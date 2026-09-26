import React, { useEffect, useState } from 'react';
import { useI18n } from '../../../i18n/index.js';

interface PromptConfigPanelProps {
  getApiUrl: (path: string) => string;
}

export const PromptConfigPanel: React.FC<PromptConfigPanelProps> = ({ getApiUrl }) => {
  const { t } = useI18n();
  const [selectedPrompt, setSelectedPrompt] = useState('SOUL');
  const [promptContent, setPromptContent] = useState('');
  const [toasts, setToasts] = useState<{ id: string; message: string; type: 'success' | 'error' | 'info' }[]>([]);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    const id = generateId();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  };

  const generateId = () => {
    return (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID()
      : Math.random().toString(36).substring(2, 15);
  };

  const loadPrompt = async (name: string) => {
    try {
      const res = await fetch(getApiUrl(`/api/config/prompts/${name}`));
      const json = await res.json();
      if (json.success) {
        setPromptContent(json.data || '');
      } else {
        setPromptContent(t('prompt.loadFailed', 'Failed to load prompt: {error}', { error: json.error }));
      }
    } catch (err) {
      console.error('Failed to load prompt:', err);
    }
  };

  useEffect(() => {
    loadPrompt(selectedPrompt);
  }, [selectedPrompt]);

  const savePrompt = async () => {
    try {
      const res = await fetch(getApiUrl(`/api/config/prompts/${selectedPrompt}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: promptContent })
      });
      const json = await res.json();
      if (json.success) {
        showToast(t('prompt.saveSuccess', 'Prompt {name} saved successfully', { name: selectedPrompt }), 'success');
      } else {
        showToast(t('prompt.saveFailed', 'Failed to save prompt: {error}', { error: json.message }), 'error');
      }
    } catch (err) {
      console.error(err);
      showToast(t('prompt.saveError', 'Failed to save prompt'), 'error');
    }
  };

  return (
    <div className="prompt-panel-wrapper">
      <div className="config-group" style={{ flexDirection: 'row', alignItems: 'center', gap: '1rem', marginBottom: '1.25rem' }}>
        <label className="config-label">{t('prompt.switchCard', 'Select prompt to edit:')}</label>
        <select
          className="config-input"
          value={selectedPrompt}
          onChange={(e) => setSelectedPrompt(e.target.value)}
        >
          <option value="SOUL">{`SOUL (${t('prompt.descSoul', 'Soul Definition')})`}</option>
          <option value="IDENTITY">{`IDENTITY (${t('prompt.descIdentity', 'Identity Definition')})`}</option>
          <option value="USER">{`USER (${t('prompt.descUser', 'User Persona')})`}</option>
          <option value="TOOLS">{`TOOLS (${t('prompt.descTools', 'Tool Guidelines')})`}</option>
          <option value="AGENTS">{`AGENTS (${t('prompt.descAgents', 'Agent Directives')})`}</option>
          <option value="MEMORY">{`MEMORY (${t('prompt.descMemory', 'Long-term Memory')})`}</option>
        </select>
      </div>
      <div className="config-group prompt-textarea-group">
        <textarea
          className="config-textarea"
          value={promptContent}
          onChange={(e) => setPromptContent(e.target.value)}
        />
      </div>
      <div className="tab-actions">
        <button className="btn-primary" onClick={savePrompt}>
          {t('prompt.btnSave', 'Save Prompt Config')}
        </button>
      </div>

      {toasts.length > 0 && (
        <div className="toast-container">
          {toasts.map(t => (
            <div key={t.id} className={`toast-card ${t.type}`}>
              <span>{t.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
