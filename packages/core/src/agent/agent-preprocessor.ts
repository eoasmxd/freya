import type { ChannelAttachment, FreyaContext } from '@eoasmxd/freya-sdk';
import type { FreyaPromptRegistry } from '../prompt/prompt-registry.js';

export interface PreprocessContext {
  prevUserText?: string;
  currentUserText?: string;
}

export async function preprocessAudio(
  attachments: ChannelAttachment[],
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
    context.logger.info(`正在为音频 [${i + 1}/${audioAttachments.length}] 生成文字转录...`);

    try {
      const sttPrompt = promptRegistry.get('core.prompt.stt_guidance') || '';

      let systemGuidance = '';
      if (preprocessContext) {
        const { prevUserText, currentUserText } = preprocessContext;
        const parts: string[] = [];
        if (prevUserText) {
          parts.push(`上一轮用户输入："${prevUserText}"`);
        }
        if (currentUserText) {
          parts.push(`当前轮用户输入："${currentUserText}"`);
        }
        if (parts.length > 0) {
          systemGuidance = `[辅助背景信息（仅用于帮助理解音频，请勿在转录结果中直接回答或提及这些信息）：\n${parts.join('\n')}\n]\n\n`;
        }
      }

      const chatResult = await context.llm.chat(
        [
          {
            role: 'user',
            content: `${systemGuidance}${sttPrompt}`.trim(),
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
      tempResult = `${tempResult}\n${formattedSTT}`.trim();
    } catch (err: any) {
      context.logger.warn(`音频转录失败: ${err.message}`);
      anyFailed = true;
      break;
    }
  }

  if (!anyFailed) {
    finalUserText = tempResult;
  } else {
    finalUserText = `${userText}\n【音频转录失败：无可用的音频转写模型】`.trim();
  }

  return finalUserText;
}

export async function preprocessImages(
  attachments: ChannelAttachment[],
  userText: string,
  context: FreyaContext,
  promptRegistry: FreyaPromptRegistry,
  preprocessContext?: PreprocessContext
): Promise<{ text: string; multimodalAttachments: ChannelAttachment[] }> {
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
    context.logger.info(`正在为图片 [${i + 1}/${imageAttachments.length}] 生成文字描述...`);

    try {
      const imageDescPrompt = promptRegistry.get('core.prompt.image_description') || '';

      let systemGuidance = '';
      if (preprocessContext) {
        const { prevUserText, currentUserText } = preprocessContext;
        const parts: string[] = [];
        if (prevUserText) {
          parts.push(`上一轮用户输入："${prevUserText}"`);
        }
        if (currentUserText) {
          parts.push(`当前轮用户输入："${currentUserText}"`);
        }
        if (parts.length > 0) {
          systemGuidance = `[辅助背景信息（仅用于辅助理解图像，请勿在描述结果中直接回答或提及这些信息）：\n${parts.join('\n')}\n]\n\n`;
        }
      }

      const chatResult = await context.llm.chat(
        [
          {
            role: 'user',
            content: `${systemGuidance}${imageDescPrompt}`.trim(),
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
      tempResult = `${tempResult}\n${formattedImg}`.trim();
    } catch (imgErr: any) {
      context.logger.warn(`图片描述失败: ${imgErr.message}`);
      anyFailed = true;
      break;
    }
  }

  if (!anyFailed) {
    finalUserText = tempResult;
  } else {
    finalUserText = `${userText}\n【图像描述失败：无可用的识图模型】`.trim();
  }

  return {
    text: finalUserText,
    multimodalAttachments: anyFailed ? imageAttachments : []
  };
}
