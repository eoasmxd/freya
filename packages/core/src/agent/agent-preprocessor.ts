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
          systemGuidance = `[辅助背景信息]\n${parts.join('\n')}\n\n`;
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
      context.logger.warn(`音频转录失败: ${err.message}`);
      audio.description = '【音频转录失败：无可用的音频转写模型】';
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
          systemGuidance = `[辅助背景信息]\n${parts.join('\n')}\n\n`;
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
      context.logger.warn(`图片描述失败: ${imgErr.message}`);
      img.description = '【图像描述失败：无可用的识图模型】';
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
