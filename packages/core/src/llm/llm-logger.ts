import type { LLMMessage, LLMTokenUsage, ToolDefinition } from '@eoasmxd/freya-sdk';
import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT } from '../utils/paths.js';

/** LLM 交互日志器，按日期写入 logs/llm-YYYY-MM-DD.log */
export class FreyaLLMLogger {
    private readonly logsDir: string;
    private _enabled: boolean;

    constructor(enabled: boolean) {
        this.logsDir = path.join(PROJECT_ROOT, 'logs');
        this._enabled = enabled;
        fs.mkdirSync(this.logsDir, { recursive: true });
    }

    get enabled(): boolean {
        return this._enabled;
    }

    set enabled(v: boolean) {
        this._enabled = v;
    }

    private get logFile(): string {
        const today = new Date().toISOString().slice(0, 10);
        return path.join(this.logsDir, `llm-${today}.log`);
    }

    private write(line: string): void {
        try {
            fs.appendFileSync(this.logFile, line + '\n', 'utf-8');
        } catch {
        }
    }

    logRequest(params: {
        provider: string;
        model: string;
        stream: boolean;
        messages: LLMMessage[];
        tools?: ToolDefinition[];
    }): void {
        if (!this._enabled) return;
        const ts = new Date().toISOString();
        const { provider, model, stream, messages, tools } = params;
        const messagesCount = messages.length;
        const messagesJson = this.serializeMessages(messages);
        const toolsJson = tools && tools.length > 0 ? JSON.stringify(tools) : null;

        let line = `[${ts}] [REQ] provider=${provider} model=${model} msgs=${messagesCount} stream=${stream}`;
        if (toolsJson) {
            line += ` tools=${toolsJson}`;
        }
        line += `\n  input=${messagesJson}`;
        this.write(line);
    }

    private serializeMessages(messages: LLMMessage[]): string {
        const truncated = messages.map((msg) => {
            const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
            const maxLen = 500;
            const truncatedContent = content.length > maxLen ? content.slice(0, maxLen) + '...' : content;
            return {
                role: msg.role,
                content: truncatedContent,
                ...(msg.toolCalls ? { tool_calls_count: msg.toolCalls.length } : {}),
                ...(msg.toolCallId ? { tool_call_id: msg.toolCallId } : {})
            };
        });
        return JSON.stringify(truncated);
    }

    logResponse(params: {
        provider: string;
        model: string;
        status: number;
        usage?: LLMTokenUsage;
        durationMs: number;
        contentPreview: string;
    }): void {
        if (!this._enabled) return;
        const ts = new Date().toISOString();
        const { provider, model, status, usage, durationMs, contentPreview } = params;
        const preview = contentPreview.length > 200 ? contentPreview.slice(0, 200) + '...' : contentPreview;
        const usageStr = usage
            ? `tokens(in=${usage.promptTokens},out=${usage.completionTokens},cache=${usage.cachedPromptTokens ?? 0})`
            : 'tokens(n/a)';
        this.write(
            `[${ts}] [RES] provider=${provider} model=${model} status=${status} ${usageStr} dur=${durationMs}ms preview="${preview}"`
        );
    }

    logError(params: {
        provider: string;
        model: string;
        error: string;
        durationMs: number;
    }): void {
        if (!this._enabled) return;
        const ts = new Date().toISOString();
        const { provider, model, error, durationMs } = params;
        this.write(
            `[${ts}] [ERR] provider=${provider} model=${model} dur=${durationMs}ms error="${error}"`
        );
    }
}
