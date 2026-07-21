import type { FreyaContext } from '@eoasmxd/freya-sdk';
import type { FreyaConfigManager } from '../config/config-manager.js';
import { FreyaConfigApi } from './config-api.js';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { APP_ROOT } from '../utils/paths.js';

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

/** HTTP 服务容器，托管前端 UI 静态资源 */
export class FreyaWebContainer {
    private httpServer?: http.Server;
    private port: number = 3000;
    private configApi?: FreyaConfigApi;

    constructor() { }

    /**
     * 获取当前托管的底层 HTTP 服务实例
     */
    getServer(): http.Server {
        if (!this.httpServer) {
            throw new Error('[WebContainer] HTTP 服务尚未初始化。');
        }
        return this.httpServer;
    }

    /**
     * 启动 Web 静态容器托管服务
     */
    async start(ctx: FreyaContext, port: number, configManager: FreyaConfigManager): Promise<void> {
        this.port = port;
        this.configApi = new FreyaConfigApi(configManager);
        const uiDist = this.getUiDistPath(APP_ROOT);
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
                res.writeHead(200, { 'Content-Type': contentType });
                res.end(content);
            } catch (err: any) {
                if (err.code === 'ENOENT') {
                    try {
                        const indexHtml = await fs.readFile(path.join(uiDist, 'index.html'));
                        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                        res.end(indexHtml);
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
            ctx.logger.error(`[WebContainer] HTTP 服务监听遭遇异常: ${err.message}`);
        });

        return new Promise((resolve) => {
            this.httpServer?.listen(this.port, () => {
                ctx.logger.info(`[WebContainer] Web 容器启动成功，监听端口: ${this.port}`);
                resolve();
            });
        });
    }

    /**
     * 关停 Web 静态容器服务，并强行阻断释放所有活跃连接
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

    private getUiDistPath(projectRoot: string): string {
        const devPath = path.join(projectRoot, 'packages', 'ui', 'dist');
        const prodPath = path.join(projectRoot, 'ui');
        if (fsSync.existsSync(devPath)) return devPath;
        return prodPath;
    }
}
