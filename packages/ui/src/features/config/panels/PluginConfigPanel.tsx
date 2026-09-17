import React, { useEffect, useState } from 'react';

interface PluginEntry {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  source?: 'builtin' | 'workspace' | 'runtime' | 'npm';
}

interface PluginConfigPanelProps {
  getApiUrl: (path: string) => string;
}

export const PluginConfigPanel: React.FC<PluginConfigPanelProps> = ({ getApiUrl }) => {
  const [plugins, setPlugins] = useState<PluginEntry[]>([]);
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

  const loadPlugins = async () => {
    try {
      const res = await fetch(getApiUrl('/api/config/plugins'));
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setPlugins(json.data);
      }
    } catch (err) {
      console.error('WS load plugins failed:', err);
    }
  };

  useEffect(() => {
    loadPlugins();
  }, []);

  const togglePlugin = async (pluginId: string, enabled: boolean) => {
    try {
      const res = await fetch(getApiUrl('/api/config/plugins/toggle'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pluginId, enabled })
      });
      const json = await res.json();
      if (json.success) {
        showToast(`插件 ${pluginId} 已${enabled ? '启用' : '禁用'}`, 'success');
        loadPlugins();
      } else {
        showToast(`切换插件失败: ${json.message}`, 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('切换插件状态失败', 'error');
    }
  };

  const getSourceTagMeta = (source?: string) => {
    switch (source) {
      case 'builtin':
        return { label: '内置', bg: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa' };
      case 'workspace':
        return { label: '集成', bg: 'rgba(168, 85, 247, 0.15)', color: '#c084fc' };
      case 'npm':
        return { label: 'NPM', bg: 'rgba(245, 158, 11, 0.15)', color: '#fbbf24' };
      case 'runtime':
      default:
        return { label: '自定义', bg: 'rgba(16, 185, 129, 0.15)', color: '#34d399' };
    }
  };

  return (
    <div className="plugins-list">
      {plugins.map((plugin) => {
        const displayName = plugin.name || plugin.id;
        const displayDesc = plugin.description || '未提供描述信息';
        const shouldShowIdTag = displayName !== plugin.id;
        const tagMeta = getSourceTagMeta(plugin.source);

        return (
          <div key={plugin.id} className="plugin-card">
            <div>
              <div className="plugin-title">
                {displayName}
                {shouldShowIdTag && (
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 'normal', marginLeft: '0.5rem' }}>
                    ({plugin.id})
                  </span>
                )}
                {plugin.source && (
                  <span
                    style={{
                      fontSize: '0.68rem',
                      marginLeft: '0.5rem',
                      padding: '0.1rem 0.4rem',
                      borderRadius: '4px',
                      background: tagMeta.bg,
                      color: tagMeta.color
                    }}
                  >
                    {tagMeta.label}
                  </span>
                )}
              </div>
              <div className="plugin-desc">{displayDesc}</div>
            </div>
            <div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={plugin.enabled}
                  onChange={(e) => togglePlugin(plugin.id, e.target.checked)}
                />
                <span className="slider" />
              </label>
            </div>
          </div>
        );
      })}

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
