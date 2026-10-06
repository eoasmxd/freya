import type { FreyaContext, FreyaTool, ToolDefinition } from "@eoasmxd/freya-sdk";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

interface WecomWebhookConfigItem {
  name: string;
  key: string;
  description?: string;
}

/**
 * 校验工作区相对路径并获取安全物理路径
 * Validate workspace relative path and resolve safe physical path
 */
function getSafeWorkspacePath(ctx: FreyaContext, relativePath: string): string {
  if (!relativePath || typeof relativePath !== "string") {
    throw new Error("File path must be a non-empty string.");
  }
  if (path.isAbsolute(relativePath)) {
    throw new Error("Security boundary rejection: Absolute paths are strictly prohibited, only workspace relative paths allowed.");
  }
  const baseAbs = ctx.paths.workspaceDir;
  const targetAbs = path.resolve(baseAbs, relativePath);
  const basePrefix = baseAbs.endsWith(path.sep) ? baseAbs : baseAbs + path.sep;
  if (targetAbs !== baseAbs && !targetAbs.startsWith(basePrefix)) {
    throw new Error(`Security boundary rejection: Path "${relativePath}" escapes workspace sandbox.`);
  }
  return targetAbs;
}

/**
 * 解析 Webhook 目标 Key（支持配置名称映射与 URL 提取）
 * Resolve Webhook target key supporting configuration name mapping and URL extraction
 */
function resolveWebhookKey(ctx: FreyaContext, target: string): string {
  const trimmed = target.trim();
  if (!trimmed) {
    throw new Error("Webhook target must not be empty.");
  }

  const rawWebhooks = ctx.config.wecom?.webhooks;
  const configuredList: WecomWebhookConfigItem[] = Array.isArray(rawWebhooks) ? rawWebhooks : [];
  const matched = configuredList.find(
    (item) => item.name && item.name.trim().toLowerCase() === trimmed.toLowerCase()
  );
  const candidateKey = matched ? matched.key.trim() : trimmed;

  if (candidateKey.includes("key=")) {
    try {
      const url = new URL(candidateKey);
      const extracted = url.searchParams.get("key");
      if (extracted) {
        return extracted.trim();
      }
    } catch {
      const match = candidateKey.match(/key=([a-zA-Z0-9_-]+)/);
      if (match) {
        return match[1];
      }
    }
  }

  return candidateKey;
}

/**
 * 企业微信群 Webhook 消息发送工具
 * WeCom group webhook message dispatching tool
 */
export class WecomSendWebhookTool implements FreyaTool {
  constructor(private ctx: FreyaContext) { }

  /**
   * 获取工具元数据定义
   * Get tool definition metadata
   */
  getDefinition(): ToolDefinition {
    return {
      name: "wecom_send_webhook",
      description: "Send notification messages (text, markdown, image, file) to WeChat Work (WeCom) group via Webhook.",
      parameters: {
        type: "object",
        properties: {
          target: {
            type: "string",
            description: "Target webhook name, key, or full webhook URL."
          },
          messageType: {
            type: "string",
            enum: ["text", "markdown", "image", "file"],
            description: "Message format type to send."
          },
          content: {
            type: "string",
            description: "Message body content (required when messageType is 'text' or 'markdown')."
          },
          filePath: {
            type: "string",
            description: "Relative file path under workspace sandbox (required when messageType is 'image' or 'file')."
          }
        },
        required: ["target", "messageType"]
      }
    };
  }

  /**
   * 执行 Webhook 消息推送
   * Execute webhook message dispatching
   */
  async execute(args: Record<string, any>): Promise<string> {
    const target = args.target;
    const messageType = args.messageType;
    const content = args.content;
    const filePath = args.filePath;

    if (!target || typeof target !== "string") {
      return "❌ Error: 'target' is required and must be a valid webhook name or key.";
    }

    let webhookKey = "";
    try {
      webhookKey = resolveWebhookKey(this.ctx, target);
    } catch (err: any) {
      return `❌ Webhook resolution error: ${err.message}`;
    }

    const sendUrl = `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${encodeURIComponent(webhookKey)}`;

    try {
      if (messageType === "text") {
        if (!content || typeof content !== "string") {
          return "❌ Error: 'content' is required when messageType is 'text'.";
        }
        if (Buffer.byteLength(content, "utf-8") > 2048) {
          return "❌ Error: Text content exceeds 2048 bytes limit.";
        }
        return await this.sendPayload(sendUrl, target, messageType, {
          msgtype: "text",
          text: { content }
        });
      }

      if (messageType === "markdown") {
        if (!content || typeof content !== "string") {
          return "❌ Error: 'content' is required when messageType is 'markdown'.";
        }
        if (Buffer.byteLength(content, "utf-8") > 4096) {
          return "❌ Error: Markdown content exceeds 4096 bytes limit.";
        }
        return await this.sendPayload(sendUrl, target, messageType, {
          msgtype: "markdown",
          markdown: { content }
        });
      }

      if (messageType === "image") {
        if (!filePath || typeof filePath !== "string") {
          return "❌ Error: 'filePath' is required when messageType is 'image'.";
        }
        const safeAbs = getSafeWorkspacePath(this.ctx, filePath);
        const stats = await fs.stat(safeAbs).catch(() => null);
        if (!stats || !stats.isFile()) {
          return `❌ Error: Image file "${filePath}" does not exist in workspace.`;
        }
        if (stats.size > 2 * 1024 * 1024) {
          return `❌ Error: Image size (${(stats.size / 1024 / 1024).toFixed(2)}MB) exceeds 2MB limit.`;
        }
        const ext = path.extname(safeAbs).toLowerCase();
        if (![".jpg", ".jpeg", ".png"].includes(ext)) {
          return `❌ Error: Unsupported image format "${ext}", only JPG and PNG are supported.`;
        }

        const buffer = await fs.readFile(safeAbs);
        const md5 = crypto.createHash("md5").update(buffer).digest("hex");
        const base64 = buffer.toString("base64");

        return await this.sendPayload(sendUrl, target, messageType, {
          msgtype: "image",
          image: { base64, md5 }
        });
      }

      if (messageType === "file") {
        if (!filePath || typeof filePath !== "string") {
          return "❌ Error: 'filePath' is required when messageType is 'file'.";
        }
        const safeAbs = getSafeWorkspacePath(this.ctx, filePath);
        const stats = await fs.stat(safeAbs).catch(() => null);
        if (!stats || !stats.isFile()) {
          return `❌ Error: File "${filePath}" does not exist in workspace.`;
        }
        if (stats.size > 20 * 1024 * 1024) {
          return `❌ Error: File size (${(stats.size / 1024 / 1024).toFixed(2)}MB) exceeds 20MB limit.`;
        }

        const mediaId = await this.uploadMedia(webhookKey, safeAbs);
        return await this.sendPayload(sendUrl, target, messageType, {
          msgtype: "file",
          file: { media_id: mediaId }
        });
      }

      return `❌ Error: Unsupported messageType "${messageType}". Supported types: text, markdown, image, file.`;
    } catch (err: any) {
      return `❌ Failed to execute WeCom webhook: ${err.message}`;
    }
  }

  /**
   * 上传文件素材获取 media_id
   * Upload file media to obtain media_id
   */
  private async uploadMedia(webhookKey: string, fileAbs: string): Promise<string> {
    const uploadUrl = `https://qyapi.weixin.qq.com/cgi-bin/webhook/upload_media?key=${encodeURIComponent(webhookKey)}&type=file`;
    const buffer = await fs.readFile(fileAbs);
    const fileName = path.basename(fileAbs);

    const formData = new FormData();
    formData.append("media", new Blob([buffer]), fileName);

    const res = await fetch(uploadUrl, {
      method: "POST",
      body: formData
    });

    if (!res.ok) {
      throw new Error(`Media upload HTTP error status: ${res.status}`);
    }

    const json = (await res.json()) as any;
    if (json.errcode !== 0) {
      throw new Error(`Media upload rejected by WeCom API [${json.errcode}]: ${json.errmsg || "unknown"}`);
    }

    if (!json.media_id) {
      throw new Error("Media upload succeeded but returned no media_id.");
    }

    return json.media_id;
  }

  /**
   * 发送 Webhook 消息载荷并校验响应状态
   * Dispatch webhook message payload and validate response
   */
  private async sendPayload(sendUrl: string, target: string, messageType: string, payload: any): Promise<string> {
    const res = await fetch(sendUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      return `❌ WeCom HTTP error status: ${res.status} when sending to "${target}".`;
    }

    const result = (await res.json()) as any;
    if (result.errcode === 0) {
      return `✅ Successfully sent ${messageType} message to WeCom webhook "${target}".`;
    }

    return `❌ WeCom API rejection [${result.errcode}]: ${result.errmsg || "unknown"} (target: "${target}")`;
  }
}
