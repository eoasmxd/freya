import type { FreyaContext, ToolDefinition, FreyaTool } from '@eoasmxd/freya-sdk';
import type { MysqlPoolManager } from './pool-manager.js';
import type { SqlAuditService } from './audit.js';

/**
 * 脱敏错误信息中的敏感凭据
 * Sanitize sensitive credentials in error messages
 */
function sanitizeErrorMessage(err: any, password?: string): string {
  let message = err?.message || String(err);
  if (password) {
    message = message.replaceAll(password, '******');
  }
  return message;
}

/**
 * MySQL 数据库查询执行工具
 * MySQL database query execution tool
 */
export class MysqlQueryTool implements FreyaTool {
  constructor(
    private poolManager: MysqlPoolManager,
    private auditService: SqlAuditService,
    private ctx?: FreyaContext
  ) {}

  getDefinition(): ToolDefinition {
    return {
      name: 'mysql_query',
      // 执行 MySQL SELECT 查询
      description: 'Execute MySQL SELECT query and return structured data. Undergoes independent LLM security and integrity audit before execution. Supports specifying target connection.',
      parameters: {
        type: 'object',
        properties: {
          sql: {
            type: 'string',
            // 待执行的 SQL 查询语句
            description: 'SQL query statement to execute'
          },
          connection: {
            type: 'string',
            // 目标数据库连接名称
            description: 'Target database connection name (optional, defaults to system default connection)'
          },
          params: {
            type: 'array',
            items: {},
            // 参数化查询参数列表
            description: 'Optional parameterized query argument list'
          }
        },
        required: ['sql']
      }
    };
  }

  async execute(args: Record<string, any>): Promise<string> {
    const rawSql = typeof args.sql === 'string' ? args.sql.trim() : '';
    if (!rawSql) {
      // 缺少 SQL 语句参数错误
      return '❌ Parameter error: sql statement cannot be empty.';
    }

    const connectionName = typeof args.connection === 'string' && args.connection.trim()
      ? args.connection.trim()
      : undefined;

    const queryParams = Array.isArray(args.params) ? args.params : undefined;

    const auditResult = await this.auditService.audit(rawSql, connectionName || 'default', this.ctx!);
    if (!auditResult.passed) {
      // SQL 审计未通过拒绝执行
      return `❌ SQL audit rejected execution.\nReason: ${auditResult.reason}`;
    }

    let currentPassword = '';
    try {
      const { pool, config } = this.poolManager.getPool(connectionName);
      currentPassword = config.password || '';

      const maxRows = Number(this.ctx?.config?.mysql?.maxRows ?? this.ctx?.config?.['mysql.maxRows']) || 100;
      const [rows] = await pool.query(rawSql, queryParams);

      if (!Array.isArray(rows)) {
        return JSON.stringify({
          connection: config.name,
          database: config.database || null,
          affectedRows: (rows as any).affectedRows ?? 0,
          // 非数组结果状态
          info: (rows as any).info || 'Query completed'
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
        // 结果截断通知提示
        notice: truncated ? `Result set exceeded maximum limit of ${maxRows} rows, automatically truncated to first ${maxRows} records.` : undefined,
        data
      }, null, 2);
    } catch (err: any) {
      const safeMessage = sanitizeErrorMessage(err, currentPassword);
      this.ctx?.logger.error(`MySQL query execution error: ${safeMessage}`);
      // MySQL 查询失败错误提示
      return `❌ MySQL query execution failed: ${safeMessage}`;
    }
  }
}
