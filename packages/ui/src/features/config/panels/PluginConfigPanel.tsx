import React, { useEffect, useState } from 'react';
import { useI18n } from '../../../i18n/index.js';

interface PluginEntry {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  source?: 'builtin' | 'launch' | 'runtime' | 'npm';
}

interface PluginConfigPanelProps {
  getApiUrl: (path: string) => string;
}

export const PluginConfigPanel: React.FC<PluginConfigPanelProps> = ({ getApiUrl }) => {
  const { t } = useI18n();
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
      console.error('Failed to load plugins:', err);
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
        const statusText = enabled ? t('plugin.enabled', 'enabled') : t('plugin.disabled', 'disabled');
        showToast(t('plugin.toggleSuccess', 'Plugin {id} {status}', { id: pluginId, status: statusText }), 'success');
        loadPlugins();
      } else {
        showToast(t('plugin.toggleFailed', 'Failed to toggle plugin: {error}', { error: json.message }), 'error');
      }
    } catch (err) {
      console.error(err);
      showToast(t('plugin.toggleError', 'Failed to change plugin status'), 'error');
    }
  };

  const getSourceTagMeta = (source?: string) => {
    switch (source) {
      case 'builtin':
        return { label: t('plugin.sourceBuiltin', 'Builtin'), bg: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa' };
      case 'launch':
        return { label: t('plugin.sourceLaunch', 'Packaged'), bg: 'rgba(168, 85, 247, 0.15)', color: '#c084fc' };
      case 'npm':
        return { label: 'NPM', bg: 'rgba(245, 158, 11, 0.15)', color: '#fbbf24' };
      case 'runtime':
      default:
        return { label: t('plugin.sourceCustom', 'Custom'), bg: 'rgba(16, 185, 129, 0.15)', color: '#34d399' };
    }
  };

  return (
    <div className="plugins-list">
      {plugins.map((plugin) => {
        const displayName = plugin.name || plugin.id;
        const displayDesc = plugin.description || t('plugin.noDesc', 'No description provided');
        const shouldShowIdTag = displayName !== plugin.id;
        const tagMeta = getSourceTagMeta(plugin.source);

        return (
          <div key={plugin.id} className="plugin-card">
            <div>
              <div className="plugin-title">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                  <span>{displayName}</span>
                  {plugin.source && (
                    <span
                      style={{
                        fontSize: '0.68rem',
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
                {shouldShowIdTag && (
                  <span className="plugin-id-tag">
                    ({plugin.id})
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
