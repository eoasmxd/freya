import React from 'react';
import { useI18n } from '../../i18n/index.js';

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
  const { t } = useI18n();

  return (
    <header className="header">
      <div className="logo-container">
        <div className="logo">{t('header.title', 'Freya Console')}</div>
      </div>
      <div className="header-actions">
        <div className="status-container">
          <span className={`status-dot ${isConnected ? 'connected' : ''}`} />
          <span>{isConnected ? t('header.connected', 'Connected') : t('header.disconnected', 'Disconnected')}</span>
        </div>
        <button className="btn-header" onClick={onClear}>
          {t('header.resetSession', 'Reset Session')}
        </button>
        <button className="btn-header" onClick={onOpenConfig}>
          {t('header.settings', 'Settings')}
        </button>
      </div>
    </header>
  );
};
