import type { FreyaContext } from '@eoasmxd/freya-sdk';
import readline from 'node:readline';

const CLI_CONN_ID = 'built-in-cli-channel:terminal';

/**
 * 内置控制台交互通道。
 * 负责监听终端标准输入（stdin）并将大模型响应流式渲染输出至标准输出（stdout）。
 */
export class FreyaCliChannel {
    id = 'built-in-cli-channel';
    private rl?: readline.Interface;
    private isGenerating = false;
    private ctx?: FreyaContext;

    async setup(ctx: FreyaContext): Promise<void> {
        this.ctx = ctx;
        ctx.eventBus.on('config:auth_request', this.handleAuthRequest);
        ctx.eventBus.on('connection:reply', this.handleConnectionReply);
        ctx.eventBus.on('connection:reply:delta', this.handleConnectionReplyDelta);
        ctx.eventBus.on('connection:reply:completed', this.handleConnectionReplyCompleted);
    }

    async start(ctx: FreyaContext): Promise<void> {
        ctx.logger.info('[CliChannel] 本地控制台交互已启动。输入消息即可交流，输入 "/exit" 退出。');
        ctx.eventBus.emit('connection:active', { connectionId: CLI_CONN_ID, defaultSessionId: 'main' });

        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        this.rl.on('close', () => {
            ctx.logger.info('[CliChannel] 频道关闭。');
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
                defaultSessionId: 'main'
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
        console.log('\n==================================================');
        console.log(`⚠️  【敏感操作授权请求】`);
        console.log(`大模型正尝试 [${payload.action}] 敏感文件 "${payload.filePath}" 内的 Key 路径 "${payload.keyPath}"${payload.value ? ` 为新值 "${payload.value}"` : ''}。`);
        console.log(`请做出决策决定：`);
        console.log(`👉 输入 "/approve ${payload.authId}" 批准此项操作`);
        console.log(`👉 输入 "/reject ${payload.authId}" 拒绝此项操作`);
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
        process.stdout.write('\n👤 [你]: ');
    }
}
