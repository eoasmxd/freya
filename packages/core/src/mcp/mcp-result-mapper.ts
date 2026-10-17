import fs from 'node:fs/promises';
import path from 'node:path';
import type { FreyaAttachment, FreyaToolResult } from '@eoasmxd/freya-sdk';
import { FREYA_HOME } from '../utils/paths.js';

/**
 * 将 MCP callTool 响应转换为 Freya 工具标准结果
 * Map MCP callTool result to FreyaToolResult with overflow persistence
 */
export async function mapMcpResult(
  serverId: string,
  toolName: string,
  rawResult: any
): Promise<string | FreyaToolResult> {
  if (!rawResult) {
    return 'Tool executed successfully with no output.';
  }

  const isError = Boolean(rawResult.isError);
  const contents = Array.isArray(rawResult.content) ? rawResult.content : [];
  const textParts: string[] = [];
  const attachments: FreyaAttachment[] = [];

  for (const item of contents) {
    if (item.type === 'text' && typeof item.text === 'string') {
      textParts.push(item.text);
    } else if (item.type === 'image' && item.data && item.mimeType) {
      attachments.push({
        type: 'image',
        mimeType: item.mimeType,
        base64: item.data
      });
    } else if (item.type === 'resource') {
      const res = item.resource;
      if (res?.text) {
        textParts.push(res.text);
      } else if (res?.blob) {
        attachments.push({
          type: 'file',
          mimeType: res.mimeType || 'application/octet-stream',
          base64: res.blob
        });
      }
    }
  }

  let finalContent = textParts.join('\n\n').trim();
  if (isError) {
    finalContent = `[MCP Error] ${finalContent}`;
  }

  if (finalContent.length > 15000) {
    try {
      const safeServerId = serverId.replace(/[^a-zA-Z0-9_-]/g, '_');
      const safeToolName = toolName.replace(/[^a-zA-Z0-9_-]/g, '_');
      const downloadDir = path.join(FREYA_HOME, 'workspace', 'download', 'mcp', safeServerId);
      await fs.mkdir(downloadDir, { recursive: true });
      const filename = `${safeToolName}_${Date.now()}.txt`;
      const fullPath = path.join(downloadDir, filename);
      await fs.writeFile(fullPath, finalContent, 'utf-8');

      finalContent = `${finalContent.slice(0, 1000)}\n\n...[Output truncated due to large size. Complete output saved to workspace: download/mcp/${safeServerId}/${filename}]`;
    } catch {}
  }

  if (attachments.length > 0) {
    return {
      content: finalContent || 'Image/Attachment payload received.',
      attachments
    };
  }

  return finalContent || 'Tool executed successfully with empty content.';
}
