import type { LLMMessage } from '@eoasmxd/freya-sdk';

/** 会话索引条目（存入 sessions.json） */
export interface SessionIndex {
    id: string;
    uuid: string;
    parentId: string | null;
    archived: boolean;
    archivedAt: string | null;
    summary?: string;
    updatedAt: string;
    modelId?: string;
    providerId?: string;
    activeSkillId?: string;
    activeToolboxIds?: string[];
    prompt?: string;
    status?: 'running' | 'completed' | 'failed';
    startTime?: number;
    durationMs?: number;
    promptTokens?: number;
    completionTokens?: number;
    cachedPromptTokens?: number;
    totalTokens?: number;
    cost?: number;
    toolboxIdleRounds?: Record<string, number>;
}

/** 内存中的完整会话对象 */
export interface Session extends SessionIndex {
    history: LLMMessage[];
    lastSnapshotId: string | null;
}

export interface SessionData {
    history: LLMMessage[];
    lastSnapshotId: string | null;
}

/** 独立快照文件结构 */
export interface SnapFile {
    id: string;
    prevSnapshotId: string | null;
    summary: string;
    messageCount: number;
    messages: LLMMessage[];
    createdAt: string;
}
