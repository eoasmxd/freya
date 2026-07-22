/** Telegram 频道插件，通过原生 fetch 长轮询连接 Telegram Bot API */
import type { ChannelAttachment, ChannelPlugin, FreyaContext } from "@eoasmxd/freya-sdk";

interface TelegramUpdate {
    update_id: number;
    message?: TelegramMessage;
}

interface TelegramMessage {
    message_id: number;
    from?: TelegramUser;
    chat: TelegramChat;
    text?: string;
    caption?: string;
    photo?: TelegramPhotoSize[];
    document?: TelegramDocument;
    voice?: TelegramVoice;
}

interface TelegramUser {
    id: number;
    is_bot?: boolean;
    first_name?: string;
}

interface TelegramChat {
    id: number;
    type: string;
}

interface TelegramPhotoSize {
    file_id: string;
    file_unique_id: string;
    width: number;
    height: number;
}

interface TelegramDocument {
    file_id: string;
    file_unique_id: string;
    mime_type?: string;
    file_name?: string;
}

interface TelegramVoice {
    file_id: string;
    file_unique_id: string;
    duration: number;
    mime_type?: string;
}

interface TelegramFile {
    file_id: string;
    file_path?: string;
}

interface TelegramBotConfig {
    id: string;
    token: string;
}

export default class TelegramChannelPlugin implements ChannelPlugin {
    readonly type = "channel" as const;

    private bots: TelegramBotConfig[] = [];
    private activeBots = new Map<string, {
        token: string;
        abortController: AbortController;
        running: boolean;
    }>();

    private registeredConnections = new Set<string>();
    private syncTimer?: NodeJS.Timeout;

    private connId(botId: string, chatId: string): string {
        return `telegram:${botId}:${chatId}`;
    }

    private async callApi<T = unknown>(
        token: string,
        method: string,
        body?: Record<string, unknown>,
        signal?: AbortSignal
    ): Promise<T> {
        const url = `https://api.telegram.org/bot${token}/${method}`;
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: body ? JSON.stringify(body) : undefined,
            signal
        });
        const json = (await res.json()) as { ok: boolean; result: T; description?: string };
        if (!json.ok) {
            throw new Error(`Telegram API ${method} 调用失败: ${json.description ?? "未知错误"}`);
        }
        return json.result;
    }

    private getFileUrl(token: string, filePath: string): string {
        return `https://api.telegram.org/file/bot${token}/${filePath}`;
    }

    private async getFileAsAttachment(
        token: string,
        fileId: string,
        type: ChannelAttachment["type"],
        fallbackMime: string,
    ): Promise<ChannelAttachment | null> {
        try {
            const fileInfo = await this.callApi<TelegramFile>(token, "getFile", { file_id: fileId });
            if (!fileInfo.file_path) return null;
            return {
                type,
                mimeType: fallbackMime,
                url: this.getFileUrl(token, fileInfo.file_path),
            };
        } catch {
            return null;
        }
    }

    async setup(ctx: FreyaContext): Promise<void> {
        const rawBots = ctx.config.telegram?.bots;
        this.bots = Array.isArray(rawBots) ? rawBots : [];

        ctx.eventBus.on('connection:reply', async (payload: { connectionId: string; content: string }) => {
            const prefix = 'telegram:';
            if (payload.connectionId.startsWith(prefix)) {
                const parts = payload.connectionId.slice(prefix.length).split(':');
                if (parts.length >= 2) {
                    const [botId, chatId] = parts;
                    await this.sendToChat(botId, chatId, payload.content);
                }
            }
        });

        this.syncTimer = setInterval(() => {
            this.syncBots(ctx).catch((err) => {
                ctx.logger.error("Telegram 机器人热重载同步失败:", err.message);
            });
        }, 5000);

        ctx.logger.info(`Telegram 频道插件初始化完成，已发现 ${this.bots.length} 个机器人配置，热更新服务就绪。`);
    }

    async start(ctx: FreyaContext): Promise<void> {
        if (this.bots.length === 0) {
            ctx.logger.warn("Telegram 机器人配置未检测到，将等待心跳同步。");
            return;
        }

        for (const botConfig of this.bots) {
            const botId = botConfig.id.trim();
            const token = botConfig.token.trim();
            if (!botId || !token) continue;

            const abortController = new AbortController();
            const state = {
                token,
                abortController,
                running: true
            };
            this.activeBots.set(botId, state);

            await this.callApi(token, "deleteWebhook", { drop_pending_updates: true }).catch(() => { });
            this.startSingleBotLoop(ctx, botId, state);
            ctx.logger.info(`Telegram 机器人 [${botId}] 轮询服务已拉起。`);
        }
    }

    private startSingleBotLoop(
        ctx: FreyaContext,
        botId: string,
        state: { token: string; abortController: AbortController; running: boolean }
    ): void {
        (async () => {
            let offset = 0;
            while (state.running) {
                try {
                    const signal = state.abortController.signal;
                    const updates = await this.callApi<TelegramUpdate[]>(state.token, "getUpdates", {
                        offset,
                        timeout: 30,
                    }, signal);

                    for (const update of updates) {
                        offset = update.update_id + 1;
                        const msg = update.message;
                        if (!msg) continue;

                        const chatId = msg.chat.id.toString();
                        const connectionId = this.connId(botId, chatId);
                        ctx.eventBus.emit('connection:active', { connectionId, defaultSessionId: `telegram:${botId}:${chatId}`, staleThresholdMs: 0 });
                        this.registeredConnections.add(connectionId);

                        if (msg.text) {
                            const text = msg.text;
                            if (text.length > 4096) {
                                this.callApi(state.token, "sendMessage", {
                                    chat_id: msg.chat.id,
                                    text: "消息过长，请控制在 4096 字符以内。",
                                    reply_to_message_id: msg.message_id,
                                }).catch(() => { });
                                continue;
                            }
                            ctx.eventBus.emit("connection:message", {
                                connectionId,
                                content: text,
                                defaultSessionId: `telegram:${botId}:${chatId}`
                            });
                            continue;
                        }

                        const attachments: ChannelAttachment[] = [];
                        let caption = msg.caption ?? "";

                        if (msg.photo && msg.photo.length > 0) {
                            const largest = msg.photo[msg.photo.length - 1];
                            const attachment = await this.getFileAsAttachment(
                                state.token,
                                largest.file_id,
                                "image",
                                "image/jpeg",
                            );
                            if (attachment) attachments.push(attachment);
                        }

                        if (msg.document) {
                            const attachment = await this.getFileAsAttachment(
                                state.token,
                                msg.document.file_id,
                                "file",
                                msg.document.mime_type ?? "application/octet-stream",
                            );
                            if (attachment) attachments.push(attachment);
                        }

                        if (msg.voice) {
                            const attachment = await this.getFileAsAttachment(
                                state.token,
                                msg.voice.file_id,
                                "file",
                                "audio/ogg",
                            );
                            if (attachment) attachments.push(attachment);
                        }

                        if (attachments.length > 0 || caption) {
                            ctx.eventBus.emit("connection:message", {
                                connectionId,
                                content: caption,
                                attachments,
                            });
                        }
                    }
                } catch (err) {
                    if (!state.running) break;
                    const message = err instanceof Error ? err.message : String(err);
                    ctx.logger.error(`Telegram 机器人 [${botId}] 轮询出错:`, message);
                    await new Promise((resolve) => setTimeout(resolve, 5000));
                }
            }
            ctx.logger.info(`Telegram 机器人 [${botId}] 轮询循环已安全结束。`);
        })();
    }

    private async syncBots(ctx: FreyaContext): Promise<void> {
        const rawBots = ctx.config.telegram?.bots;
        const latestBots: TelegramBotConfig[] = Array.isArray(rawBots) ? rawBots : [];

        for (const [botId, active] of this.activeBots.entries()) {
            const currentConfig = latestBots.find((b) => b.id.trim() === botId);
            if (!currentConfig || currentConfig.token.trim() !== active.token) {
                active.running = false;
                active.abortController.abort();
                this.activeBots.delete(botId);
                ctx.logger.info(`[Telegram热更新] 成功热停用机器人: ${botId}`);

                for (const connectionId of this.registeredConnections) {
                    if (connectionId.startsWith(`telegram:${botId}:`)) {
                        ctx.eventBus.emit('connection:inactive', { connectionId });
                        this.registeredConnections.delete(connectionId);
                    }
                }
            }
        }

        for (const botConfig of latestBots) {
            const botId = botConfig.id.trim();
            const token = botConfig.token.trim();
            if (!botId || !token) continue;

            if (!this.activeBots.has(botId)) {
                const abortController = new AbortController();
                const state = {
                    token,
                    abortController,
                    running: true
                };
                this.activeBots.set(botId, state);

                await this.callApi(token, "deleteWebhook", { drop_pending_updates: true }).catch(() => { });
                this.startSingleBotLoop(ctx, botId, state);
                ctx.logger.info(`[Telegram热更新] 成功热连接拉起新机器人: ${botId}`);
            }
        }

        this.bots = latestBots;
    }

    async stop(ctx: FreyaContext): Promise<void> {
        if (this.syncTimer) {
            clearInterval(this.syncTimer);
            this.syncTimer = undefined;
        }

        for (const [botId, state] of this.activeBots.entries()) {
            state.running = false;
            state.abortController.abort();
            ctx.logger.info(`Telegram 机器人 [${botId}] 轮询线程已中止。`);
        }
        this.activeBots.clear();

        for (const connectionId of this.registeredConnections) {
            ctx.eventBus.emit('connection:inactive', { connectionId });
        }
        this.registeredConnections.clear();
        ctx.logger.info("Telegram 频道插件已彻底停止所有服务。");
    }

    private async sendToChat(botId: string, chatId: string, text: string): Promise<void> {
        const token = this.bots.find((b) => b.id === botId)?.token;
        if (!token) return;
        try {
            const numericId = Number(chatId);
            if (isNaN(numericId) || numericId === 0) return;
            await this.callApi(token, "sendMessage", { chat_id: numericId, text });
        } catch {
        }
    }

}

export const Plugin = TelegramChannelPlugin;
