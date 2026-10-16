import type { FreyaAttachment, FreyaContext } from "@eoasmxd/freya-sdk";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import QRCode from "qrcode";
import type { I18n } from "./i18n/index.js";
import type { WeixinMessageSender } from "./send-message-tool.js";
import { type WeixinAccountState, type WeixinBotConfig, WEIXIN_MIME_MAP } from "./types.js";

/**
 * 微信智能硬件 (iLink 协议) 长连接与通信管理器
 * WeChat smart device (iLink protocol) persistent connection and communication manager
 */
export class WeixinConnectionManager implements WeixinMessageSender {
  private context!: FreyaContext;
  private activeAccounts = new Map<string, WeixinAccountState>();
  private contextTokens = new Map<string, string>();

  constructor(private i18n: I18n) { }

  /**
   * 初始化连接管理器与事件监听
   * Initialize connection manager and event listeners
   */
  setup(ctx: FreyaContext): void {
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

    this.context.logger.debug("WeChat channel connection manager initialized, waiting for session cache restore.");
  }

  /**
   * 恢复本地缓存并启动所有微信账号实例长轮询
   * Restore local session cache and start long polling for all WeChat account instances
   */
  async start(): Promise<void> {
    const sessions = await this.loadWeixinSessions(this.context);
    for (const [accountId, session] of Object.entries(sessions)) {
      if (session && session.token && session.baseUrl) {
        const config: WeixinBotConfig = {
          id: accountId,
          appId: session.appId || "bot"
        };
        await this.startWeixinAccount(this.context, config, session);
      }
    }
  }

  /**
   * 优雅停止并断开所有活跃账号连接
   * Gracefully stop and disconnect all active account connections
   */
  async stop(): Promise<void> {
    for (const [accountId, state] of this.activeAccounts) {
      this.context.logger.debug(`Deactivating and removing WeChat account [${accountId}]...`);
      state.running = false;
      state.abortController.abort();
      if (state.isLoggedIn && state.token && state.baseUrl) {
        await this.callWeixinApi(state.config, "ilink/bot/msg/notifystop", {}, undefined, state.baseUrl, state.token).catch(() => { });
      }
    }
    this.activeAccounts.clear();
  }

  /**
   * 获取当前已加载的所有微信账号连接状态列表
   * Get connection status list for all currently loaded WeChat accounts
   */
  getAccountStates(): { accountId: string; state: WeixinAccountState }[] {
    const result: { accountId: string; state: WeixinAccountState }[] = [];
    for (const [accountId, state] of this.activeAccounts.entries()) {
      result.push({ accountId, state });
    }
    return result;
  }

  /**
   * 触发指定账号扫码登录上线
   * Trigger QR code login and online binding for specified account
   */
  async loginAccount(accountId: string): Promise<string> {
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

    return await this.triggerWeixinQrLogin(this.context, accountId, state.config);
  }

  /**
   * 国际化文案翻译辅助方法
   * Internationalization message translation helper method
   */
  translate(key: string, fallback: string, params?: Record<string, any>): string {
    return this.i18n.t(key, fallback, params);
  }

  /**
   * 主动向指定微信实例绑定的会话推送消息
   * Proactively dispatch message to the bound conversation of specified WeChat instance
   */
  async sendMessage(
    accountId: string,
    content: string
  ): Promise<{ success: boolean; chunks: number }> {
    const state = this.activeAccounts.get(accountId);
    if (!state || !state.isLoggedIn || !state.token || !state.baseUrl) {
      throw new Error(
        this.i18n.t(
          "tool.weixin.send.accountNotFound",
          `WeChat account [${accountId}] is not found or not logged in.`,
          { accountId }
        )
      );
    }

    const targetChatId = state.chatId;
    if (!targetChatId) {
      throw new Error(
        this.i18n.t(
          "tool.weixin.send.notBound",
          `WeChat account [${accountId}] has not established conversation binding yet.`,
          { accountId }
        )
      );
    }

    const connectionId = this.getWeixinConnectionId(accountId, targetChatId);
    const contextToken = this.contextTokens.get(connectionId);

    const maxChunkSize = 1000;
    const chunks: string[] = [];
    for (let i = 0; i < content.length; i += maxChunkSize) {
      chunks.push(content.slice(i, i + maxChunkSize));
    }

    for (const chunk of chunks) {
      const payload = {
        msg: {
          from_user_id: "",
          to_user_id: targetChatId,
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

      const res = await this.callWeixinApi(
        state.config,
        "ilink/bot/sendmessage",
        payload,
        undefined,
        state.baseUrl,
        state.token
      );
      const hasError = (res.errcode !== undefined && res.errcode !== 0) || (res.ret !== undefined && res.ret !== 0);
      if (hasError) {
        throw new Error(`WeChat gateway rejected delivery: errcode=${res.errcode}, errmsg=${res.errmsg}`);
      }
    }

    return {
      success: true,
      chunks: chunks.length
    };
  }

  private getWeixinConnectionId(botId: string, chatId: string): string {
    return `weixin:${botId}:${chatId}`;
  }

  private async loadWeixinSessions(ctx: FreyaContext): Promise<Record<string, any>> {
    const filePath = path.join(ctx.paths.dataDir, "weixin_sessions.json");
    try {
      const content = await fs.readFile(filePath, "utf-8");
      return JSON.parse(content);
    } catch {
      return {};
    }
  }

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
      channel_version: "2.4.9",
      bot_agent: "Freya/1.0.1"
    };
  }

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
      throw new Error(`WeChat iLink API request failed for endpoint "${endpoint}" (${response.status}): ${errText}`);
    }

    return await response.json();
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
      botId: session.botId || "bot_default",
      chatId: session.chatId
    };
    this.activeAccounts.set(accountId, state);

    try {
      await this.callWeixinApi(config, "ilink/bot/msg/notifystart", {}, undefined, state.baseUrl, state.token);
      this.startWeixinLoop(ctx, accountId, state);
      ctx.logger.debug(`WeChat account [${accountId}] session restored, long polling started.`);
    } catch (err: any) {
      ctx.logger.warn(`WeChat account [${accountId}] session restore failed. Please run \`/weixin login ${accountId}\` to scan QR code again.`, err.message);
      state.isLoggedIn = false;
    }
  }

  private async triggerWeixinQrLogin(ctx: FreyaContext, accountId: string, config: WeixinBotConfig): Promise<string> {
    try {
      const res = await this.callWeixinApi(config, "ilink/bot/get_bot_qrcode?bot_type=3", {}, undefined, "https://ilinkai.weixin.qq.com");
      const qrcode = res.qrcode;
      const scanUrl = res.qrcode_img_content;
      if (!qrcode) {
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
        "```qrcode\n" +
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
              if (state.chatId !== userId) {
                state.chatId = userId;
                this.updateSessionChatId(accountId, userId).catch(() => { });
              }
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
                  text = `[Voice-to-Text: ${voiceText || "No voice content recognized"}]`;
                } else if (item.type === 4 && item.file_item) {
                  const fileUrl = item.file_item.media?.full_url || "";
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
          ctx.logger.warn(`WeChat account [${accountId}] polling network error:`, err.message);
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
            botId: finalBotId,
            chatId: state.chatId
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

  private async updateSessionChatId(accountId: string, chatId: string): Promise<void> {
    const sessions = await this.loadWeixinSessions(this.context);
    if (sessions[accountId] && sessions[accountId].chatId !== chatId) {
      sessions[accountId].chatId = chatId;
      await this.saveWeixinSessions(this.context, sessions);
    }
  }

  private async sendWeixinMessage(botId: string, chatId: string, content: string): Promise<void> {
    const state = this.activeAccounts.get(botId);
    if (!state || !state.isLoggedIn || !state.token || !state.baseUrl) return;

    if (state.chatId !== chatId) {
      state.chatId = chatId;
      this.updateSessionChatId(botId, chatId).catch(() => { });
    }

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
