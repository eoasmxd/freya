import type { ChannelPlugin, FreyaContext } from "@eoasmxd/freya-sdk";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import WebSocket from "ws";

interface WecomBotConfig {
  botId: string;
  secret: string;
}

interface WecomBotState {
  config: WecomBotConfig;
  ws?: WebSocket;
  pingTimer?: NodeJS.Timeout;
  running: boolean;
  retryDelay: number;
  retryTimer?: NodeJS.Timeout;
}

/**
 * Freya 企业微信智能机器人长连接通道插件
 */
export default class FreyaWecomChannelPlugin implements ChannelPlugin {
  readonly type = "channel" as const;

  private context!: FreyaContext;
  private bots: WecomBotConfig[] = [];
  private activeBots = new Map<string, WecomBotState>();
  private contextTokens = new Map<string, string>();
  private syncTimer?: NodeJS.Timeout;

  private getWecomConnectionId(botId: string, chatId: string): string {
    return `wecom:${botId}:${chatId}`;
  }

  async setup(ctx: FreyaContext): Promise<void> {
    this.context = ctx;

    const rawBots = ctx.config.wecom?.bots;
    this.bots = Array.isArray(rawBots) ? rawBots : [];

    ctx.eventBus.on("connection:reply", async (payload: { connectionId: string; content: string }) => {
      const prefix = "wecom:";
      if (payload.connectionId.startsWith(prefix)) {
        const parts = payload.connectionId.slice(prefix.length).split(":");
        if (parts.length >= 2) {
          const botId = parts[0];
          const chatId = parts.slice(1).join(":");
          await this.sendWecomMessage(botId, chatId, payload.content);
        }
      }
    });

    this.syncTimer = setInterval(() => {
      this.syncWecomBots(ctx).catch((err) => {
        ctx.logger.error("企业微信机器人配置热更新检测异常:", err.message);
      });
    }, 5000);

    ctx.logger.debug("企业微信频道插件已成功初始化。");
  }

  async start(ctx: FreyaContext): Promise<void> {
    if (this.bots.length === 0) {
      ctx.logger.debug("未检测到企业微信机器人配置，热重载轮询已就绪。");
      return;
    }

    for (const botConfig of this.bots) {
      this.startBot(ctx, botConfig);
    }
  }

  async stop(ctx: FreyaContext): Promise<void> {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
    }

    for (const [botId, state] of this.activeBots) {
      this.closeWecomBot(state);
    }
    this.activeBots.clear();
  }

  private startBot(ctx: FreyaContext, config: WecomBotConfig): void {
    const botId = config.botId.trim();
    if (!botId) return;

    const state: WecomBotState = {
      config,
      running: true,
      retryDelay: 5000
    };
    this.activeBots.set(botId, state);
    this.connectWecomBot(ctx, botId, state);
  }

  private connectWecomBot(ctx: FreyaContext, botId: string, state: WecomBotState): void {
    if (!state.running) return;

    const wsUrl = "wss://openws.work.weixin.qq.com";
    const ws = new WebSocket(wsUrl);
    state.ws = ws;

    ws.on("open", () => {
      if (!state.running) {
        ws.close();
        return;
      }

      const subscribeFrame = {
        cmd: "aibot_subscribe",
        headers: {
          req_id: crypto.randomUUID()
        },
        body: {
          bot_id: botId,
          secret: state.config.secret
        }
      };

      ws.send(JSON.stringify(subscribeFrame));
    });

    ws.on("message", (data: WebSocket.Data) => {
      try {
        const frame = JSON.parse(data.toString());
        this.handleWecomIncomingFrame(ctx, botId, state, frame);
      } catch (err: any) {
        ctx.logger.error(`企业微信机器人 [${botId}] 解析 WS 数据失败:`, err.message);
      }
    });

    ws.on("close", (code, reason) => {
      this.clearWecomTimers(state);
      if (state.running) {
        ctx.logger.warn(`企业微信机器人 [${botId}] 连接已断开 (${code}: ${reason.toString() || "未知原因"})，将于 ${state.retryDelay / 1000} 秒后尝试重新连接...`);
        state.retryTimer = setTimeout(() => {
          state.retryDelay = Math.min(state.retryDelay * 2, 5 * 60 * 1000);
          this.connectWecomBot(ctx, botId, state);
        }, state.retryDelay);
      }
    });

    ws.on("error", (err: any) => {
      ctx.logger.error(`企业微信机器人 [${botId}] WS 连接出现异常:`, err.message);
    });
  }

  private async handleWecomIncomingFrame(ctx: FreyaContext, botId: string, state: WecomBotState, frame: any): Promise<void> {
    const cmd = frame.cmd;
    const reqId = frame.headers?.req_id;

    if (cmd === "aibot_subscribe_resp") {
      const errcode = frame.body?.errcode;
      if (errcode === 0) {
        state.retryDelay = 5000;
        ctx.logger.info(`企业微信智能机器人 [${botId}] 认证成功，长连接已建立。`);
        this.startPingInterval(botId, state);
      } else {
        ctx.logger.error(`企业微信智能机器人 [${botId}] 认证授权失败：errcode=${errcode}, errmsg=${frame.body?.errmsg || "未知错误"}`);
        state.retryDelay = 30000;
        state.ws?.close();
      }
    } else if (cmd === "aibot_msg_callback") {
      const body = frame.body;
      if (!body) return;

      const userId = body.from?.userid;
      if (!userId) return;

      const chatId = body.chatid || userId;
      const connectionId = this.getWecomConnectionId(botId, chatId);

      if (reqId) {
        this.contextTokens.set(connectionId, reqId);
      }

      const msgtype = body.msgtype;
      let content = "";
      const attachments: any[] = [];

      const parseWecomMsgItem = async (item: any) => {
        const type = item.msgtype;
        if (type === "text" && item.text?.content) {
          return { text: item.text.content, attach: [] };
        }

        const attachList: any[] = [];
        let textResult = "";

        if (type === "image" && item.image) {
          const img = item.image;
          const mediaId = img.media_id || "";
          const url = img.url || img.pic_url || "";
          const aesKey = img.aeskey || img.aes_key || "";
          let localPath: string | undefined;
          if (url) {
            const name = mediaId || `image-${Date.now()}`;
            localPath = await this.downloadAndDecryptMedia(ctx, url, aesKey, `${name}.jpg`);
          }
          if (localPath) {
            textResult = `[图片] (已保存至本地: ${localPath})`;
            attachList.push({
              type: "image",
              mimeType: "image/jpeg",
              path: localPath
            });
          } else {
            textResult = `🤖 [收到图片] 收到用户发送的一张图片 (media_id: "${mediaId}")。由于安全加密通道限制目前无法下载解密，请用户将关键问题改用文字描述。`;
            attachList.push({
              type: "image",
              mimeType: "image/jpeg",
              path: mediaId
            });
          }
        } else if (type === "voice" && item.voice) {
          const voice = item.voice;
          const mediaId = voice.media_id || "";
          const url = voice.url || "";
          const aesKey = voice.aeskey || voice.aes_key || "";
          let localPath: string | undefined;
          if (url) {
            const name = mediaId || `voice-${Date.now()}`;
            localPath = await this.downloadAndDecryptMedia(ctx, url, aesKey, `${name}.ogg`);
          }
          if (localPath) {
            textResult = `[语音] (已保存至本地: ${localPath})`;
            attachList.push({
              type: "file",
              mimeType: "audio/ogg",
              path: localPath
            });
          } else {
            textResult = `🤖 [收到语音] 收到用户发送的一段语音消息 (media_id: "${mediaId}")。由于当前通道安全限制，本通道目前无法解密还原，请引导用户使用文本与您对话。`;
            attachList.push({
              type: "file",
              mimeType: "audio/ogg",
              path: mediaId
            });
          }
        } else if (type === "file" && item.file) {
          const file = item.file;
          const mediaId = file.media_id || "";
          const fileName = file.file_name || file.name || "未命名文件";
          const url = file.url || "";
          const aesKey = file.aeskey || file.aes_key || "";
          let localPath: string | undefined;
          if (url) {
            localPath = await this.downloadAndDecryptMedia(ctx, url, aesKey, fileName);
          }
          if (localPath) {
            textResult = `[文件: ${fileName}] (已保存至本地: ${localPath})`;
            attachList.push({
              type: "file",
              mimeType: item.file.mime_type || "application/octet-stream",
              path: localPath
            });
          } else {
            textResult = `🤖 [收到文件: "${fileName}"] 用户发送了一份文件 (media_id: "${mediaId}")。由于 WebSocket 协议的安全隔离策略暂无法直接下载解密此临时媒体文件，请告知用户您已收到了文件事件但目前无法直接打开，礼貌引导用户直接发送文本内容。`;
            attachList.push({
              type: "file",
              mimeType: "application/octet-stream",
              path: mediaId
            });
          }
        } else if (type === "video" && item.video) {
          const video = item.video;
          const mediaId = video.media_id || "";
          const url = video.url || "";
          const aesKey = video.aeskey || video.aes_key || "";
          let localPath: string | undefined;
          if (url) {
            const name = mediaId || `video-${Date.now()}`;
            localPath = await this.downloadAndDecryptMedia(ctx, url, aesKey, `${name}.mp4`);
          }
          if (localPath) {
            textResult = `[视频] (已保存至本地: ${localPath})`;
            attachList.push({
              type: "file",
              mimeType: "video/mp4",
              path: localPath
            });
          } else {
            textResult = `🤖 [收到视频] 收到用户发送的一段视频消息 (media_id: "${mediaId}")。由于当前安全机制，您无法直接播放此媒体，请礼貌引导其发送文本交流。`;
            attachList.push({
              type: "file",
              mimeType: "video/mp4",
              path: mediaId
            });
          }
        }

        return { text: textResult, attach: attachList };
      };

      if (msgtype === "mixed" && body.mixed?.msg_item) {
        const items = body.mixed.msg_item;
        const textParts: string[] = [];
        for (const item of items) {
          const res = await parseWecomMsgItem(item);
          if (res.text) {
            textParts.push(res.text);
          }
          if (res.attach.length > 0) {
            attachments.push(...res.attach);
          }
        }
        content = textParts.join("\n");
      } else {
        const res = await parseWecomMsgItem(body);
        content = res.text || "";
        if (res.attach.length > 0) {
          attachments.push(...res.attach);
        }
      }

      if (!content) {
        content = `🤖 [未知消息] 用户发来了一个不支持的协议格式消息 (msgtype: "${msgtype || "unknown"}")。`;
      }

      if (content) {
        ctx.eventBus.emit("connection:active", {
          connectionId,
          defaultSessionId: connectionId,
          staleThresholdMs: 0
        });

        ctx.eventBus.emit("connection:message", {
          connectionId,
          content,
          attachments: attachments.length > 0 ? attachments : undefined,
          defaultSessionId: connectionId
        });
      }
    } else if (cmd === "pong") {
      // 心跳响应
    }
  }

  /**
   * 下载企业微信加密媒体文件并进行 AES-256-CBC 解密还原
   */
  private async downloadAndDecryptMedia(
    ctx: FreyaContext,
    url: string,
    aesKey: string,
    fileName: string
  ): Promise<string | undefined> {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`下载媒体文件 HTTP 状态码异常: ${res.status}`);
      }
      const rawBuffer = Buffer.from(await res.arrayBuffer());
      let finalBuffer = rawBuffer;

      if (aesKey) {
        let keyBuffer = Buffer.from(aesKey, "base64");
        if (keyBuffer.length !== 32) {
          keyBuffer = Buffer.from(aesKey, "utf-8");
        }
        if (keyBuffer.length !== 32) {
          keyBuffer = Buffer.alloc(32, aesKey);
        }

        const iv = keyBuffer.subarray(0, 16);
        const decipher = crypto.createDecipheriv("aes-256-cbc", keyBuffer, iv);
        decipher.setAutoPadding(true);

        finalBuffer = Buffer.concat([
          decipher.update(rawBuffer),
          decipher.final()
        ]);
      }

      const downloadDir = path.join(
        process.env.FREYA_HOME || path.join(process.env.USERPROFILE || "", ".freya"),
        "workspace",
        "download"
      );
      await fs.mkdir(downloadDir, { recursive: true });

      const safeFileName = `${Date.now()}-${fileName.replace(/[\\/:*?"<>|]/g, "_")}`;
      const filePath = path.join(downloadDir, safeFileName);
      await fs.writeFile(filePath, finalBuffer);
      return `download/${safeFileName}`;
    } catch (err: any) {
      ctx.logger.error(`下载或解密企业微信媒体附件失败 [${fileName}]:`, err.message);
      return undefined;
    }
  }

  private startPingInterval(botId: string, state: WecomBotState): void {
    if (state.pingTimer) clearInterval(state.pingTimer);

    state.pingTimer = setInterval(() => {
      if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        const pingFrame = {
          cmd: "ping",
          headers: {
            req_id: crypto.randomUUID()
          }
        };
        state.ws.send(JSON.stringify(pingFrame));
      }
    }, 30000);
  }

  private async sendWecomMessage(botId: string, chatId: string, content: string): Promise<void> {
    const state = this.activeBots.get(botId);
    if (!state) {
      this.context.logger.error(`[企业微信发信失败] 未找到机器人实例状态: ${botId}`);
      return;
    }
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
      this.context.logger.error(`[企业微信发信失败] 机器人 [${botId}] 连接未建立或已断开 (readyState: ${state.ws ? state.ws.readyState : "未定义"})`);
      return;
    }

    const connectionId = this.getWecomConnectionId(botId, chatId);
    const originalReqId = this.contextTokens.get(connectionId) || crypto.randomUUID();

    const respondFrame = {
      cmd: "aibot_respond_msg",
      headers: {
        req_id: originalReqId
      },
      body: {
        msgtype: "markdown",
        markdown: {
          content: content
        },
        finish: true
      }
    };

    try {
      state.ws.send(JSON.stringify(respondFrame), (err) => {
        if (err) {
          this.context.logger.error(`[企业微信发信失败] 机器人 [${botId}] 发送 WS 帧物理失败:`, err.message);
        }
      });
    } catch (err: any) {
      this.context.logger.error(`[企业微信发信异常] 机器人 [${botId}] 发信异常:`, err.message);
    }
  }

  /**
   * 定期同步内存中的活跃机器人列表，提供配置平滑热重载支持
   */
  private async syncWecomBots(ctx: FreyaContext): Promise<void> {
    const rawBots = ctx.config.wecom?.bots;
    const latestBots: WecomBotConfig[] = Array.isArray(rawBots) ? rawBots : [];

    for (const [botId, activeState] of this.activeBots.entries()) {
      const target = latestBots.find((b) => b.botId.trim() === botId);
      if (!target || target.secret !== activeState.config.secret) {
        this.closeWecomBot(activeState);
        this.activeBots.delete(botId);
        ctx.logger.info(`[企业微信热更新] 成功热停用智能机器人: ${botId}`);
      }
    }

    for (const config of latestBots) {
      const botId = config.botId.trim();
      if (!botId) continue;

      if (!this.activeBots.has(botId)) {
        this.startBot(ctx, config);
        ctx.logger.info(`[企业微信热更新] 检测到新配置，正在热加载启动机器人: ${botId}`);
      }
    }
  }

  private closeWecomBot(state: WecomBotState): void {
    state.running = false;
    this.clearWecomTimers(state);
    if (state.ws) {
      state.ws.close();
    }
  }

  private clearWecomTimers(state: WecomBotState): void {
    if (state.pingTimer) {
      clearInterval(state.pingTimer);
      state.pingTimer = undefined;
    }
    if (state.retryTimer) {
      clearTimeout(state.retryTimer);
      state.retryTimer = undefined;
    }
  }
}

export const Plugin = FreyaWecomChannelPlugin;
