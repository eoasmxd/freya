export default {
  'error.missingApiKey': '未配置有效的大模型授权密钥，请在配置中检查。',
  'error.missingModelId': '未配置有效的模型 ID (modelId)，请在配置中检查。',
  'error.timeout': '连接大模型服务超时 ({timeout}s)，请检查 API 网络连通性或 baseURL: {baseURL}',
  'error.serverError': '模型服务端返回错误 (HTTP {status}): {detail}',
  'error.noChoices': '模型服务未响应有效选项选择。',
  'error.lengthLimitReached': '模型生成因达到 maxTokens 长度限制而被强制截断 (finish_reason: length)，且未产生有效内容，请在设置中适当调大 maxTokens。',
  'error.emptyResponse': '大模型服务返回了空内容且未发起任何工具调用，请检查提示词或模型参数设置。'
};
