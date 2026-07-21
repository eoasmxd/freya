import type { FreyaContext } from '@eoasmxd/freya-sdk';
import fs from 'node:fs/promises';
import path from 'node:path';

const BLOCK_TAG_PATTERN =
    /<\s*\/\s*(p|div|h[1-6]|li|tr|article|section|header|footer|nav|main|aside|blockquote|pre|hr|table|ul|ol|dl|dt|dd|figure|figcaption|form|fieldset|details|summary|address|caption)\s*>/gi;
const BR_TAG_PATTERN = /<\s*br\s*\/?\s*>/gi;
const HR_TAG_PATTERN = /<\s*hr\s*\/?\s*>/gi;

const NON_TEXT_TAG_PATTERN =
    /<\s*(script|style|noscript|svg|iframe|template|canvas|audio|video|object|embed)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi;
const SELF_CLOSING_NON_TEXT_TAG_PATTERN =
    /<\s*(script|style|noscript|svg|iframe|template|canvas|audio|video|object|embed)\b[^>]*\/\s*>/gi;
const HEADING_TAG_PATTERN = /<\s*h([1-6])\b[^>]*>([\s\S]*?)<\s*\/\s*h\1\s*>/gi;
const TABLE_CELL_END_PATTERN = /<\s*\/\s*(td|th)\s*>/gi;
const IMG_ALT_PATTERN = /<\s*img\b[^>]*\b(?:alt|title)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi;
const ANCHOR_TAG_PATTERN = /<\s*a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\s*\/\s*a\s*>/gi;
const ALL_TAGS_PATTERN = /<(?:"[^"]*"|'[^']*'|[^'">])*>/g;

const INVISIBLE_UNICODE_PATTERN = /[\u200B\u200C\u200D\uFEFF\u00AD]/g;

const BINARY_CONTENT_TYPES = [
    'application/octet-stream',
    'image/',
    'audio/',
    'video/',
    'application/pdf',
    'application/zip',
    'application/gzip',
    'font/',
    'model/',
];

function resolveAbsoluteUrl(href: string, baseUrl?: string): string {
    if (!baseUrl || href.startsWith('http://') || href.startsWith('https://') || href.startsWith('//')) {
        return href;
    }
    try {
        return new URL(href, baseUrl).toString();
    } catch {
        return href;
    }
}

/** HTML 内容净化与结构提取 */
export function cleanHtmlContent(html: string, mode: 'auto' | 'text', baseUrl?: string): string {
    let content = html;

    content = content.replace(NON_TEXT_TAG_PATTERN, '');
    content = content.replace(SELF_CLOSING_NON_TEXT_TAG_PATTERN, '');
    content = content.replace(/<!--[\s\S]*?-->/g, '');

    if (mode === 'auto') {
        content = content.replace(HEADING_TAG_PATTERN, (_match, level, text) => {
            const prefix = '#'.repeat(parseInt(level, 10));
            const cleanTitle = text.replace(ALL_TAGS_PATTERN, '').trim();
            return cleanTitle ? `\n\n${prefix} ${cleanTitle}\n` : '';
        });
        content = content.replace(HR_TAG_PATTERN, '\n───\n');
        content = content.replace(BR_TAG_PATTERN, '\n');
        content = content.replace(TABLE_CELL_END_PATTERN, ' ');
        content = content.replace(BLOCK_TAG_PATTERN, '\n');
    }

    content = content.replace(IMG_ALT_PATTERN, (_match, g1, g2, g3) => {
        const altText = (g1 || g2 || g3 || '').trim();
        return altText ? ` [图片: ${altText}] ` : '';
    });

    content = content.replace(ANCHOR_TAG_PATTERN, (_match, g1, g2, g3, text) => {
        const rawHref = (g1 || g2 || g3 || '').trim();
        const cleanText = text.replace(ALL_TAGS_PATTERN, '').trim();
        if (!rawHref || rawHref.startsWith('javascript:') || rawHref === '#') {
            return cleanText;
        }
        const fullHref = resolveAbsoluteUrl(rawHref, baseUrl);
        return cleanText ? `[${cleanText}](${fullHref})` : fullHref;
    });

    content = content.replace(ALL_TAGS_PATTERN, '');
    content = decodeHtmlEntities(content);
    content = normalizeWhitespaceContent(content);
    content = content.replace(INVISIBLE_UNICODE_PATTERN, '');

    return content.trim();
}

function decodeHtmlEntities(text: string): string {
    let result = text.replace(/&#(\d+);/g, (_match, dec) => {
        const code = parseInt(dec, 10);
        return code > 0 ? String.fromCodePoint(code) : _match;
    });
    result = result.replace(/&#x([0-9a-fA-F]+);/g, (_match, hex) => {
        const code = parseInt(hex, 16);
        return code > 0 ? String.fromCodePoint(code) : _match;
    });

    const entities = [
        ['amp', '\x26'],
        ['lt', '\x3C'],
        ['gt', '\x3E'],
        ['quot', '\x22'],
        ['apos', '\x27'],
        ['#x27', '\x27'],
        ['#39', '\x27'],
        ['nbsp', '\x20'],
        ['#160', '\x20'],
        ['copy', '\xA9'],
        ['reg', '\xAE'],
        ['trade', '\u2122'],
        ['mdash', '\u2014'],
        ['ndash', '\u2013'],
        ['hellip', '\u2026'],
        ['lsquo', '\u2018'],
        ['rsquo', '\u2019'],
        ['ldquo', '\u201C'],
        ['rdquo', '\u201D'],
    ];

    for (const [name, replacement] of entities) {
        result = result.split('\x26' + name + ';').join(replacement);
    }

    return result;
}

function normalizeWhitespaceContent(text: string): string {
    const cleanedLines = text
        .split('\n')
        .map((line) => line.replace(/[ \t]+/g, ' ').trim());
    return cleanedLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const BLOCKED_HOSTS = new Set([
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    '[::1]',
]);

function isPrivateIPv4(hostname: string): boolean {
    const parts = hostname.split('.');
    if (parts.length !== 4) return false;

    const octets = parts.map((p) => parseInt(p, 10));
    if (octets.some((o) => isNaN(o) || o < 0 || o > 255)) return false;

    if (octets[0] === 10) return true;
    if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
    if (octets[0] === 192 && octets[1] === 168) return true;
    if (octets[0] === 169 && octets[1] === 254) return true;

    return false;
}

/** 校验 URL 安全性 */
export function validateUrl(rawUrl: string): URL {
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        throw new Error(`无效的 URL: "${rawUrl}"，请提供完整的 HTTP/HTTPS 地址。`);
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error(
            `不支持的协议 "${url.protocol}"，仅允许 http: 和 https: 协议。`
        );
    }

    const hostname = url.hostname.toLowerCase();

    if (BLOCKED_HOSTS.has(hostname)) {
        throw new Error(`安全拒绝：禁止访问本地地址 "${hostname}"。`);
    }

    if (isPrivateIPv4(hostname)) {
        throw new Error(
            `安全拒绝：禁止访问内网地址 "${hostname}"。`
        );
    }

    return url;
}

const DEFAULT_MAX_LENGTH = 100 * 1024;

/** 截断响应文本 */
export function truncateContent(content: string, maxLength?: number): string {
    const limit = maxLength && maxLength > 0 ? maxLength : DEFAULT_MAX_LENGTH;

    if (content.length <= limit) {
        return content;
    }

    const truncated = content.slice(0, limit);
    return (
        truncated +
        `\n\n... [响应内容已截断，原始长度 ${content.length} 字符，当前限制 ${limit} 字符。可通过 maxLength 参数调整限制]`
    );
}

export const DEFAULT_TIMEOUT_MS = 30_000;

/** 解析请求 Headers 参数 */
export function parseHeaders(rawHeaders: unknown): Record<string, string> {
    if (!rawHeaders) return {};

    if (typeof rawHeaders === 'string') {
        try {
            const parsed = JSON.parse(rawHeaders);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return ensureStringValues(parsed);
            }
        } catch {
            throw new Error('headers 参数 JSON 解析失败，请提供合法的 JSON 对象字符串。');
        }
    }

    if (typeof rawHeaders === 'object' && rawHeaders !== null && !Array.isArray(rawHeaders)) {
        return ensureStringValues(rawHeaders as Record<string, unknown>);
    }

    throw new Error(
        'headers 参数格式不正确，需为 JSON 对象字符串（如 \'{"Authorization": "Bearer xxx"}\'）。'
    );
}

function ensureStringValues(obj: Record<string, unknown>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(obj)) {
        result[key] = String(value);
    }
    return result;
}

/** 获取工作区绝对路径 */
export function getWorkspaceDir(ctx: FreyaContext): string {
    return ctx.paths.workspaceDir;
}

function isBinaryContentType(contentType: string): boolean {
    const lower = contentType.toLowerCase();
    return BINARY_CONTENT_TYPES.some((prefix) => lower.startsWith(prefix));
}

/** 智能判定是否自动落盘 */
export function shouldAutoSave(
    args: Record<string, any>,
    bodyLength: number,
    contentType: string,
    threshold: number,
): boolean {
    const saveAs = args.saveAs || 'auto';
    if (saveAs === 'file') return true;
    if (saveAs === 'inline') return false;

    if (isBinaryContentType(contentType)) return true;
    if (bodyLength > threshold) return true;
    return false;
}

function inferExtension(contentType: string): string {
    const lower = contentType.toLowerCase();
    if (lower.includes('application/json')) return '.json';
    if (lower.includes('text/html') || lower.includes('application/xhtml')) return '.html';
    if (lower.includes('text/xml') || lower.includes('application/xml')) return '.xml';
    if (lower.includes('text/css')) return '.css';
    if (lower.includes('text/javascript') || lower.includes('application/javascript')) return '.js';
    if (lower.includes('text/csv')) return '.csv';
    if (lower.includes('application/pdf')) return '.pdf';
    if (lower.includes('image/png')) return '.png';
    if (lower.includes('image/jpeg')) return '.jpg';
    if (lower.includes('image/gif')) return '.gif';
    if (lower.includes('image/svg')) return '.svg';
    if (lower.includes('application/zip')) return '.zip';
    if (lower.includes('application/gzip')) return '.gz';
    return '.txt';
}

/** 将响应内容保存到工作区文件 */
export async function saveToWorkspace(
    workspaceDir: string,
    url: string,
    body: string,
    contentType: string,
): Promise<string> {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/[^a-zA-Z0-9\-_\.]/g, '_');
    const pathPart = parsed.pathname
        .replace(/[^a-zA-Z0-9\-_\.\/]/g, '_')
        .replace(/\//g, '_')
        .slice(0, 50)
        .replace(/^_+/, '')
        .replace(/_+$/, '');

    const timestamp = new Date().toISOString().replace(/[:\.]/g, '-');
    const ext = inferExtension(contentType);

    const fileName = `${timestamp}_${hostname}${pathPart ? '_' + pathPart : ''}${ext}`;
    const saveDir = path.join(workspaceDir, 'download');

    await fs.mkdir(saveDir, { recursive: true });

    const filePath = path.join(saveDir, fileName);
    await fs.writeFile(filePath, body, 'utf-8');

    const relativePath = path.relative(workspaceDir, filePath);
    return relativePath;
}

/** 格式化文件大小 */
export function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
