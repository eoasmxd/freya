import type { FreyaContext, FreyaTool, ToolDefinition } from '@eoasmxd/freya-sdk';
import { FreyaConfigManager } from '../../config/config-manager.js';

/**
 * 发起用户授权请求，在敏感操作前进行二级鉴权
 * Initiate user authorization request for secondary authentication before sensitive operations
 */
function requestUserAuthorization(
  ctx: FreyaContext,
  action: 'read' | 'write',
  documentName: string,
  keyPath: string,
  pendingAuths: Map<string, (approved: boolean) => void>,
  value?: string
): Promise<boolean> {
  const authId = `auth_${Math.random().toString(36).substring(2, 8)}`;

  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      ctx.logger.error('[ConfigTool] Authorization timeout (15s), default fail-closed rejected.');
      pendingAuths.delete(authId);
      resolve(false);
    }, 15000);

    pendingAuths.set(authId, (approved: boolean) => {
      clearTimeout(timer);
      resolve(approved);
    });

    ctx.eventBus.emit('config:auth_request', {
      authId,
      action,
      documentName,
      keyPath,
      value
    });
  });
}

export class ReadConfigTool implements FreyaTool {
  constructor(
    private configService: FreyaConfigManager,
    private pendingAuths: Map<string, (approved: boolean) => void>,
    private ctx: FreyaContext
  ) { }

  getDefinition(): ToolDefinition {
    return {
      name: 'read_config',
      // 读取系统核心配置
      description: 'Read core system configuration. Sensitive config values are masked by default. Includes a "_readonly" list of property paths that are read-only and locked from modification.',
      parameters: {
        type: 'object',
        properties: {
          revealSensitive: {
            type: 'boolean',
            // 是否揭示敏感字段明文
            description: 'Whether to reveal plaintext of sensitive fields (defaults to false)'
          }
        }
      }
    };
  }

  async execute(args: Record<string, any>): Promise<string> {
    try {
      const revealSensitive = !!args.revealSensitive;
      const configName = 'freya';

      const sensitiveKeys = this.configService.getSensitiveKeys();

      if (revealSensitive && sensitiveKeys.length > 0) {
        const currentConfig = await this.configService.readConfig(false);
        let hasSensitiveData = false;
        for (const k of sensitiveKeys) {
          const parts = k.split('.');
          let current: any = currentConfig;
          let found = true;
          for (const part of parts) {
            if (current && typeof current === 'object' && part in current) {
              current = current[part];
            } else {
              found = false;
              break;
            }
          }
          if (found && current !== undefined && current !== '******') {
            hasSensitiveData = true;
            break;
          }
        }

        if (hasSensitiveData) {
          this.ctx.logger.warn('[ConfigTool] LLM attempting to read sensitive plaintext, initiating secondary user authorization...');
          const approved = await requestUserAuthorization(this.ctx, 'read', configName, sensitiveKeys.join(', '), this.pendingAuths);
          if (!approved) {
            // 授权被拒绝提示
            return `❌ Authorization failed: User rejected LLM request to read sensitive configuration plaintext.`;
          }
        }
      }

      const outputData = await this.configService.readConfig(revealSensitive);
      const readonlyKeys = this.configService.getReadonlyKeys(true);
      const result = {
        ...outputData,
        _readonly: readonlyKeys
      };
      return JSON.stringify(result, null, 2);
    } catch (err: any) {
      // 读取配置失败错误提示
      return `❌ Failed to read core configuration: ${err.message}`;
    }
  }
}

export class UpdateConfigTool implements FreyaTool {
  constructor(
    private configService: FreyaConfigManager,
    private pendingAuths: Map<string, (approved: boolean) => void>,
    private ctx: FreyaContext
  ) { }

  getDefinition(): ToolDefinition {
    return {
      name: 'update_config',
      // 修改系统核心配置局部属性
      description: 'Incrementally update fine-grained property (keyPath) of system configuration (e.g. "log.console"). Most properties take effect dynamically; process-level lifecycle bindings (e.g. "port") require manual core service restart. Modifying sensitive configs requires user authorization.',
      parameters: {
        type: 'object',
        properties: {
          keyPath: {
            type: 'string',
            // 属性层级路径
            description: 'Property hierarchical path (e.g. "log.console" or "contextManagement.maxHistoryTurns")'
          },
          value: {
            type: 'string',
            // 新修改的目标值
            description: 'New target value to update (any type, pass as JSON string or literal)'
          }
        },
        required: ['keyPath', 'value']
      }
    };
  }

  async execute(args: Record<string, any>): Promise<string> {
    try {
      const configName = 'freya';
      const keyPath = String(args.keyPath || '').trim();
      const manualOnlyKeys = this.configService.getManualOnlyKeys();
      let isManualOnly = false;
      const manualOnlySet = new Set(manualOnlyKeys);
      if (manualOnlySet.has(keyPath)) {
        isManualOnly = true;
      } else {
        for (const pattern of manualOnlyKeys) {
          if (pattern.includes('*')) {
            const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '[^\\.]+') + '$');
            if (regex.test(keyPath)) {
              isManualOnly = true;
              break;
            }
          }
        }
      }

      if (isManualOnly) {
        // 仅限管理员手动修改提示
        return `❌ Permission denied: Config item "${keyPath}" can only be modified manually by administrator, automated AI updates are forbidden.`;
      }

      let newValue = args.value;

      try {
        newValue = JSON.parse(newValue);
      } catch { }

      const sensitiveKeys = this.configService.getSensitiveKeys();
      let isSensitive = false;
      const sensitiveSet = new Set(sensitiveKeys);
      if (sensitiveSet.has(keyPath)) {
        isSensitive = true;
      } else {
        for (const pattern of sensitiveKeys) {
          if (pattern.includes('*')) {
            const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '[^\\.]+') + '$');
            if (regex.test(keyPath)) {
              isSensitive = true;
              break;
            }
          }
        }
      }

      if (isSensitive) {
        this.ctx.logger.warn(`[ConfigTool] Detected write to sensitive field "${keyPath}", initiating secondary user authorization...`);
        const approved = await requestUserAuthorization(this.ctx, 'write', configName, keyPath, this.pendingAuths, '******');
        if (!approved) {
          // 修改敏感字段授权被拒绝提示
          return `❌ Authorization failed: User rejected LLM request to modify sensitive field "${keyPath}".`;
        }
      }

      const result = await this.configService.updateConfig(keyPath, newValue);
      return result.startsWith('❌') ? result : `✅ ${result}`;
    } catch (err: any) {
      // 修改配置失败错误提示
      return `❌ Failed to update core configuration: ${err.message}`;
    }
  }
}
