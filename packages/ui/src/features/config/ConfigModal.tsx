import React, { useState } from 'react';
import { GlobalConfigPanel } from './panels/GlobalConfigPanel.jsx';
import { ProviderConfigPanel } from './panels/ProviderConfigPanel.jsx';
import { PromptConfigPanel } from './panels/PromptConfigPanel.jsx';
import { PluginConfigPanel } from './panels/PluginConfigPanel.jsx';

interface ConfigModalProps {
  onClose: () => void;
  getApiUrl: (path: string) => string;
}

export const ConfigModal: React.FC<ConfigModalProps> = ({
  onClose,
  getApiUrl
}) => {
  const [activeTab, setActiveTab] = useState<'global' | 'providers' | 'prompts' | 'plugins'>('global');

  const getTabTitle = () => {
    if (activeTab === 'global') return '全局参数设置';
    if (activeTab === 'providers') return '大模型提供商与模型管理';
    if (activeTab === 'prompts') return '系统提示词管理';
    if (activeTab === 'plugins') return '扩展插件管理';
    return '';
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-container" onClick={(e) => e.stopPropagation()}>
        <div className="modal-sidebar">
          <div className="modal-sidebar-header">
            Freya 配置中心
          </div>
          <div className="modal-sidebar-tabs">
            <button
              className={`tab-btn ${activeTab === 'global' ? 'active' : ''}`}
              onClick={() => setActiveTab('global')}
            >
              全局配置
            </button>
            <button
              className={`tab-btn ${activeTab === 'providers' ? 'active' : ''}`}
              onClick={() => setActiveTab('providers')}
            >
              模型提供商
            </button>
            <button
              className={`tab-btn ${activeTab === 'prompts' ? 'active' : ''}`}
              onClick={() => setActiveTab('prompts')}
            >
              提示词管理
            </button>
            <button
              className={`tab-btn ${activeTab === 'plugins' ? 'active' : ''}`}
              onClick={() => setActiveTab('plugins')}
            >
              扩展插件
            </button>
          </div>
        </div>

        <div className="modal-main">
          <div className="modal-main-header">
            <div className="tab-title">{getTabTitle()}</div>
            <button className="modal-close" onClick={onClose} title="关闭">
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
          </div>
        </div>
      </div>
    </div>
  );
};
