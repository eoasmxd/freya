import type { FreyaAttachment } from './attachment.js';

export interface ChannelMessage {
  channelId: string;
  userId: string;
  messageId: string;
  sessionId: string;
  content: string;
  attachments?: FreyaAttachment[];
  connectionId?: string;
}
