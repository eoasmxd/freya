import type { FreyaContext, ToolPlugin, FreyaTool } from '@eoasmxd/freya-sdk';
import { MysqlPoolManager } from './pool-manager.js';
import { SqlAuditService } from './audit.js';
import { MysqlQueryTool } from './tools.js';

/**
 * MySQL 数据库查询工具箱插件
 * MySQL database query toolbox plugin
 */
export default class MysqlToolsPlugin implements ToolPlugin {
  type = 'tool' as const;

  private poolManager?: MysqlPoolManager;
  private auditService = new SqlAuditService();
  private tools: FreyaTool[] = [];

  async setup(ctx: FreyaContext): Promise<void> {
    this.poolManager = new MysqlPoolManager(ctx);
    this.tools = [
      new MysqlQueryTool(this.poolManager, this.auditService)
    ];

    const available = this.poolManager.getAvailableConnectionNames();
    ctx.logger.info(`MySQL toolbox plugin initialized, registered connections: [${available.join(', ') || 'none'}]`);
  }

  getId(): string {
    return 'mysql';
  }

  getInstructionPrompt(): string {
    return 'plugin.prompt.mysql';
  }

  getTools(): FreyaTool[] {
    return this.tools;
  }

  async stop(ctx: FreyaContext): Promise<void> {
    if (this.poolManager) {
      await this.poolManager.closeAll();
      ctx.logger.info('MySQL toolbox connection resources fully released.');
    }
  }
}

export const Plugin = MysqlToolsPlugin;
