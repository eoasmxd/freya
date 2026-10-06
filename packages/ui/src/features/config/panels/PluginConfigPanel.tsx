import React, { useEffect, useState } from 'react';
import { useI18n } from '../../../i18n/index.js';

interface PluginEntry {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  source?: 'builtin' | 'launch' | 'runtime' | 'npm';
}

interface ConfigFieldSchema {
  key: string;
  defaultValue: any;
  description?: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'sha256' | string;
  category?: string;
  required?: boolean;
  sensitive?: boolean;
  readonly?: boolean;
  uiHint?: string;
  min?: number;
  max?: number;
  enumValues?: (string | { value: string; label?: string })[];
  children?: ConfigFieldSchema[];
}

interface PluginConfigPanelProps {
  getApiUrl: (path: string) => string;
}

export const PluginConfigPanel: React.FC<PluginConfigPanelProps> = ({ getApiUrl }) => {
  const { t } = useI18n();
  const [plugins, setPlugins] = useState<PluginEntry[]>([]);
  const [schemas, setSchemas] = useState<Record<string, ConfigFieldSchema[]>>({});
  const [configValues, setConfigValues] = useState<Record<string, any>>({});
  const [dirtyValues, setDirtyValues] = useState<Record<string, Record<string, any>>>({});
  const [expandedPluginId, setExpandedPluginId] = useState<string | null>(null);
  const [savingPluginId, setSavingPluginId] = useState<string | null>(null);
  const [addingChildKeys, setAddingChildKeys] = useState<Record<string, boolean>>({});
  const [tempChildInputs, setTempChildInputs] = useState<Record<string, Record<string, any>>>({});
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

  const getValueByPath = (obj: any, path: string): any => {
    const keys = path.split('.');
    let current = obj;
    for (const key of keys) {
      if (current === null || current === undefined) return undefined;
      current = current[key];
    }
    return current;
  };

  const loadData = async () => {
    try {
      const [pluginsRes, schemaRes, configRes] = await Promise.all([
        fetch(getApiUrl('/api/config/plugins')),
        fetch(getApiUrl('/api/config/schema')),
        fetch(getApiUrl('/api/config'))
      ]);

      const [pluginsJson, schemaJson, configJson] = await Promise.all([
        pluginsRes.json(),
        schemaRes.json(),
        configRes.json()
      ]);

      if (pluginsJson.success && Array.isArray(pluginsJson.data)) {
        setPlugins(pluginsJson.data);
      }
      if (schemaJson.success && schemaJson.data) {
        setSchemas(schemaJson.data);
      }
      if (configJson.success && configJson.data) {
        setConfigValues(configJson.data);
      }
    } catch (err) {
      console.error('Failed to load plugin config data:', err);
    }
  };

  useEffect(() => {
    loadData();
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
        loadData();
      } else {
        showToast(t('plugin.toggleFailed', 'Failed to toggle plugin: {error}', { error: json.message }), 'error');
      }
    } catch (err) {
      console.error(err);
      showToast(t('plugin.toggleError', 'Failed to change plugin status'), 'error');
    }
  };

  const toggleExpand = (pluginId: string) => {
    setExpandedPluginId(prev => (prev === pluginId ? null : pluginId));
  };

  const getFieldValue = (pluginId: string, field: ConfigFieldSchema): any => {
    const dirty = dirtyValues[pluginId]?.[field.key];
    if (dirty !== undefined) return dirty;
    const current = getValueByPath(configValues, field.key);
    return current !== undefined ? current : field.defaultValue;
  };

  const handleFieldChange = (pluginId: string, fieldKey: string, value: any) => {
    setDirtyValues(prev => ({
      ...prev,
      [pluginId]: {
        ...(prev[pluginId] || {}),
        [fieldKey]: value
      }
    }));
  };

  const savePluginConfig = async (pluginId: string) => {
    const updates = dirtyValues[pluginId];
    if (!updates || Object.keys(updates).length === 0) {
      showToast(t('plugin.noChanges', 'No configuration changes to save'), 'info');
      return;
    }

    setSavingPluginId(pluginId);
    try {
      const res = await fetch(getApiUrl('/api/config/batch'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates })
      });
      const json = await res.json();
      if (json.success) {
        showToast(t('plugin.configSaveSuccess', 'Plugin configuration saved successfully'), 'success');
        const configRes = await fetch(getApiUrl('/api/config'));
        const configJson = await configRes.json();
        if (configJson.success && configJson.data) {
          setConfigValues(configJson.data);
        }
        setDirtyValues(prev => {
          const next = { ...prev };
          delete next[pluginId];
          return next;
        });
      } else {
        showToast(t('plugin.configSaveFailed', 'Failed to save plugin configuration: {error}', { error: json.message || json.error }), 'error');
      }
    } catch (err: any) {
      showToast(t('plugin.configSaveFailed', 'Failed to save plugin configuration: {error}', { error: err.message }), 'error');
    } finally {
      setSavingPluginId(null);
    }
  };

  const resetPluginConfig = (pluginId: string) => {
    setDirtyValues(prev => {
      const next = { ...prev };
      delete next[pluginId];
      return next;
    });
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

  const renderField = (pluginId: string, field: ConfigFieldSchema, isPluginEnabled: boolean) => {
    const isFieldDisabled = !isPluginEnabled || field.readonly;
    const currentValue = getFieldValue(pluginId, field);

    if (field.type === 'array' && Array.isArray(field.children) && field.children.length > 0) {
      const itemsList = Array.isArray(currentValue) ? currentValue : [];
      const childKeyPrefix = `${pluginId}:::${field.key}`;
      const isAdding = Boolean(addingChildKeys[childKeyPrefix]);
      const inputs = tempChildInputs[childKeyPrefix] || {};

      return (
        <div key={field.key} className="config-group" style={{ margin: '0.4rem 0' }}>
          <div className="crud-form-card" style={{ margin: 0, padding: '0.8rem', gap: '0.6rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label className="config-label" style={{ fontSize: '0.82rem', margin: 0 }}>
                {field.description || field.key}
                {field.readonly && <span title={t('global.fieldReadonlyHint', 'Current item is locked as read-only')} style={{ fontSize: '11px', cursor: 'help' }}>🔒</span>}
              </label>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                {t('global.configuredItemsCount', '{count} items configured', { count: itemsList.length })}
              </span>
            </div>

            <div className="models-list config-children-list">
              {itemsList.map((item: any, idx: number) => (
                <div key={idx} className="model-item" style={{ padding: '0.5rem 0.8rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', gap: '0.8rem', flexWrap: 'wrap', fontSize: '0.78rem' }}>
                    {field.children?.map(c => {
                      const isSensitive = c.sensitive || c.uiHint === 'password';
                      const v = item[c.key];
                      return (
                        <span key={c.key}>
                          <span style={{ color: 'var(--text-secondary)', marginRight: '0.3rem' }}>{c.description || c.key}:</span>
                          <span style={{ fontFamily: 'monospace' }}>{isSensitive ? '******' : String(v ?? '-')}</span>
                        </span>
                      );
                    })}
                  </div>
                  {!isFieldDisabled && (
                    <button
                      className="btn-action delete"
                      style={{ padding: '0.2rem 0.5rem', fontSize: '0.72rem' }}
                      onClick={() => {
                        const nextList = itemsList.filter((_: any, i: number) => i !== idx);
                        handleFieldChange(pluginId, field.key, nextList);
                      }}
                    >
                      {t('common.delete', 'Delete')}
                    </button>
                  )}
                </div>
              ))}
            </div>

            {isAdding && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', background: 'rgba(255,255,255,0.02)', padding: '0.6rem', borderRadius: '6px' }}>
                {field.children.map(c => (
                  <div key={c.key} style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                    <label style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{c.description || c.key}</label>
                    <input
                      type={c.sensitive || c.uiHint === 'password' ? 'password' : c.type === 'number' ? 'number' : 'text'}
                      className="config-input"
                      style={{ height: '28px', fontSize: '0.75rem' }}
                      value={inputs[c.key] ?? ''}
                      onChange={(e) => setTempChildInputs(prev => ({
                        ...prev,
                        [childKeyPrefix]: { ...(prev[childKeyPrefix] || {}), [c.key]: e.target.value }
                      }))}
                    />
                  </div>
                ))}
                <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.2rem' }}>
                  <button
                    className="btn-primary"
                    style={{ height: '28px', padding: '0 0.8rem', fontSize: '0.74rem' }}
                    onClick={() => {
                      const newItem = { ...inputs };
                      handleFieldChange(pluginId, field.key, [...itemsList, newItem]);
                      setAddingChildKeys(prev => ({ ...prev, [childKeyPrefix]: false }));
                      setTempChildInputs(prev => ({ ...prev, [childKeyPrefix]: {} }));
                    }}
                  >
                    {t('common.confirm', 'Confirm')}
                  </button>
                  <button
                    className="btn-secondary"
                    style={{ height: '28px', padding: '0 0.8rem', fontSize: '0.74rem' }}
                    onClick={() => {
                      setAddingChildKeys(prev => ({ ...prev, [childKeyPrefix]: false }));
                      setTempChildInputs(prev => ({ ...prev, [childKeyPrefix]: {} }));
                    }}
                  >
                    {t('common.cancel', 'Cancel')}
                  </button>
                </div>
              </div>
            )}

            {!isFieldDisabled && !isAdding && (
              <div>
                <button
                  type="button"
                  className="btn-action"
                  style={{ fontSize: '0.74rem', padding: '0.3rem 0.6rem' }}
                  onClick={() => setAddingChildKeys(prev => ({ ...prev, [childKeyPrefix]: true }))}
                >
                  + {t('global.btnAddItem', 'Add Item')}
                </button>
              </div>
            )}
          </div>
        </div>
      );
    }

    const isBoolean = field.type === 'boolean';
    const displayLabel = field.description || field.key;

    return (
      <div key={field.key} className={`config-field-row ${isBoolean ? 'is-boolean' : 'is-input'}`} style={{ padding: '0.4rem 0' }}>
        <label className="config-label" style={{ fontSize: '0.82rem', margin: 0, opacity: isFieldDisabled ? 0.6 : 1 }}>
          {displayLabel}
          {field.readonly && <span title={t('global.fieldReadonlyHint', 'Current item is locked as read-only')} style={{ fontSize: '11px', cursor: 'help' }}>🔒</span>}
        </label>

        {isBoolean ? (
          <label className="switch" style={{ margin: 0, opacity: isFieldDisabled ? 0.5 : 1, cursor: isFieldDisabled ? 'not-allowed' : 'pointer' }}>
            <input
              type="checkbox"
              disabled={isFieldDisabled}
              checked={Boolean(currentValue)}
              onChange={(e) => handleFieldChange(pluginId, field.key, e.target.checked)}
            />
            <span className="slider" />
          </label>
        ) : field.enumValues && field.enumValues.length > 0 ? (
          <select
            disabled={isFieldDisabled}
            className="config-input config-field-input"
            style={{ opacity: isFieldDisabled ? 0.5 : 1, cursor: isFieldDisabled ? 'not-allowed' : undefined, height: '32px' }}
            value={currentValue ?? field.defaultValue ?? (typeof field.enumValues[0] === 'object' ? field.enumValues[0]?.value : field.enumValues[0])}
            onChange={(e) => handleFieldChange(pluginId, field.key, e.target.value)}
          >
            {field.enumValues.map((opt) => {
              const val = typeof opt === 'object' && opt !== null ? opt.value : opt;
              const label = typeof opt === 'object' && opt !== null && opt.label ? opt.label : val;
              return (
                <option key={val} value={val}>{label}</option>
              );
            })}
          </select>
        ) : field.type === 'number' ? (
          <input
            type="number"
            disabled={isFieldDisabled}
            className="config-input config-field-input"
            style={{ opacity: isFieldDisabled ? 0.5 : 1, cursor: isFieldDisabled ? 'not-allowed' : undefined, height: '32px' }}
            value={currentValue ?? ''}
            onChange={(e) => handleFieldChange(pluginId, field.key, Number(e.target.value))}
          />
        ) : (
          <input
            type={field.type === 'sha256' || field.uiHint === 'password' || field.sensitive ? 'password' : 'text'}
            disabled={isFieldDisabled}
            className="config-input config-field-input"
            style={{ opacity: isFieldDisabled ? 0.5 : 1, cursor: isFieldDisabled ? 'not-allowed' : undefined, height: '32px' }}
            value={typeof currentValue === 'object' ? JSON.stringify(currentValue) : (currentValue ?? '')}
            onChange={(e) => {
              let val: any = e.target.value;
              if (field.type === 'array') {
                try {
                  val = JSON.parse(e.target.value);
                } catch {
                  val = e.target.value;
                }
              }
              handleFieldChange(pluginId, field.key, val);
            }}
          />
        )}
      </div>
    );
  };

  return (
    <div className="plugins-list">
      {plugins.map((plugin) => {
        const displayName = plugin.name || plugin.id;
        const displayDesc = plugin.description || t('plugin.noDesc', 'No description provided');
        const shouldShowIdTag = displayName !== plugin.id;
        const tagMeta = getSourceTagMeta(plugin.source);
        const pluginFields = schemas[plugin.id] || [];
        const hasSchema = pluginFields.length > 0;
        const isExpanded = expandedPluginId === plugin.id;
        const isDirty = Boolean(dirtyValues[plugin.id] && Object.keys(dirtyValues[plugin.id]).length > 0);

        return (
          <div key={plugin.id} className={`plugin-card ${isExpanded ? 'is-expanded' : ''}`}>
            <div className="plugin-card-main">
              <div className="plugin-card-info">
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

              <div className="plugin-card-actions">
                {hasSchema && (
                  <button
                    type="button"
                    className={`btn-plugin-config ${isExpanded ? 'active' : ''}`}
                    onClick={() => toggleExpand(plugin.id)}
                    title={isExpanded ? t('chat.fold', 'Fold') : t('plugin.config', 'Configure')}
                  >
                    <span>⚙️</span>
                    <span className="btn-plugin-config-text">{t('plugin.config', 'Configure')}</span>
                    <span className="chevron-icon">{isExpanded ? '▲' : '▼'}</span>
                  </button>
                )}
                <label className="switch" title={plugin.enabled ? t('plugin.enabled', 'Enabled') : t('plugin.disabled', 'Disabled')}>
                  <input
                    type="checkbox"
                    checked={plugin.enabled}
                    onChange={(e) => togglePlugin(plugin.id, e.target.checked)}
                  />
                  <span className="slider" />
                </label>
              </div>
            </div>

            {hasSchema && isExpanded && (
              <div className="plugin-config-accordion">
                {!plugin.enabled && (
                  <div className="plugin-config-disabled-tip">
                    ℹ️ {t('plugin.disabledTip', 'Plugin is currently disabled; settings will take effect once enabled')}
                  </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                  {pluginFields.map(f => renderField(plugin.id, f, plugin.enabled))}
                </div>

                {plugin.enabled && (
                  <div className="plugin-config-footer">
                    <button
                      className="btn-primary"
                      style={{ height: '32px', padding: '0 1rem', fontSize: '0.78rem' }}
                      disabled={savingPluginId === plugin.id || !isDirty}
                      onClick={() => savePluginConfig(plugin.id)}
                    >
                      {savingPluginId === plugin.id ? '...' : t('plugin.saveConfig', 'Save Settings')}
                    </button>
                    {isDirty && (
                      <button
                        className="btn-secondary"
                        style={{ height: '32px', padding: '0 0.8rem', fontSize: '0.78rem' }}
                        onClick={() => resetPluginConfig(plugin.id)}
                      >
                        {t('common.cancel', 'Cancel')}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
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
