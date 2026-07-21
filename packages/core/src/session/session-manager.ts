import type { FreyaContext, LLMMessage, LLMTokenUsage } from '@eoasmxd/freya-sdk';
import crypto from 'node:crypto';
import type { FreyaPromptRegistry } from '../prompt/prompt-registry.js';
import { SessionCompactor } from './compactor.js';
import { FreyaSessionPersistence } from './persistence.js';
import type { Session, SessionIndex } from './types.js';
export type { Session, SessionIndex, SnapFile } from './types.js';

/**
 * SessionManager — 会话管理器。
 *
 * 职责：内存缓存调度、持久化读写中转、自动上下文压缩。
 */
export class FreyaSessionManager {
    private persistence = new FreyaSessionPersistence();
    private compactor = new SessionCompactor();

    private sessions = new Map<string, Session>();
    private sessionIndices = new Map<string, SessionIndex>();
    private updateLocks = new Map<string, Promise<unknown>>();
    private globalIndexLock = Promise.resolve();

    private context?: FreyaContext;
    private logger?: FreyaContext['logger'];

    constructor() { }

    findLatestIndexById(id: string): SessionIndex | undefined {
        const matched = Array.from(this.sessionIndices.values()).filter(idx => idx.id === id);
        if (matched.length === 0) return undefined;
        const active = matched.find(idx => !idx.archived);
        if (active) return active;
        return matched.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
    }

    /**
     * 初始化会话系统。
     */
    async load(context: FreyaContext, promptRegistry: FreyaPromptRegistry): Promise<void> {
        this.context = context;
        this.logger = context.logger;

        this.persistence.setLogger(context.logger);
        this.compactor.setup(context, promptRegistry);

        const indices = await this.persistence.loadIndex();
        for (const idx of indices) {
            this.sessionIndices.set(idx.uuid, idx);
        }

        await this.initMainSession();

        context.eventBus.on('billing:session:add', (payload: {
            sessionId: string;
            modelId: string;
            usage: LLMTokenUsage;
            singleCost: number;
        }) => {
            this.handleSessionBillingAdd(payload).catch((err) => {
                this.logger?.error(`[SessionManager] 异步处理增量计费失败:`, err);
            });
        });

        this.logger?.info(`[SessionManager] 初始化完成，已加载 ${this.sessionIndices.size} 个会话`);
    }

    private async initMainSession(): Promise<void> {
        const hasMain = Array.from(this.sessionIndices.values()).some(idx => idx.id === 'main' && !idx.archived);
        if (!hasMain) {
            const main = this.newSession('main', crypto.randomUUID());
            await this.persistence.saveIndex(Array.from(this.sessionIndices.values()));
            await this.persistence.saveSessionData(main);
            this.logger?.info('[SessionManager] 首次启动，创建主会话 main');
        }
    }

    newSession(id: string, uuid: string, extra: Partial<Session> = {}): Session {
        const session: Session = {
            id,
            uuid,
            parentId: extra.parentId ?? null,
            archived: extra.archived ?? false,
            archivedAt: extra.archivedAt ?? null,
            summary: extra.summary || '',
            history: [],
            lastSnapshotId: null,
            updatedAt: new Date().toISOString(),
            modelId: extra.modelId,
            providerId: extra.providerId,
            activeSkillId: extra.activeSkillId,
            activeToolboxIds: extra.activeToolboxIds || [],
            prompt: extra.prompt,
            status: extra.status,
            startTime: extra.startTime,
            durationMs: extra.durationMs,
            promptTokens: extra.promptTokens,
            completionTokens: extra.completionTokens,
            cachedPromptTokens: extra.cachedPromptTokens,
            totalTokens: extra.totalTokens,
            cost: extra.cost,
        };
        this.sessions.set(id, session);

        const idx: SessionIndex = {
            id: session.id,
            uuid: session.uuid,
            parentId: session.parentId,
            archived: session.archived,
            archivedAt: session.archivedAt,
            summary: session.summary,
            updatedAt: session.updatedAt,
            modelId: session.modelId,
            providerId: session.providerId,
            activeSkillId: session.activeSkillId,
            activeToolboxIds: session.activeToolboxIds,
            prompt: session.prompt,
            status: session.status,
            startTime: session.startTime,
            durationMs: session.durationMs,
            promptTokens: session.promptTokens,
            completionTokens: session.completionTokens,
            cachedPromptTokens: session.cachedPromptTokens,
            totalTokens: session.totalTokens,
            cost: session.cost,
        };
        this.sessionIndices.set(uuid, idx);

        this.logger?.info(`[SessionManager] 新建会话: ${id} (${uuid})`);
        return session;
    }

    private async lazyLoadSession(id: string): Promise<Session> {
        const cached = this.sessions.get(id);
        if (cached && !cached.archived) return cached;

        const idx = this.findLatestIndexById(id);
        if (!idx) {
            throw new Error(`会话不存在: ${id}`);
        }

        const data = await this.persistence.loadSessionData(idx.uuid);
        const session: Session = {
            id: idx.id,
            uuid: idx.uuid,
            parentId: idx.parentId,
            archived: idx.archived,
            archivedAt: idx.archivedAt,
            summary: idx.summary,
            history: data.history,
            lastSnapshotId: data.lastSnapshotId,
            updatedAt: idx.updatedAt,
            modelId: idx.modelId,
            providerId: idx.providerId,
            activeSkillId: idx.activeSkillId,
            activeToolboxIds: idx.activeToolboxIds || [],
            prompt: idx.prompt,
            status: idx.status,
            startTime: idx.startTime,
            durationMs: idx.durationMs,
            promptTokens: idx.promptTokens,
            completionTokens: idx.completionTokens,
            cachedPromptTokens: idx.cachedPromptTokens,
            totalTokens: idx.totalTokens,
            cost: idx.cost,
        };
        this.sessions.set(id, session);
        this.logger?.info(`[SessionManager] 延迟加载会话: ${id}`);
        return session;
    }

    private async enqueueWrite<T>(sessionId: string, fn: (session: Session) => Promise<T>): Promise<T> {
        const current = this.updateLocks.get(sessionId) ?? Promise.resolve();
        const next = current.then(async () => {
            let session: Session | null = null;
            try {
                session = await this.lazyLoadSession(sessionId);
            } catch {
            }
            return fn(session as any);
        });
        this.updateLocks.set(sessionId, next);
        try {
            return await next;
        } finally {
            if (this.updateLocks.get(sessionId) === next) {
                this.updateLocks.delete(sessionId);
            }
        }
    }

    private async saveIndex(): Promise<void> {
        const next = this.globalIndexLock.then(async () => {
            await this.persistence.saveIndex(Array.from(this.sessionIndices.values()));
        }).catch(() => { });
        this.globalIndexLock = next;
        await next;
    }

    private async persistSession(session: Session): Promise<void> {
        await this.persistence.saveSessionData(session);
        await this.saveIndex();
    }

    async getOrCreate(id: string): Promise<Session> {
        const index = this.findLatestIndexById(id);
        if (index && !index.archived) {
            try {
                return await this.lazyLoadSession(id);
            } catch (err) {
            }
        }

        this.logger?.warn(`[SessionManager] 检测到无活跃会话 ID ${id}，将自动创建新物理会话以保持连接弹性。`);
        const session = this.newSession(id, crypto.randomUUID(), { archived: false });
        await this.persistSession(session);
        return session;
    }

    has(id: string): boolean {
        return !!this.findLatestIndexById(id);
    }

    async appendMessage(sessionId: string, message: LLMMessage): Promise<void> {
        return this.appendMessages(sessionId, [message]);
    }

    async appendMessages(
        sessionId: string,
        messages: LLMMessage[],
        modelId?: string,
    ): Promise<void> {
        return this.enqueueWrite(sessionId, async (session) => {
            session.history.push(...messages);
            session.updatedAt = new Date().toISOString();
            if (modelId !== undefined) session.modelId = modelId;
            await this.persistence.saveSessionData(session);
            await this.persistSession(session);

            const hasUserOrTool = messages.some((m) => m.role === 'user' || m.role === 'tool');
            const hasAssistant = messages.some((m) => m.role === 'assistant');

            if (hasUserOrTool) {
                const compResult = await this.compactor.compressIfNeeded(session, session.history, session.modelId);
                if (compResult.type !== 'none') {
                    if (compResult.snapshot) {
                        await this.persistence.saveSnapshot(session.uuid, compResult.snapshot);
                    }
                    await this.persistence.saveSessionData(session);
                    await this.saveIndex();
                }
            }

            if (hasAssistant) {
                this.compactor.compressPostChat(session, session.modelId).then(async (result) => {
                    if (result) {
                        await this.enqueueWrite(sessionId, async (latestSession) => {
                            if (!latestSession || latestSession.history.length < result.safeTruncateIndex) {
                                return;
                            }

                            if (result.type === 'truncated') {
                                const keepMessages = latestSession.history.slice(result.safeTruncateIndex);
                                latestSession.history = keepMessages;
                            } else if (result.type === 'summarized') {
                                const snap = result.snapshot!;
                                const taggedSummary = `[压缩快照 ${snap.id}] ${result.newSummary!}`;
                                const summaryUserMsg: LLMMessage = {
                                    role: 'user',
                                    content: `[上下文压缩摘要] 以下是此前对话的回顾，请参考：\n${taggedSummary}`,
                                };
                                const keepMessages = latestSession.history.slice(result.safeTruncateIndex);
                                latestSession.summary = taggedSummary;
                                latestSession.lastSnapshotId = snap.id;
                                latestSession.history = [summaryUserMsg, ...keepMessages];

                                await this.persistence.saveSnapshot(latestSession.uuid, snap);
                            }

                            latestSession.updatedAt = new Date().toISOString();
                            await this.persistence.saveSessionData(latestSession);
                            await this.persistSession(latestSession);
                        });
                    }
                }).catch((err) => {
                    this.logger?.error(`[SessionManager] 后置异步会话压缩发生异常:`, err);
                });
            }
        });
    }

    async getHistory(sessionId: string): Promise<LLMMessage[]> {
        const session = await this.getOrCreate(sessionId);
        return session.history.map((h) => ({ ...h }));
    }

    async updateSession(sessionId: string, updates: Partial<Session & SessionIndex>): Promise<void> {
        return this.enqueueWrite(sessionId, async (session) => {
            Object.assign(session, updates);
            session.updatedAt = new Date().toISOString();

            const idx = this.sessionIndices.get(session.uuid);
            if (idx) {
                Object.assign(idx, updates);
                idx.updatedAt = session.updatedAt;
            }
            await this.persistSession(session);
        });
    }

    private async archive(id: string): Promise<void> {
        const session = await this.getOrCreate(id);
        session.archived = true;
        session.archivedAt = new Date().toISOString();
        session.updatedAt = session.archivedAt;

        await this.persistSession(session);
    }

    async archiveAndRecreate(id: string): Promise<{ oldId: string; newId: string }> {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const oldId = `${id}_${timestamp}`;

        let parentId: string | null = null;
        let providerId: string | undefined;
        let modelId: string | undefined;
        let activeSkillId: string | undefined;

        const oldSession = this.sessions.get(id);
        if (oldSession) {
            parentId = oldSession.parentId;
            providerId = oldSession.providerId;
            modelId = oldSession.modelId;
            activeSkillId = oldSession.activeSkillId;
        }

        await this.archive(id);

        const oldIdx = this.findLatestIndexById(id);
        if (oldIdx) {
            oldIdx.id = oldId;
            await this.saveIndex();
        }
        this.sessions.delete(id);

        await this.createSession(id, {
            parentId: parentId ?? undefined,
            providerId,
            modelId,
            activeSkillId
        });

        this.logger?.info(`[SessionManager] 会话已归档并重建: ${id} → ${oldId}`);
        return { oldId, newId: id };
    }

    /**
     * 读取指定会话中的单个物理快照。
     */
    async getSnapshot(id: string, snapId: string): Promise<any | null> {
        const session = await this.getOrCreate(id);
        return this.persistence.loadSnapshot(session.uuid, snapId);
    }

    async createSession(id: string, options?: { parentId?: string; prompt?: string; providerId?: string; modelId?: string; activeSkillId?: string; history?: LLMMessage[] }): Promise<Session> {
        const session = this.newSession(id, crypto.randomUUID(), {
            parentId: options?.parentId,
            prompt: options?.prompt,
            providerId: options?.providerId,
            modelId: options?.modelId,
            activeSkillId: options?.activeSkillId,
            status: options?.parentId ? 'running' : undefined,
            startTime: options?.parentId ? Date.now() : undefined,
            durationMs: options?.parentId ? 0 : undefined
        });

        if (options?.history) {
            session.history = options.history.map(msg => ({ ...msg }));
        }

        await this.persistSession(session);
        return session;
    }

    listSessions(filter?: { parentId?: string; archived?: boolean }): SessionIndex[] {
        let list = Array.from(this.sessionIndices.values());

        if (filter?.parentId !== undefined) {
            list = list.filter(idx => idx.parentId === filter.parentId);
        }
        if (filter?.archived !== undefined) {
            list = list.filter(idx => idx.archived === filter.archived);
        }

        return list.map(idx => {
            const durationMs = idx.status === 'running' && idx.startTime
                ? Date.now() - idx.startTime
                : idx.durationMs || 0;
            return { ...idx, durationMs };
        });
    }

    async activateToolboxes(sessionId: string, toolboxIds: string[]): Promise<void> {
        return this.enqueueWrite(sessionId, async (session) => {
            const current = new Set(session.activeToolboxIds || []);
            toolboxIds.forEach(id => current.add(id));
            session.activeToolboxIds = Array.from(current);
            session.updatedAt = new Date().toISOString();
            await this.persistSession(session);
        });
    }

    async deactivateToolboxes(sessionId: string, toolboxIds: string[]): Promise<void> {
        return this.enqueueWrite(sessionId, async (session) => {
            const current = new Set(session.activeToolboxIds || []);
            toolboxIds.forEach(id => current.delete(id));
            session.activeToolboxIds = Array.from(current);
            session.updatedAt = new Date().toISOString();
            await this.persistSession(session);
        });
    }

    private async handleSessionBillingAdd(payload: {
        sessionId: string;
        modelId: string;
        usage: LLMTokenUsage;
        singleCost: number;
    }): Promise<void> {
        const { sessionId, modelId, usage, singleCost } = payload;
        await this.enqueueWrite(sessionId, async (session) => {
            const currentPrompt = session.promptTokens || 0;
            const currentCompletion = session.completionTokens || 0;
            const currentCached = session.cachedPromptTokens || 0;
            const currentTotal = session.totalTokens || 0;
            const currentCost = session.cost || 0;

            session.promptTokens = currentPrompt + usage.promptTokens;
            session.completionTokens = currentCompletion + usage.completionTokens;
            session.cachedPromptTokens = currentCached + (usage.cachedPromptTokens || 0);
            session.totalTokens = currentTotal + usage.totalTokens;
            session.cost = parseFloat((currentCost + singleCost).toFixed(7));
            session.updatedAt = new Date().toISOString();

            await this.persistSession(session);

            this.context?.eventBus.emit('session:billing:update', {
                sessionId,
                modelId,
                usage,
                singleCost,
                promptTokens: session.promptTokens,
                completionTokens: session.completionTokens,
                cachedPromptTokens: session.cachedPromptTokens,
                totalTokens: session.totalTokens,
                cost: session.cost
            });
        });
    }
}
