import type { ConfigFieldSchema, FreyaContext } from '@eoasmxd/freya-sdk';
import type { FreyaConfigManager } from './config-manager.js';
import type http from 'node:http';
import { I18n } from '../i18n/index.js';
import { zh } from '../i18n/locales/zh.js';
import { en } from '../i18n/locales/en.js';

/**
 * 核心配置 REST API 路由器
 * Core configuration REST API router
 * 拦截并分发以 /api/config 开头的管理请求，复用 ConfigManager 的现有实现
 * Intercepts and dispatches /api/config management requests, reusing ConfigManager implementation
 */
export class FreyaConfigApi {
  private readonly headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
  private readonly i18n: I18n;

  constructor(private configManager: FreyaConfigManager, ctx?: FreyaContext) {
    this.i18n = new I18n({ zh, en }, ctx);
  }

  private getBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let body = '';
      let size = 0;
      const maxLimit = 1024 * 1024;

      req.on('data', chunk => {
        size += chunk.length;
        if (size > maxLimit) {
          req.destroy();
          reject(new Error(this.i18n.t('api.error.bodyTooLarge', 'Request body exceeds 1MB size limit.')));
          return;
        }
        body += chunk;
      });

      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch {
          reject(new Error(this.i18n.t('api.error.bodyInvalidJson', 'Request body is not valid JSON.')));
        }
      });
    });
  }

  async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
    const urlObj = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
    const pathname = urlObj.pathname;
    const defaultLang = urlObj.searchParams.get('lang') || (req.headers['accept-language'] ? String(req.headers['accept-language']).split(',')[0] : undefined);

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
          res.end(JSON.stringify({ success: false, error: this.i18n.t('api.error.missingKeyPath', 'Missing required parameter: keyPath') }));
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
          res.end(JSON.stringify({ success: false, error: this.i18n.t('api.error.updatesNotObject', 'Missing required parameter: updates must be an object') }));
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
        const targetNamespace = urlObj.searchParams.get('namespace') || undefined;
        const schemaMap = this.configManager.getSchema();
        const resolveEnumOption = (opt: any): any => {
          if (typeof opt === 'object' && opt !== null && opt.value !== undefined) {
            return {
              value: opt.value,
              label: opt.label ? this.i18n.resolve(opt.label, defaultLang) : opt.value
            };
          }
          return opt;
        };

        const resolveField = (f: ConfigFieldSchema, ns: string): any => ({
          ...f,
          readonly: this.configManager.isFieldReadonly(f.key, ns) || f.readonly || false,
          description: this.i18n.resolve(f.description, defaultLang),
          category: f.category ? this.i18n.resolve(f.category, defaultLang) : undefined,
          enumValues: f.enumValues ? f.enumValues.map(resolveEnumOption) : undefined,
          children: f.children ? f.children.map(c => resolveField(c, ns)) : undefined
        });

        if (targetNamespace) {
          const fields = schemaMap.get(targetNamespace) || [];
          const data = fields.map(f => resolveField(f, targetNamespace));
          res.writeHead(200, this.headers);
          res.end(JSON.stringify({ success: true, data, namespace: targetNamespace }));
          return true;
        }

        const data: Record<string, any> = {};
        for (const [ns, fields] of schemaMap.entries()) {
          data[ns] = Array.isArray(fields) ? fields.map((f: ConfigFieldSchema) => resolveField(f, ns)) : [];
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
        const rawPlugins = await this.configManager.listPlugins();
        const plugins = rawPlugins.map(plugin => ({
          ...plugin,
          name: this.i18n.resolve(plugin.displayName, defaultLang),
          description: this.i18n.resolve(plugin.description, defaultLang)
        }));
        res.writeHead(200, this.headers);
        res.end(JSON.stringify({ success: true, data: plugins }));
        return true;
      }

      if (pathname === '/api/config/plugins/toggle' && req.method === 'POST') {
        const { pluginId, enabled } = await this.getBody(req);
        if (!pluginId) {
          res.writeHead(200, this.headers);
          res.end(JSON.stringify({ success: false, error: this.i18n.t('api.error.missingPluginId', 'Missing required parameter: pluginId', undefined, defaultLang) }));
          return true;
        }
        const msg = await this.configManager.togglePlugin(pluginId, enabled);
        res.writeHead(200, this.headers);
        res.end(JSON.stringify({ success: !msg.startsWith('❌'), message: msg }));
        return true;
      }

      if (pathname === '/api/config/skills' && req.method === 'GET') {
        const skills = this.configManager.listSkills().map(skill => ({
          ...skill,
          name: this.i18n.resolve(skill.name, defaultLang),
          description: this.i18n.resolve(skill.description, defaultLang)
        }));
        res.writeHead(200, this.headers);
        res.end(JSON.stringify({ success: true, data: skills }));
        return true;
      }

      if (pathname === '/api/config/skills/toggle' && req.method === 'POST') {
        const { skillId, enabled } = await this.getBody(req);
        if (!skillId) {
          res.writeHead(200, this.headers);
          res.end(JSON.stringify({ success: false, error: this.i18n.t('api.error.missingSkillId', 'Missing required parameter: skillId', undefined, defaultLang) }));
          return true;
        }
        const msg = await this.configManager.toggleSkill(skillId, enabled);
        res.writeHead(200, this.headers);
        res.end(JSON.stringify({ success: !msg.startsWith('❌'), message: msg }));
        return true;
      }


      const promptMatch = pathname.match(/^\/api\/config\/prompts\/([^/]+)$/);
      if (promptMatch && req.method === 'GET') {
        const promptName = decodeURIComponent(promptMatch[1]);
        const content = await this.configManager.readPrompt(promptName, defaultLang);
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
      res.end(JSON.stringify({ success: false, error: this.i18n.t('api.error.notSupported', 'Unsupported API method or path: {method} {pathname}', { method: req.method || '', pathname }, defaultLang) }));
      return true;

    } catch (err: any) {
      res.writeHead(500, this.headers);
      res.end(JSON.stringify({ success: false, error: err.message || this.i18n.t('api.error.internal', 'Internal API processing error', undefined, defaultLang) }));
      return true;
    }

  }
}
