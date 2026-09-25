import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FreyaContext, LLMMessage } from '@eoasmxd/freya-sdk';

export interface AuditResult {
  passed: boolean;
  reason: string;
}

/**
 * 前置 SQL 安全与完整性审查审计服务
 * Pre-execution SQL security and integrity audit service
 */
export class SqlAuditService {
  private cachedPrompt: string | null = null;

  /**
   * 双通道探针加载审计提示词模板
   * Dual-channel probe loading for audit prompt template
   */
  private async loadAuditPrompt(ctx: FreyaContext): Promise<string> {
    if (this.cachedPrompt) {
      return this.cachedPrompt;
    }

    const promptFileName = 'plugin.prompt.mysql.select.audit.md';
    const runtimeOverridePath = path.join(ctx.paths.homeDir, 'config', 'prompts', promptFileName);

    try {
      const content = await fs.readFile(runtimeOverridePath, 'utf-8');
      if (content.trim()) {
        this.cachedPrompt = content;
        return content;
      }
    } catch {
      // 运行时覆盖不存在，继续降级读取内置模板
      // Runtime override not found, fallback to built-in template
    }

    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const packageDefaultPath = path.resolve(currentDir, '..', 'config', 'prompts', promptFileName);

    try {
      const content = await fs.readFile(packageDefaultPath, 'utf-8');
      this.cachedPrompt = content;
      return content;
    } catch (err: any) {
      ctx.logger.error(`Failed to load built-in SQL audit prompt template: ${packageDefaultPath}`, err);
      return '';
    }
  }

  /**
   * 执行前置独立 LLM 分析审查
   * Perform pre-execution independent LLM analysis and review
   */
  public async audit(sql: string, connectionName: string, ctx: FreyaContext): Promise<AuditResult> {
    const trimmedSql = sql.trim();
    if (!trimmedSql) {
      // 拦截原因：SQL 语句内容为空
      return { passed: false, reason: 'SQL statement cannot be empty.' };
    }

    const auditPrompt = await this.loadAuditPrompt(ctx);
    if (!auditPrompt) {
      // 拦截原因：安全审查提示词未就绪
      return { passed: false, reason: 'SQL audit prompt template is not ready, execution rejected for safety.' };
    }

    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: auditPrompt
      },
      {
        role: 'user',
        content: JSON.stringify({
          connection: connectionName,
          sql: trimmedSql
        }, null, 2)
      }
    ];

    try {
      const response = await ctx.llm.chat(messages);
      const rawOutput = response.message?.content?.trim() || '';

      const cleaned = rawOutput
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();

      const parsed = JSON.parse(cleaned);
      if (typeof parsed.passed === 'boolean') {
        return {
          passed: parsed.passed,
          // 审核通过或未提供原因
          reason: parsed.reason ? String(parsed.reason) : (parsed.passed ? 'Audit passed.' : 'No rejection reason provided.')
        };
      }

      // 响应结构不符合预期
      return {
        passed: false,
        reason: `Audit response structure does not match expectation: ${rawOutput}`
      };
    } catch (err: any) {
      ctx.logger.error('Error during pre-LLM SQL audit process:', err);
      // 审查服务调用失败
      return {
        passed: false,
        reason: `SQL security audit service call failed: ${err?.message || err}`
      };
    }
  }
}
