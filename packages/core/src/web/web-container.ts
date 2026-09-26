import type { FreyaContext } from '@eoasmxd/freya-sdk';
import type { FreyaConfigManager } from '../config/config-manager.js';
import { FreyaConfigApi } from './config-api.js';
import { I18n } from '../i18n/index.js';
import { zh } from '../i18n/locales/zh.js';
import { en } from '../i18n/locales/en.js';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { FREYA_APP } from '../utils/paths.js';

const mimeTypes: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

function resolveHtmlLanguage(req: http.IncomingMessage, ctx: FreyaContext): string {
    const configLang = (ctx.config as any)?.system?.language;
    if (configLang && configLang !== 'auto') {
        return configLang;
    }
    const acceptLang = String(req.headers['accept-language'] || '').toLowerCase();
    return acceptLang.includes('zh') ? 'zh' : 'en';
}

function injectLanguageToHtml(html: string, lang: string): string {
    const tag = `<script>window.__FREYA_LANGUAGE__ = "${lang}";</script>`;
    if (html.includes('</head>')) {
        return html.replace('</head>', `${tag}</head>`);
    }
    return tag + html;
}

/**
 * HTTP 服务容器，托管前端 UI 静态资源
 * HTTP service container hosting front-end UI static assets
 */
export class FreyaWebContainer {
    private httpServer?: http.Server;
    private port: number = 3000;
    private configApi?: FreyaConfigApi;
    private i18n: I18n;

    constructor() {
        this.i18n = new I18n({ zh, en });
    }

    /**
     * 获取当前托管的底层 HTTP 服务实例
     * Get underlying HTTP server instance currently hosted
     */
    getServer(): http.Server {
        if (!this.httpServer) {
            throw new Error(this.i18n.t('web.error.notInitialized', '[WebContainer] HTTP server has not been initialized.'));
        }
        return this.httpServer;
    }

    /**
     * 启动 Web 静态容器托管服务
     * Start Web static container hosting service
     */
    async start(ctx: FreyaContext, configManager: FreyaConfigManager): Promise<void> {
        this.i18n.setContext(ctx);
        const portIdx = process.argv.indexOf('--port');
        if (portIdx !== -1 && portIdx + 1 < process.argv.length) {
            const cliPort = parseInt(process.argv[portIdx + 1], 10);
            if (!isNaN(cliPort) && cliPort > 0 && cliPort <= 65535) {
                this.port = cliPort;
            } else {
                this.port = (ctx.config as any)?.server?.port ?? 3000;
            }
        } else {
            this.port = (ctx.config as any)?.server?.port ?? 3000;
        }
        this.configApi = new FreyaConfigApi(configManager, ctx);
        const uiDist = this.getUiDistPath(FREYA_APP);
        const safePrefix = uiDist.endsWith(path.sep) ? uiDist : uiDist + path.sep;

        this.httpServer = http.createServer(async (req, res) => {
            if (this.configApi) {
                const handled = await this.configApi.handleRequest(req, res);
                if (handled) return;
            }

            let reqUrl = req.url === '/' || !req.url ? '/index.html' : req.url;
            reqUrl = reqUrl.split('?')[0];

            const filePath = path.join(uiDist, reqUrl);
            if (!filePath.startsWith(safePrefix)) {
                res.statusCode = 403;
                res.end('Forbidden');
                return;
            }

            try {
                const content = await fs.readFile(filePath);
                const ext = path.extname(filePath).toLowerCase();
                const contentType = mimeTypes[ext] || 'application/octet-stream';
                if (ext === '.html') {
                    const lang = resolveHtmlLanguage(req, ctx);
                    const injected = injectLanguageToHtml(content.toString('utf-8'), lang);
                    res.writeHead(200, { 'Content-Type': contentType });
                    res.end(injected);
                    return;
                }
                res.writeHead(200, { 'Content-Type': contentType });
                res.end(content);
            } catch (err: any) {
                if (err.code === 'ENOENT') {
                    try {
                        const indexHtml = await fs.readFile(path.join(uiDist, 'index.html'));
                        const lang = resolveHtmlLanguage(req, ctx);
                        const injected = injectLanguageToHtml(indexHtml.toString('utf-8'), lang);
                        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                        res.end(injected);
                    } catch {
                        res.statusCode = 404;
                        res.end('Not Found');
                    }
                } else {
                    res.statusCode = 500;
                    res.end('Internal Server Error');
                }
            }
        });

        this.httpServer.on('error', (err: any) => {
            ctx.logger.error(`[WebContainer] HTTP server encountered an error: ${err.message}`);
        });

        return new Promise((resolve) => {
            this.httpServer?.listen(this.port, () => {
                ctx.logger.info(`[WebContainer] Server listening on port ${this.port}`);
                resolve();
            });
        });
    }

    /**
     * 关停 Web 静态容器服务，并强行阻断释放所有活跃连接
     * Stop Web static container service and force termination of all active connections
     */
    async stop(): Promise<void> {
        return new Promise((resolve) => {
            if (this.httpServer) {
                if (typeof this.httpServer.closeAllConnections === 'function') {
                    this.httpServer.closeAllConnections();
                }
                this.httpServer.close(() => resolve());
            } else {
                resolve();
            }
        });
    }

    private getUiDistPath(appRoot: string): string {
        const devPath = path.join(appRoot, 'packages', 'ui', 'dist');
        const prodPath = path.join(appRoot, 'ui');
        if (fsSync.existsSync(devPath)) return devPath;
        return prodPath;
    }
}
