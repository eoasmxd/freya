import type { FreyaContext, FreyaHttpService, HttpRouteHandler, RouteContext, StaticMountOptions } from '@eoasmxd/freya-sdk';
import { I18n } from '../i18n/index.js';
import { zh } from '../i18n/locales/zh.js';
import { en } from '../i18n/locales/en.js';
import http from 'node:http';
import type { Duplex } from 'node:stream';
import { createStaticHandler, getUiDistPath, normalizePrefix } from './static-handler.js';

export type UpgradeHandler = (req: http.IncomingMessage, socket: Duplex, head: Buffer) => void;

/**
 * Standard Web runtime host and route dispatch gateway
 */
export class FreyaWebContainer implements FreyaHttpService {
    private httpServer?: http.Server;
    private port: number = 3000;
    private ctx?: FreyaContext;
    private readonly i18n = new I18n({ zh, en });

    private apiRoutes = new Map<string, HttpRouteHandler>();
    private staticRoutes = new Map<string, HttpRouteHandler>();
    private upgradeRoutes = new Map<string, UpgradeHandler>();

    constructor() { }

    getServer(): http.Server {
        if (!this.httpServer) {
            throw new Error(this.i18n.t('web.error.notInitialized', '[WebContainer] HTTP server has not been initialized.'));
        }
        return this.httpServer;
    }

    registerApi(pathPrefix: string, handler: HttpRouteHandler): () => void {
        const normalized = normalizePrefix(pathPrefix);
        this.apiRoutes.set(normalized, handler);
        return () => this.unregisterApi(normalized);
    }

    unregisterApi(pathPrefix: string): boolean {
        const normalized = normalizePrefix(pathPrefix);
        return this.apiRoutes.delete(normalized);
    }

    registerStatic(pathPrefix: string, localDir: string, options: StaticMountOptions = {}): () => void {
        const normalized = normalizePrefix(pathPrefix);
        const handler = createStaticHandler(normalized, localDir, options, () => this.ctx);
        this.staticRoutes.set(normalized, handler);
        return () => this.unregisterStatic(normalized);
    }

    unregisterStatic(pathPrefix: string): boolean {
        const normalized = normalizePrefix(pathPrefix);
        return this.staticRoutes.delete(normalized);
    }

    registerUpgrade(pathPrefix: string, handler: UpgradeHandler): () => void {
        const normalized = normalizePrefix(pathPrefix);
        this.upgradeRoutes.set(normalized, handler);
        return () => this.unregisterUpgrade(normalized);
    }

    unregisterUpgrade(pathPrefix: string): boolean {
        const normalized = normalizePrefix(pathPrefix);
        return this.upgradeRoutes.delete(normalized);
    }

    private matchPrefix(pathname: string, prefix: string): boolean {
        if (prefix === '/') return true;
        return pathname === prefix || pathname.startsWith(`${prefix}/`);
    }

    private getSortedRoutes<T>(routes: Map<string, T>): [string, T][] {
        return Array.from(routes.entries()).sort((a, b) => b[0].length - a[0].length);
    }

    async start(ctx: FreyaContext): Promise<void> {
        this.ctx = ctx;
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

        this.httpServer = http.createServer(async (req, res) => {
            await this.handleHttpRequest(req, res);
        });

        this.httpServer.on('upgrade', (req, socket, head) => {
            this.handleUpgradeRequest(req, socket as Duplex, head);
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

    private async handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const urlObj = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
        const pathname = urlObj.pathname;
        const context: RouteContext = {
            pathname,
            query: urlObj.searchParams
        };

        for (const [prefix, handler] of this.getSortedRoutes(this.apiRoutes)) {
            if (this.matchPrefix(pathname, prefix)) {
                try {
                    const handled = await handler(req, res, context);
                    if (handled !== false || res.writableEnded) {
                        return;
                    }
                } catch (err: any) {
                    this.ctx?.logger.error(`[WebContainer] Error handling API route "${prefix}": ${err.message}`);
                    if (!res.headersSent) {
                        res.statusCode = 500;
                        res.setHeader('Content-Type', 'application/json; charset=utf-8');
                        res.end(JSON.stringify({ error: 'Internal Server Error' }));
                    }
                    return;
                }
            }
        }

        for (const [prefix, handler] of this.getSortedRoutes(this.staticRoutes)) {
            if (this.matchPrefix(pathname, prefix)) {
                try {
                    const handled = await handler(req, res, context);
                    if (handled !== false || res.writableEnded) {
                        return;
                    }
                } catch (err: any) {
                    this.ctx?.logger.error(`[WebContainer] Error handling static route "${prefix}": ${err.message}`);
                }
            }
        }

        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end('Not Found');
    }

    private handleUpgradeRequest(req: http.IncomingMessage, socket: Duplex, head: Buffer): void {
        const urlObj = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
        const pathname = urlObj.pathname;

        for (const [prefix, handler] of this.getSortedRoutes(this.upgradeRoutes)) {
            if (this.matchPrefix(pathname, prefix)) {
                handler(req, socket, head);
                return;
            }
        }

        socket.destroy();
    }

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

    getUiDistPath(appRoot: string): string {
        return getUiDistPath(appRoot);
    }
}
