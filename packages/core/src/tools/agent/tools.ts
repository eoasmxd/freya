import type { FreyaContext, FreyaTool, ToolDefinition, FreyaAttachment } from '@eoasmxd/freya-sdk';
import type { FreyaAgentService } from '../../agent/agent-service.js';
import type { FreyaSessionManager } from '../../session/session-manager.js';
import path from 'node:path';

const MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.csv': 'text/csv'
};

/**
 * 解析入参中的附件路径列表为 FreyaAttachment 对象数组
 * Parse raw attachment paths into FreyaAttachment array
 */
export function parseAttachments(rawAttachments?: any[]): FreyaAttachment[] {
  const parsedAttachments: FreyaAttachment[] = [];
  if (!rawAttachments || !Array.isArray(rawAttachments)) {
    return parsedAttachments;
  }

  for (const rawPath of rawAttachments) {
    if (!rawPath || typeof rawPath !== 'string') {
      continue;
    }
    const attachPath = rawPath.trim();
    if (!attachPath) {
      continue;
    }

    const isUrl = attachPath.startsWith('http://') || attachPath.startsWith('https://');
    let ext = '';
    if (isUrl) {
      try {
        ext = path.extname(new URL(attachPath).pathname).toLowerCase();
      } catch {
        ext = path.extname(attachPath).toLowerCase();
      }
    } else {
      ext = path.extname(attachPath).toLowerCase();
    }

    const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
    const isImage = mimeType.startsWith('image/');

    parsedAttachments.push({
      type: isImage ? 'image' : 'file',
      mimeType,
      ...(isUrl ? { url: attachPath } : { path: attachPath })
    });
  }

  return parsedAttachments;
}

/**
 * 委派独立子智能体任务工具
 * Delegate independent subagent task tool
 */
export class DelegateTaskTool implements FreyaTool {
  private agentService?: FreyaAgentService;

  constructor(
    _sessionManager?: FreyaSessionManager,
    private ctx?: FreyaContext
  ) { }

  setAgentService(agentService: FreyaAgentService): void {
    this.agentService = agentService;
  }

  getDefinition(): ToolDefinition {
    return {
      name: 'agent_delegate_task',
      description: 'Delegate a complex, multi-step, or isolated subtask to an independent subagent with its own tool execution loop. For simple single-step reasoning, image/document analysis, or data transformation without tools, use agent_chat instead.',
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
          skillId: {
            type: 'string',
            description: 'Name of a specific skill to activate as the subagent\'s primary guideline.'
          },
          providerId: {
            type: 'string',
            description: 'Optional provider ID for subtask model (defaults to current session or system default).'
          },
          modelId: {
            type: 'string',
            description: 'Optional model ID for subtask (defaults to current session or system default).'
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
    const parsedAttachments = parseAttachments(args.attachments);

    this.ctx?.logger.info(`[AgentTool] Delegating task to subagent: parent "${parentSessionId}" -> child "${childSessionId}"`);
    return await this.agentService.delegateTask(parentSessionId, childSessionId, args.prompt, {
      providerId: args.providerId,
      modelId: args.modelId,
      attachments: parsedAttachments.length > 0 ? parsedAttachments : undefined,
      toolboxes: args.toolboxes,
      skillId: args.skillId
    });
  }
}

/**
 * 直接调用大模型进行单次问答与多模态分析工具
 * Direct single-turn LLM chat and multimodal analysis tool
 */
export class AgentChatTool implements FreyaTool {
  constructor(
    private sessionManager?: FreyaSessionManager,
    private ctx?: FreyaContext
  ) { }

  getDefinition(): ToolDefinition {
    return {
      name: 'agent_chat',
      description: 'Directly invoke language model for single-turn reasoning, image/document analysis, or text transformation without subagent overhead or tool execution loops. For multi-step autonomous exploration with tools, use agent_delegate_task instead.',
      parameters: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'The instruction or question for the model (e.g. "Describe the diagram in detail and extract the values")'
          },
          attachments: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of workspace-relative file paths or URLs to attach (e.g. ["cache/screenshot.png", "https://example.com/image.jpg"]). Do NOT use absolute paths.'
          },
          systemPrompt: {
            type: 'string',
            description: 'Optional system prompt to guide role, output format, or behavior for this single call.'
          },
          providerId: {
            type: 'string',
            description: 'Optional provider ID for this call (defaults to current session or system default).'
          },
          modelId: {
            type: 'string',
            description: 'Optional model ID for this call (defaults to current session or system default).'
          }
        },
        required: ['prompt']
      }
    };
  }

  async execute(args: Record<string, any>): Promise<string> {
    if (!args.prompt || typeof args.prompt !== 'string' || !args.prompt.trim()) {
      return '❌ Parameter error: Prompt must be provided.';
    }

    if (!this.ctx?.llm) {
      throw new Error('LLM service is not available in context.');
    }

    const sessionId = args.__sessionId;
    const sessionIndex = sessionId ? this.sessionManager?.findLatestIndexById(sessionId) : undefined;
    const providerId = args.providerId || sessionIndex?.providerId;
    const modelId = args.modelId || sessionIndex?.modelId;

    const parsedAttachments = parseAttachments(args.attachments);
    const messages: any[] = [];

    if (args.systemPrompt && typeof args.systemPrompt === 'string' && args.systemPrompt.trim()) {
      messages.push({
        role: 'system',
        content: args.systemPrompt.trim()
      });
    }

    messages.push({
      role: 'user',
      content: args.prompt.trim(),
      ...(parsedAttachments.length > 0 ? { attachments: parsedAttachments } : {})
    });

    try {
      const response = await this.ctx.llm.chat(messages, undefined, {
        providerId,
        modelId,
        billingContext: sessionId ? { ownerType: 'session', ownerId: sessionId } : undefined
      });

      return response.message.content || '';
    } catch (err: any) {
      this.ctx.logger.error(`[AgentChatTool] Direct LLM chat failed: ${err.message}`);
      return `❌ LLM chat error: ${err.message}`;
    }
  }
}
