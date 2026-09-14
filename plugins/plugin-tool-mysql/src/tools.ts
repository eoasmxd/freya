import type { FreyaContext, ToolDefinition, FreyaTool } from '@eoasmxd/freya-sdk';
import type { MysqlPoolManager } from './pool-manager.js';
import type { SqlAuditService } from './audit.js';

/** 脱敏错误信息中的敏感凭据 */
function sanitizeErrorMessage(err: any, password?: string): string {
  let message = err?.message || String(err);
  if (password) {
    message = message.replaceAll(password, '******');
  }
  return message;
}

/** MySQL 数据库查询执行工具 */
export class MysqlQueryTool implements FreyaTool {
  constructor(
    private poolManager: MysqlPoolManager,
    private auditService: SqlAuditService
  ) {}

  getDefinition(): ToolDefinition {
    return {
      name: 'mysql_query',
      description: '执行 MySQL SELECT 查询语句并返回结构化数据。执行前会进行独立 LLM 安全与完整性审核，支持通过 connection 指定目标连接。',
      parameters: {
        type: 'object',
        properties: {
          sql: {
            type: 'string',
            description: '待执行的 SQL 查询语句'
          },
          connection: {
            type: 'string',
            description: '目标数据库连接名称（可选，若未指定则使用系统默认连接）'
          },
          params: {
            type: 'array',
            items: {},
            description: '可选的参数化查询参数列表'
          }
        },
        required: ['sql']
      }
    };
  }

  async execute(args: Record<string, any>, ctx: FreyaContext): Promise<string> {
    const rawSql = typeof args.sql === 'string' ? args.sql.trim() : '';
    if (!rawSql) {
      return '❌ 参数错误: sql 语句不能为空。';
    }

    const connectionName = typeof args.connection === 'string' && args.connection.trim()
      ? args.connection.trim()
      : undefined;

    const queryParams = Array.isArray(args.params) ? args.params : undefined;

    const auditResult = await this.auditService.audit(rawSql, connectionName || 'default', ctx);
    if (!auditResult.passed) {
      return `❌ SQL 审查未通过，已拒绝执行。\n原因: ${auditResult.reason}`;
    }

    let currentPassword = '';
    try {
      const { pool, config } = this.poolManager.getPool(connectionName);
      currentPassword = config.password || '';

      const maxRows = Number(ctx.config?.mysql?.maxRows ?? ctx.config?.['mysql.maxRows']) || 100;
      const [rows] = await pool.query(rawSql, queryParams);

      if (!Array.isArray(rows)) {
        return JSON.stringify({
          connection: config.name,
          database: config.database || null,
          affectedRows: (rows as any).affectedRows ?? 0,
          info: (rows as any).info || '查询已完成'
        }, null, 2);
      }

      const totalCount = rows.length;
      const truncated = totalCount > maxRows;
      const data = truncated ? rows.slice(0, maxRows) : rows;

      return JSON.stringify({
        connection: config.name,
        database: config.database || null,
        totalCount,
        returnedCount: data.length,
        truncated,
        notice: truncated ? `结果集超过最大限制 ${maxRows} 条，已自动截断返回前 ${maxRows} 条记录。` : undefined,
        data
      }, null, 2);
    } catch (err: any) {
      const safeMessage = sanitizeErrorMessage(err, currentPassword);
      ctx.logger.error(`MySQL 查询执行异常: ${safeMessage}`);
      return `❌ MySQL 查询执行失败: ${safeMessage}`;
    }
  }
}
