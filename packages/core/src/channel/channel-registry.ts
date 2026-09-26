/**
 * 通道插件与内建通道注册表
 * Registry for channel plugins and built-in channels
 */
export class FreyaChannelRegistry {
  private channels = new Map<string, { id: string }>();

  register(channel: { id: string }): void {
    this.channels.set(channel.id, channel);
  }

  unregister(channelId: string): void {
    this.channels.delete(channelId);
  }
}
