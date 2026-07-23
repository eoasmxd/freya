export interface FreyaAttachment {
  type: 'image' | 'file';
  mimeType: string;
  url?: string;
  base64?: string;
  path?: string;
  description?: string;
}
