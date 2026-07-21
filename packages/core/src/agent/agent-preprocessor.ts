import type { ChannelAttachment, FreyaContext } from '@eoasmxd/freya-sdk';
import type { FreyaPromptRegistry } from '../prompt/prompt-registry.js';

export async function preprocessAudio(
  attachments: ChannelAttachment[],
  userText: string,
  context: FreyaContext,
  promptRegistry: FreyaPromptRegistry
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

      const chatResult = await context.llm.chat(
        [
          {
            role: 'user',
            content: sttPrompt,
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
  promptRegistry: FreyaPromptRegistry
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

      const chatResult = await context.llm.chat(
        [
          {
            role: 'user',
            content: imageDescPrompt,
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
