import React, { useEffect, useState } from 'react';

interface PromptConfigPanelProps {
  getApiUrl: (path: string) => string;
}

export const PromptConfigPanel: React.FC<PromptConfigPanelProps> = ({ getApiUrl }) => {
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

  const generateId = () => crypto.randomUUID();

  const loadPrompt = async (name: string) => {
    try {
      const res = await fetch(getApiUrl(`/api/config/prompts/${name}`));
      const json = await res.json();
      if (json.success) {
        setPromptContent(json.data || '');
      } else {
        setPromptContent(`未找到或读取提示词失败: ${json.error}`);
      }
    } catch (err) {
      console.error('WS load prompt failed:', err);
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
        showToast(`提示词 ${selectedPrompt} 保存成功`, 'success');
      } else {
        showToast(`保存失败: ${json.message}`, 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('保存提示词失败', 'error');
    }
  };

  return (
    <div className="prompt-panel-wrapper">
      <div className="config-group" style={{ flexDirection: 'row', alignItems: 'center', gap: '1rem', marginBottom: '1.25rem' }}>
        <label className="config-label">切换要编辑的主提示词卡片:</label>
        <select
          className="config-input"
          value={selectedPrompt}
          onChange={(e) => setSelectedPrompt(e.target.value)}
        >
          <option value="SOUL">SOUL (灵魂设定)</option>
          <option value="IDENTITY">IDENTITY (身份设定)</option>
          <option value="USER">USER (用户设定)</option>
          <option value="TOOLS">TOOLS (工具使用规范)</option>
          <option value="AGENTS">AGENTS (智能体配置)</option>
          <option value="MEMORY">MEMORY (长期记忆)</option>
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
          保存提示词配置
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
