import type { FreyaConfigManager } from '../config/config-manager.js';
import type http from 'node:http';

/**
 * 核心配置 REST API 路由器
 * 拦截并分发以 /api/config 开头的管理请求，复用 ConfigManager 的现有实现
 */
export class FreyaConfigApi {
  private readonly headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  constructor(private configManager: FreyaConfigManager) { }

  private getBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let body = '';
      let size = 0;
      const maxLimit = 1024 * 1024;

      req.on('data', chunk => {
        size += chunk.length;
        if (size > maxLimit) {
          req.destroy();
          reject(new Error('请求体大小溢出 1MB 额度限制。'));
          return;
        }
        body += chunk;
      });

      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch {
          reject(new Error('请求体非合法 JSON 格式。'));
        }
      });
    });
  }

  async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
    const urlObj = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
    const pathname = urlObj.pathname;

    if (!pathname.startsWith('/api/config')) {
      return false;
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(200, this.headers);
      res.end();
      return true;
    }

    try {
      if (pathname === '/api/config' && req.method === 'GET') {
        const reveal = urlObj.searchParams.get('reveal') === 'true';
        const config = await this.configManager.readConfig(reveal);
        res.writeHead(200, this.headers);
        res.end(JSON.stringify({ success: true, data: config }));
        return true;
      }

      if (pathname === '/api/config' && req.method === 'POST') {
        const { keyPath, value } = await this.getBody(req);
        if (!keyPath) {
          res.writeHead(200, this.headers);
          res.end(JSON.stringify({ success: false, error: '缺少必要参数: keyPath' }));
          return true;
        }
        const msg = await this.configManager.updateConfig(keyPath, value);
        res.writeHead(200, this.headers);
        res.end(JSON.stringify({ success: true, message: msg }));
        return true;
      }

      if (pathname === '/api/config/batch' && req.method === 'POST') {
        const { updates } = await this.getBody(req);
        if (!updates || typeof updates !== 'object') {
          res.writeHead(200, this.headers);
          res.end(JSON.stringify({ success: false, error: '缺少必要参数: updates 必须是对象' }));
          return true;
        }
        const msg = await this.configManager.updateConfigs(updates);
        res.writeHead(200, this.headers);
        res.end(JSON.stringify({ success: true, message: msg }));
        return true;
      }

      if (pathname === '/api/config/providers' && req.method === 'GET') {
        const providers = await this.configManager.listProviders();
        res.writeHead(200, this.headers);
        res.end(JSON.stringify({ success: true, data: providers }));
        return true;
      }

      if (pathname === '/api/config/provider-types' && req.method === 'GET') {
        const types = await this.configManager.getAvailableProviderTypes();
        res.writeHead(200, this.headers);
        res.end(JSON.stringify({ success: true, data: types }));
        return true;
      }

      if (pathname === '/api/config/schema' && req.method === 'GET') {
        const schemaMap = this.configManager.getSchema();
        const data: Record<string, any> = {};
        for (const [ns, fields] of schemaMap.entries()) {
          data[ns] = fields;
        }
        res.writeHead(200, this.headers);
        res.end(JSON.stringify({ success: true, data }));
        return true;
      }

      if (pathname === '/api/config/providers' && req.method === 'POST') {
        const body = await this.getBody(req);
        const msg = await this.configManager.addProvider(body);
        res.writeHead(200, this.headers);
        res.end(JSON.stringify({ success: !msg.startsWith('❌'), message: msg }));
        return true;
      }

      const providerMatch = pathname.match(/^\/api\/config\/providers\/([^/]+)$/);
      if (providerMatch && req.method === 'PUT') {
        const providerId = decodeURIComponent(providerMatch[1]);
        const body = await this.getBody(req);
        const msg = await this.configManager.editProvider(providerId, body);
        res.writeHead(200, this.headers);
        res.end(JSON.stringify({ success: !msg.startsWith('❌'), message: msg }));
        return true;
      }

      if (providerMatch && req.method === 'DELETE') {
        const providerId = decodeURIComponent(providerMatch[1]);
        const msg = await this.configManager.removeProvider(providerId);
        res.writeHead(200, this.headers);
        res.end(JSON.stringify({ success: !msg.startsWith('❌'), message: msg }));
        return true;
      }

      if (pathname === '/api/config/models' && req.method === 'GET') {
        const providerId = urlObj.searchParams.get('providerId') || undefined;
        const models = await this.configManager.listModels(providerId);
        res.writeHead(200, this.headers);
        res.end(JSON.stringify({ success: true, data: models }));
        return true;
      }

      const modelAddMatch = pathname.match(/^\/api\/config\/models\/([^/]+)$/);
      if (modelAddMatch && req.method === 'POST') {
        const providerId = decodeURIComponent(modelAddMatch[1]);
        const body = await this.getBody(req);
        const msg = await this.configManager.addModel(providerId, body);
        res.writeHead(200, this.headers);
        res.end(JSON.stringify({ success: !msg.startsWith('❌'), message: msg }));
        return true;
      }

      const modelEditMatch = pathname.match(/^\/api\/config\/models\/([^/]+)\/([^/]+)$/);
      if (modelEditMatch && req.method === 'PUT') {
        const providerId = decodeURIComponent(modelEditMatch[1]);
        const modelId = decodeURIComponent(modelEditMatch[2]);
        const body = await this.getBody(req);
        const msg = await this.configManager.editModel(providerId, modelId, body);
        res.writeHead(200, this.headers);
        res.end(JSON.stringify({ success: !msg.startsWith('❌'), message: msg }));
        return true;
      }

      if (modelEditMatch && req.method === 'DELETE') {
        const providerId = decodeURIComponent(modelEditMatch[1]);
        const modelId = decodeURIComponent(modelEditMatch[2]);
        const msg = await this.configManager.removeModel(providerId, modelId);
        res.writeHead(200, this.headers);
        res.end(JSON.stringify({ success: !msg.startsWith('❌'), message: msg }));
        return true;
      }

      if (pathname === '/api/config/plugins' && req.method === 'GET') {
        const plugins = await this.configManager.listPlugins();
        res.writeHead(200, this.headers);
        res.end(JSON.stringify({ success: true, data: plugins }));
        return true;
      }

      if (pathname === '/api/config/plugins/toggle' && req.method === 'POST') {
        const { pluginId, enabled } = await this.getBody(req);
        if (!pluginId) {
          res.writeHead(200, this.headers);
          res.end(JSON.stringify({ success: false, error: '缺少必要参数: pluginId' }));
          return true;
        }
        const msg = await this.configManager.togglePlugin(pluginId, enabled);
        res.writeHead(200, this.headers);
        res.end(JSON.stringify({ success: !msg.startsWith('❌'), message: msg }));
        return true;
      }

      const promptMatch = pathname.match(/^\/api\/config\/prompts\/([^/]+)$/);
      if (promptMatch && req.method === 'GET') {
        const promptName = decodeURIComponent(promptMatch[1]);
        const content = await this.configManager.readPrompt(promptName);
        res.writeHead(200, this.headers);
        res.end(JSON.stringify({
          success: !content.startsWith('❌'),
          data: content.startsWith('❌') ? undefined : content,
          error: content.startsWith('❌') ? content : undefined
        }));
        return true;
      }

      if (promptMatch && req.method === 'POST') {
        const promptName = decodeURIComponent(promptMatch[1]);
        const { content } = await this.getBody(req);
        const msg = await this.configManager.writePrompt(promptName, content || '');
        res.writeHead(200, this.headers);
        res.end(JSON.stringify({ success: !msg.startsWith('❌'), message: msg }));
        return true;
      }

      if (promptMatch && req.method === 'PATCH') {
        const promptName = decodeURIComponent(promptMatch[1]);
        const { targetContent, replacementContent } = await this.getBody(req);
        const msg = await this.configManager.editPrompt(promptName, targetContent, replacementContent);
        res.writeHead(200, this.headers);
        res.end(JSON.stringify({ success: !msg.startsWith('❌'), message: msg }));
        return true;
      }

      res.writeHead(404, this.headers);
      res.end(JSON.stringify({ success: false, error: `请求的 API 方法或路径不支持: ${req.method} ${pathname}` }));
      return true;

    } catch (err: any) {
      res.writeHead(500, this.headers);
      res.end(JSON.stringify({ success: false, error: err.message || '内部接口处理异常' }));
      return true;
    }
  }
}
