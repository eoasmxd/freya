import type { FreyaContext, FreyaTool, ToolDefinition } from '@eoasmxd/freya-sdk';
import { FreyaConfigManager } from '../../config/config-manager.js';

/** 发起用户授权请求，在敏感操作前进行二级鉴权 */
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
      ctx.logger.error(`[ConfigTool] 授权超时（15秒），默认执行 Fail-Closed 拒绝操作。`);
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
    private pendingAuths: Map<string, (approved: boolean) => void>
  ) { }

  getDefinition(): ToolDefinition {
    return {
      name: 'read_config',
      description: '读取系统核心配置。出于安全考量，敏感配置值默认会进行脱敏处理，除非指定 revealSensitive 为 true 并通过用户授权。',
      parameters: {
        type: 'object',
        properties: {
          revealSensitive: {
            type: 'boolean',
            description: '是否揭示敏感字段的明文（默认为 false）'
          }
        }
      }
    };
  }

  async execute(args: Record<string, any>, ctx: FreyaContext): Promise<string> {
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
          ctx.logger.warn(`[ConfigTool] 大模型尝试读取敏感明文，发起用户二级鉴权...`);
          const approved = await requestUserAuthorization(ctx, 'read', configName, sensitiveKeys.join(', '), this.pendingAuths);
          if (!approved) {
            return `❌ 授权失败：用户拒绝了大模型读取核心配置敏感明文的请求。`;
          }
        }
      }

      const outputData = await this.configService.readConfig(revealSensitive);
      return JSON.stringify(outputData, null, 2);
    } catch (err: any) {
      return `❌ 读取核心配置失败: ${err.message}`;
    }
  }
}

export class UpdateConfigTool implements FreyaTool {
  constructor(
    private configService: FreyaConfigManager,
    private pendingAuths: Map<string, (approved: boolean) => void>
  ) { }

  getDefinition(): ToolDefinition {
    return {
      name: 'update_config',
      description: '对系统核心配置进行细粒度的局部属性（keyPath）增量修改（如 "log.console"）。绝大部分策略属性实时热生效；但若修改了与系统底层进程生命周期绑定的关键属性（如 "port" 端口配置），则需要手动重启核心服务方可物理应用。修改敏感配置项目前需要经过用户授权。',
      parameters: {
        type: 'object',
        properties: {
          keyPath: {
            type: 'string',
            description: '属性层级路径（如："log.console" 或 "contextManagement.maxHistoryTurns"）'
          },
          value: {
            type: 'string',
            description: '新修改的目标值（可为任意类型，传 JSON 字符串或字面量）'
          }
        },
        required: ['keyPath', 'value']
      }
    };
  }

  async execute(args: Record<string, any>, ctx: FreyaContext): Promise<string> {
    try {
      const configName = 'freya';
      const keyPath = args.keyPath;
      if (keyPath === 'workspace') {
        return '❌ 权限拒绝：系统工作区路径 "workspace" 为核心只读保护字段，不允许通过大模型配置管理工具进行修改。';
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
        ctx.logger.warn(`[ConfigTool] 检测到写入敏感字段 "${keyPath}"，发起用户二级鉴权...`);
        const approved = await requestUserAuthorization(ctx, 'write', configName, keyPath, this.pendingAuths, '******');
        if (!approved) {
          return `❌ 授权失败：用户拒绝了大模型修改核心配置敏感字段 "${keyPath}" 的请求。`;
        }
      }

      const result = await this.configService.updateConfig(keyPath, newValue);
      return result.startsWith('❌') ? result : `✅ ${result}`;
    } catch (err: any) {
      return `❌ 修改核心配置失败: ${err.message}`;
    }
  }
}
