import React, { useState } from 'react';
import { GlobalConfigPanel } from './panels/GlobalConfigPanel.jsx';
import { ProviderConfigPanel } from './panels/ProviderConfigPanel.jsx';
import { PromptConfigPanel } from './panels/PromptConfigPanel.jsx';
import { PluginConfigPanel } from './panels/PluginConfigPanel.jsx';
import { SkillConfigPanel } from './panels/SkillConfigPanel.jsx';
import { useI18n } from '../../i18n/index.js';

interface ConfigModalProps {
  onClose: () => void;
  getApiUrl: (path: string) => string;
}

export const ConfigModal: React.FC<ConfigModalProps> = ({
  onClose,
  getApiUrl
}) => {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<'global' | 'providers' | 'prompts' | 'plugins' | 'skills'>('global');

  const getTabTitle = () => {
    if (activeTab === 'global') return t('config.tabTitleGlobal', 'Global Settings');
    if (activeTab === 'providers') return t('config.tabTitleProviders', 'LLM Providers & Models');
    if (activeTab === 'prompts') return t('config.tabTitlePrompts', 'System Prompts Management');
    if (activeTab === 'plugins') return t('config.tabTitlePlugins', 'Plugins Management');
    if (activeTab === 'skills') return t('config.tabTitleSkills', 'Skills Management');
    return '';
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-container" onClick={(e) => e.stopPropagation()}>
        <div className="modal-sidebar">
          <div className="modal-sidebar-header">
            {t('config.centerTitle', 'Freya Settings')}
          </div>
          <div className="modal-sidebar-tabs">
            <button
              className={`tab-btn ${activeTab === 'global' ? 'active' : ''}`}
              onClick={() => setActiveTab('global')}
            >
              {t('config.tabGlobal', 'Global Config')}
            </button>
            <button
              className={`tab-btn ${activeTab === 'providers' ? 'active' : ''}`}
              onClick={() => setActiveTab('providers')}
            >
              {t('config.tabProviders', 'Providers')}
            </button>
            <button
              className={`tab-btn ${activeTab === 'prompts' ? 'active' : ''}`}
              onClick={() => setActiveTab('prompts')}
            >
              {t('config.tabPrompts', 'Prompts')}
            </button>
            <button
              className={`tab-btn ${activeTab === 'plugins' ? 'active' : ''}`}
              onClick={() => setActiveTab('plugins')}
            >
              {t('config.tabPlugins', 'Plugins')}
            </button>
            <button
              className={`tab-btn ${activeTab === 'skills' ? 'active' : ''}`}
              onClick={() => setActiveTab('skills')}
            >
              {t('config.tabSkills', 'Skills')}
            </button>
          </div>
        </div>

        <div className="modal-main">
          <div className="modal-main-header">
            <div className="tab-title">{getTabTitle()}</div>
            <button className="modal-close" onClick={onClose} title={t('common.close', 'Close')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>

          <div className="modal-body">
            {activeTab === 'global' && (
              <GlobalConfigPanel getApiUrl={getApiUrl} />
            )}

            {activeTab === 'providers' && (
              <ProviderConfigPanel getApiUrl={getApiUrl} />
            )}

            {activeTab === 'prompts' && (
              <PromptConfigPanel getApiUrl={getApiUrl} />
            )}

            {activeTab === 'plugins' && (
              <PluginConfigPanel getApiUrl={getApiUrl} />
            )}

            {activeTab === 'skills' && (
              <SkillConfigPanel getApiUrl={getApiUrl} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
