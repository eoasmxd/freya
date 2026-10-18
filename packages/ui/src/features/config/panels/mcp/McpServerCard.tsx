import React, { useState } from 'react';
import { useI18n } from '../../../../i18n/index.js';
import type { McpServerState, McpServerStatusItem } from './types.js';

interface McpServerCardProps {
  server: McpServerStatusItem;
  onToggle: (serverId: string, enabled: boolean) => void;
  onRetry: (serverId: string) => void;
  onOpenAuth: (serverId: string) => void;
  onEdit: (server: McpServerStatusItem) => void;
  onDelete: (serverId: string) => void;
}

/**
 * MCP 服务卡片组件
 * Card component for displaying a single MCP remote service with state badges and inline tools expansion
 */
export const McpServerCard: React.FC<McpServerCardProps> = ({
  server,
  onToggle,
  onRetry,
  onOpenAuth,
  onEdit,
  onDelete
}) => {
  const { t } = useI18n();
  const [isToolsExpanded, setIsToolsExpanded] = useState(false);
  const [filterKeyword, setFilterKeyword] = useState('');
  const [expandedSchemaTool, setExpandedSchemaTool] = useState<string | null>(null);

  const getStatusBadgeMeta = (status: McpServerState) => {
    switch (status) {
      case 'ready':
        return {
          label: t('mcp.statusReady', 'Ready'),
          bg: 'rgba(16, 185, 129, 0.15)',
          color: '#34d399',
          border: 'rgba(16, 185, 129, 0.3)'
        };
      case 'connecting':
        return {
          label: t('mcp.statusConnecting', 'Connecting'),
          bg: 'rgba(59, 130, 246, 0.15)',
          color: '#60a5fa',
          border: 'rgba(59, 130, 246, 0.3)'
        };
      case 'auth_required':
        return {
          label: t('mcp.statusAuthRequired', 'Auth Required'),
          bg: 'rgba(245, 158, 11, 0.15)',
          color: '#fbbf24',
          border: 'rgba(245, 158, 11, 0.3)'
        };
      case 'error':
        return {
          label: t('mcp.statusError', 'Error'),
          bg: 'rgba(239, 68, 68, 0.15)',
          color: '#f87171',
          border: 'rgba(239, 68, 68, 0.3)'
        };
      case 'disabled':
      default:
        return {
          label: t('mcp.statusDisabled', 'Disabled'),
          bg: 'rgba(156, 163, 175, 0.15)',
          color: '#9ca3af',
          border: 'rgba(156, 163, 175, 0.2)'
        };
    }
  };

  const badgeMeta = getStatusBadgeMeta(server.status);
  const config = server.config || (server as any);
  const serverInfo = server.serverInfo;
  const iconUrl = serverInfo?.icons?.[0]?.src;
  const displayTitle = serverInfo?.title || serverInfo?.name || server.id;
  const displayDesc = server.description || config?.description || t('mcp.noDescription', 'No description provided');

  const filteredTools = (server.tools || []).filter(tool => {
    if (!filterKeyword.trim()) return true;
    const kw = filterKeyword.toLowerCase();
    const name = (tool.name || '').toLowerCase();
    const orig = (tool.originalName || '').toLowerCase();
    const desc = (tool.description || '').toLowerCase();
    return name.includes(kw) || orig.includes(kw) || desc.includes(kw);
  });

  return (
    <div className={`mcp-server-card ${server.enabled ? 'is-enabled' : 'is-disabled'}`}>
      <div className="mcp-server-card-header">
        <div className="mcp-server-header-left">
          <div className="mcp-server-title-row">
            {iconUrl && (
              <img
                src={iconUrl}
                alt={displayTitle}
                className="mcp-server-logo"
                onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }}
              />
            )}
            <span className="mcp-server-name">{displayTitle}</span>
            {displayTitle !== server.id && (
              <span className="mcp-server-id-tag" title={server.id}>#{server.id}</span>
            )}
            {serverInfo?.version && (
              <span className="mcp-server-version-tag">v{serverInfo.version}</span>
            )}
            <span
              className="mcp-status-badge"
              style={{
                background: badgeMeta.bg,
                color: badgeMeta.color,
                border: `1px solid ${badgeMeta.border}`
              }}
            >
              {badgeMeta.label}
            </span>
          </div>
          <span className="mcp-server-url" title={config?.url}>
            {config?.url}
          </span>
        </div>

        <div className="mcp-server-header-actions">
          <label className="switch" title={server.enabled ? t('mcp.disabled', 'disabled') : t('mcp.enabled', 'enabled')}>
            <input
              type="checkbox"
              checked={server.enabled}
              onChange={(e) => onToggle(server.id, e.target.checked)}
            />
            <span className="slider" />
          </label>
        </div>
      </div>

      <div className="mcp-server-card-body">
        <p className="mcp-server-desc">{displayDesc}</p>

        {server.lastError && server.status === 'error' && (
          <div className="mcp-error-notice">
            <span className="mcp-error-icon">⚠️</span>
            <span className="mcp-error-text">{server.lastError}</span>
          </div>
        )}
      </div>

      <div className="mcp-server-card-footer">
        <div className="mcp-footer-left">
          {server.enabled && server.status === 'ready' && (
            <button
              type="button"
              className={`btn-plugin-config ${isToolsExpanded ? 'active' : ''}`}
              onClick={() => setIsToolsExpanded(!isToolsExpanded)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '4px' }}>
                <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path>
              </svg>
              {isToolsExpanded
                ? t('mcp.foldTools', '▲ Fold Tools List')
                : t('mcp.toolsCount', '{count} tools available', { count: server.toolCount })
              }
            </button>
          )}

          {server.status === 'auth_required' && (
            <button
              type="button"
              className="btn-primary"
              style={{ padding: '0.35rem 0.85rem', fontSize: '0.8rem', background: '#f59e0b', color: '#111827' }}
              onClick={() => onOpenAuth(server.id)}
            >
              🔑 {t('mcp.btnAuth', 'Authenticate')}
            </button>
          )}

          {server.status === 'error' && server.enabled && (
            <button
              type="button"
              className="btn-secondary"
              style={{ padding: '0.35rem 0.85rem', fontSize: '0.8rem' }}
              onClick={() => onRetry(server.id)}
            >
              🔄 {t('mcp.btnRetry', 'Retry')}
            </button>
          )}
        </div>

        <div className="mcp-footer-right">
          <button
            type="button"
            className="btn-plugin-config"
            onClick={() => onEdit(server)}
            title={t('common.edit', 'Edit')}
          >
            {t('common.edit', 'Edit')}
          </button>
          <button
            type="button"
            className="btn-plugin-config mcp-btn-delete"
            onClick={() => onDelete(server.id)}
            title={t('common.delete', 'Delete')}
          >
            {t('common.delete', 'Delete')}
          </button>
        </div>
      </div>

      {isToolsExpanded && server.status === 'ready' && (
        <div className="mcp-card-tools-container">
          <div className="mcp-card-tools-search">
            <input
              type="text"
              className="config-input"
              style={{ width: '100%', fontSize: '0.82rem', padding: '0.45rem 0.75rem' }}
              placeholder={t('common.search', 'Search tools by name or description...')}
              value={filterKeyword}
              onChange={(e) => setFilterKeyword(e.target.value)}
            />
          </div>

          <div className="mcp-card-tools-list">
            {(!server.tools || server.tools.length === 0) ? (
              <div className="mcp-drawer-empty" style={{ padding: '1.5rem 1rem' }}>
                {t('mcp.toolsDrawerEmpty', 'No tools mounted for this server.')}
              </div>
            ) : filteredTools.length === 0 ? (
              <div className="mcp-drawer-empty" style={{ padding: '1.5rem 1rem' }}>
                {t('common.noResults', 'No matching tools found.')}
              </div>
            ) : (
              filteredTools.map((tool) => {
                const isSchemaOpen = expandedSchemaTool === tool.name;
                return (
                  <div key={tool.name} className="mcp-tool-card">
                    <div className="mcp-tool-header">
                      <div className="mcp-tool-names">
                        <span className="mcp-tool-name">{tool.name}</span>
                        {tool.originalName && tool.originalName !== tool.name && (
                          <span className="mcp-tool-original" title="Original remote tool name">
                            ({tool.originalName})
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        className="btn-plugin-config"
                        style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                        onClick={() => setExpandedSchemaTool(isSchemaOpen ? null : tool.name)}
                      >
                        {isSchemaOpen ? t('chat.fold', '▲ Fold') : t('chat.expand', '▼ Expand')} Schema
                      </button>
                    </div>

                    <div className="mcp-tool-desc">
                      {tool.description || t('skill.noDesc', 'No description provided')}
                    </div>

                    {isSchemaOpen && (
                      <div className="mcp-tool-schema">
                        <pre className="mcp-schema-code">
                          {JSON.stringify(tool.parameters, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};

