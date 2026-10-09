import type { FreyaTool, ToolDefinition } from '@eoasmxd/freya-sdk';
import type { FreyaSessionManager } from '../../session/session-manager.js';

/**
 * 历史压缩快照读取工具
 * Compaction history snapshot inspection tool
 */
export class ReadSnapshotTool implements FreyaTool {
  constructor(private sessionManager: FreyaSessionManager) { }

  getDefinition(): ToolDefinition {
    return {
      name: 'read_snapshot',
      description: 'Read the original conversation messages preserved in a compacted history snapshot. Use this to retrieve early details when referencing summary tags like "[Snapshot snap_xxx]".',
      parameters: {
        type: 'object',
        properties: {
          sessionId: {
            type: 'string',
            description: 'Session ID to inspect (optional, defaults to current session)'
          },
          snapshotId: {
            type: 'string',
            description: 'Target snapshot ID to inspect (optional, defaults to latest snapshot)'
          }
        }
      }
    };
  }

  async execute(args: Record<string, any>): Promise<string> {
    try {
      const sessionId = args.__sessionId || args.sessionId;
      if (!sessionId) {
        return '❌ Parameter error: Please provide a valid session ID.';
      }
      const idx = this.sessionManager.findLatestIndexById(sessionId);
      if (!idx) {
        return `❌ Session not found: ${sessionId}`;
      }

      let snapshotId = args.snapshotId;
      if (!snapshotId) {
        const session = await this.sessionManager.getOrCreate(sessionId);
        snapshotId = session.lastSnapshotId;
      }

      if (!snapshotId) {
        return `ℹ️ Session [${sessionId}] has no compaction snapshots.`;
      }

      const targetSnap = await this.sessionManager.getSnapshot(sessionId, snapshotId);
      if (!targetSnap) {
        return `❌ Snapshot "${snapshotId}" not found in session [${sessionId}].`;
      }

      const formatted = targetSnap.messages.map((m: any, i: number) => {
        return `[#${i + 1}] **${m.role.toUpperCase()}**:\n${m.content || '(Empty content)'}\n---`;
      });

      const prevLink = targetSnap.prevSnapshotId ? `- **Previous Snapshot ID**: \`${targetSnap.prevSnapshotId}\`\n` : '';

      return `📸 Session [${sessionId}] Snapshot [${snapshotId}] Chat History:\n\n- **Created At**: ${targetSnap.createdAt}\n- **Summary**: ${targetSnap.summary}\n${prevLink}- **Compacted Messages**: Total ${targetSnap.messageCount} entries\n\n--- Raw message details ---\n\n${formatted.join('\n\n')}`;
    } catch (err: any) {
      return `❌ Failed to read snapshot: ${err.message}`;
    }
  }
}
