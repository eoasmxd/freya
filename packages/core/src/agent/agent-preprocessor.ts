import type { FreyaAttachment, FreyaContext } from '@eoasmxd/freya-sdk';
import type { FreyaPromptRegistry } from '../prompt/prompt-registry.js';

export interface PreprocessContext {
  prevUserText?: string;
  currentUserText?: string;
}

export async function preprocessAudio(
  attachments: FreyaAttachment[],
  userText: string,
  context: FreyaContext,
  promptRegistry: FreyaPromptRegistry,
  preprocessContext?: PreprocessContext
): Promise<string> {
  let finalUserText = userText;
  const audioAttachments = attachments.filter(
    (a) =>
      a.mimeType.startsWith('audio/') ||
      (a.type === 'file' &&
        (a.mimeType.includes('wav') ||
          a.mimeType.includes('mp3') ||
          a.mimeType.includes('m4a')))
  );

  if (audioAttachments.length === 0) {
    return finalUserText;
  }

  let tempResult = userText;
  let anyFailed = false;

  for (let i = 0; i < audioAttachments.length; i++) {
    const audio = audioAttachments[i];
    context.logger.info(`Generating transcription for audio [${i + 1}/${audioAttachments.length}]...`);

    try {
      const sttPrompt = promptRegistry.get('core.prompt.stt_guidance') || '';

      let systemGuidance = '';
      if (preprocessContext) {
        const { prevUserText, currentUserText } = preprocessContext;
        const parts: string[] = [];
        if (prevUserText) {
          // 上一轮用户输入
          parts.push(`Previous user input: "${prevUserText}"`);
        }
        if (currentUserText) {
          // 当前轮用户输入
          parts.push(`Current user input: "${currentUserText}"`);
        }
        if (parts.length > 0) {
          // 辅助背景信息引导词
          systemGuidance = `[Auxiliary Context]\n${parts.join('\n')}\n\n`;
        }
      }

      const chatResult = await context.llm.chat(
        [
          {
            role: 'system',
            content: sttPrompt
          },
          {
            role: 'user',
            content: systemGuidance.trim(),
            attachments: [audio]
          }
        ],
        undefined,
        {
          modelType: 'audio'
        }
      );

      const transcriptionText = chatResult.message.content || '';
      const sttTemplate = promptRegistry.get('core.prompt.stt_template') || '{text}';
      const formattedSTT = sttTemplate.replace('{text}', transcriptionText);
      audio.description = formattedSTT;
      tempResult = `${tempResult}\n${formattedSTT}`.trim();
    } catch (err: any) {
      context.logger.warn(`Audio transcription failed: ${err.message}`);
      // 音频转录失败描述
      audio.description = '[Audio transcription failed: No available STT model]';
      anyFailed = true;
      break;
    }
  }

  if (!anyFailed) {
    finalUserText = tempResult;
  } else {
    // 音频转录失败追加文本
    finalUserText = `${userText}\n[Audio transcription failed: No available STT model]`.trim();
  }

  return finalUserText;
}

export async function preprocessImages(
  attachments: FreyaAttachment[],
  userText: string,
  context: FreyaContext,
  promptRegistry: FreyaPromptRegistry,
  preprocessContext?: PreprocessContext
): Promise<{ text: string; multimodalAttachments: FreyaAttachment[] }> {
  let finalUserText = userText;
  const imageAttachments = attachments.filter(
    (a) => a.mimeType.startsWith('image/') || a.type === 'image'
  );

  if (imageAttachments.length === 0) {
    return { text: finalUserText, multimodalAttachments: [] };
  }

  let tempResult = userText;
  let anyFailed = false;

  for (let i = 0; i < imageAttachments.length; i++) {
    const img = imageAttachments[i];
    context.logger.info(`Generating description for image [${i + 1}/${imageAttachments.length}]...`);

    try {
      const imageDescPrompt = promptRegistry.get('core.prompt.image_description') || '';

      let systemGuidance = '';
      if (preprocessContext) {
        const { prevUserText, currentUserText } = preprocessContext;
        const parts: string[] = [];
        if (prevUserText) {
          // 上一轮用户输入
          parts.push(`Previous user input: "${prevUserText}"`);
        }
        if (currentUserText) {
          // 当前轮用户输入
          parts.push(`Current user input: "${currentUserText}"`);
        }
        if (parts.length > 0) {
          // 辅助背景信息引导词
          systemGuidance = `[Auxiliary Context]\n${parts.join('\n')}\n\n`;
        }
      }

      const chatResult = await context.llm.chat(
        [
          {
            role: 'system',
            content: imageDescPrompt
          },
          {
            role: 'user',
            content: systemGuidance.trim(),
            attachments: [img]
          }
        ],
        undefined,
        {
          modelType: 'image'
        }
      );

      const descText = chatResult.message.content || '';
      const imgTemplate = promptRegistry.get('core.prompt.image_description_template') || '{text}';
      const formattedImg = imgTemplate.replace('{text}', descText);
      img.description = formattedImg;
      tempResult = `${tempResult}\n${formattedImg}`.trim();
    } catch (imgErr: any) {
      context.logger.warn(`Image description failed: ${imgErr.message}`);
      // 图像描述失败描述
      img.description = '[Image description failed: No available vision model]';
      anyFailed = true;
      break;
    }
  }

  if (!anyFailed) {
    finalUserText = tempResult;
  } else {
    // 图像描述失败追加文本
    finalUserText = `${userText}\n[Image description failed: No available vision model]`.trim();
  }

  return {
    text: finalUserText,
    multimodalAttachments: anyFailed ? imageAttachments : []
  };
}
