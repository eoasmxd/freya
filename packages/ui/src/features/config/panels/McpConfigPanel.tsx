import React, { useEffect, useState, useCallback } from 'react';
import { useI18n } from '../../../i18n/index.js';
import type { McpServerStatusItem } from './mcp/types.js';
import { McpServerCard } from './mcp/McpServerCard.jsx';
import { McpServerModal } from './mcp/McpServerModal.jsx';
import { McpAuthModal } from './mcp/McpAuthModal.jsx';

interface McpConfigPanelProps {
  getApiUrl: (path: string) => string;
}

/**
 * MCP 远程服务管理主面板
 * Main management panel for MCP remote services and toolboxes
 */
export const McpConfigPanel: React.FC<McpConfigPanelProps> = ({ getApiUrl }) => {
  const { t } = useI18n();
  const [servers, setServers] = useState<McpServerStatusItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const [isServerModalOpen, setIsServerModalOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<McpServerStatusItem | null>(null);

  const [authenticatingServerId, setAuthenticatingServerId] = useState<string | null>(null);

  const [deletingServerId, setDeletingServerId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  const [toasts, setToasts] = useState<{ id: string; message: string; type: 'success' | 'error' | 'info' }[]>([]);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    const id = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID()
      : Math.random().toString(36).substring(2, 15);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(item => item.id !== id));
    }, 3000);
  };

  const loadServers = useCallback(async () => {
    try {
      const res = await fetch(getApiUrl('/api/config/mcp'));
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setServers(json.data);
      } else {
        showToast(t('mcp.loadFailed', 'Failed to load MCP server list'), 'error');
      }
    } catch (err) {
      console.error('Failed to load MCP server list:', err);
      showToast(t('mcp.loadFailed', 'Failed to load MCP server list'), 'error');
    } finally {
      setLoading(false);
    }
  }, [getApiUrl, t]);

  useEffect(() => {
    loadServers();
  }, [loadServers]);

  useEffect(() => {
    const hasConnecting = servers.some(s => s.status === 'connecting');
    if (!hasConnecting) return;

    const timer = setTimeout(() => {
      loadServers();
    }, 2000);

    return () => clearTimeout(timer);
  }, [servers, loadServers]);

  const handleToggle = async (serverId: string, enabled: boolean) => {
    try {
      const res = await fetch(getApiUrl('/api/config/mcp/toggle'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverId, enabled })
      });
      const json = await res.json();
      if (json.success) {
        const statusText = enabled ? t('mcp.enabled', 'enabled') : t('mcp.disabled', 'disabled');
        showToast(t('mcp.toggleSuccess', 'MCP server "{id}" has been {status}', { id: serverId, status: statusText }), 'success');
        loadServers();
      } else {
        showToast(t('mcp.toggleFailed', 'Failed to change server status: {error}', { error: json.message || json.error }), 'error');
      }
    } catch (err) {
      console.error('Failed to toggle MCP server:', err);
      showToast(t('mcp.toggleFailed', 'Failed to change server status'), 'error');
    }
  };

  const handleRetry = async (serverId: string) => {
    try {
      const res = await fetch(getApiUrl('/api/config/mcp/retry'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverId })
      });
      const json = await res.json();
      if (json.success) {
        showToast(t('mcp.retrySuccess', 'Server "{id}" reconnection probe succeeded', { id: serverId }), 'success');
        loadServers();
      } else {
        showToast(t('mcp.retryFailed', 'Reconnection probe failed: {error}', { error: json.message || json.error }), 'error');
      }
    } catch (err) {
      console.error('Failed to retry MCP server connection:', err);
      showToast(t('mcp.retryFailed', 'Reconnection probe failed'), 'error');
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deletingServerId) return;
    try {
      setIsDeleting(true);
      const res = await fetch(getApiUrl(`/api/config/mcp/server/${encodeURIComponent(deletingServerId)}`), {
        method: 'DELETE'
      });
      const json = await res.json();
      if (json.success) {
        showToast(t('mcp.deleteSuccess', 'Deleted MCP server "{id}"', { id: deletingServerId }), 'success');
        setDeletingServerId(null);
        loadServers();
      } else {
        showToast(t('mcp.deleteFailed', 'Failed to delete server: {error}', { error: json.message || json.error }), 'error');
      }
    } catch (err) {
      console.error('Failed to delete MCP server:', err);
      showToast(t('mcp.deleteFailed', 'Failed to delete server'), 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleOpenAddModal = () => {
    setEditingServer(null);
    setIsServerModalOpen(true);
  };

  const handleOpenEditModal = (server: McpServerStatusItem) => {
    setEditingServer(server);
    setIsServerModalOpen(true);
  };

  return (
    <div className="mcp-config-panel">
      <div className="mcp-panel-toolbar">
        <div className="mcp-toolbar-summary">
          {t('mcp.serversCount', 'Configured {count} services', { count: servers.length })}
        </div>
        <button
          type="button"
          className="btn-primary mcp-btn-add"
          onClick={handleOpenAddModal}
        >
          + {t('mcp.addServer', 'Add MCP Server')}
        </button>
      </div>

      {loading && servers.length === 0 ? (
        <div style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
          {t('mcp.loading', 'Loading MCP server configuration...')}
        </div>
      ) : servers.length === 0 ? (
        <div className="mcp-empty-state">
          <div className="mcp-empty-icon">🔌</div>
          <p className="mcp-empty-text">{t('mcp.emptyHint', 'No MCP remote services configured yet.')}</p>
          <button
            type="button"
            className="btn-primary"
            style={{ marginTop: '1rem' }}
            onClick={handleOpenAddModal}
          >
            + {t('mcp.addServer', 'Add MCP Server')}
          </button>
        </div>
      ) : (
        <div className="mcp-servers-grid">
          {servers.map((server) => (
            <McpServerCard
              key={server.id}
              server={server}
              onToggle={handleToggle}
              onRetry={handleRetry}
              onOpenAuth={(id) => setAuthenticatingServerId(id)}
              onEdit={handleOpenEditModal}
              onDelete={(id) => setDeletingServerId(id)}
            />
          ))}
        </div>
      )}

      {isServerModalOpen && (
        <McpServerModal
          initialServer={editingServer}
          getApiUrl={getApiUrl}
          onClose={() => setIsServerModalOpen(false)}
          onSuccess={(id) => {
            setIsServerModalOpen(false);
            showToast(t('mcp.saveSuccess', 'MCP server configuration saved successfully'), 'success');
            loadServers();
          }}
        />
      )}


      {authenticatingServerId && (
        <McpAuthModal
          serverId={authenticatingServerId}
          getApiUrl={getApiUrl}
          onClose={() => setAuthenticatingServerId(null)}
          onSuccess={() => {
            setAuthenticatingServerId(null);
            showToast(t('mcp.retrySuccess', 'Server "{id}" reconnection probe succeeded', { id: authenticatingServerId }), 'success');
            loadServers();
          }}
        />
      )}

      {deletingServerId && (
        <div className="confirm-modal-overlay" onClick={() => setDeletingServerId(null)}>
          <div className="confirm-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-modal-title">
              <span>{t('common.delete', 'Delete')} MCP {t('common.service', 'Service')}</span>
            </div>
            <p className="confirm-modal-desc">
              {t('mcp.deleteConfirm', 'Are you sure you want to delete MCP server "{id}"?', { id: deletingServerId })}
            </p>
            <div className="confirm-modal-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setDeletingServerId(null)}
                disabled={isDeleting}
              >
                {t('common.cancel', 'Cancel')}
              </button>
              <button
                type="button"
                className="btn-primary"
                style={{ background: '#ef4444', color: '#ffffff' }}
                onClick={handleDeleteConfirm}
                disabled={isDeleting}
              >
                {isDeleting ? '...' : t('common.delete', 'Delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {toasts.length > 0 && (
        <div className="toast-container">
          {toasts.map(toast => (
            <div key={toast.id} className={`toast-card ${toast.type}`}>
              <span>{toast.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
