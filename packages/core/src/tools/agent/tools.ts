import type { FreyaContext, FreyaTool, ToolDefinition, FreyaAttachment } from '@eoasmxd/freya-sdk';
import type { FreyaAgentService } from '../../agent/agent-service.js';
import type { FreyaSessionManager } from '../../session/session-manager.js';
import path from 'node:path';

/**
 * 委派独立子智能体任务工具
 * Delegate independent subagent task tool
 */
export class AgentDelegateTaskTool implements FreyaTool {
  private agentService?: FreyaAgentService;

  constructor(
    private sessionManager: FreyaSessionManager,
    private ctx?: FreyaContext
  ) { }

  setAgentService(agentService: FreyaAgentService): void {
    this.agentService = agentService;
  }

  getDefinition(): ToolDefinition {
    return {
      name: 'agent_delegate_task',
      description: 'Delegate a complex or isolated subtask to an independent subagent. The subagent runs its own sense-plan-act loop and synchronously returns the final result text upon completion.',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'Detailed prompt description dispatched to the subtask (e.g. "Research and compile latest trends in LLM technologies")'
          },
          attachments: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of workspace-relative file paths or URLs to attach to the subtask (e.g. ["cache/image.png", "https://example.com/data.csv"]). Do NOT use absolute paths.'
          },
          toolboxes: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of specific toolbox IDs to pre-activate for this subagent. Replaces default capabilities.'
          },
          skill_id: {
            type: 'string',
            description: 'Name of a specific skill to activate as the subagent\'s primary guideline.'
          },
          providerId: {
            type: 'string',
            description: 'Provider ID for subtask model (optional, use config_list_provider to get valid IDs)'
          },
          modelId: {
            type: 'string',
            description: 'Model ID for subtask (optional, use config_list_model to get valid IDs)'
          }
        },
        required: ['prompt']
      }
    };
  }

  async execute(args: Record<string, any>): Promise<string> {
    if (!args.prompt) {
      return '❌ Parameter error: Detailed prompt description for subtask must be provided.';
    }
    if (!this.agentService) {
      throw new Error('AgentService has not been injected yet, cannot delegate task.');
    }

    const parentSessionId = args.__sessionId || 'unknown_parent';
    const childSessionId = `${parentSessionId}_sub_${Date.now()}`;

    const parsedAttachments: FreyaAttachment[] = [];
    if (args.attachments && Array.isArray(args.attachments)) {
      for (const attachPath of args.attachments) {
        const isUrl = attachPath.startsWith('http://') || attachPath.startsWith('https://');
        const ext = isUrl ? path.extname(new URL(attachPath).pathname).toLowerCase() : path.extname(attachPath).toLowerCase();
        
        const isImage = ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext);
        let mimeType = 'application/octet-stream';
        if (isImage) {
          if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
          else if (ext === '.png') mimeType = 'image/png';
          else if (ext === '.gif') mimeType = 'image/gif';
          else if (ext === '.webp') mimeType = 'image/webp';
        } else {
          if (ext === '.pdf') mimeType = 'application/pdf';
          else if (ext === '.txt') mimeType = 'text/plain';
          else if (ext === '.md') mimeType = 'text/markdown';
          else if (ext === '.csv') mimeType = 'text/csv';
          else if (ext === '.mp3') mimeType = 'audio/mpeg';
          else if (ext === '.wav') mimeType = 'audio/wav';
          else if (ext === '.ogg') mimeType = 'audio/ogg';
          else if (ext === '.mp4') mimeType = 'video/mp4';
        }
        
        parsedAttachments.push({
          type: isImage ? 'image' : 'file',
          mimeType,
          ...(isUrl ? { url: attachPath } : { path: attachPath })
        });
      }
    }

    this.ctx?.logger.info(`[AgentTool] Delegating task to subagent: parent "${parentSessionId}" -> child "${childSessionId}"`);
    return await this.agentService.runSubAgent(parentSessionId, childSessionId, args.prompt, {
      providerId: args.providerId,
      modelId: args.modelId,
      attachments: parsedAttachments.length > 0 ? parsedAttachments : undefined,
      toolboxes: args.toolboxes,
      skillId: args.skill_id
    });
  }
}
