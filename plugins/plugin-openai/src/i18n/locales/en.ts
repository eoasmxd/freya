export default {
  'error.missingApiKey': 'API key is not configured or empty. Please check provider settings.',
  'error.missingModelId': 'Model ID (modelId) is not configured. Please check provider settings.',
  'error.timeout': 'LLM service connection timeout ({timeout}s). Check API connectivity or baseURL: {baseURL}',
  'error.serverError': 'LLM server returned error (HTTP {status}): {detail}',
  'error.noChoices': 'LLM service responded without valid choices.',
  'error.lengthLimitReached': 'Generation terminated due to token limit (finish_reason: length) without valid output. Please increase maxTokens.',
  'error.emptyResponse': 'LLM service returned an empty response without tool calls. Please check prompt instructions or model settings.'
};
