import type { FreyaContext, ToolDefinition, FreyaTool } from '@eoasmxd/freya-sdk';
import { CookieStore } from './cookie-store.js';
import { cleanHtmlContent, DEFAULT_TIMEOUT_MS, formatBytes, getWorkspaceDir, parseHeaders, saveToWorkspace, shouldAutoSave, truncateContent, validateUrl } from './utils.js';

function extractHostname(urlString: string): string {
    return new URL(urlString).hostname;
}

async function executeRequest(
    url: string,
    method: string,
    args: Record<string, any>,
    cookieStore: CookieStore,
    ctx?: FreyaContext,
    cleanMode?: "auto" | "text"
): Promise<string> {
    const validatedUrl = validateUrl(url);

    let customHeaders: Record<string, string> = {};
    if (args.headers) {
        customHeaders = parseHeaders(args.headers);
    }

    const contentType = args.contentType || 'application/json';
    if (method !== 'GET' && method !== 'HEAD') {
        if (!customHeaders['Content-Type'] && !customHeaders['content-type']) {
            customHeaders['Content-Type'] = contentType;
        }
    }

    const useCookies = args.useCookies === true;
    if (useCookies) {
        const hostname = extractHostname(url);
        const cookieHeader = cookieStore.getCookieHeader(hostname);
        if (cookieHeader) {
            customHeaders['Cookie'] = cookieHeader;
        }
    }

    const timeout = ctx?.config?.web?.timeout ?? DEFAULT_TIMEOUT_MS;
    const configMaxLength = ctx?.config?.web?.maxLength ?? undefined;
    const configAutoSaveThreshold = ctx?.config?.web?.autoSaveThreshold ?? 50 * 1024;

    const requestInit: RequestInit = {
        method,
        headers: customHeaders,
        signal: AbortSignal.timeout(timeout),
    };

    if (method !== 'GET' && method !== 'HEAD' && args.body !== undefined) {
        const bodyStr = typeof args.body === 'string' ? args.body : JSON.stringify(args.body);
        requestInit.body = bodyStr;
    }

    let response: Response;
    try {
        response = await fetch(validatedUrl.toString(), requestInit);
    } catch (err: any) {
        const message = err?.message || String(err);
        if (message.includes('timeout') || message.includes('abort') || err?.name === 'AbortError') {
            // 请求超时报错
            return `❌ Request timeout (${timeout / 1000}s): ${url}`;
        }
        if (message.includes('fetch')) {
            // 网络连接失败报错
            return `❌ Network request failed: Unable to connect to ${url} (${message})`;
        }
        // 网络请求异常报错
        return `❌ Network request failed: ${message}`;
    }

    const setCookieHeaders = response.headers.getSetCookie?.() || [];
    cookieStore.recordFromResponse(url, setCookieHeaders);

    let responseText: string;
    try {
        responseText = await response.text();
    } catch (err: any) {
        // 读取响应内容失败报错
        return `❌ Failed to read response content: ${err?.message || String(err)}`;
    }

    const paramMaxLength = args.maxLength !== undefined && args.maxLength !== null
        ? parseInt(args.maxLength, 10)
        : undefined;
    const maxLength = paramMaxLength && paramMaxLength > 0
        ? paramMaxLength
        : (configMaxLength ?? undefined);

    const responseContentType = response.headers.get('content-type') || '';

    const needSave = cleanMode === undefined
        ? shouldAutoSave(args, responseText.length, responseContentType, configAutoSaveThreshold)
        : false;

    if (needSave) {
        const workspaceDir = getWorkspaceDir(ctx);
        const savedPath = await saveToWorkspace(workspaceDir, url, responseText, responseContentType);
        const byteLength = Buffer.byteLength(responseText, 'utf-8');

        const lines: string[] = [];
        lines.push(`HTTP ${response.status} ${response.statusText} — ${url}`);
        lines.push(`Content-Type: ${responseContentType || 'unknown'}`);
        lines.push(`Original response (${formatBytes(byteLength)}) saved to workspace relative path: "${savedPath}"`);

        if (setCookieHeaders.length > 0) {
            const domain = extractHostname(url);
            lines.push(`Recorded ${setCookieHeaders.length} Set-Cookie headers → Domain: ${domain}`);
        }

        if (useCookies) {
            const hostname = extractHostname(url);
            const usedCookie = cookieStore.getCookieHeader(hostname);
            if (usedCookie) {
                lines.push(`Sent with Cookie → ${hostname}`);
            }
        }

        lines.push('');
        lines.push('Use read_file tool to inspect this file in chunks.');
        return lines.join('\n');
    }

    let processedText = responseText;
    if (cleanMode) {
        const lowerContentType = responseContentType.toLowerCase();
        const isHtmlContent = lowerContentType.includes("text/html") || 
                              lowerContentType.includes("application/xhtml") ||
                              /^\s*<!DOCTYPE\s+html/i.test(responseText) ||
                              /^\s*<html\b/i.test(responseText);
        if (isHtmlContent) {
            processedText = cleanHtmlContent(responseText, cleanMode, url);
        }
    }

    const content = truncateContent(processedText, maxLength);
    const sizeInfo = processedText.length !== content.length
        ? `(Cleaned raw ${processedText.length} chars, truncated)`
        : `(Cleaned ${processedText.length} chars)`;

    const lines: string[] = [];
    lines.push(`HTTP ${response.status} ${response.statusText} — ${url}`);
    lines.push(`Content-Type: ${responseContentType || 'unknown'} ${sizeInfo}`);

    if (setCookieHeaders.length > 0) {
        const domain = extractHostname(url);
        lines.push(`Recorded ${setCookieHeaders.length} Set-Cookie headers → Domain: ${domain}`);
    }

    if (useCookies) {
        const hostname = extractHostname(url);
        const usedCookie = cookieStore.getCookieHeader(hostname);
        if (usedCookie) {
            lines.push(`Sent with Cookie → ${hostname}`);
        }
    }

    lines.push('');
    lines.push(content);

    return lines.join('\n');
}

export class WebFetchTool implements FreyaTool {

    constructor(
        private cookieStore: CookieStore,
        private ctx?: FreyaContext
    ) { }

    getDefinition(): ToolDefinition {
        return {
            name: 'web_fetch',
            // 发起 HTTP GET 请求并清洗网页
            description: 'Send HTTP GET request to external URL. Security: only http/https allowed, internal and local access strictly forbidden. Cleans HTML (strips script/style/comments) and extracts structured body text to save tokens, suitable for article reading. Large responses (>50KB) auto-saved to workspace.',
            parameters: {
                type: 'object',
                properties: {
                    url: {
                        type: 'string',
                        // 请求地址
                        description: 'Full HTTP/HTTPS request URL'
                    },
                    headers: {
                        type: 'string',
                        // 请求头字符串
                        description: 'Optional JSON request headers object string, e.g. \'{"Authorization": "Bearer xxx"}\''
                    },
                    useCookies: {
                        type: 'boolean',
                        // 是否携带 Cookie
                        description: 'Whether to include previously recorded cookies for this domain (default false)'
                    },
                    maxLength: {
                        type: 'number',
                        // 最大响应长度限制
                        description: 'Maximum character limit for response content (default 102400 / 100KB)'
                    },
                    extractMode: {
                        type: 'string',
                        // 网页内容清洗提取模式
                        description: 'Content extraction mode: "auto" (default, strip script/style/comments, keep paragraphs) / "text" (aggressive plaintext extraction) / "raw" (return verbatim response)',
                    }
                },
                required: ['url']
            }
        };
    }

    async execute(args: Record<string, any>): Promise<string> {
        if (!args.url) {
            // 缺少 URL 参数错误
            return '❌ Parameter error: Must specify url.';
        }

        const extractMode = args.extractMode || 'auto';
        if (!['auto', 'text', 'raw'].includes(extractMode)) {
            // 不支持的提取模式错误
            return `❌ Parameter error: extractMode only supports "auto", "text", or "raw", got "${extractMode}".`;
        }

        const cleanMode = extractMode === 'raw' ? undefined : extractMode;

        try {
            return await executeRequest(args.url, 'GET', args, this.cookieStore, this.ctx, cleanMode);
        } catch (err: any) {
            // 执行失败错误提示
            return `❌ web_fetch execution failed: ${err?.message || String(err)}`;
        }
    }
}

export class WebRequestTool implements FreyaTool {

    constructor(
        private cookieStore: CookieStore,
        private ctx?: FreyaContext
    ) { }

    getDefinition(): ToolDefinition {
        return {
            name: 'web_request',
            // 发起通用 HTTP 请求
            description: 'Send generic HTTP request (POST, PUT, DELETE, GET, etc.) to external URL. Security same as GET. Does not clean HTML by default (raw response, suitable for API JSON or raw HTML). Large responses (>50KB) or binary streams auto-saved to workspace, or forced via saveAs parameter.',
            parameters: {
                type: 'object',
                properties: {
                    url: {
                        type: 'string',
                        // 请求地址
                        description: 'Full HTTP/HTTPS request URL'
                    },
                    method: {
                        type: 'string',
                        // HTTP 请求方法
                        description: 'HTTP request method, e.g. POST, PUT, PATCH, DELETE, GET, etc.'
                    },
                    body: {
                        type: 'string',
                        // 请求体内容
                        description: 'Request body content: JSON string or plaintext'
                    },
                    contentType: {
                        type: 'string',
                        // 请求类型头
                        description: 'Content-Type header value (default application/json)'
                    },
                    headers: {
                        type: 'string',
                        // 请求头字符串
                        description: 'Optional JSON request headers object string, e.g. \'{"Authorization": "Bearer xxx"}\''
                    },
                    useCookies: {
                        type: 'boolean',
                        // 是否携带 Cookie
                        description: 'Whether to include previously recorded cookies for this domain (default false)'
                    },
                    maxLength: {
                        type: 'number',
                        // 最大响应长度限制
                        description: 'Maximum character limit for response content (default 102400 / 100KB)'
                    },
                    saveAs: {
                        type: 'string',
                        // 响应处理模式
                        description: 'Response handling mode: "auto" (default, auto-save file if threshold exceeded or binary) / "file" (force save to file) / "inline" (force inline return, do not save file)',
                    }
                },
                required: ['url', 'method']
            }
        };
    }

    async execute(args: Record<string, any>): Promise<string> {
        if (!args.url) {
            // 缺少 URL 参数错误
            return '❌ Parameter error: Must specify url.';
        }
        if (!args.method) {
            // 缺少 method 参数错误
            return '❌ Parameter error: Must specify method (e.g. POST, PUT, etc.).';
        }

        const method = String(args.method).toUpperCase();
        const allowedMethods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

        if (!allowedMethods.has(method)) {
            // 不支持的 HTTP 方法错误
            return `❌ Unsupported HTTP method "${args.method}", allowed methods: ${Array.from(allowedMethods).join(', ')}.`;
        }

        const saveAs = args.saveAs || 'auto';
        if (!['auto', 'file', 'inline'].includes(saveAs)) {
            // 不支持的 saveAs 模式错误
            return `❌ Parameter error: saveAs only supports "auto", "file", or "inline", got "${saveAs}".`;
        }

        try {
            return await executeRequest(args.url, method, args, this.cookieStore, this.ctx);
        } catch (err: any) {
            // 执行失败错误提示
            return `❌ web_request execution failed: ${err?.message || String(err)}`;
        }
    }
}
