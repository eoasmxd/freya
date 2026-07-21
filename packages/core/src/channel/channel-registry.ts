/** 通道插件与内建通道注册表 */
export class FreyaChannelRegistry {
  private channels = new Map<string, { id: string }>();

  register(channel: { id: string }): void {
    this.channels.set(channel.id, channel);
  }

  unregister(channelId: string): void {
    this.channels.delete(channelId);
  }
}
