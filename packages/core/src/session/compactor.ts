import type { FreyaContext, ILLMService, LLMMessage } from '@eoasmxd/freya-sdk';
import crypto from 'node:crypto';
import type { FreyaPromptRegistry } from '../prompt/prompt-registry.js';
import type { Session, SnapFile } from './types.js';

function formatHistoryToText(history: LLMMessage[]): string {
    return history
        .map((msg) => {
            // 对话角色名称映射
            const roleMap: Record<string, string> = {
                user: 'User',
                assistant: 'Assistant',
                system: 'System',
                tool: 'Tool Result'
            };
            const roleName = roleMap[msg.role] || msg.role;
            return `[${roleName}]: ${msg.content}`;
        })
        .join('\n\n');
}

export class SessionCompactor {
    private logger?: FreyaContext['logger'];
    private context?: FreyaContext;
    private llm!: ILLMService;
    private promptRegistry?: FreyaPromptRegistry;

    setup(context: FreyaContext, promptRegistry: FreyaPromptRegistry): void {
        this.logger = context.logger;
        this.context = context;
        this.llm = context.llm;
        this.promptRegistry = promptRegistry;
    }

    private truncateHistory(history: LLMMessage[], safeTruncateIndex: number, extraHeader?: LLMMessage): void {
        const keepMessages = history.slice(safeTruncateIndex);
        history.length = 0;
        if (extraHeader) {
            history.push(extraHeader, ...keepMessages);
        } else {
            history.push(...keepMessages);
        }
    }

    /**
     * 仅在内存中组装并返回快照文件实体，无写盘副作用
     * Assemble and return snapshot file entity in memory only, without disk write side effects
     */
    buildSnapshot(
        session: Session,
        summary: string,
        messages: LLMMessage[],
    ): SnapFile {
        return {
            id: crypto.randomUUID(),
            prevSnapshotId: session.lastSnapshotId,
            summary,
            messageCount: messages.length,
            messages,
            createdAt: new Date().toISOString(),
        };
    }

    private async executeSummarize(
        session: Session,
        historyToCompress: LLMMessage[],
        currentSummary?: string
    ): Promise<string | null> {
        const summarizeGuidance = this.promptRegistry?.get('core.prompt.summarize_guidance') || '';
        const formattedHistory = formatHistoryToText(historyToCompress);
        const userContentParts: string[] = [];
        if (currentSummary) {
            // 先前的对话提要
            userContentParts.push(`[Previous Conversation Summary]:\n${currentSummary}`);
        }
        // 需要提炼的对话历史
        userContentParts.push(`[Conversation History to Summarize]:\n${formattedHistory}`);

        const summaryRequest: LLMMessage[] = [
            {
                role: 'system',
                content: summarizeGuidance
            },
            {
                role: 'user',
                content: userContentParts.join('\n\n')
            }
        ];

        this.logger?.info('[SessionCompactor] Generating incremental session background summary...');
        const cmConfig = this.context?.config.contextManagement || {};
        const summaryMaxTokens = cmConfig.summaryMaxTokens || 512;
        const summaryResponse = await this.llm.chat(
            summaryRequest,
            undefined,
            {
                providerId: session.providerId,
                modelId: session.modelId,
                modelParams: { maxTokens: summaryMaxTokens }
            },
        );
        return summaryResponse.message.content || null;
    }

    /**
     * 【前置安全拦截】在发送前基于本地估算做硬拦截限制（默认 85% 窗口），防止大模型 API 溢出崩溃
     * [Pre-guard] Hard intercept based on local estimation (default 85% window) before sending, preventing LLM API overflow crashes
     */
    async compressIfNeeded(
        session: Session,
        history: LLMMessage[],
        modelId?: string,
    ): Promise<{
        type: 'summarized' | 'truncated' | 'none';
        newSummary?: string;
        snapshot?: SnapFile;
    }> {
        const cmConfig = this.context?.config.contextManagement || {};
        const isEnabled = cmConfig.enabled !== false;
        if (!isEnabled) return { type: 'none' };

        const currentSummary = session.summary;

        const effectiveModelId = modelId || 'default-model';
        const contextWindow = this.llm.getContextWindow(effectiveModelId);

        const systemPrompt = this.promptRegistry?.getSystemPrompt() || '';
        const systemTokens = estimateMessageTokens({ role: 'system', content: systemPrompt });
        const historyTokens = history.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
        const totalEstimatedTokens = systemTokens + historyTokens;

        const limitTurns = cmConfig.maxHistoryTurns || 15;
        const historyLimit = cmConfig.historyLimit || 100;

        const preThreshold = cmConfig.preCompressThreshold ?? 0.85;
        const shouldCompressByToken = totalEstimatedTokens > contextWindow * preThreshold;
        const shouldCompressByTurns = history.length > limitTurns * 2;
        const shouldTruncateByLimit = history.length > historyLimit;

        if (!shouldCompressByToken && !shouldCompressByTurns && !shouldTruncateByLimit) {
            return { type: 'none' };
        }

        const reasons: string[] = [];
        if (shouldCompressByToken) reasons.push(`Estimated tokens reached watermark (${totalEstimatedTokens}/${contextWindow} >= ${(preThreshold * 100).toFixed(0)}%)`);
        if (shouldCompressByTurns) reasons.push(`History messages exceeded limit (${history.length} > ${limitTurns * 2} msgs / ${limitTurns} turns)`);
        if (shouldTruncateByLimit) reasons.push(`Total history messages exceeded limit (${history.length} > ${historyLimit})`);

        this.logger?.info(
            `[SessionCompactor] Triggered pre-compaction [Reason: ${reasons.join(', ')}]`
        );

        try {
            const keepTurns = cmConfig.keepRecentTurns || 6;
            const safeTruncateIndex = findSafeTruncateIndex(history, keepTurns);

            if (safeTruncateIndex <= 0) return { type: 'none' };

            if (cmConfig.summarizeEnabled === false) {
                this.logger?.info('[SessionCompactor] Summarization disabled, applying sliding-window truncation to keep latest messages.');
                this.truncateHistory(history, safeTruncateIndex);
                return { type: 'truncated' };
            }

            const historyToCompress = history.slice(0, safeTruncateIndex);
            const newSummary = await this.executeSummarize(session, historyToCompress, currentSummary);

            if (!newSummary || newSummary.trim() === '') {
                this.logger?.warn('[SessionCompactor] Summary generated by pre-compaction was empty, falling back to sliding-window truncation.');
                this.truncateHistory(history, safeTruncateIndex);
                return { type: 'truncated' };
            }

            this.logger?.info(`[SessionCompactor] Context summary compaction completed: "${newSummary}"`);

            const snapFile = this.buildSnapshot(session, newSummary, historyToCompress);
            // 压缩快照标识标签
            const taggedSummary = `[Snapshot ${snapFile.id}] ${newSummary}`;

            const template = this.promptRegistry?.get('core.prompt.context_summary_template') || '{summary}';
            const summaryUserMsg: LLMMessage = {
                role: 'user',
                content: template.replace('{summary}', taggedSummary),
            };
            this.truncateHistory(history, safeTruncateIndex, summaryUserMsg);

            session.summary = taggedSummary;
            session.lastSnapshotId = snapFile.id;
            this.logger?.info(`[SessionCompactor] Compaction summary recorded to session: ${session.id}`);
            return {
                type: 'summarized',
                newSummary,
                snapshot: snapFile
            };
        } catch (err: any) {
            this.logger?.error('[SessionCompactor] Failed to manage session history compaction:', err);
            try {
                const keepTurns = cmConfig.keepRecentTurns || 6;
                const safeTruncateIndex = findSafeTruncateIndex(history, keepTurns);
                if (safeTruncateIndex > 0) {
                    this.logger?.warn('[SessionCompactor] Summary generation failed, executing fallback sliding-window truncation.');
                    this.truncateHistory(history, safeTruncateIndex);
                    return { type: 'truncated' };
                }
            } catch (fallbackErr: any) {
                this.logger?.error('[SessionCompactor] Fallback sliding-window truncation also failed:', fallbackErr);
            }
            return { type: 'none' };
        }
    }

    /**
     * 【后置异步静默整理】在大模型回复追加后，利用本地估算在后台异步执行压缩整理（默认 65% 水位）
     * [Post-chat Silent Compaction] Asynchronously perform background compaction after LLM reply appended (default 65% watermark)
     * 如果实际执行了压缩，返回 true；否则返回 false
     * Returns true if compaction actually executed; otherwise false
     */
    async compressPostChat(
        session: Session,
        modelId?: string,
    ): Promise<{
        type: 'summarized' | 'truncated';
        newSummary?: string;
        snapshot?: SnapFile;
        safeTruncateIndex: number;
    } | null> {
        const cmConfig = this.context?.config.contextManagement || {};
        const isEnabled = cmConfig.enabled !== false;
        if (!isEnabled) return null;

        const effectiveModelId = modelId || 'default-model';
        const contextWindow = this.llm.getContextWindow(effectiveModelId);

        const systemPrompt = this.promptRegistry?.getSystemPrompt() || '';
        const systemTokens = estimateMessageTokens({ role: 'system', content: systemPrompt });
        const historyTokens = session.history.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
        const totalEstimatedTokens = systemTokens + historyTokens;

        const postThreshold = cmConfig.postCompressThreshold ?? 0.65;
        if (totalEstimatedTokens <= contextWindow * postThreshold) {
            return null;
        }

        this.logger?.info(
            `[SessionCompactor] Triggered post-chat background compaction (estimated tokens: ${totalEstimatedTokens}/${contextWindow}, threshold: ${postThreshold})`
        );

        try {
            const keepTurns = cmConfig.keepRecentTurns || 6;
            const history = session.history;
            const safeTruncateIndex = findSafeTruncateIndex(history, keepTurns);
            if (safeTruncateIndex <= 0) return null;

            if (cmConfig.summarizeEnabled === false) {
                return {
                    type: 'truncated',
                    safeTruncateIndex
                };
            }

            const historyToCompress = history.slice(0, safeTruncateIndex);
            const currentSummary = session.summary;
            const newSummary = await this.executeSummarize(session, historyToCompress, currentSummary);

            if (!newSummary || newSummary.trim() === '') {
                this.logger?.warn('[SessionCompactor] Summary generated by post-compaction was empty, falling back to sliding-window truncation.');
                return {
                    type: 'truncated',
                    safeTruncateIndex
                };
            }

            const snapFile = this.buildSnapshot(session, newSummary, historyToCompress);
            return {
                type: 'summarized',
                newSummary,
                snapshot: snapFile,
                safeTruncateIndex
            };
        } catch (err: any) {
            this.logger?.error('[SessionCompactor] Background async session compaction error:', err);
            return null;
        }
    }
}

/**
 * 估算单条消息的 Token 数
 * Estimate token count of a single message
 */
export function estimateMessageTokens(msg: LLMMessage): number {
    let tokens = 0;
    if (msg.content) {
        const englishWords = msg.content.match(/[a-zA-Z0-9_]+/g) || [];
        tokens += englishWords.length * 1.3;

        const chineseChars = msg.content.match(/[\u4e00-\u9fa5]/g) || [];
        tokens += chineseChars.length * 1.8;

        const otherText = msg.content.replace(/[a-zA-Z0-9_]/g, '').replace(/[\u4e00-\u9fa5]/g, '');
        tokens += otherText.length * 0.5;
    }

    if (msg.attachments) {
        const imageAttachments = msg.attachments.filter(
            (a) => a.mimeType.startsWith('image/') || a.type === 'image',
        );
        tokens += imageAttachments.length * 200;
    }

    if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
            tokens += 20;
            if (tc.arguments) {
                const englishWords = tc.arguments.match(/[a-zA-Z0-9_]+/g) || [];
                tokens += englishWords.length * 1.3;
            }
        }
    }

    return Math.ceil(tokens);
}

function findSafeTruncateIndex(history: LLMMessage[], keepTurns: number): number {
    const keepCount = keepTurns * 2;
    if (history.length <= keepCount) return 0;

    let targetIndex = history.length - keepCount;

    while (targetIndex > 0) {
        const currentMsg = history[targetIndex];
        const prevMsg = history[targetIndex - 1];

        const isCurrentTool = currentMsg.role === 'tool';
        const isPrevAssistantWithTools =
            prevMsg && prevMsg.role === 'assistant' && !!(prevMsg.toolCalls && prevMsg.toolCalls.length > 0);

        if (isCurrentTool || isPrevAssistantWithTools) {
            targetIndex--;
        } else {
            break;
        }
    }

    if (targetIndex > 0) {
        const boundaryMsg = history[targetIndex];
        const prevMsg = history[targetIndex - 1];
        if (boundaryMsg.role === 'assistant' && boundaryMsg.toolCalls && boundaryMsg.toolCalls.length > 0) {
            if (prevMsg && prevMsg.role === 'user') {
                targetIndex--;
            }
        }
    }

    return targetIndex;
}
