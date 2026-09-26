export default {
  'error.missingApiKey': '未配置有效的大模型授权密钥，请在配置中检查。',
  'error.missingModelId': '未配置有效的模型 ID (modelId)，请在配置中检查。',
  'error.timeout': '连接 Gemini 模型服务超时 ({timeout}s)，请检查网络连通性。',
  'error.serverError': 'Gemini 服务端返回错误 (HTTP {status}): {detail}',
  'error.streamError': 'Gemini 流错误: {detail}',
  'error.apiError': 'Gemini API 错误: {detail}',
  'error.promptBlocked': 'Gemini 输入安全策略拦截 (blockReason: "{reason}")',
  'error.generationBlocked': 'Gemini 输出安全策略拦截/未生成 (finishReason: "{reason}")'
};
