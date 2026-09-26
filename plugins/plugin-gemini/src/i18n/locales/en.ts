export default {
  'error.missingApiKey': 'API key is not configured or empty. Please check provider settings.',
  'error.missingModelId': 'Model ID (modelId) is not configured. Please check provider settings.',
  'error.timeout': 'Gemini service connection timeout ({timeout}s). Check network connectivity.',
  'error.serverError': 'Gemini server returned error (HTTP {status}): {detail}',
  'error.streamError': 'Gemini stream error: {detail}',
  'error.apiError': 'Gemini API error: {detail}',
  'error.promptBlocked': 'Gemini prompt blocked by safety policy (blockReason: "{reason}")',
  'error.generationBlocked': 'Gemini generation blocked by safety policy or empty (finishReason: "{reason}")'
};
