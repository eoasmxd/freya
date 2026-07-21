import type { FreyaContext } from '@eoasmxd/freya-sdk';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PROJECT_ROOT } from '../utils/paths.js';
import type { Session, SessionData, SessionIndex, SnapFile } from './types.js';

const DATA_DIR = path.resolve(PROJECT_ROOT, 'data');
const SESSIONS_DIR = path.resolve(DATA_DIR, 'sessions');
const INDEX_FILE = path.resolve(DATA_DIR, 'sessions.json');

const sessionDirByUuid = (uuid: string) => path.resolve(SESSIONS_DIR, uuid);
const sessionFileByUuid = (uuid: string) => path.resolve(sessionDirByUuid(uuid), 'session.json');
const snapFileByUuid = (uuid: string, snapId: string) => path.resolve(sessionDirByUuid(uuid), `${snapId}.json`);

/**
 * FreyaSessionPersistence — 会话数据持久化层。
 *
 * 职责：Session 数据的磁盘读写（索引文件、session.json、快照文件）。
 * 不持有任何内存缓存状态，仅作为纯 I/O 层。
 */
export class FreyaSessionPersistence {
    private logger?: FreyaContext['logger'];

    setLogger(logger: FreyaContext['logger']): void {
        this.logger = logger;
    }

    /**
     * 读取索引文件 sessions.json。
     * 返回已解析的索引列表；文件不存在时返回空数组。
     */
    async loadIndex(): Promise<SessionIndex[]> {
        try {
            const data = await fs.readFile(INDEX_FILE, 'utf-8');
            const list: SessionIndex[] = JSON.parse(data);
            return list;
        } catch (err: any) {
            if (err.code !== 'ENOENT') {
                this.logger?.error('加载 sessions.json 索引文件失败:', err);
            }
            return [];
        }
    }

    async saveIndex(indices: SessionIndex[]): Promise<void> {
        try {
            const list: SessionIndex[] = indices.map((idx) => ({
                id: idx.id,
                uuid: idx.uuid,
                parentId: idx.parentId,
                archived: idx.archived,
                archivedAt: idx.archivedAt,
                summary: idx.summary,
                updatedAt: idx.updatedAt,
                modelId: idx.modelId,
                providerId: idx.providerId,
                activeSkillId: idx.activeSkillId,
                activeToolboxIds: idx.activeToolboxIds,
                prompt: idx.prompt,
                status: idx.status,
                startTime: idx.startTime,
                durationMs: idx.durationMs,
            }));
            await fs.mkdir(path.dirname(INDEX_FILE), { recursive: true });
            await fs.writeFile(INDEX_FILE, JSON.stringify(list, null, 2), 'utf-8');
        } catch (err) {
            this.logger?.error('保存 sessions.json 索引失败:', err);
        }
    }

    async saveSessionData(session: { uuid: string; history: Session['history']; lastSnapshotId: string | null }): Promise<void> {
        try {
            const dir = sessionDirByUuid(session.uuid);
            await fs.mkdir(dir, { recursive: true });
            const data: SessionData = {
                history: session.history,
                lastSnapshotId: session.lastSnapshotId,
            };
            await fs.writeFile(sessionFileByUuid(session.uuid), JSON.stringify(data, null, 2), 'utf-8');
        } catch (err) {
            this.logger?.error(`保存会话数据文件 ${session.uuid}/session.json 失败:`, err);
        }
    }

    /**
     * 从磁盘读取 session.json 的内容。
     * 返回 history 和 lastSnapshotId；文件不存在时返回空。
     */
    async loadSessionData(uuid: string): Promise<SessionData> {
        const filePath = sessionFileByUuid(uuid);
        try {
            const raw = await fs.readFile(filePath, 'utf-8');
            const sessionData: SessionData = JSON.parse(raw);
            return {
                history: sessionData.history || [],
                lastSnapshotId: sessionData.lastSnapshotId ?? null,
            };
        } catch (err: any) {
            if (err.code !== 'ENOENT') {
                this.logger?.error(`读取会话数据文件 ${uuid}/session.json 失败:`, err);
            }
            return { history: [], lastSnapshotId: null };
        }
    }

    async saveSnapshot(uuid: string, snap: SnapFile): Promise<void> {
        const filePath = snapFileByUuid(uuid, snap.id);
        await fs.mkdir(sessionDirByUuid(uuid), { recursive: true });
        await fs.writeFile(filePath, JSON.stringify(snap, null, 2), 'utf-8');
    }

    /**
     * 读取单个快照文件。
     * 文件不存在时返回 null。
     */
    async loadSnapshot(uuid: string, snapId: string): Promise<SnapFile | null> {
        const filePath = snapFileByUuid(uuid, snapId);
        try {
            const raw = await fs.readFile(filePath, 'utf-8');
            const snap: SnapFile = JSON.parse(raw);
            return snap;
        } catch {
            return null;
        }
    }
}
