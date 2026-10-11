import * as fs from 'node:fs';
import * as path from 'node:path';
import type { FreyaContext } from '@eoasmxd/freya-sdk';
import type { HomeAssistantClient } from './client.js';
import type { I18n } from './i18n/index.js';

/**
 * Home Assistant 自定义集成自动部署管理器
 * Home Assistant custom integration automatic deployer
 */
export class HomeAssistantIntegrationDeployer {
  private readonly client: HomeAssistantClient;
  private readonly i18n: I18n;
  private readonly sourceDirectory: string;
  private readonly targetDirectory: string;

  constructor(client: HomeAssistantClient, i18n: I18n) {
    this.client = client;
    this.i18n = i18n;
    this.sourceDirectory = process.env.FREYA_INTEGRATION_SOURCE_DIR || '/app/integration/custom_components/freya';
    this.targetDirectory = process.env.FREYA_INTEGRATION_TARGET_DIR || '/config/custom_components/freya';
  }

  /**
   * 探测并在版本不一致时自动部署集成至宿主机
   * Detect and automatically deploy integration to host when versions mismatch
   */
  async deployIfNeeded(ctx: FreyaContext): Promise<void> {
    const sourceManifestPath = path.join(this.sourceDirectory, 'manifest.json');
    if (!fs.existsSync(sourceManifestPath)) {
      await this.triggerDiscovery(ctx);
      return;
    }

    const sourceVersion = await this.readVersion(sourceManifestPath);
    if (!sourceVersion) {
      await this.triggerDiscovery(ctx);
      return;
    }

    const targetManifestPath = path.join(this.targetDirectory, 'manifest.json');
    const isInitialInstall = !fs.existsSync(targetManifestPath);
    const targetVersion = isInitialInstall ? '' : await this.readVersion(targetManifestPath);

    if (!isInitialInstall && targetVersion === sourceVersion) {
      ctx.logger.debug(`[HomeAssistantDeployer] Integration version matches (v${sourceVersion}), skipping deployment.`);
      await this.triggerDiscovery(ctx);
      return;
    }

    try {
      await fs.promises.mkdir(path.dirname(this.targetDirectory), { recursive: true });
      await fs.promises.cp(this.sourceDirectory, this.targetDirectory, { recursive: true, force: true });
      ctx.logger.info(`[HomeAssistantDeployer] Successfully deployed integration (v${sourceVersion}) to ${this.targetDirectory}.`);

      await this.sendRestartNotification(sourceVersion, isInitialInstall, ctx);
    } catch (err: any) {
      ctx.logger.warn(`[HomeAssistantDeployer] Failed to deploy integration: ${err?.message || err}`);
    }
  }

  /**
   * 读取清单文件中的版本号
   * Read version string from manifest file
   */
  private async readVersion(manifestPath: string): Promise<string> {
    try {
      const rawContent = await fs.promises.readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(rawContent);
      return typeof manifest?.version === 'string' ? manifest.version.trim() : '';
    } catch {
      return '';
    }
  }

  /**
   * 向 Home Assistant 发送重启提示通知
   * Send restart reminder notification to Home Assistant
   */
  private async sendRestartNotification(
    version: string,
    isInitialInstall: boolean,
    ctx: FreyaContext
  ): Promise<void> {
    try {
      const title = isInitialInstall
        ? this.i18n.t('notification.install.title', 'Freya Integration Installed')
        : this.i18n.t('notification.update.title', `Freya Integration Updated (v${version})`, { version });
      const message = isInitialInstall
        ? this.i18n.t(
            'notification.install.message',
            'Freya integration has been automatically installed to `custom_components/freya`. Please **restart Home Assistant** to activate it.'
          )
        : this.i18n.t(
            'notification.update.message',
            `Freya integration has been updated to v${version}. Please **restart Home Assistant** to apply updates.`,
            { version }
          );

      await this.client.callService('persistent_notification', 'create', {
        notification_id: 'freya_integration_update',
        title,
        message
      });
      ctx.logger.info('[HomeAssistantDeployer] Sent restart notification to Home Assistant.');
    } catch (err: any) {
      ctx.logger.warn(`[HomeAssistantDeployer] Failed to send restart notification: ${err?.message || err}`);
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
