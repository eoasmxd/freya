import type { ChannelPlugin, FreyaAttachment, FreyaContext, FreyaTool, ToolPlugin } from "@eoasmxd/freya-sdk";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import WebSocket from "ws";
import { WecomSendWebhookTool } from "./webhook-tool.js";

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

const WECOM_MIME_MAP: Record<string, string> = {
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".html": "text/html",
  ".htm": "text/html",
  ".csv": "text/csv",
  ".md": "text/markdown",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".mp4": "video/mp4",
  ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp"
};

/**
 * Freya 企业微信长连接通道与群 Webhook 工具插件
 * Freya WeChat Work persistent channel and group webhook toolbox plugin
 */
export default class FreyaWecomChannelPlugin implements ChannelPlugin, ToolPlugin {
  readonly type = ["channel", "tool"] as const;

  private context!: FreyaContext;
  private tools: FreyaTool[] = [];
  private bots: WecomBotConfig[] = [];
  private activeBots = new Map<string, WecomBotState>();
  private contextTokens = new Map<string, string>();
  private syncTimer?: NodeJS.Timeout;

  private getWecomConnectionId(botId: string, chatId: string): string {
    return `wecom:${botId}:${chatId}`;
  }

  async setup(ctx: FreyaContext): Promise<void> {
    this.context = ctx;
    this.tools = [new WecomSendWebhookTool(ctx)];

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
        ctx.logger.error("WeCom bot config hot reload detection error:", err.message);
      });
    }, 5000);

    ctx.logger.debug("WeCom channel plugin initialized successfully.");
  }

  async start(ctx: FreyaContext): Promise<void> {
    if (this.bots.length === 0) {
      ctx.logger.debug("No WeCom bot configurations detected, hot reload polling ready.");
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

  getId(): string {
    return "wecom";
  }

  getInstructionPrompt(): string {
    return "plugin.prompt.wecom";
  }

  getTools(): FreyaTool[] {
    return this.tools;
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
        ctx.logger.error(`WeCom bot [${botId}] failed to parse WS frame:`, err.message);
      }
    });

    ws.on("close", (code, reason) => {
      this.clearWecomTimers(state);
      if (state.running) {
        ctx.logger.warn(`WeCom bot [${botId}] connection closed (${code}: ${reason.toString() || "unknown"}), reconnecting in ${state.retryDelay / 1000}s...`);
        state.retryTimer = setTimeout(() => {
          state.retryDelay = Math.min(state.retryDelay * 2, 5 * 60 * 1000);
          this.connectWecomBot(ctx, botId, state);
        }, state.retryDelay);
      }
    });

    ws.on("error", (err: any) => {
      ctx.logger.error(`WeCom bot [${botId}] WS connection error:`, err.message);
    });
  }

  private async handleWecomIncomingFrame(ctx: FreyaContext, botId: string, state: WecomBotState, frame: any): Promise<void> {
    const cmd = frame.cmd;
    const reqId = frame.headers?.req_id;

    if (cmd === "aibot_subscribe_resp") {
      const errcode = frame.body?.errcode;
      if (errcode === 0) {
        state.retryDelay = 5000;
        ctx.logger.info(`WeCom bot [${botId}] authenticated successfully, persistent connection established.`);
        this.startPingInterval(botId, state);
      } else {
        ctx.logger.error(`WeCom bot [${botId}] authentication failed: errcode=${errcode}, errmsg=${frame.body?.errmsg || "unknown error"}`);
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
      const attachments: FreyaAttachment[] = [];

      const parseWecomMsgItem = async (item: any) => {
        const type = item.msgtype;
        if (type === "text" && item.text?.content) {
          return { text: item.text.content, attach: [] };
        }

        const attachList: FreyaAttachment[] = [];
        let textResult = "";

        if (type === "image" && item.image) {
          const img = item.image;
          const mediaId = img.media_id || "";
          const url = img.url || "";
          const aesKey = img.aeskey || "";
          let result: { path: string; mimeType: string } | undefined;
          if (url) {
            const name = mediaId || `image-${Date.now()}`;
            result = await this.downloadAndDecryptMedia(ctx, url, aesKey, `${name}.jpg`, true);
          }
          if (result) {
            attachList.push({
              type: "image",
              mimeType: result.mimeType,
              path: result.path
            });
          } else {
            // 无法解密的图片提示词
            textResult = `[Received Image] The user sent an image (media_id: "${mediaId}"). Due to secure channel encryption constraints, it cannot be downloaded. Please ask the user to describe their question or request in text.`;
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
          const aesKey = voice.aeskey || "";
          let result: { path: string; mimeType: string } | undefined;
          if (url) {
            const name = mediaId || `voice-${Date.now()}`;
            result = await this.downloadAndDecryptMedia(ctx, url, aesKey, `${name}.ogg`, false);
          }
          if (result) {
            attachList.push({
              type: "file",
              mimeType: result.mimeType,
              path: result.path
            });
          } else {
            // 无法解密的语音提示词
            textResult = `[Received Voice] The user sent a voice message (media_id: "${mediaId}"). Due to channel security constraints, voice cannot be decrypted. Please guide the user to communicate with text.`;
            attachList.push({
              type: "file",
              mimeType: "audio/ogg",
              path: mediaId
            });
          }
        } else if (type === "file" && item.file) {
          const file = item.file;
          const mediaId = file.media_id || "";
          // 默认未命名文件名
          const fileName = file.file_name || "untitled_file";
          const url = file.url || "";
          const aesKey = file.aeskey || "";
          let result: { path: string; mimeType: string } | undefined;
          if (url) {
            result = await this.downloadAndDecryptMedia(ctx, url, aesKey, fileName, false);
          }
          if (result) {
            attachList.push({
              type: "file",
              mimeType: result.mimeType,
              path: result.path
            });
          } else {
            // 无法下载的文件提示词
            textResult = `[Received File: "${fileName}"] The user sent a file (media_id: "${mediaId}"). Due to security isolation policy, this media file cannot be downloaded directly. Please acknowledge receiving the file event, inform the user that it cannot be opened directly, and politely guide them to send the text content.`;
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
          const aesKey = video.aeskey || "";
          let result: { path: string; mimeType: string } | undefined;
          if (url) {
            const name = mediaId || `video-${Date.now()}`;
            result = await this.downloadAndDecryptMedia(ctx, url, aesKey, `${name}.mp4`, false);
          }
          if (result) {
            attachList.push({
              type: "file",
              mimeType: result.mimeType,
              path: result.path
            });
          } else {
            // 无法播放的视频提示词
            textResult = `[Received Video] The user sent a video message (media_id: "${mediaId}"). Due to current security mechanisms, you cannot view this media. Please guide the user to communicate in text.`;
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
        // 不支持的消息类型提示词
        content = `[Unsupported Message] The user sent an unsupported message format (msgtype: "${msgtype || "unknown"}").`;
      }

      if (content) {
        ctx.eventBus.emit("connection:active", {
          connectionId,
          defaultSessionId: connectionId,
          staleThresholdMs: 0,
          channelType: "wecom",
          defaultLanguage: "zh"
        });

        ctx.eventBus.emit("connection:message", {
          connectionId,
          content,
          attachments: attachments.length > 0 ? attachments : undefined,
          defaultSessionId: connectionId,
          channelType: "wecom",
          defaultLanguage: "zh"
        });
      }
    } else if (cmd === "pong") {
      // 心跳响应
      // Heartbeat response
    }
  }

  private detectMimeType(buffer: Buffer): { mimeType: string; ext: string } {
    if (buffer.length > 4) {
      if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return { mimeType: "image/jpeg", ext: "jpg" };
      }
      if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
        return { mimeType: "image/png", ext: "png" };
      }
      if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
        return { mimeType: "image/gif", ext: "gif" };
      }
      if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
        const webpHeader = buffer.subarray(8, 12).toString("ascii");
        if (webpHeader === "WEBP") {
          return { mimeType: "image/webp", ext: "webp" };
        }
      }
    }
    return { mimeType: "image/jpeg", ext: "jpg" };
  }

  /**
   * 下载企业微信加密媒体文件并进行 AES-256-CBC 解密还原
   * Download WeChat Work encrypted media file and decrypt via AES-256-CBC
   */
  private async downloadAndDecryptMedia(
    ctx: FreyaContext,
    url: string,
    aesKey: string,
    fileName: string,
    isImage = false
  ): Promise<{ path: string; mimeType: string } | undefined> {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        // 下载媒体文件 HTTP 状态码异常
        throw new Error(`Failed to download media file with HTTP status: ${res.status}`);
      }
      const rawBuffer = Buffer.from(await res.arrayBuffer());
      let finalBuffer = rawBuffer;

      if (aesKey) {
        let safeKey = aesKey;
        while (safeKey.length % 4 !== 0) {
          safeKey += "=";
        }

        const keyBuffer = Buffer.from(safeKey, "base64");
        let finalKey = keyBuffer;
        if (keyBuffer.length !== 32) {
          finalKey = Buffer.alloc(32, keyBuffer);
        }

        const iv = finalKey.subarray(0, 16);
        const decipher = crypto.createDecipheriv("aes-256-cbc", finalKey, iv);
        decipher.setAutoPadding(false);

        const decrypted = Buffer.concat([
          decipher.update(rawBuffer),
          decipher.final()
        ]);

        const padLen = decrypted[decrypted.length - 1];
        if (padLen < 1 || padLen > 32 || padLen > decrypted.length) {
          // 解密填充长度异常
          throw new Error(`Decryption failed: invalid padding length (${padLen})`);
        }
        for (let i = decrypted.length - padLen; i < decrypted.length; i++) {
          if (decrypted[i] !== padLen) {
            // 解密填充字节不匹配
            throw new Error("Decryption failed: padding bytes mismatch");
          }
        }
        finalBuffer = decrypted.subarray(0, decrypted.length - padLen);
      }

      let mimeType = "application/octet-stream";
      let finalFileName = fileName;

      if (isImage) {
        const detected = this.detectMimeType(finalBuffer);
        mimeType = detected.mimeType;
        finalFileName = `image.${detected.ext}`;
      } else {
        const ext = path.extname(fileName).toLowerCase();
        mimeType = WECOM_MIME_MAP[ext] || "application/octet-stream";
      }

      const downloadDir = path.resolve(ctx.paths.workspaceDir, "cache/wecom");
      await fs.mkdir(downloadDir, { recursive: true });

      const safeFileName = `${Date.now()}-${finalFileName.replace(/[\\/:*?"<>|]/g, "_")}`;
      const filePath = path.join(downloadDir, safeFileName);
      await fs.writeFile(filePath, finalBuffer);

      return {
        path: `cache/wecom/${safeFileName}`,
        mimeType
      };
    } catch (err: any) {
      ctx.logger.error(`Failed to download or decrypt WeCom media attachment [${fileName}]:`, err.message);
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
      this.context.logger.error(`[WeCom Send Failed] Bot instance state not found: ${botId}`);
      return;
    }
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
      this.context.logger.error(`[WeCom Send Failed] Bot [${botId}] connection not established or disconnected (readyState: ${state.ws ? state.ws.readyState : "undefined"})`);
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
          this.context.logger.error(`[WeCom Send Failed] Bot [${botId}] failed to send WS frame:`, err.message);
        }
      });
    } catch (err: any) {
      this.context.logger.error(`[WeCom Send Exception] Bot [${botId}] message send exception:`, err.message);
    }
  }

  /**
   * 定期同步内存中的活跃机器人列表，提供配置平滑热重载支持
   * Periodically synchronize active bots in memory to support smooth configuration hot-reloading
   */
  private async syncWecomBots(ctx: FreyaContext): Promise<void> {
    const rawBots = ctx.config.wecom?.bots;
    const latestBots: WecomBotConfig[] = Array.isArray(rawBots) ? rawBots : [];

    for (const [botId, activeState] of this.activeBots.entries()) {
      const target = latestBots.find((b) => b.botId.trim() === botId);
      if (!target || target.secret !== activeState.config.secret) {
        this.closeWecomBot(activeState);
        this.activeBots.delete(botId);
        ctx.logger.info(`[WeCom Hot Reload] Hot deactivated bot: ${botId}`);
      }
    }

    for (const config of latestBots) {
      const botId = config.botId.trim();
      if (!botId) continue;

      if (!this.activeBots.has(botId)) {
        this.startBot(ctx, config);
        ctx.logger.info(`[WeCom Hot Reload] New config detected, hot starting bot: ${botId}`);
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
