import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FreyaContext, LLMMessage } from '@eoasmxd/freya-sdk';

export interface AuditResult {
  passed: boolean;
  reason: string;
}

/** 前置 SQL 安全与完整性审查审计服务 */
export class SqlAuditService {
  private cachedPrompt: string | null = null;

  /** 双通道探针加载审计提示词模板 */
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
    }

    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const packageDefaultPath = path.resolve(currentDir, '..', 'config', 'prompts', promptFileName);

    try {
      const content = await fs.readFile(packageDefaultPath, 'utf-8');
      this.cachedPrompt = content;
      return content;
    } catch (err: any) {
      ctx.logger.error(`加载内置 SQL 审计提示词模板失败: ${packageDefaultPath}`, err);
      return '';
    }
  }

  /** 执行前置独立 LLM 分析审查 */
  public async audit(sql: string, connectionName: string, ctx: FreyaContext): Promise<AuditResult> {
    const trimmedSql = sql.trim();
    if (!trimmedSql) {
      return { passed: false, reason: 'SQL 语句内容不能为空。' };
    }

    const auditPrompt = await this.loadAuditPrompt(ctx);
    if (!auditPrompt) {
      return { passed: false, reason: 'SQL 审计提示词模板未就绪，安全拒绝执行。' };
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
          reason: parsed.reason ? String(parsed.reason) : (parsed.passed ? '审查通过' : '未提供拦截原因')
        };
      }

      return {
        passed: false,
        reason: `审查响应结构不符合预期: ${rawOutput}`
      };
    } catch (err: any) {
      ctx.logger.error('前置 LLM SQL 审计过程发生异常', err);
      return {
        passed: false,
        reason: `SQL 安全审查服务调用失败: ${err?.message || err}`
      };
    }
  }
}
