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
    ctx: FreyaContext,
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

    const timeout = ctx.config.web?.timeout ?? DEFAULT_TIMEOUT_MS;
    const configMaxLength = ctx.config.web?.maxLength ?? undefined;
    const configAutoSaveThreshold = ctx.config.web?.autoSaveThreshold ?? 50 * 1024;

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
            return `❌ 请求超时（${timeout / 1000} 秒）：${url}`;
        }
        if (message.includes('fetch')) {
            return `❌ 网络请求失败：无法连接到 ${url}（${message}）`;
        }
        return `❌ 网络请求失败：${message}`;
    }

    const setCookieHeaders = response.headers.getSetCookie?.() || [];
    cookieStore.recordFromResponse(url, setCookieHeaders);

    let responseText: string;
    try {
        responseText = await response.text();
    } catch (err: any) {
        return `❌ 读取响应内容失败：${err?.message || String(err)}`;
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
        lines.push(`原始响应 (${formatBytes(byteLength)}) 已保存至工作区相对路径: "${savedPath}"`);

        if (setCookieHeaders.length > 0) {
            const domain = extractHostname(url);
            lines.push(`已记录 ${setCookieHeaders.length} 个 Set-Cookie → 域名: ${domain}`);
        }

        if (useCookies) {
            const hostname = extractHostname(url);
            const usedCookie = cookieStore.getCookieHeader(hostname);
            if (usedCookie) {
                lines.push(`已携带 Cookie 请求 → ${hostname}`);
            }
        }

        lines.push('');
        lines.push('可通过 read_file 工具分段读取该文件进行分析。');
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
        ? `（净化后原始 ${processedText.length} 字符，已截断）`
        : `（净化后 ${processedText.length} 字符）`;

    const lines: string[] = [];
    lines.push(`HTTP ${response.status} ${response.statusText} — ${url}`);
    lines.push(`Content-Type: ${responseContentType || 'unknown'} ${sizeInfo}`);

    if (setCookieHeaders.length > 0) {
        const domain = extractHostname(url);
        lines.push(`已记录 ${setCookieHeaders.length} 个 Set-Cookie → 域名: ${domain}`);
    }

    if (useCookies) {
        const hostname = extractHostname(url);
        const usedCookie = cookieStore.getCookieHeader(hostname);
        if (usedCookie) {
            lines.push(`已携带 Cookie 请求 → ${hostname}`);
        }
    }

    lines.push('');
    lines.push(content);

    return lines.join('\n');
}

export class WebFetchTool implements FreyaTool {

    constructor(private cookieStore: CookieStore) { }

    getDefinition(): ToolDefinition {
        return {
            name: 'web_fetch',
            description: '对指定外部 URL 发起 HTTP GET 请求。安全限制：仅限 http/https 协议，严禁访问本地与内网。本工具默认会对返回的 HTML 网页进行深度净化清洗（剔除 script、style 与注释），仅提取结构化网页正文文本（以节约 Token 消耗），特别适用于网页文章内容的阅读与分析。超大响应（默认超过 50KB）会被自动保存为工作区文件。',
            parameters: {
                type: 'object',
                properties: {
                    url: {
                        type: 'string',
                        description: '完整的 HTTP/HTTPS 请求地址'
                    },
                    headers: {
                        type: 'string',
                        description: '可选的 JSON 格式请求头对象字符串，如 \'{"Authorization": "Bearer xxx"}\''
                    },
                    useCookies: {
                        type: 'boolean',
                        description: '是否自动携带该域名之前记录的 Cookie（默认 false）'
                    },
                    maxLength: {
                        type: 'number',
                        description: '响应内容最大字符长度限制（默认 102400 即 100KB）'
                    },
                    extractMode: {
                        type: 'string',
                        description: '内容提取模式："auto"（默认，移除 script/style/注释，保留块级分段）/ "text"（更激进的纯文本提取）/ "raw"（原文返回，不做任何处理）',
                    }
                },
                required: ['url']
            }
        };
    }

    async execute(args: Record<string, any>, ctx: FreyaContext): Promise<string> {
        if (!args.url) {
            return '❌ 参数错误：必须指定 url。';
        }

        const extractMode = args.extractMode || 'auto';
        if (!['auto', 'text', 'raw'].includes(extractMode)) {
            return `❌ 参数错误：extractMode 仅支持 "auto"、"text" 或 "raw"，当前值为 "${extractMode}"。`;
        }

        const cleanMode = extractMode === 'raw' ? undefined : extractMode;

        try {
            return await executeRequest(args.url, 'GET', args, this.cookieStore, ctx, cleanMode);
        } catch (err: any) {
            return `❌ web_fetch 执行失败: ${err?.message || String(err)}`;
        }
    }
}

export class WebRequestTool implements FreyaTool {

    constructor(private cookieStore: CookieStore) { }

    getDefinition(): ToolDefinition {
        return {
            name: 'web_request',
            description: '对指定外部 URL 发起通用 HTTP 请求（包括 POST, PUT, DELETE, GET 等动作）。安全限制与 GET 保持一致，严禁访问本地与内网。支持自定义请求体 body。本工具默认不对响应内容进行任何 HTML 文本净化（Raw 原始内容返回，适合读取 API 接口 JSON 或网页原始 HTML 源码），且超大响应或二进制流（默认超过 50KB）会被自动保存为工作区文件，亦可通过 saveAs 参数强制指定落盘下载，以供后续读取。',
            parameters: {
                type: 'object',
                properties: {
                    url: {
                        type: 'string',
                        description: '完整的 HTTP/HTTPS 请求地址'
                    },
                    method: {
                        type: 'string',
                        description: 'HTTP 请求方法，如 POST、PUT、PATCH、DELETE、GET 等'
                    },
                    body: {
                        type: 'string',
                        description: '请求体内容：JSON 字符串或普通文本'
                    },
                    contentType: {
                        type: 'string',
                        description: 'Content-Type 请求头值（默认 application/json）'
                    },
                    headers: {
                        type: 'string',
                        description: '可选的 JSON 格式请求头对象字符串，如 \'{"Authorization": "Bearer xxx"}\''
                    },
                    useCookies: {
                        type: 'boolean',
                        description: '是否自动携带该域名之前记录的 Cookie（默认 false）'
                    },
                    maxLength: {
                        type: 'number',
                        description: '响应内容最大字符长度限制（默认 102400 即 100KB）'
                    },
                    saveAs: {
                        type: 'string',
                        description: '响应处理模式："auto"（默认，超过阈值或二进制自动保存文件）/ "file"（强制保存文件）/ "inline"（强制直接返回，不保存文件）',
                    }
                },
                required: ['url', 'method']
            }
        };
    }

    async execute(args: Record<string, any>, ctx: FreyaContext): Promise<string> {
        if (!args.url) {
            return '❌ 参数错误：必须指定 url。';
        }
        if (!args.method) {
            return '❌ 参数错误：必须指定 method（如 POST、PUT 等）。';
        }

        const method = String(args.method).toUpperCase();
        const allowedMethods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

        if (!allowedMethods.has(method)) {
            return `❌ 不支持的 HTTP 方法 "${args.method}"，允许的方法：${Array.from(allowedMethods).join(', ')}。`;
        }

        const saveAs = args.saveAs || 'auto';
        if (!['auto', 'file', 'inline'].includes(saveAs)) {
            return `❌ 参数错误：saveAs 仅支持 "auto"、"file" 或 "inline"，当前值为 "${saveAs}"。`;
        }

        try {
            return await executeRequest(args.url, method, args, this.cookieStore, ctx);
        } catch (err: any) {
            return `❌ web_request 执行失败: ${err?.message || String(err)}`;
        }
    }
}
