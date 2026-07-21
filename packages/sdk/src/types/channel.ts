export interface ChannelAttachment {
  type: 'image' | 'file';
  mimeType: string;
  url?: string;
  base64?: string;
  path?: string;
}

export interface ChannelMessage {
  channelId: string;
  userId: string;
  messageId: string;
  sessionId: string;
  content: string;
  attachments?: ChannelAttachment[];
  connectionId?: string;
}
