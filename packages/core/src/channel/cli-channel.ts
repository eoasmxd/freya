import type { FreyaContext } from '@eoasmxd/freya-sdk';
import readline from 'node:readline';
import { I18n } from '../i18n/index.js';
import { zh } from '../i18n/locales/zh.js';
import { en } from '../i18n/locales/en.js';

const CLI_CONN_ID = 'built-in-cli-channel:terminal';

/**
 * 内置控制台交互通道。
 * Built-in console interaction channel.
 * 负责监听终端标准输入（stdin）并将大模型响应流式渲染输出至标准输出（stdout）。
 * Listens to terminal stdin and streams LLM responses to stdout.
 */
function detectCliLanguage(): string {
    const envLang = (process.env.LANG || process.env.LC_ALL || process.env.LC_MESSAGES || '').toLowerCase();
    if (envLang.startsWith('zh')) {
        return 'zh';
    }
    try {
        const locale = Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase();
        if (locale.startsWith('zh')) {
            return 'zh';
        }
    } catch {
        // 忽略检测异常
        // Ignore detection errors
    }
    return 'en';
}

export class FreyaCliChannel {
    id = 'built-in-cli-channel';
    private rl?: readline.Interface;
    private isGenerating = false;
    private ctx?: FreyaContext;
    private i18n: I18n;

    constructor() {
        this.i18n = new I18n({ zh, en });
    }

    async setup(ctx: FreyaContext): Promise<void> {
        this.ctx = ctx;
        this.i18n.setContext(ctx);
        ctx.eventBus.on('config:auth_request', this.handleAuthRequest);
        ctx.eventBus.on('connection:reply', this.handleConnectionReply);
        ctx.eventBus.on('connection:reply:delta', this.handleConnectionReplyDelta);
        ctx.eventBus.on('connection:reply:completed', this.handleConnectionReplyCompleted);
    }

    async start(ctx: FreyaContext): Promise<void> {
        const defaultLanguage = detectCliLanguage();
        console.log('\n' + this.i18n.t('cli.start.launched', '[CliChannel] Local console interaction started. Type your message to chat, or "/exit" to quit.'));
        console.log(this.i18n.t('cli.start.backgroundTip', '[CliChannel] Tip: Append "--no-cli" to the startup command to run in background mode.') + '\n');
        ctx.eventBus.emit('connection:active', {
            connectionId: CLI_CONN_ID,
            defaultSessionId: 'main',
            staleThresholdMs: 0,
            channelType: 'cli',
            defaultLanguage
        });

        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        this.rl.on('close', () => {
            ctx.logger.info('[CliChannel] Channel closed.');
        });

        this.promptUser();

        this.rl.on('line', (line: string) => {
            const input = line.trim();
            if (!input) {
                this.promptUser();
                return;
            }

            if (input.toLowerCase() === '/exit') {
                this.rl?.close();
                ctx.eventBus.emit('system:exit');
                return;
            }

            const messagePayload = {
                connectionId: CLI_CONN_ID,
                content: input,
                defaultSessionId: 'main',
                channelType: 'cli',
                defaultLanguage
            };

            ctx.eventBus.emit('connection:message', messagePayload);
        });
    }

    async stop(ctx: FreyaContext): Promise<void> {
        ctx.eventBus.emit('connection:inactive', { connectionId: CLI_CONN_ID });
        this.rl?.close();

        if (this.ctx) {
            this.ctx.eventBus.off('config:auth_request', this.handleAuthRequest);
            this.ctx.eventBus.off('connection:reply', this.handleConnectionReply);
            this.ctx.eventBus.off('connection:reply:delta', this.handleConnectionReplyDelta);
            this.ctx.eventBus.off('connection:reply:completed', this.handleConnectionReplyCompleted);
        }
    }

    private handleAuthRequest = (payload: {
        authId: string;
        action: 'read' | 'write';
        filePath: string;
        keyPath: string;
        value?: string;
    }) => {
        const valueLabel = this.i18n.t('cli.auth.valueLabel', 'to value');
        const valuePart = payload.value ? ` ${valueLabel} "${payload.value}"` : '';
        console.log('\n==================================================');
        console.log(this.i18n.t('cli.auth.title', '⚠️  [Sensitive Operation Authorization Request]'));
        console.log(this.i18n.t('cli.auth.detail', 'The AI model is attempting to [{action}] the sensitive file "{filePath}" at key path "{keyPath}"{valuePart}.', {
            action: payload.action,
            filePath: payload.filePath,
            keyPath: payload.keyPath,
            valuePart
        }));
        console.log(this.i18n.t('cli.auth.decision', 'Please make a decision:'));
        console.log(this.i18n.t('cli.auth.approveHint', '👉 Type "/approve {authId}" to approve this operation', { authId: payload.authId }));
        console.log(this.i18n.t('cli.auth.rejectHint', '👉 Type "/reject {authId}" to reject this operation', { authId: payload.authId }));
        console.log('==================================================\n');
        this.promptUser();
    };

    private handleConnectionReply = (payload: { connectionId: string; content: string }) => {
        if (payload.connectionId === CLI_CONN_ID) {
            if (!this.isGenerating) {
                console.log(`🤖 [Freya]: ${payload.content}`);
                this.promptUser();
            }
        }
    };

    private handleConnectionReplyDelta = (payload: { connectionId: string; text: string }) => {
        if (payload.connectionId === CLI_CONN_ID) {
            if (!this.isGenerating) {
                this.isGenerating = true;
                process.stdout.write('🤖 [Freya]: ');
            }
            process.stdout.write(payload.text);
        }
    };

    private handleConnectionReplyCompleted = (payload: { connectionId: string }) => {
        if (payload.connectionId === CLI_CONN_ID) {
            if (this.isGenerating) {
                console.log();
                this.isGenerating = false;
                this.promptUser();
            }
        }
    };

    private promptUser(): void {
        process.stdout.write(this.i18n.t('cli.prompt.user', '\n👤 [You]: '));
    }
}
