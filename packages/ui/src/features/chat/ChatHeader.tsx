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
        <div className="logo">
          <span className="header-text-full">{t('header.title', 'Freya Console')}</span>
          <span className="header-text-short">{t('header.titleShort', 'Freya')}</span>
        </div>
      </div>
      <div className="header-actions">
        <div
          className="status-container"
          title={isConnected ? t('header.connected', 'Connected') : t('header.disconnected', 'Disconnected')}
        >
          <span className={`status-dot ${isConnected ? 'connected' : ''}`} />
          <span className="status-text">
            {isConnected ? t('header.connected', 'Connected') : t('header.disconnected', 'Disconnected')}
          </span>
        </div>
        <button className="btn-header" onClick={onClear} title={t('header.resetSession', 'Reset Session')}>
          <span className="header-text-full">{t('header.resetSession', 'Reset Session')}</span>
          <span className="header-text-short">{t('header.resetShort', 'Reset')}</span>
        </button>
        <button className="btn-header" onClick={onOpenConfig} title={t('header.settings', 'Settings')}>
          <span className="header-text-full">{t('header.settings', 'Settings')}</span>
          <span className="header-text-short">{t('header.settingsShort', 'Settings')}</span>
        </button>
      </div>
    </header>
  );
};
