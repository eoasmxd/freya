import React, { useRef } from 'react';

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
      <div className="billing-bar">
        <div>
          Token 消耗: <span>{billing.totalTokens} Tokens</span> (输入: {billing.promptTokens} | 缓存: {billing.cachedPromptTokens} | 输出: {billing.completionTokens})
        </div>
        <div>
          估算账单: <span className="billing-cost">{billing.cost.toFixed(6)}</span>
        </div>

      </div>

      <div className="input-container">
        <textarea
          ref={textareaRef}
          rows={1}
          className="chat-textarea"
          placeholder={isConnected ? "输入消息，与 Freya 对话..." : "正在连接服务器，请稍候..."}
          value={input}
          disabled={!isConnected}
          onChange={handleTextareaChange}
          onKeyDown={handleKeyDown}
        />
        {isGenerating ? (
          <button className="btn btn-interrupt" onClick={onInterrupt}>
            中断
          </button>
        ) : (
          <button
            className="btn btn-send"
            onClick={onSend}
            disabled={!isConnected || !input.trim()}
          >
            发送
          </button>
        )}
      </div>
    </footer>
  );
};
