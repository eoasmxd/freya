import type { FreyaContext, ToolPlugin, FreyaTool } from '@eoasmxd/freya-sdk';
import { CookieStore } from './cookie-store.js';
import { WebFetchTool, WebRequestTool } from './tools.js';

/** Web 网络请求工具箱插件，提供 web_fetch 和 web_request 工具 */
export default class WebToolboxPlugin implements ToolPlugin {
    type = 'tool' as const;

    private cookieStore = new CookieStore();
    private tools: FreyaTool[];

    constructor() {
        this.tools = [
            new WebFetchTool(this.cookieStore),
            new WebRequestTool(this.cookieStore),
        ];
    }

    async setup(ctx: FreyaContext): Promise<void> {
        ctx.logger.info('Web 网络工具箱插件初始化就绪。');
    }

    getId(): string {
        return 'web';
    }

    getInstructionPrompt(): string {
        return 'plugin.prompt.web';
    }

    getTools(): FreyaTool[] {
        return this.tools;
    }
}
