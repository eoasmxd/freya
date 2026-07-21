import React from 'react';

interface ChatHeaderProps {
  isConnected: boolean;
  onClear: () => void;
  onOpenConfig: () => void;
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({
  isConnected,
  onClear,
  onOpenConfig
}) => {
  return (
    <header className="header">
      <div className="logo-container">
        <div className="logo">Freya 控制台</div>
      </div>
      <div className="header-actions">
        <div className="status-container">
          <span className={`status-dot ${isConnected ? 'connected' : ''}`} />
          <span>{isConnected ? '已连接' : '已断开'}</span>
        </div>
        <button className="btn-header" onClick={onClear}>
          重置会话
        </button>
        <button className="btn-header" onClick={onOpenConfig}>
          系统设置
        </button>
      </div>
    </header>
  );
};
