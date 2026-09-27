import React, { useRef } from 'react';
import { useI18n } from '../../i18n/index.js';

interface BillingInfo {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedPromptTokens: number;
  cost: number;
}

interface ChatFooterProps {
  input: string;
  isConnected: boolean;
  isGenerating: boolean;
  billing: BillingInfo;
  onChangeInput: (val: string) => void;
  onSend: () => void;
  onInterrupt: () => void;
}

export const ChatFooter: React.FC<ChatFooterProps> = ({
  input,
  isConnected,
  isGenerating,
  billing,
  onChangeInput,
  onSend,
  onInterrupt
}) => {
  const { t } = useI18n();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChangeInput(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }
    }
  };

  return (
    <footer className="footer">
      <div className="input-container">
        <textarea
          ref={textareaRef}
          rows={1}
          className="chat-textarea"
          placeholder={isConnected ? t('footer.placeholderConnected', 'Type a message to chat with Freya...') : t('footer.placeholderDisconnected', 'Connecting to server, please wait...')}
          value={input}
          disabled={!isConnected}
          onChange={handleTextareaChange}
          onKeyDown={handleKeyDown}
        />
        {isGenerating ? (
          <button className="btn btn-interrupt" onClick={onInterrupt}>
            {t('footer.interrupt', 'Stop')}
          </button>
        ) : (
          <button
            className="btn btn-send"
            onClick={onSend}
            disabled={!isConnected || !input.trim()}
          >
            {t('footer.send', 'Send')}
          </button>
        )}
      </div>

      <div className="billing-bar">
        <div className="billing-tokens">
          <span className="billing-tokens-full">
            {t('footer.tokenUsage', 'Tokens: {total} (Prompt: {prompt} | Cached: {cached} | Output: {completion})', {
              total: billing.totalTokens,
              prompt: billing.promptTokens,
              cached: billing.cachedPromptTokens,
              completion: billing.completionTokens
            })}
          </span>
          <span className="billing-tokens-short">
            {t('footer.tokenUsageShort', 'Tokens: {total}', {
              total: billing.totalTokens
            })}
          </span>
        </div>
        <div className="billing-cost">
          <span className="billing-cost-full">
            {t('footer.estimatedCost', 'Estimated Cost: {cost}', {
              cost: billing.cost.toFixed(6)
            })}
          </span>
          <span className="billing-cost-short">
            {t('footer.estimatedCostShort', 'Cost: {cost}', {
              cost: billing.cost.toFixed(6)
            })}
          </span>
        </div>
      </div>
    </footer>
  );
};
