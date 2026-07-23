import type { FreyaContext, ILLMService, LLMMessage } from '@eoasmxd/freya-sdk';
import crypto from 'node:crypto';
import type { FreyaPromptRegistry } from '../prompt/prompt-registry.js';
import type { Session, SnapFile } from './types.js';

function formatHistoryToText(history: LLMMessage[]): string {
    return history
        .map((msg) => {
            const roleMap: Record<string, string> = {
                user: '用户',
                assistant: '助手',
                system: '系统',
                tool: '工具结果'
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

    /** 仅在内存中组装并返回快照文件实体，无写盘副作用 */
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
            userContentParts.push(`【先前的对话提要】：\n${currentSummary}`);
        }
        userContentParts.push(`【需要提炼的对话历史】：\n${formattedHistory}`);

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

        this.logger?.info(`[SessionCompactor] 正在生成增量会话背景摘要...`);
        const cmConfig = this.context?.config.contextManagement || {};
        const summaryMaxTokens = cmConfig.summaryMaxTokens || 150;
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

        this.logger?.info(
            `[SessionCompactor] 触发前置同步历史压缩 (当前预估 Token: ${totalEstimatedTokens}/${contextWindow}, 触发水位: ${preThreshold})`
        );

        try {
            const keepTurns = cmConfig.keepRecentTurns || 6;
            const safeTruncateIndex = findSafeTruncateIndex(history, keepTurns);

            if (safeTruncateIndex <= 0) return { type: 'none' };

            if (cmConfig.summarizeEnabled === false) {
                this.logger?.info(`[SessionCompactor] 摘要总结已关闭，直接对历史滑动窗口截断，保留最新消息。`);
                this.truncateHistory(history, safeTruncateIndex);
                return { type: 'truncated' };
            }

            const historyToCompress = history.slice(0, safeTruncateIndex);
            const newSummary = await this.executeSummarize(session, historyToCompress, currentSummary);

            if (!newSummary || newSummary.trim() === '') {
                this.logger?.warn(`[SessionCompactor] 前置压缩生成的摘要为空，放弃应用。`);
                return { type: 'none' };
            }

            this.logger?.info(`[SessionCompactor] 上下文摘要压缩生成完成: "${newSummary}"`);

            const snapFile = this.buildSnapshot(session, newSummary, historyToCompress);
            const taggedSummary = `[压缩快照 ${snapFile.id}] ${newSummary}`;

            const summaryUserMsg: LLMMessage = {
                role: 'user',
                content: `[上下文压缩摘要] 以下是此前对话的回顾，请参考：\n${taggedSummary}`,
            };
            this.truncateHistory(history, safeTruncateIndex, summaryUserMsg);

            session.summary = taggedSummary;
            session.lastSnapshotId = snapFile.id;
            this.logger?.info(`[SessionCompactor] 压缩摘要已记录到会话: ${session.id}`);
            return {
                type: 'summarized',
                newSummary,
                snapshot: snapFile
            };
        } catch (err: any) {
            this.logger?.error('[SessionCompactor] 触发对话历史压缩管理失败:', err);
            try {
                const keepTurns = cmConfig.keepRecentTurns || 6;
                const safeTruncateIndex = findSafeTruncateIndex(history, keepTurns);
                if (safeTruncateIndex > 0) {
                    this.logger?.warn(`[SessionCompactor] 摘要生成失败，执行兜底滑动窗口截断`);
                    this.truncateHistory(history, safeTruncateIndex);
                    return { type: 'truncated' };
                }
            } catch (fallbackErr: any) {
                this.logger?.error('[SessionCompactor] 兜底滑动窗口截断也失败:', fallbackErr);
            }
            return { type: 'none' };
        }
    }

    /**
     * 【后置异步静默整理】在大模型回复追加后，利用本地估算在后台异步执行压缩整理（默认 65% 水位）
     * 如果实际执行了压缩，返回 true；否则返回 false
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
            `[SessionCompactor] 触发后置后台异步会话压缩 (预估 Token: ${totalEstimatedTokens}/${contextWindow}, 触发水位: ${postThreshold})`
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
                this.logger?.warn(`[SessionCompactor] 后置压缩生成的摘要为空，放弃应用。`);
                return null;
            }

            const snapFile = this.buildSnapshot(session, newSummary, historyToCompress);
            return {
                type: 'summarized',
                newSummary,
                snapshot: snapFile,
                safeTruncateIndex
            };
        } catch (err: any) {
            this.logger?.error('[SessionCompactor] 后台异步会话压缩出错:', err);
            return null;
        }
    }
}

/** 估算单条消息的 Token 数 */
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
