import React, { useState } from 'react';
import { useI18n } from '../../../../i18n/index.js';
import type { McpServerConfig, McpServerStatusItem } from './types.js';

interface McpServerModalProps {
  initialServer?: McpServerStatusItem | null;
  getApiUrl: (path: string) => string;
  onClose: () => void;
  onSuccess: (serverId: string) => void;
}

interface HeaderRow {
  key: string;
  value: string;
}

/**
 * MCP 服务新增 / 编辑模态表单
 * Modal dialog for creating or updating MCP remote service configurations
 */
export const McpServerModal: React.FC<McpServerModalProps> = ({
  initialServer,
  getApiUrl,
  onClose,
  onSuccess
}) => {
  const { t } = useI18n();
  const isEditing = !!initialServer;

  const [serverId, setServerId] = useState(initialServer?.id || '');
  const [url, setUrl] = useState(initialServer?.config?.url || '');
  const [description, setDescription] = useState(initialServer?.config?.description || '');

  const initialAuthType = initialServer?.config?.oauth
    ? 'oauth'
    : (initialServer?.config?.headers && Object.keys(initialServer.config.headers).length > 0)
    ? 'headers'
    : 'none';
  const [authType, setAuthType] = useState<'none' | 'headers' | 'oauth'>(initialAuthType);

  const initialHeaders: HeaderRow[] = initialServer?.config?.headers
    ? Object.entries(initialServer.config.headers).map(([k, v]) => ({ key: k, value: String(v) }))
    : [];
  const [headers, setHeaders] = useState<HeaderRow[]>(initialHeaders);

  const [oauthClientId, setOauthClientId] = useState(initialServer?.config?.oauth?.clientId || '');
  const [oauthClientSecret, setOauthClientSecret] = useState(initialServer?.config?.oauth?.clientSecret || '');
  const [oauthAuthUrl, setOauthAuthUrl] = useState(initialServer?.config?.oauth?.authUrl || '');
  const [oauthTokenUrl, setOauthTokenUrl] = useState(initialServer?.config?.oauth?.tokenUrl || '');
  const [oauthDeviceUrl, setOauthDeviceUrl] = useState(initialServer?.config?.oauth?.deviceUrl || '');
  const [oauthScopes, setOauthScopes] = useState(initialServer?.config?.oauth?.scopes?.join(' ') || '');

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [filterInclude, setFilterInclude] = useState(initialServer?.config?.toolFilter?.include?.join(', ') || '');
  const [filterExclude, setFilterExclude] = useState(initialServer?.config?.toolFilter?.exclude?.join(', ') || '');
  const [timeoutMs, setTimeoutMs] = useState(initialServer?.config?.timeoutMs ? String(initialServer.config.timeoutMs) : '');
  const [idleTimeoutMs, setIdleTimeoutMs] = useState(initialServer?.config?.idleTimeoutMs ? String(initialServer.config.idleTimeoutMs) : '');

  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleAddHeader = () => {
    setHeaders(prev => [...prev, { key: '', value: '' }]);
  };

  const handleRemoveHeader = (index: number) => {
    setHeaders(prev => prev.filter((_, idx) => idx !== index));
  };

  const handleHeaderChange = (index: number, field: 'key' | 'value', val: string) => {
    setHeaders(prev => prev.map((item, idx) => idx === index ? { ...item, [field]: val } : item));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    const trimmedId = serverId.trim();
    const trimmedUrl = url.trim();

    if (!trimmedId) {
      setErrorMsg(t('global.requiredField', 'Please fill in required field: {field}', { field: t('mcp.fieldServerId', 'Server ID') }));
      return;
    }

    if (!/^[a-z0-9_]+$/.test(trimmedId)) {
      setErrorMsg(t('mcp.fieldServerIdHint', 'Unique identifier, lowercase letters, numbers, or underscores (e.g. github)'));
      return;
    }

    if (!trimmedUrl) {
      setErrorMsg(t('global.requiredField', 'Please fill in required field: {field}', { field: t('mcp.fieldUrl', 'Endpoint URL') }));
      return;
    }

    const config: McpServerConfig = {
      url: trimmedUrl,
      description: description.trim() || undefined
    };

    if (authType === 'headers') {
      const headerMap: Record<string, string> = {};
      for (const h of headers) {
        if (h.key.trim()) {
          headerMap[h.key.trim()] = h.value;
        }
      }
      if (Object.keys(headerMap).length > 0) {
        config.headers = headerMap;
      }
    } else if (authType === 'oauth') {
      if (!oauthClientId.trim() || !oauthAuthUrl.trim() || !oauthTokenUrl.trim()) {
        setErrorMsg('Please complete required OAuth fields (Client ID, Auth URL, Token URL)');
        return;
      }
      config.oauth = {
        clientId: oauthClientId.trim(),
        clientSecret: oauthClientSecret.trim() || undefined,
        authUrl: oauthAuthUrl.trim(),
        tokenUrl: oauthTokenUrl.trim(),
        deviceUrl: oauthDeviceUrl.trim() || undefined,
        scopes: oauthScopes.split(/[,\s]+/).map(s => s.trim()).filter(Boolean)
      };
    }

    const includes = filterInclude.split(',').map(s => s.trim()).filter(Boolean);
    const excludes = filterExclude.split(',').map(s => s.trim()).filter(Boolean);
    if (includes.length > 0 || excludes.length > 0) {
      config.toolFilter = {
        include: includes.length > 0 ? includes : undefined,
        exclude: excludes.length > 0 ? excludes : undefined
      };
    }

    if (timeoutMs.trim() && !isNaN(Number(timeoutMs))) {
      config.timeoutMs = Number(timeoutMs);
    }
    if (idleTimeoutMs.trim() && !isNaN(Number(idleTimeoutMs))) {
      config.idleTimeoutMs = Number(idleTimeoutMs);
    }

    try {
      setSaving(true);
      const apiPath = isEditing ? `/api/config/mcp/server/${encodeURIComponent(trimmedId)}` : '/api/config/mcp/server';
      const method = isEditing ? 'PUT' : 'POST';
      const payload = isEditing ? { config } : { id: trimmedId, config };

      const res = await fetch(getApiUrl(apiPath), {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        onSuccess(trimmedId);
      } else {
        setErrorMsg(data.message || data.error || 'Failed to save MCP server');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Network request failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="confirm-modal-overlay" onClick={onClose}>
      <div
        className="confirm-modal-card mcp-server-form-card"
        onClick={(e) => e.stopPropagation()}
        style={{ width: '640px', maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto' }}
      >
        <div className="confirm-modal-title" style={{ justifyContent: 'space-between' }}>
          <span>{isEditing ? t('mcp.editServer', 'Edit Server Config') : t('mcp.addServer', 'Add MCP Server')}</span>
          <button className="modal-close" onClick={onClose} type="button" title={t('common.close', 'Close')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        {errorMsg && (
          <div style={{ margin: '0.8rem 0', padding: '0.65rem 0.85rem', borderRadius: '8px', background: 'rgba(239, 68, 68, 0.1)', color: '#f87171', fontSize: '0.85rem' }}>
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '0.8rem' }}>
          <div className="config-group">
            <label className="config-label">
              {t('mcp.fieldServerId', 'Server ID')} <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input
              type="text"
              className="config-input"
              value={serverId}
              disabled={isEditing}
              placeholder="e.g. github, filesystem, postgres"
              onChange={(e) => setServerId(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
            />
            <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
              {t('mcp.fieldServerIdHint', 'Unique identifier, lowercase letters, numbers, or underscores (e.g. github)')}
            </span>
          </div>

          <div className="config-group">
            <label className="config-label">
              {t('mcp.fieldUrl', 'Endpoint URL')} <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <input
              type="url"
              className="config-input"
              value={url}
              placeholder="https://api.example.com/mcp"
              onChange={(e) => setUrl(e.target.value)}
            />
            <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
              {t('mcp.fieldUrlHint', 'Standard MCP Streamable HTTP endpoint (e.g. https://mcp.example.com)')}
            </span>
          </div>

          <div className="config-group">
            <label className="config-label">{t('mcp.fieldDescription', 'Description')}</label>
            <input
              type="text"
              className="config-input"
              value={description}
              placeholder={t('mcp.fieldDescriptionPlaceholder', 'Optional. If left blank, AI summary will be automatically generated upon connection')}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="config-group">
            <label className="config-label">{t('mcp.fieldAuthType', 'Auth Type')}</label>
            <div style={{ display: 'flex', gap: '1rem', marginTop: '0.2rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="authType"
                  value="none"
                  checked={authType === 'none'}
                  onChange={() => setAuthType('none')}
                />
                {t('mcp.authNone', 'None')}
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="authType"
                  value="headers"
                  checked={authType === 'headers'}
                  onChange={() => setAuthType('headers')}
                />
                {t('mcp.authHeaders', 'Custom Headers')}
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="authType"
                  value="oauth"
                  checked={authType === 'oauth'}
                  onChange={() => setAuthType('oauth')}
                />
                {t('mcp.authOAuth', 'OAuth 2.1 (OAuth / Device Flow)')}
              </label>
            </div>
          </div>

          {authType === 'headers' && (
            <div className="mcp-section-box">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>{t('mcp.authHeaders', 'Custom Headers')}</span>
                <button type="button" className="btn-secondary" onClick={handleAddHeader} style={{ padding: '0.25rem 0.6rem', fontSize: '0.78rem' }}>
                  {t('mcp.addHeader', '+ Add Header')}
                </button>
              </div>
              {headers.length === 0 ? (
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  {t('global.emptyChildList', 'List is empty. Click "+ Add Header" to create one.')}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {headers.map((row, idx) => (
                    <div key={idx} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <input
                        type="text"
                        className="config-input"
                        style={{ flex: 1 }}
                        placeholder={t('mcp.headerKey', 'Header Key')}
                        value={row.key}
                        onChange={(e) => handleHeaderChange(idx, 'key', e.target.value)}
                      />
                      <input
                        type="text"
                        className="config-input"
                        style={{ flex: 2 }}
                        placeholder={t('mcp.headerValue', 'Header Value')}
                        value={row.value}
                        onChange={(e) => handleHeaderChange(idx, 'value', e.target.value)}
                      />
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => handleRemoveHeader(idx)}
                        style={{ padding: '0.4rem 0.6rem', color: '#f87171' }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {authType === 'oauth' && (
            <div className="mcp-section-box" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div className="config-group">
                <label className="config-label">{t('mcp.oauthClientId', 'Client ID')} *</label>
                <input
                  type="text"
                  className="config-input"
                  value={oauthClientId}
                  onChange={(e) => setOauthClientId(e.target.value)}
                />
              </div>
              <div className="config-group">
                <label className="config-label">{t('mcp.oauthClientSecret', 'Client Secret (Optional)')}</label>
                <input
                  type="password"
                  className="config-input"
                  value={oauthClientSecret}
                  onChange={(e) => setOauthClientSecret(e.target.value)}
                />
              </div>
              <div className="config-group">
                <label className="config-label">{t('mcp.oauthAuthUrl', 'Authorization URL')} *</label>
                <input
                  type="url"
                  className="config-input"
                  value={oauthAuthUrl}
                  placeholder="https://oauth.example.com/authorize"
                  onChange={(e) => setOauthAuthUrl(e.target.value)}
                />
              </div>
              <div className="config-group">
                <label className="config-label">{t('mcp.oauthTokenUrl', 'Token URL')} *</label>
                <input
                  type="url"
                  className="config-input"
                  value={oauthTokenUrl}
                  placeholder="https://oauth.example.com/token"
                  onChange={(e) => setOauthTokenUrl(e.target.value)}
                />
              </div>
              <div className="config-group">
                <label className="config-label">{t('mcp.oauthDeviceUrl', 'Device Auth URL (Optional)')}</label>
                <input
                  type="url"
                  className="config-input"
                  value={oauthDeviceUrl}
                  placeholder="https://oauth.example.com/device/code"
                  onChange={(e) => setOauthDeviceUrl(e.target.value)}
                />
              </div>
              <div className="config-group">
                <label className="config-label">{t('mcp.oauthScopes', 'Scopes (space or comma separated)')}</label>
                <input
                  type="text"
                  className="config-input"
                  value={oauthScopes}
                  placeholder="repo read:user"
                  onChange={(e) => setOauthScopes(e.target.value)}
                />
              </div>
            </div>
          )}

          <div>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setShowAdvanced(!showAdvanced)}
              style={{ fontSize: '0.8rem', padding: '0.35rem 0.8rem' }}
            >
              {showAdvanced ? '▲ ' : '▼ '}{t('mcp.advancedOptions', 'Advanced Options / Filter Rules')}
            </button>
          </div>

          {showAdvanced && (
            <div className="mcp-section-box" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div className="config-group">
                <label className="config-label">{t('mcp.filterInclude', 'Tool Include Whitelist')}</label>
                <input
                  type="text"
                  className="config-input"
                  placeholder="e.g. read_*, get_*"
                  value={filterInclude}
                  onChange={(e) => setFilterInclude(e.target.value)}
                />
              </div>
              <div className="config-group">
                <label className="config-label">{t('mcp.filterExclude', 'Tool Exclude Blacklist')}</label>
                <input
                  type="text"
                  className="config-input"
                  placeholder="e.g. delete_*, drop_*"
                  value={filterExclude}
                  onChange={(e) => setFilterExclude(e.target.value)}
                />
              </div>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <div className="config-group" style={{ flex: 1 }}>
                  <label className="config-label">{t('mcp.timeoutMs', 'Request Timeout (ms)')}</label>
                  <input
                    type="number"
                    className="config-input"
                    placeholder="30000"
                    value={timeoutMs}
                    onChange={(e) => setTimeoutMs(e.target.value)}
                  />
                </div>
                <div className="config-group" style={{ flex: 1 }}>
                  <label className="config-label">{t('mcp.idleTimeoutMs', 'Idle Connection Release Timeout (ms)')}</label>
                  <input
                    type="number"
                    className="config-input"
                    placeholder="300000"
                    value={idleTimeoutMs}
                    onChange={(e) => setIdleTimeoutMs(e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}

          <div className="confirm-modal-actions" style={{ marginTop: '1rem' }}>
            <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
              {t('common.cancel', 'Cancel')}
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? '...' : t('common.save', 'Save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
