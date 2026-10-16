import type { ChannelPlugin, FreyaCommand, FreyaContext, FreyaTool, ToolPlugin } from "@eoasmxd/freya-sdk";
import { createWeixinCommands } from "./command.js";
import { WeixinConnectionManager } from "./connection.js";
import { I18n } from "./i18n/index.js";
import en from "./i18n/locales/en.js";
import zh from "./i18n/locales/zh.js";
import { WeixinSendMessageTool } from "./send-message-tool.js";

/**
 * Freya 微信智能群设备 (iLink 协议) 通道与工具插件入口
 * Freya WeChat intelligent group device (iLink protocol) channel and tool plugin entry
 */
export default class FreyaWeixinChannelPlugin implements ChannelPlugin, ToolPlugin {
  readonly type = ["channel", "tool"] as const;

  private i18n = new I18n({ zh, en });
  private connectionManager = new WeixinConnectionManager(this.i18n);
  private tools: FreyaTool[] = [new WeixinSendMessageTool(this.connectionManager)];
  commands: FreyaCommand[] = createWeixinCommands(this.connectionManager, this.i18n);

  /**
   * 初始化微信通道与工具插件
   * Initialize WeChat channel and tool plugin
   */
  async setup(ctx: FreyaContext): Promise<void> {
    this.i18n.setContext(ctx);
    this.connectionManager.setup(ctx);
  }

  /**
   * 启动微信账号会话监听与长轮询
   * Start WeChat account session listening and long polling
   */
  async start(_ctx: FreyaContext): Promise<void> {
    await this.connectionManager.start();
  }

  /**
   * 停止微信连接与清理资源
   * Stop WeChat connections and cleanup resources
   */
  async stop(_ctx: FreyaContext): Promise<void> {
    await this.connectionManager.stop();
  }

  /**
   * 获取工具箱唯一标识符
   * Get unique identifier for the toolbox
   */
  getId(): string {
    return "weixin";
  }

  /**
   * 获取工具箱提示词模板索引
   * Get instruction prompt template index for the toolbox
   */
  getInstructionPrompt(): string {
    return "plugin.prompt.weixin";
  }

  /**
   * 获取工具箱内装配的工具实例集合
   * Get assembled tool instances within the toolbox
   */
  getTools(): FreyaTool[] {
    return this.tools;
  }
}

export const Plugin = FreyaWeixinChannelPlugin;
