import type { ChannelPlugin, FreyaAttachment, FreyaCommand, FreyaContext } from "@eoasmxd/freya-sdk";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
// @ts-ignore
import qrcodeTerminal from "qrcode-terminal";

interface WeixinBotConfig {
  id: string;
  appId: string;
}

interface WeixinAccountState {
  config: WeixinBotConfig;
  abortController: AbortController;
  running: boolean;
  getUpdatesBuf: string;
  isLoggedIn: boolean;
  token?: string;
  baseUrl?: string;
  botId?: string;
}

const WEIXIN_MIME_MAP: Record<string, string> = {
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
 * Freya 微信智能群设备 (iLink 协议) 通道插件
 */
export default class FreyaWeixinChannelPlugin implements ChannelPlugin {
  readonly type = "channel" as const;

  private context!: FreyaContext;
  private activeAccounts = new Map<string, WeixinAccountState>();
  private contextTokens = new Map<string, string>();

  commands: FreyaCommand[] = [
    {
      name: "weixin",
      description: "微信机器人管理指令",
      subcommands: [
        { name: "list", description: "列出当前已加载微信账号及其连接登录状态" },
        { name: "login", description: "拉取微信扫码登录二维码，用法: /weixin login <accountId>" }
      ],
      execute: async (args: string[], sessionId: string, ctx: FreyaContext): Promise<string | void> => {
        const sub = args[0]?.trim().toLowerCase();

        if (sub === "list") {
          if (this.activeAccounts.size === 0) {
            return "ℹ️ 当前没有加载任何微信账号实例。";
          }

          let output = "📱 **微信账号连接状态列表**：\n\n";
          for (const [accountId, state] of this.activeAccounts.entries()) {
            const statusStr = state.isLoggedIn ? "✅ **已登录 / 在线**" : "❌ **未登录 / 离线**";
            output += `- 账号 ID: \`${accountId}\` —— ${statusStr}\n`;
            if (!state.isLoggedIn) {
              output += `  *(提示：可运行 \`/weixin login ${accountId}\` 启动扫码登录)*\n`;
            }
          }
          return output;
        }

        if (sub === "login") {
          const accountId = args[1]?.trim();
          if (!accountId) {
            return "❌ 缺少必要参数：请指定微信账号标识 id，例如 `/weixin login my_weixin`";
          }

          let state = this.activeAccounts.get(accountId);
          if (!state) {
            const newConfig: WeixinBotConfig = {
              id: accountId,
              appId: "bot"
            };
            const abortController = new AbortController();
            state = {
              config: newConfig,
              abortController,
              running: true,
              getUpdatesBuf: "",
              isLoggedIn: false
            };
            this.activeAccounts.set(accountId, state);
          }

          if (state.isLoggedIn) {
            return `ℹ️ 微信账号 [${accountId}] 已经是登录在线状态。`;
          }

          return await this.triggerWeixinQrLogin(ctx, accountId, state.config);
        }

        return "❌ 未知子命令：支持的子命令有 `list` 和 `login`。用法示例：\n- `/weixin list`\n- `/weixin login my_weixin`";
      }
    }
  ];

  private getWeixinConnectionId(botId: string, chatId: string): string {
    return `weixin:${botId}:${chatId}`;
  }

  /**
   * 从本地物理路径加载微信会话缓存数据
   */
  private async loadWeixinSessions(ctx: FreyaContext): Promise<Record<string, any>> {
    const filePath = path.join(ctx.paths.dataDir, "weixin_sessions.json");
    try {
      const content = await fs.readFile(filePath, "utf-8");
      return JSON.parse(content);
    } catch {
      return {};
    }
  }

  /**
   * 将微信会话缓存持久化保存至本地物理路径中
   */
  private async saveWeixinSessions(ctx: FreyaContext, sessions: Record<string, any>): Promise<void> {
    const filePath = path.join(ctx.paths.dataDir, "weixin_sessions.json");
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(sessions, null, 2) + "\n", "utf-8");
  }

  private buildWeixinHeaders(config: WeixinBotConfig, token?: string): Record<string, string> {
    const randomUin = String(crypto.randomBytes(4).readUInt32BE(0));
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "AuthorizationType": "ilink_bot_token",
      "X-WECHAT-UIN": randomUin,
      "iLink-App-Id": config.appId || "bot",
      "iLink-App-ClientVersion": "65547"
    };
    if (token) {
      headers.Authorization = `Bearer ${token.trim()}`;
    }
    return headers;
  }

  private buildWeixinBaseInfo(): Record<string, string> {
    return {
      channel_version: "0.1.0",
      bot_agent: "Freya/0.1.0"
    };
  }

  /**
   * 调用微信官方 iLink 服务端 HTTP API 接口
   */
  private async callWeixinApi(
    config: WeixinBotConfig,
    endpoint: string,
    body: Record<string, any>,
    signal?: AbortSignal,
    customBaseUrl?: string,
    token?: string
  ): Promise<any> {
    const baseUrl = customBaseUrl || "https://ilinkai.weixin.qq.com";
    const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;

    const response = await fetch(`${base}${endpoint}`, {
      method: "POST",
      headers: this.buildWeixinHeaders(config, token),
      body: JSON.stringify({
        ...body,
        base_info: this.buildWeixinBaseInfo()
      }),
      signal
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`微信 iLink 接口 ${endpoint} 失败 (${response.status}): ${errText}`);
    }

    return await response.json();
  }

  async setup(ctx: FreyaContext): Promise<void> {
    this.context = ctx;

    ctx.eventBus.on("connection:reply", async (payload: { connectionId: string; content: string }) => {
      const prefix = "weixin:";
      if (payload.connectionId.startsWith(prefix)) {
        const parts = payload.connectionId.slice(prefix.length).split(":");
        if (parts.length >= 2) {
          const botId = parts[0];
          const chatId = parts.slice(1).join(":");
          await this.sendWeixinMessage(botId, chatId, payload.content);
        }
      }
    });

    this.context.logger.debug("微信频道插件已成功初始化，等待冷启动装载会话缓存。");
  }

  async start(ctx: FreyaContext): Promise<void> {
    const sessions = await this.loadWeixinSessions(ctx);
    for (const [accountId, session] of Object.entries(sessions)) {
      if (session && session.token && session.baseUrl) {
        const config: WeixinBotConfig = {
          id: accountId,
          appId: session.appId || "bot"
        };
        await this.startWeixinAccount(ctx, config, session);
      }
    }
  }

  async stop(ctx: FreyaContext): Promise<void> {
    for (const [accountId, state] of this.activeAccounts) {
      ctx.logger.debug(`正在停用并移除微信账号 [${accountId}]...`);
      state.running = false;
      state.abortController.abort();
      if (state.isLoggedIn && state.token && state.baseUrl) {
        await this.callWeixinApi(state.config, "ilink/bot/msg/notifystop", {}, undefined, state.baseUrl, state.token).catch(() => { });
      }
    }
    this.activeAccounts.clear();
  }

  private async startWeixinAccount(ctx: FreyaContext, config: WeixinBotConfig, session: any): Promise<void> {
    const accountId = config.id.trim();
    if (!accountId) return;

    const abortController = new AbortController();
    const state: WeixinAccountState = {
      config,
      abortController,
      running: true,
      getUpdatesBuf: "",
      isLoggedIn: true,
      token: session.token,
      baseUrl: session.baseUrl,
      botId: session.botId || "bot_default"
    };
    this.activeAccounts.set(accountId, state);

    try {
      await this.callWeixinApi(config, "ilink/bot/msg/notifystart", {}, undefined, state.baseUrl, state.token);
      this.startWeixinLoop(ctx, accountId, state);
      ctx.logger.debug(`微信账号 [${accountId}] 登录态冷启动恢复成功，已开启长轮询。`);
    } catch (err: any) {
      ctx.logger.error(`微信账号 [${accountId}] 登录凭证冷启动恢复失败，连接已失效。请手动执行 \`/weixin login ${accountId}\` 重新扫码登录。`, err.message);
      state.isLoggedIn = false;
    }
  }

  /**
   * 拉取并生成微信登录绑定二维码，启动后台监听轮询
   */
  private async triggerWeixinQrLogin(ctx: FreyaContext, accountId: string, config: WeixinBotConfig): Promise<string> {
    try {
      const res = await this.callWeixinApi(config, "ilink/bot/get_bot_qrcode?bot_type=3", {}, undefined, "https://ilinkai.weixin.qq.com");
      const qrcode = res.qrcode;
      if (!qrcode) {
        throw new Error("获取微信登录二维码失败：服务端未返回 qrcode");
      }

      const matrix: number[][] = [];
      qrcodeTerminal.generate(qrcode, { small: false }, (code: string) => {
        const lines = code.split("\n");
        for (const line of lines) {
          const cleanLine = line.replace(/[\r\n]/g, "");
          if (!cleanLine) continue;
          const row: number[] = [];
          const re = /\x1b\[(40|47)m  \x1b\[0m/g;
          let match;
          while ((match = re.exec(cleanLine)) !== null) {
            row.push(match[1] === "40" ? 1 : 0);
          }
          if (row.length > 0) {
            matrix.push(row);
          }
        }
      });

      const size = matrix.length;
      let svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="180" height="180" style="shape-rendering:crispEdges;">`;
      svgContent += `<rect width="${size}" height="${size}" fill="#ffffff"/>`;
      for (let y = 0; y < size; y++) {
        const row = matrix[y];
        for (let x = 0; x < row.length; x++) {
          if (row[x] === 1) {
            svgContent += `<rect x="${x}" y="${y}" width="1" height="1" fill="#000000"/>`;
          }
        }
      }
      svgContent += `</svg>`;

      const base64Svg = Buffer.from(svgContent).toString("base64");
      const qrDataUri = `data:image/svg+xml;base64,${base64Svg}`;

      this.pollWeixinQrStatus(ctx, accountId, config, qrcode).catch((err) => {
        ctx.logger.error(`微信账号 [${accountId}] 后台监听扫码绑定失败:`, err.message);
      });

      return `⚠️ **微信账号 [${accountId}] 登录二维码已成功生成！**\n\n` +
        `**[微信扫码] 请使用微信扫描下方二维码绑定账号 [${accountId}]**：\n\n` +
        `![微信登录二维码](${qrDataUri})\n\n` +
        `*(提示：若二维码未能正常显示，您可以直接点击 [打开微信二维码网页](${qrcode}) 扫码绑定)*`;
    } catch (err: any) {
      ctx.logger.error(`微信账号 [${accountId}] 拉取扫码登录失败:`, err.message);
      return `❌ 拉取微信登录二维码失败: ${err.message}`;
    }
  }

  private startWeixinLoop(ctx: FreyaContext, accountId: string, state: WeixinAccountState): void {
    (async () => {
      while (state.running && state.isLoggedIn && state.token && state.baseUrl) {
        try {
          const res = await this.callWeixinApi(
            state.config,
            "ilink/bot/getupdates",
            { get_updates_buf: state.getUpdatesBuf },
            state.abortController.signal,
            state.baseUrl,
            state.token
          );

          const hasError = (res.errcode !== undefined && res.errcode !== 0) || (res.ret !== undefined && res.ret !== 0);
          if (!hasError) {
            if (res.get_updates_buf) {
              state.getUpdatesBuf = res.get_updates_buf;
            }
            const msgs = res.msgs || [];

            for (const weixinMsg of msgs) {
              const userId = weixinMsg.from_user_id;
              if (!userId) continue;

              const connectionId = this.getWeixinConnectionId(accountId, userId);
              if (weixinMsg.context_token) {
                this.contextTokens.set(connectionId, weixinMsg.context_token);
              }

              const items = weixinMsg.item_list || [];
              for (const item of items) {
                let text = "";
                const attachments: FreyaAttachment[] = [];

                if (item.type === 1 && item.text_item?.text) {
                  text = item.text_item.text;
                } else if (item.type === 2) {
                  const imgUrl = item.image_item?.media?.full_url || "";
                  const aesKey = item.image_item?.aeskey || "";
                  let result: { path: string; mimeType: string } | undefined;
                  if (imgUrl) {
                    result = await this.downloadAndDecryptWeixinMedia(ctx, imgUrl, aesKey, "image.jpg", true);
                  }
                  if (result) {
                    attachments.push({
                      type: "image",
                      mimeType: result.mimeType,
                      path: result.path
                    });
                  } else {
                    text = `[图片]${imgUrl ? `(${imgUrl})` : " (无法获取图片链接)"}`;
                    if (imgUrl) {
                      attachments.push({
                        type: "image",
                        mimeType: "image/jpeg",
                        url: imgUrl
                      });
                    }
                  }
                } else if (item.type === 3) {
                  const voiceText = item.voice_item?.text || "";
                  text = `[语音转文字: ${voiceText || "未识别到语音内容"}]`;
                } else if (item.type === 4 && item.file_item) {
                  const fileUrl = item.file_item.media?.full_url || "";
                  const fileName = item.file_item.file_name || "未命名文件";
                  const aesKey = item.file_item.media?.aes_key || "";
                  let result: { path: string; mimeType: string } | undefined;
                  if (fileUrl) {
                    result = await this.downloadAndDecryptWeixinMedia(ctx, fileUrl, aesKey, fileName, false);
                  }
                  if (result) {
                    attachments.push({
                      type: "file",
                      mimeType: result.mimeType,
                      path: result.path
                    });
                  } else {
                    text = `[文件附件: ${fileName}]${fileUrl ? `(${fileUrl})` : " (无法获取下载链接)"}`;
                    if (fileUrl) {
                      attachments.push({
                        type: "file",
                        mimeType: "application/octet-stream",
                        url: fileUrl
                      });
                    }
                  }
                } else if (item.type === 5) {
                  const videoUrl = item.video_item?.media?.full_url || "";
                  const aesKey = item.video_item?.media?.aes_key || "";
                  let result: { path: string; mimeType: string } | undefined;
                  if (videoUrl) {
                    result = await this.downloadAndDecryptWeixinMedia(ctx, videoUrl, aesKey, "video.mp4", false);
                  }
                  if (result) {
                    attachments.push({
                      type: "file",
                      mimeType: result.mimeType,
                      path: result.path
                    });
                  } else {
                    text = `[视频]${videoUrl ? `(${videoUrl})` : " (无法获取视频链接)"}`;
                    if (videoUrl) {
                      attachments.push({
                        type: "file",
                        mimeType: "video/mp4",
                        url: videoUrl
                      });
                    }
                  }
                }

                if (text) {
                  ctx.eventBus.emit("connection:active", {
                    connectionId,
                    defaultSessionId: connectionId,
                    staleThresholdMs: 0
                  });

                  ctx.eventBus.emit("connection:message", {
                    connectionId,
                    content: text,
                    attachments: attachments.length > 0 ? attachments : undefined,
                    defaultSessionId: connectionId
                  });
                }
              }
            }
          } else if (res.errcode === -14 || res.ret === -14) {
            ctx.logger.error(`微信账号 [${accountId}] 服务连接已失效 (ErrorCode -14)，自动注销缓存。请手动运行 \`/weixin login ${accountId}\` 重新扫码上线。`);
            state.isLoggedIn = false;

            const sessions = await this.loadWeixinSessions(ctx);
            delete sessions[accountId];
            await this.saveWeixinSessions(ctx, sessions);
            break;
          } else {
            ctx.logger.warn(`微信账号 [${accountId}] 长轮询异常: errcode=${res.errcode}, ret=${res.ret}`);
            await new Promise((resolve) => setTimeout(resolve, 5000));
          }
        } catch (err: any) {
          if (err.name === "AbortError") break;
          ctx.logger.error(`微信账号 [${accountId}] 轮询网络异常:`, err.message);
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }
      }
    })();
  }

  private async pollWeixinQrStatus(
    ctx: FreyaContext,
    accountId: string,
    config: WeixinBotConfig,
    qrcode: string
  ): Promise<void> {
    const state = this.activeAccounts.get(accountId);
    if (!state) return;

    const startTime = Date.now();
    const TIMEOUT_MS = 5 * 60 * 1000;

    let loginConfirmed = false;
    while (state.running && !loginConfirmed) {
      if (Date.now() - startTime > TIMEOUT_MS) {
        ctx.logger.warn(`微信账号 [${accountId}] 扫码绑定超时（已监听超过 5 分钟），已自动停止监听。`);
        break;
      }

      try {
        const res = await this.callWeixinApi(
          config,
          `ilink/bot/get_qrcode_status?bot_type=3&qrcode=${encodeURIComponent(qrcode)}`,
          {},
          state.abortController.signal,
          "https://ilinkai.weixin.qq.com"
        );

        if (res.status === "confirmed" && res.bot_token) {
          const sessions = await this.loadWeixinSessions(ctx);
          const finalBaseUrl = res.baseurl || "https://ilinkai.weixin.qq.com";
          const finalBotId = res.ilink_bot_id || "bot_default";

          sessions[accountId] = {
            appId: config.appId,
            token: res.bot_token,
            baseUrl: finalBaseUrl,
            botId: finalBotId
          };
          await this.saveWeixinSessions(ctx, sessions);

          state.token = res.bot_token;
          state.baseUrl = finalBaseUrl;
          state.botId = finalBotId;
          state.isLoggedIn = true;

          await this.callWeixinApi(config, "ilink/bot/msg/notifystart", {}, undefined, state.baseUrl, state.token);
          this.startWeixinLoop(ctx, accountId, state);
          loginConfirmed = true;
          ctx.logger.info(`微信账号 [${accountId}] 扫码绑定成功！长轮询已开启。`);
        } else if (res.status === "expired") {
          ctx.logger.warn(`微信账号 [${accountId}] 登录二维码已失效过期，已停止监听。`);
          break;
        } else {
          await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, 3000);
            state.abortController.signal.addEventListener("abort", () => {
              clearTimeout(timer);
              reject(new DOMException("Aborted", "AbortError"));
            });
          });
        }
      } catch (err: any) {
        if (err.name === "AbortError") break;
        ctx.logger.error(`微信账号 [${accountId}] 监听扫码状态错误:`, err.message);
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }

  private async sendWeixinMessage(botId: string, chatId: string, content: string): Promise<void> {
    const state = this.activeAccounts.get(botId);
    if (!state || !state.isLoggedIn || !state.token || !state.baseUrl) return;

    const connectionId = this.getWeixinConnectionId(botId, chatId);
    const contextToken = this.contextTokens.get(connectionId);

    const maxChunkSize = 1000;
    const chunks: string[] = [];
    for (let i = 0; i < content.length; i += maxChunkSize) {
      chunks.push(content.slice(i, i + maxChunkSize));
    }

    try {
      for (const chunk of chunks) {
        const payload = {
          msg: {
            from_user_id: "",
            to_user_id: chatId,
            client_id: `freya-${crypto.randomUUID()}`,
            message_type: 2,
            message_state: 2,
            context_token: contextToken,
            item_list: [
              {
                type: 1,
                text_item: { text: chunk }
              }
            ]
          }
        };

        const res = await this.callWeixinApi(state.config, "ilink/bot/sendmessage", payload, undefined, state.baseUrl, state.token);
        const hasError = (res.errcode !== undefined && res.errcode !== 0) || (res.ret !== undefined && res.ret !== 0);
        if (hasError) {
          throw new Error(`微信网关拒绝投递: errcode=${res.errcode}, errmsg=${res.errmsg}`);
        }
      }
    } catch (err: any) {
      this.contextTokens.delete(connectionId);
      this.context.logger.error(`向微信用户 [${chatId}] 发送消息失败:`, err.message);
    }
  }

  private parseWeixinAesKey(aesKey: string): Buffer {
    const trimmed = aesKey.trim();
    if (trimmed.length === 32 && /^[0-9a-fA-F]{32}$/.test(trimmed)) {
      return Buffer.from(trimmed, "hex");
    }
    const decoded = Buffer.from(trimmed, "base64");
    if (decoded.length === 16) {
      return decoded;
    }
    if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/.test(decoded.toString("ascii"))) {
      return Buffer.from(decoded.toString("ascii"), "hex");
    }
    throw new Error(`无效的 AES 密钥格式`);
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

  private async downloadAndDecryptWeixinMedia(
    ctx: FreyaContext,
    url: string,
    aesKey: string,
    fileName: string,
    isImage = false
  ): Promise<{ path: string; mimeType: string } | undefined> {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`下载微信媒体文件 HTTP 状态码异常: ${res.status}`);
      }
      const rawBuffer = Buffer.from(await res.arrayBuffer());
      let finalBuffer = rawBuffer;

      if (aesKey) {
        const keyBuffer = this.parseWeixinAesKey(aesKey);
        const decipher = crypto.createDecipheriv("aes-128-ecb", keyBuffer, null);
        finalBuffer = Buffer.concat([
          decipher.update(rawBuffer),
          decipher.final()
        ]);
      }

      let mimeType = "application/octet-stream";
      let finalFileName = fileName;

      if (isImage) {
        const detected = this.detectMimeType(finalBuffer);
        mimeType = detected.mimeType;
        finalFileName = `image.${detected.ext}`;
      } else {
        const ext = path.extname(fileName).toLowerCase();
        mimeType = WEIXIN_MIME_MAP[ext] || "application/octet-stream";
      }

      const downloadDir = path.resolve(ctx.paths.workspaceDir, "cache/weixin");
      await fs.mkdir(downloadDir, { recursive: true });

      const safeFileName = `${Date.now()}-${finalFileName.replace(/[\\/:*?"<>|]/g, "_")}`;
      const filePath = path.join(downloadDir, safeFileName);
      await fs.writeFile(filePath, finalBuffer);

      return {
        path: `cache/weixin/${safeFileName}`,
        mimeType
      };
    } catch (err: any) {
      ctx.logger.error(`下载或解密微信媒体附件失败 [${fileName}]:`, err.message);
      return undefined;
    }
  }
}

export const Plugin = FreyaWeixinChannelPlugin;
