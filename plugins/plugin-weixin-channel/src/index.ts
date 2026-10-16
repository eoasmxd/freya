import type { ChannelPlugin, FreyaCommand, FreyaContext } from "@eoasmxd/freya-sdk";
import { createWeixinCommands } from "./command.js";
import { WeixinConnectionManager } from "./connection.js";
import { I18n } from "./i18n/index.js";
import en from "./i18n/locales/en.js";
import zh from "./i18n/locales/zh.js";

/**
 * Freya 微信智能群设备 (iLink 协议) 通道插件入口
 * Freya WeChat intelligent group device (iLink protocol) channel plugin entry
 */
export default class FreyaWeixinChannelPlugin implements ChannelPlugin {
  readonly type = "channel" as const;

  private i18n = new I18n({ zh, en });
  private connectionManager = new WeixinConnectionManager(this.i18n);
  commands: FreyaCommand[] = createWeixinCommands(this.connectionManager, this.i18n);

  /**
   * 初始化微信通道插件
   * Initialize WeChat channel plugin
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
}

export const Plugin = FreyaWeixinChannelPlugin;
