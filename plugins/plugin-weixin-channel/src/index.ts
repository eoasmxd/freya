import type { ChannelPlugin, FreyaAttachment, FreyaCommand, FreyaContext } from "@eoasmxd/freya-sdk";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import QRCode from "qrcode";
import { I18n } from "./i18n/index.js";
import en from "./i18n/locales/en.js";
import zh from "./i18n/locales/zh.js";

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
 * Freya WeChat intelligent group device (iLink protocol) channel plugin
 */
export default class FreyaWeixinChannelPlugin implements ChannelPlugin {
  readonly type = "channel" as const;

  private i18n = new I18n({ zh, en });
  private context!: FreyaContext;
  private activeAccounts = new Map<string, WeixinAccountState>();
  private contextTokens = new Map<string, string>();

  async loginAccount(accountId: string, ctx: FreyaContext): Promise<string> {
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
      return this.i18n.t("cmd.weixin.login.alreadyOnline", `ℹ️ WeChat account [${accountId}] is already logged in and online.`, { accountId });
    }

    return await this.triggerWeixinQrLogin(ctx, accountId, state.config);
  }

  commands: FreyaCommand[] = [
    {
      name: "weixin",
      description: this.i18n.all("cmd.weixin.description", "WeChat bot management commands"),
      subcommands: [
        { name: "list", description: this.i18n.all("cmd.weixin.sub.list", "List currently loaded WeChat accounts and connection login status") },
        { name: "login", description: this.i18n.all("cmd.weixin.sub.login", "Fetch WeChat login QR code, usage: /weixin login <accountId>") }
      ],
      execute: async (args: string[], sessionId: string, ctx: FreyaContext): Promise<string | void> => {
        const sub = args[0]?.trim().toLowerCase();

        if (sub === "list") {
          if (this.activeAccounts.size === 0) {
            return this.i18n.t("cmd.weixin.list.empty", "ℹ️ No WeChat account instances currently loaded.");
          }

          let output = this.i18n.t("cmd.weixin.list.title", "📱 **WeChat Account Connection Status List**:\n\n");
          for (const [accountId, state] of this.activeAccounts.entries()) {
            const statusStr = state.isLoggedIn
              ? this.i18n.t("cmd.weixin.list.statusOnline", "✅ **Logged in / Online**")
              : this.i18n.t("cmd.weixin.list.statusOffline", "❌ **Not logged in / Offline**");
            output += this.i18n.t("cmd.weixin.list.item", `- Account ID: \`${accountId}\` —— ${statusStr}\n`, { accountId, status: statusStr });
            if (!state.isLoggedIn) {
              output += this.i18n.t("cmd.weixin.list.loginHint", `  *(Tip: Run \`/weixin login ${accountId}\` to start QR code login)*\n`, { accountId });
            }
          }
          return output;
        }

        if (sub === "login") {
          const accountId = args[1]?.trim();
          if (!accountId) {
            return this.i18n.t("cmd.weixin.login.missingId", "❌ Missing required parameter: please specify WeChat account id, e.g. `/weixin login my_weixin`");
          }
          return await this.loginAccount(accountId, ctx);
        }

        return this.i18n.t("cmd.weixin.unknown", "❌ Unknown subcommand. Supported subcommands: `list` and `login`. Usage examples:\n- `/weixin list`\n- `/weixin login my_weixin`");
      }
    }
  ];



  private getWeixinConnectionId(botId: string, chatId: string): string {
    return `weixin:${botId}:${chatId}`;
  }

  /**
   * 从本地物理路径加载微信会话缓存数据
   * Load WeChat session cache data from local physical path
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
   * Persist WeChat session cache to local physical path
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
   * Call official WeChat iLink server HTTP API endpoint
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
      // 微信 iLink 接口请求失败异常
      throw new Error(`WeChat iLink API request failed for endpoint "${endpoint}" (${response.status}): ${errText}`);
    }

    return await response.json();
  }

  async setup(ctx: FreyaContext): Promise<void> {
    this.context = ctx;
    this.i18n.setContext(ctx);

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

    this.context.logger.debug("WeChat channel plugin initialized, waiting for session cache restore.");
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
      ctx.logger.debug(`Deactivating and removing WeChat account [${accountId}]...`);
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
      ctx.logger.debug(`WeChat account [${accountId}] session restored, long polling started.`);
    } catch (err: any) {
      ctx.logger.error(`WeChat account [${accountId}] session restore failed. Please run \`/weixin login ${accountId}\` to scan QR code again.`, err.message);
      state.isLoggedIn = false;
    }
  }

  /**
   * 拉取并生成微信登录绑定二维码，启动后台监听轮询
   * Fetch and generate WeChat login binding QR code, start background polling
   */
  private async triggerWeixinQrLogin(ctx: FreyaContext, accountId: string, config: WeixinBotConfig): Promise<string> {
    try {
      const res = await this.callWeixinApi(config, "ilink/bot/get_bot_qrcode?bot_type=3", {}, undefined, "https://ilinkai.weixin.qq.com");
      const qrcode = res.qrcode;
      const scanUrl = res.qrcode_img_content;
      if (!qrcode) {
        // 获取微信登录二维码失败异常
        throw new Error("Failed to get WeChat login QR code: server did not return qrcode");
      }

      const qrAscii = await QRCode.toString(scanUrl, {
        type: "utf8",
        errorCorrectionLevel: "M",
        margin: 2
      });

      this.pollWeixinQrStatus(ctx, accountId, config, qrcode).catch((err) => {
        ctx.logger.error(`WeChat account [${accountId}] background QR code polling failed:`, err.message);
      });

      return (
        this.i18n.t("cmd.weixin.login.qrGenerated", "⚠️ **Login QR code generated successfully for WeChat account [{accountId}]!**\n\n**[WeChat Scan] Please scan the QR code below to bind account [{accountId}]**:\n\n", { accountId }) +
        "```text\n" +
        qrAscii +
        "\n```\n\n" +
        this.i18n.t("cmd.weixin.login.qrFallbackHint", "*(Tip: If character QR code does not display properly, click [Open WeChat QR Page]({scanUrl}) to scan)*", { scanUrl })
      );
    } catch (err: any) {
      ctx.logger.error(`WeChat account [${accountId}] failed to fetch QR code login:`, err.message);
      return this.i18n.t("cmd.weixin.login.fail", "❌ Failed to fetch WeChat login QR code: {message}", { message: err.message });
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
                    // 无法获取或解密图片时的提示词
                    text = `[Image]${imgUrl ? `(${imgUrl})` : " (Unable to obtain image URL)"}`;
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
                  // 语音转文字提示词
                  text = `[Voice-to-Text: ${voiceText || "No voice content recognized"}]`;
                } else if (item.type === 4 && item.file_item) {
                  const fileUrl = item.file_item.media?.full_url || "";
                  // 默认未命名文件名
                  const fileName = item.file_item.file_name || "untitled_file";
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
                    // 无法获取或解密文件时的提示词
                    text = `[File Attachment: ${fileName}]${fileUrl ? `(${fileUrl})` : " (Unable to obtain download URL)"}`;
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
                    // 无法获取或解密视频时的提示词
                    text = `[Video]${videoUrl ? `(${videoUrl})` : " (Unable to obtain video URL)"}`;
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
                    staleThresholdMs: 0,
                    channelType: "weixin",
                    defaultLanguage: "zh"
                  });

                  ctx.eventBus.emit("connection:message", {
                    connectionId,
                    content: text,
                    attachments: attachments.length > 0 ? attachments : undefined,
                    defaultSessionId: connectionId,
                    channelType: "weixin",
                    defaultLanguage: "zh"
                  });
                }
              }
            }
          } else if (res.errcode === -14 || res.ret === -14) {
            ctx.logger.error(`WeChat account [${accountId}] connection invalidated (ErrorCode -14), cache cleared. Please run \`/weixin login ${accountId}\` to re-login.`);
            state.isLoggedIn = false;

            const sessions = await this.loadWeixinSessions(ctx);
            delete sessions[accountId];
            await this.saveWeixinSessions(ctx, sessions);
            break;
          } else {
            ctx.logger.warn(`WeChat account [${accountId}] long polling exception: errcode=${res.errcode}, ret=${res.ret}`);
            await new Promise((resolve) => setTimeout(resolve, 5000));
          }
        } catch (err: any) {
          if (err.name === "AbortError") break;
          ctx.logger.error(`WeChat account [${accountId}] polling network error:`, err.message);
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
        ctx.logger.warn(`WeChat account [${accountId}] QR code polling timed out (>5 min), stopped listening.`);
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
          ctx.logger.info(`WeChat account [${accountId}] login bound successfully! Long polling started.`);
        } else if (res.status === "expired") {
          ctx.logger.warn(`WeChat account [${accountId}] login QR code expired, stopped listening.`);
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
        ctx.logger.error(`WeChat account [${accountId}] QR polling status error:`, err.message);
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
          // 微信网关拒绝投递异常
          throw new Error(`WeChat gateway rejected delivery: errcode=${res.errcode}, errmsg=${res.errmsg}`);
        }
      }
    } catch (err: any) {
      this.contextTokens.delete(connectionId);
      this.context.logger.error(`Failed to send message to WeChat user [${chatId}]:`, err.message);
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
    // 无效的 AES 密钥格式异常
    throw new Error("Invalid WeChat AES key format");
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
        // 下载微信媒体文件 HTTP 状态码异常
        throw new Error(`Failed to download WeChat media file, HTTP status: ${res.status}`);
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
      ctx.logger.error(`Failed to download or decrypt WeChat media attachment [${fileName}]:`, err.message);
      return undefined;
    }
  }
}

export const Plugin = FreyaWeixinChannelPlugin;
