import type { FreyaContext, HttpRouteHandler, RouteContext, StaticMountOptions } from '@eoasmxd/freya-sdk';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

const MIME_TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.map': 'application/json'
};

export function normalizePrefix(prefix: string): string {
    let p = prefix.trim();
    if (!p.startsWith('/')) p = `/${p}`;
    if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
    return p;
}

export function resolveHtmlLanguage(req: http.IncomingMessage, ctx?: FreyaContext): string {
    const configLang = (ctx?.config as any)?.system?.language;
    if (configLang && configLang !== 'auto') {
        return configLang;
    }
    const acceptLang = String(req.headers['accept-language'] || '').toLowerCase();
    return acceptLang.includes('zh') ? 'zh' : 'en';
}

export function injectLanguageToHtml(html: string, lang: string): string {
    const tag = `<script>window.__FREYA_LANGUAGE__ = "${lang}";</script>`;
    if (html.includes('</head>')) {
        return html.replace('</head>', `${tag}</head>`);
    }
    return tag + html;
}

export function getUiDistPath(appRoot: string): string {
    const devPath = path.join(appRoot, 'packages', 'ui', 'dist');
    const prodPath = path.join(appRoot, 'ui');
    if (fsSync.existsSync(devPath)) return devPath;
    return prodPath;
}

/**
 * Creates an HTTP route handler for serving static files with SPA fallback and language injection
 */
export function createStaticHandler(
    pathPrefix: string,
    localDir: string,
    options: StaticMountOptions = {},
    getContext?: () => FreyaContext | undefined
): HttpRouteHandler {
    const resolvedDir = path.resolve(localDir);
    const safePrefix = resolvedDir.endsWith(path.sep) ? resolvedDir : resolvedDir + path.sep;
    const prefix = normalizePrefix(pathPrefix);

    return async (req: http.IncomingMessage, res: http.ServerResponse, context: RouteContext): Promise<boolean> => {
        const pathname = context.pathname;
        let relPath = prefix === '/' ? pathname : (pathname.slice(prefix.length) || '/');
        if (relPath === '/' || !relPath) relPath = '/index.html';

        const rawPath = path.join(resolvedDir, relPath);
        const resolvedFilePath = path.resolve(rawPath);

        if (!resolvedFilePath.startsWith(safePrefix) && resolvedFilePath !== resolvedDir) {
            res.statusCode = 403;
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.end('Forbidden');
            return true;
        }

        const ctx = getContext ? getContext() : undefined;

        try {
            const content = await fs.readFile(resolvedFilePath);
            const ext = path.extname(resolvedFilePath).toLowerCase();
            const contentType = MIME_TYPES[ext] || 'application/octet-stream';

            if (ext === '.html' && options.injectLanguage && ctx) {
                const lang = resolveHtmlLanguage(req, ctx);
                const injected = injectLanguageToHtml(content.toString('utf-8'), lang);
                res.writeHead(200, { 'Content-Type': contentType });
                res.end(injected);
                return true;
            }

            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
            return true;
        } catch (err: any) {
            if (err.code === 'ENOENT' && options.spaFallback) {
                try {
                    const fallbackPath = path.join(resolvedDir, 'index.html');
                    const indexHtml = await fs.readFile(fallbackPath);
                    if (options.injectLanguage && ctx) {
                        const lang = resolveHtmlLanguage(req, ctx);
                        const injected = injectLanguageToHtml(indexHtml.toString('utf-8'), lang);
                        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                        res.end(injected);
                        return true;
                    }
                    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                    res.end(indexHtml);
                    return true;
                } catch {
                    return false;
                }
            }
            return false;
        }
    };
}
