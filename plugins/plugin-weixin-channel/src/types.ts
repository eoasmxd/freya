/**
 * 微信机器人实例配置结构
 * WeChat bot instance configuration structure
 */
export interface WeixinBotConfig {
  id: string;
  appId: string;
}

/**
 * 微信账号长连接运行时状态
 * WeChat account persistent connection runtime state
 */
export interface WeixinAccountState {
  config: WeixinBotConfig;
  abortController: AbortController;
  running: boolean;
  getUpdatesBuf: string;
  isLoggedIn: boolean;
  token?: string;
  baseUrl?: string;
  botId?: string;
}

/**
 * 常见文件后缀与 MIME 类型对照表
 * Common file extension to MIME type mapping table
 */
export const WEIXIN_MIME_MAP: Record<string, string> = {
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".html": "text/html",
  ".htm": "text/html",
  ".csv": "text/csv",
  ".md": "text/markdown",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".mp4": "video/mp4",
  ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp"
};
