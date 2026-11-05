import * as fs from 'node:fs';
import * as path from 'node:path';
import type { FreyaContext } from '@eoasmxd/freya-sdk';
import type { HomeAssistantClient } from './client.js';
import type { I18n } from './i18n/index.js';

/**
 * Home Assistant 自定义集成探测与引导管理器
 * Home Assistant custom integration detection and guidance manager
 */
export class HomeAssistantIntegrationDeployer {
  private readonly client: HomeAssistantClient;
  private readonly i18n: I18n;
  private readonly targetDirectory: string;

  constructor(client: HomeAssistantClient, i18n: I18n) {
    this.client = client;
    this.i18n = i18n;
    this.targetDirectory = process.env.FREYA_INTEGRATION_TARGET_DIR || '/config/custom_components/freya';
  }

  /**
   * 探测集成安装状态并在缺失时输出安装指引与持久通知
   * Detect integration status and send guidance notification if missing
   */
  async verifyOrGuide(ctx: FreyaContext): Promise<void> {
    const targetManifestPath = path.join(this.targetDirectory, 'manifest.json');
    const isMissing = !fs.existsSync(targetManifestPath);

    if (isMissing) {
      ctx.logger.info(
        '[HomeAssistantDeployer] Freya integration not found in custom_components/freya. Guiding user via notification.'
      );
      await this.sendMissingNotification(ctx);
    } else {
      ctx.logger.debug('[HomeAssistantDeployer] Freya integration detected in custom_components/freya.');
    }

    await this.triggerDiscovery(ctx);
  }

  /**
   * 向 Home Assistant 发送集成缺失与 HACS 安装引导通知
   * Send integration missing and HACS installation guidance notification to Home Assistant
   */
  private async sendMissingNotification(ctx: FreyaContext): Promise<void> {
    try {
      const title = this.i18n.t('notification.missing.title', 'Freya Integration Not Installed');
      const message = this.i18n.t(
        'notification.missing.message',
        'Freya Home Assistant integration is not detected. Please install it via [**HACS**](/hacs/integrations) (search for **Freya**).'
      );

      await this.client.callService('persistent_notification', 'create', {
        notification_id: 'freya_integration_missing',
        title,
        message
      });
      ctx.logger.info('[HomeAssistantDeployer] Sent HACS guidance notification to Home Assistant.');
    } catch (err: any) {
      ctx.logger.warn(`[HomeAssistantDeployer] Failed to send missing notification: ${err?.message || err}`);
    }
  }

  /**
   * 向 Home Assistant Supervisor 发送服务发现广播
   * Send service discovery broadcast to Home Assistant Supervisor
   */
  private async triggerDiscovery(ctx: FreyaContext): Promise<void> {
    try {
      const ok = await this.client.sendDiscovery();
      if (ok) {
        ctx.logger.info('[HomeAssistantDeployer] Sent discovery message to Supervisor successfully.');
      }
    } catch (err: any) {
      ctx.logger.warn(`[HomeAssistantDeployer] Failed to send discovery message: ${err?.message || err}`);
    }
  }
}
