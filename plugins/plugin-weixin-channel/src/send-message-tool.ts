import type { FreyaTool, ToolDefinition } from "@eoasmxd/freya-sdk";

/**
 * 微信主动消息发送执行契约接口
 * Execution contract interface for WeChat proactive message dispatching
 */
export interface WeixinMessageSender {
  sendMessage(accountId: string, content: string): Promise<{ success: boolean; chunks: number }>;
  translate(key: string, fallback: string, params?: Record<string, any>): string;
}

/**
 * 微信通道主动消息发送工具
 * WeChat channel proactive message sending tool
 */
export class WeixinSendMessageTool implements FreyaTool {
  constructor(private sender: WeixinMessageSender) { }

  /**
   * 获取工具元数据定义
   * Get tool definition metadata
   */
  getDefinition(): ToolDefinition {
    return {
      name: "weixin_send_message",
      description: "Send message directly to a WeChat channel conversation bound to a specific logged-in WeChat account (accountId).",
      parameters: {
        type: "object",
        properties: {
          accountId: {
            type: "string",
            description: "WeChat account instance identifier (the accountId specified during `/weixin login <accountId>`), strictly required."
          },
          content: {
            type: "string",
            description: "Message content to send to WeChat, strictly required."
          }
        },
        required: ["accountId", "content"]
      }
    };
  }

  /**
   * 执行微信消息发送调用
   * Execute WeChat message dispatching invocation
   */
  async execute(args: Record<string, any>): Promise<string> {
    const accountId = typeof args.accountId === "string" ? args.accountId.trim() : "";
    if (!accountId) {
      return this.sender.translate(
        "tool.weixin.send.accountRequired",
        "❌ Missing required parameter accountId: WeChat account instance identifier must be specified."
      );
    }

    const content = typeof args.content === "string" ? args.content : "";
    if (!content.trim()) {
      return this.sender.translate(
        "tool.weixin.send.contentRequired",
        "❌ Missing required parameter content: message content to send must not be empty."
      );
    }

    try {
      const result = await this.sender.sendMessage(accountId, content);
      return this.sender.translate(
        "tool.weixin.send.success",
        `✅ Message delivered successfully to WeChat account [${accountId}] (${result.chunks} chunk(s)).`,
        {
          accountId,
          chunks: result.chunks
        }
      );
    } catch (err: any) {
      return this.sender.translate(
        "tool.weixin.send.failed",
        `❌ Failed to send message to WeChat account [${accountId}]: ${err.message}`,
        {
          accountId,
          message: err.message
        }
      );
    }
  }
}
