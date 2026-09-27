import React, { useEffect, useState } from 'react';
import { useI18n } from '../../../i18n';

interface Model {
  id: string;
  name: string;
  inputPrice: number;
  outputPrice: number;
  cachedInputPrice: number;
  contextWindow: number;
  contextTokens?: number | null;
  maxTokens?: number | null;
  capabilities: string[];
}

interface Provider {
  id: string;
  name: string;
  type: string;
  baseURL: string;
  apiKey: string;
  models?: Model[];
}

interface ProviderConfigPanelProps {
  getApiUrl: (path: string) => string;
}

export const ProviderConfigPanel: React.FC<ProviderConfigPanelProps> = ({ getApiUrl }) => {
  const { t } = useI18n();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [providerUpdates, setProviderUpdates] = useState<Partial<Provider>>({});
  const [availableTypes, setAvailableTypes] = useState<string[]>([]);

  const [showAddProviderForm, setShowAddProviderForm] = useState(false);
  const [newProvId, setNewProvId] = useState('');
  const [newProvName, setNewProvName] = useState('');
  const [newProvType, setNewProvType] = useState('openai');
  const [newProvBaseURL, setNewProvBaseURL] = useState('');
  const [newProvApiKey, setNewProvApiKey] = useState('');

  const [showAddModelForm, setShowAddModelForm] = useState(false);
  const [newModelId, setNewModelId] = useState('');
  const [newModelName, setNewModelName] = useState('');
  const [newModelInputPrice, setNewModelInputPrice] = useState('0');
  const [newModelCachedInputPrice, setNewModelCachedInputPrice] = useState('0');
  const [newModelOutputPrice, setNewModelOutputPrice] = useState('0');
  const [newModelContextWindow, setNewModelContextWindow] = useState('128000');
  const [newModelContextTokens, setNewModelContextTokens] = useState('128000');
  const [newModelMaxTokens, setNewModelMaxTokens] = useState('4096');
  const [newModelCapabilities, setNewModelCapabilities] = useState<string[]>(['text']);

  const [editingModelId, setEditingModelId] = useState('');
  const [editModelName, setEditModelName] = useState('');
  const [editModelInputPrice, setEditModelInputPrice] = useState('0');
  const [editModelCachedInputPrice, setEditModelCachedInputPrice] = useState('0');
  const [editModelOutputPrice, setEditModelOutputPrice] = useState('0');
  const [editModelContextWindow, setEditModelContextWindow] = useState('128000');
  const [editModelContextTokens, setEditModelContextTokens] = useState('');
  const [editModelMaxTokens, setEditModelMaxTokens] = useState('');
  const [editModelCapabilities, setEditModelCapabilities] = useState<string[]>([]);

  const [toasts, setToasts] = useState<{ id: string; message: string; type: 'success' | 'error' | 'info' }[]>([]);
  const [confirmModal, setConfirmModal] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);

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

  const loadProviders = async () => {
    try {
      const typesRes = await fetch(getApiUrl('/api/config/provider-types'));
      const typesJson = await typesRes.json();
      if (typesJson.success && Array.isArray(typesJson.data)) {
        setAvailableTypes(typesJson.data);
        if (typesJson.data.length > 0) {
          setNewProvType(typesJson.data[0]);
        }
      }

      const res = await fetch(getApiUrl('/api/config/providers'));
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setProviders(json.data);
        if (json.data.length > 0 && !selectedProviderId) {
          setSelectedProviderId(json.data[0].id);
        }
      }
    } catch (err) {
      console.error('WS load providers failed:', err);
    }
  };

  useEffect(() => {
    loadProviders();
  }, []);

  useEffect(() => {
    const activeProv = providers.find(p => p.id === selectedProviderId);
    if (activeProv) {
      setProviderUpdates({
        name: activeProv.name,
        baseURL: activeProv.baseURL,
        apiKey: activeProv.apiKey
      });
    } else {
      setProviderUpdates({});
    }
  }, [selectedProviderId, providers]);

  const saveProviderSettings = async () => {
    if (!selectedProviderId) return;
    try {
      const res = await fetch(getApiUrl(`/api/config/providers/${selectedProviderId}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(providerUpdates)
      });
      const json = await res.json();
      if (json.success) {
        showToast(t('provider.saveSuccess', 'Provider configuration saved'), 'success');
        loadProviders();
      } else {
        showToast(t('provider.saveFailed', 'Failed to save: {error}', { error: json.message }), 'error');
      }
    } catch (err) {
      console.error(err);
      showToast(t('provider.saveError', 'Failed to save provider configuration'), 'error');
    }
  };

  const handleAddProvider = async () => {
    if (!newProvId.trim() || !newProvName.trim()) {
      showToast(t('provider.missingIdOrName', 'Please fill in provider ID and display name'), 'error');
      return;
    }
    try {
      const res = await fetch(getApiUrl('/api/config/providers'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: newProvId.trim(),
          name: newProvName.trim(),
          type: newProvType,
          baseURL: newProvBaseURL.trim(),
          apiKey: newProvApiKey
        })
      });
      const json = await res.json();
      if (json.success) {
        showToast(t('provider.added', 'Provider added'), 'success');
        const addedId = newProvId.trim();
        setNewProvId('');
        setNewProvName('');
        setNewProvBaseURL('');
        setNewProvApiKey('');
        setShowAddProviderForm(false);
        setSelectedProviderId(addedId);
        loadProviders();
      } else {
        showToast(t('provider.addFailed', 'Failed to add: {error}', { error: json.message }), 'error');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteProvider = (pId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmModal({
      title: t('provider.deleteModalTitle', 'Delete Model Provider'),
      message: t('provider.deleteModalMessage', 'Are you sure you want to permanently delete model provider "{id}" and all its bound models? This cannot be undone.', { id: pId }),
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          const res = await fetch(getApiUrl(`/api/config/providers/${pId}`), {
            method: 'DELETE'
          });
          const json = await res.json();
          if (json.success) {
            showToast(t('provider.deleted', 'Provider deleted'), 'success');
            if (selectedProviderId === pId) {
              setSelectedProviderId('');
            }
            loadProviders();
          } else {
            showToast(t('provider.deleteFailed', 'Failed to delete: {error}', { error: json.message }), 'error');
          }
        } catch (err) {
          console.error(err);
          showToast(t('provider.deleteError', 'Error occurred while deleting provider'), 'error');
        }
      }
    });
  };

  const handleAddModel = async () => {
    if (!selectedProviderId) return;
    if (!newModelId.trim() || !newModelName.trim()) {
      showToast(t('provider.missingModelIdOrName', 'Please fill in model ID and display name'), 'error');
      return;
    }
    try {
      const body: any = {
        id: newModelId.trim(),
        name: newModelName.trim(),
        inputPrice: Number(newModelInputPrice) || 0,
        outputPrice: Number(newModelOutputPrice) || 0,
        cachedInputPrice: Number(newModelCachedInputPrice) || 0,
        contextWindow: Number(newModelContextWindow) || 128000,
        capabilities: newModelCapabilities
      };
      if (newModelContextTokens.trim() !== '') {
        body.contextTokens = Number(newModelContextTokens);
      }
      if (newModelMaxTokens.trim() !== '') {
        body.maxTokens = Number(newModelMaxTokens);
      }

      const res = await fetch(getApiUrl(`/api/config/models/${selectedProviderId}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const json = await res.json();
      if (json.success) {
        showToast(t('provider.modelAdded', 'Model association added'), 'success');
        setNewModelId('');
        setNewModelName('');
        setNewModelInputPrice('0');
        setNewModelOutputPrice('0');
        setNewModelCachedInputPrice('0');
        setNewModelContextWindow('128000');
        setNewModelContextTokens('128000');
        setNewModelMaxTokens('4096');
        setNewModelCapabilities(['text']);
        setShowAddModelForm(false);
        loadProviders();
      } else {
        showToast(t('provider.modelAddFailed', 'Failed to add: {error}', { error: json.message }), 'error');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const startEditModel = (model: Model) => {
    setShowAddModelForm(false);
    setEditingModelId(model.id);
    setEditModelName(model.name || '');
    setEditModelInputPrice(model.inputPrice !== undefined && model.inputPrice !== null ? String(model.inputPrice) : '0');
    setEditModelOutputPrice(model.outputPrice !== undefined && model.outputPrice !== null ? String(model.outputPrice) : '0');
    setEditModelCachedInputPrice(model.cachedInputPrice !== undefined && model.cachedInputPrice !== null ? String(model.cachedInputPrice) : '0');
    setEditModelContextWindow(model.contextWindow !== undefined && model.contextWindow !== null ? String(model.contextWindow) : '128000');
    setEditModelContextTokens(model.contextTokens !== undefined && model.contextTokens !== null ? String(model.contextTokens) : '');
    setEditModelMaxTokens(model.maxTokens !== undefined && model.maxTokens !== null ? String(model.maxTokens) : '');
    setEditModelCapabilities(Array.isArray(model.capabilities) ? model.capabilities : ['text']);
  };

  const handleSaveModel = async (modelId: string) => {
    if (!selectedProviderId) return;
    try {
      const body: any = {
        name: editModelName.trim(),
        inputPrice: Number(editModelInputPrice) || 0,
        outputPrice: Number(editModelOutputPrice) || 0,
        cachedInputPrice: Number(editModelCachedInputPrice) || 0,
        contextWindow: Number(editModelContextWindow) || 128000,
        capabilities: editModelCapabilities
      };
      if (editModelContextTokens.trim() !== '') {
        body.contextTokens = Number(editModelContextTokens);
      } else {
        body.contextTokens = null;
      }
      if (editModelMaxTokens.trim() !== '') {
        body.maxTokens = Number(editModelMaxTokens);
      } else {
        body.maxTokens = null;
      }

      const res = await fetch(getApiUrl(`/api/config/models/${selectedProviderId}/${modelId}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const json = await res.json();
      if (json.success) {
        showToast(t('provider.modelUpdated', 'Model configuration updated'), 'success');
        setEditingModelId('');
        loadProviders();
      } else {
        showToast(t('provider.modelUpdateFailed', 'Failed to update: {error}', { error: json.message }), 'error');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteModel = (modelId: string) => {
    if (!selectedProviderId) return;
    setConfirmModal({
      title: t('provider.deleteModelModalTitle', 'Delete Associated Model Config'),
      message: t('provider.deleteModelModalMessage', 'Are you sure you want to unbind and delete model "{id}"? This cannot be undone.', { id: modelId }),
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          const res = await fetch(getApiUrl(`/api/config/models/${selectedProviderId}/${modelId}`), {
            method: 'DELETE'
          });
          const json = await res.json();
          if (json.success) {
            showToast(t('provider.modelDeleted', 'Model deleted'), 'success');
            loadProviders();
          } else {
            showToast(t('provider.modelDeleteFailed', 'Failed to delete: {error}', { error: json.message }), 'error');
          }
        } catch (err) {
          console.error(err);
          showToast(t('provider.modelDeleteError', 'Error occurred while deleting model'), 'error');
        }
      }
    });
  };

  const toggleNewCapability = (type: string) => {
    setNewModelCapabilities(prev =>
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    );
  };

  const toggleEditCapability = (type: string) => {
    setEditModelCapabilities(prev =>
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    );
  };

  return (
    <div className="providers-split">
      <div className="providers-sidebar-wrapper">
        <div className="providers-sidebar">
          {providers.map((p) => (
            <div
              key={p.id}
              className={`provider-item-row ${selectedProviderId === p.id ? 'active' : ''}`}
            >
              <span
                className="provider-item"
                onClick={() => { setSelectedProviderId(p.id); setEditingModelId(''); setShowAddModelForm(false); }}
              >
                {p.name || p.id}
              </span>
              <button
                className="btn-action delete"
                title={t('common.delete', 'Delete')}
                onClick={(e) => handleDeleteProvider(p.id, e)}
              >
                {t('common.delete', 'Delete')}
              </button>
            </div>
          ))}
        </div>

        <button
          className="btn-secondary"
          style={{ padding: '0.45rem', fontSize: '0.8rem' }}
          onClick={() => setShowAddProviderForm(!showAddProviderForm)}
        >
          {showAddProviderForm ? t('common.cancel', 'Cancel') : t('provider.btnAddProvider', 'Add Provider')}
        </button>

        {showAddProviderForm && (
          <div className="crud-form-card" style={{ padding: '0.8rem', gap: '0.5rem', margin: 0 }}>
            <input
              type="text"
              placeholder={t('provider.placeholderId', 'Unique ID (e.g. deepseek)')}
              className="config-input"
              style={{ fontSize: '0.78rem', padding: '0.4rem 0.6rem' }}
              value={newProvId}
              onChange={(e) => setNewProvId(e.target.value)}
            />
            <input
              type="text"
              placeholder={t('provider.placeholderName', 'Display Name')}
              className="config-input"
              style={{ fontSize: '0.78rem', padding: '0.4rem 0.6rem' }}
              value={newProvName}
              onChange={(e) => setNewProvName(e.target.value)}
            />
            <select
              className="config-input"
              style={{ fontSize: '0.78rem', padding: '0.4rem 0.6rem' }}
              value={newProvType}
              onChange={(e) => setNewProvType(e.target.value)}
            >
              {availableTypes.map((t) => (
                <option key={t} value={t}>
                  {t.toUpperCase()}
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder={t('provider.placeholderBaseURL', 'Base URL Endpoint')}
              className="config-input"
              style={{ fontSize: '0.78rem', padding: '0.4rem 0.6rem' }}
              value={newProvBaseURL}
              onChange={(e) => setNewProvBaseURL(e.target.value)}
            />
            <input
              type="password"
              placeholder={t('provider.placeholderApiKey', 'API Key')}
              className="config-input"
              style={{ fontSize: '0.78rem', padding: '0.4rem 0.6rem' }}
              value={newProvApiKey}
              onChange={(e) => setNewProvApiKey(e.target.value)}
            />
            <button
              className="btn-primary"
              style={{ padding: '0.4rem', fontSize: '0.78rem', width: '100%' }}
              onClick={handleAddProvider}
            >
              {t('provider.btnConfirmAdd', 'Confirm Add')}
            </button>
          </div>
        )}
      </div>

      <div className="providers-content">
        {selectedProviderId ? (
          <div className="provider-card">
            <div className="config-group">
              <label className="config-label">{t('provider.displayName', 'Provider Display Name')}</label>
              <input
                type="text"
                className="config-input"
                value={providerUpdates.name || ''}
                onChange={(e) => setProviderUpdates(prev => ({ ...prev, name: e.target.value }))}
              />
            </div>
            <div className="config-group">
              <label className="config-label">{t('provider.baseURL', 'Base URL')}</label>
              <input
                type="text"
                className="config-input"
                value={providerUpdates.baseURL || ''}
                onChange={(e) => setProviderUpdates(prev => ({ ...prev, baseURL: e.target.value }))}
              />
            </div>
            <div className="config-group">
              <label className="config-label">{t('provider.apiKey', 'API Key')}</label>
              <input
                type="password"
                className="config-input"
                placeholder="******"
                value={providerUpdates.apiKey || ''}
                onChange={(e) => setProviderUpdates(prev => ({ ...prev, apiKey: e.target.value }))}
              />
            </div>
            <div className="tab-actions" style={{ marginTop: '0.5rem' }}>
              <button className="btn-primary" onClick={saveProviderSettings}>
                {t('provider.btnSaveBase', 'Save Provider Settings')}
              </button>
            </div>

            <div style={{ marginTop: '0.8rem', borderTop: '1px solid rgba(255,255,255,0.03)', paddingTop: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
                <label className="config-label">{t('provider.associatedModels', 'Associated LLM Models')}</label>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                  {t('provider.associatedCount', '{count} models associated', { count: (providers.find(p => p.id === selectedProviderId)?.models || []).length })}
                </span>
              </div>

              <div className="models-list" style={{ margin: '0.6rem 0', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {(providers.find(p => p.id === selectedProviderId)?.models || []).length === 0 && !showAddModelForm ? (
                  <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', padding: '0.4rem 0', fontStyle: 'italic' }}>
                    {t('provider.noModelsHint', 'No models associated yet. Click "+ Associate New Model" below to add.')}
                  </div>
                ) : (
                  (providers.find(p => p.id === selectedProviderId)?.models || []).map((m: Model) => (
                    <div key={m.id} className="model-item" style={{ padding: '0.85rem 1.1rem', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: '0.65rem', boxSizing: 'border-box', width: '100%' }}>
                      {editingModelId === m.id ? (
                        <>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.03)', paddingBottom: '0.35rem' }}>
                            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'rgba(255, 255, 255, 0.65)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                              <span style={{ background: 'rgba(255,255,255,0.08)', padding: '0.1rem 0.35rem', borderRadius: '4px', fontSize: '0.7rem' }}>{t('common.edit', 'Edit')}</span>
                              <span>{m.id}</span>
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                              <button
                                className="btn-action edit"
                                title={t('common.save', 'Save')}
                                onClick={() => handleSaveModel(m.id)}
                              >
                                {t('common.save', 'Save')}
                              </button>
                              <button
                                className="btn-action delete"
                                title={t('common.cancel', 'Cancel')}
                                onClick={() => setEditingModelId('')}
                              >
                                {t('common.cancel', 'Cancel')}
                              </button>
                            </div>
                          </div>

                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', paddingTop: '0.3rem' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', width: '100%' }}>
                              <label style={{ fontSize: '0.74rem', color: 'rgba(255,255,255,0.7)', fontWeight: 500 }}>{t('provider.modelFriendlyName', 'Model Display Name')}</label>
                              <input
                                type="text"
                                className="config-input"
                                style={{ height: '32px', width: '100%', boxSizing: 'border-box', fontSize: '0.78rem', padding: '0.25rem 0.6rem' }}
                                value={editModelName}
                                onChange={(e) => setEditModelName(e.target.value)}
                              />
                            </div>

                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem 1rem', width: '100%' }}>
                              <div style={{ flex: '1 1 calc(33.33% - 1rem)', minWidth: '180px', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                <label style={{ fontSize: '0.74rem', color: 'rgba(255,255,255,0.7)', fontWeight: 500 }}>{t('provider.inputPrice', 'Input Price (/ 1M)')}</label>
                                <input
                                  type="number"
                                  step="0.0001"
                                  placeholder="0"
                                  className="config-input"
                                  style={{ height: '32px', width: '100%', boxSizing: 'border-box', fontSize: '0.78rem', padding: '0.25rem 0.6rem' }}
                                  value={editModelInputPrice}
                                  onChange={(e) => setEditModelInputPrice(e.target.value)}
                                />
                              </div>
                              <div style={{ flex: '1 1 calc(33.33% - 1rem)', minWidth: '180px', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                <label style={{ fontSize: '0.74rem', color: 'rgba(255,255,255,0.7)', fontWeight: 500 }}>{t('provider.cachedInputPrice', 'Cached Input Price (/ 1M)')}</label>
                                <input
                                  type="number"
                                  step="0.0001"
                                  placeholder="0"
                                  className="config-input"
                                  style={{ height: '32px', width: '100%', boxSizing: 'border-box', fontSize: '0.78rem', padding: '0.25rem 0.6rem' }}
                                  value={editModelCachedInputPrice}
                                  onChange={(e) => setEditModelCachedInputPrice(e.target.value)}
                                />
                              </div>
                              <div style={{ flex: '1 1 calc(33.33% - 1rem)', minWidth: '180px', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                <label style={{ fontSize: '0.74rem', color: 'rgba(255,255,255,0.7)', fontWeight: 500 }}>{t('provider.outputPrice', 'Output Price (/ 1M)')}</label>
                                <input
                                  type="number"
                                  step="0.0001"
                                  placeholder="0"
                                  className="config-input"
                                  style={{ height: '32px', width: '100%', boxSizing: 'border-box', fontSize: '0.78rem', padding: '0.25rem 0.6rem' }}
                                  value={editModelOutputPrice}
                                  onChange={(e) => setEditModelOutputPrice(e.target.value)}
                                />
                              </div>
                            </div>

                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem 1rem', width: '100%' }}>
                              <div style={{ flex: '1 1 calc(33.33% - 1rem)', minWidth: '180px', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                <label style={{ fontSize: '0.74rem', color: 'rgba(255,255,255,0.7)', fontWeight: 500 }}>{t('provider.contextWindow', 'Context Window (Physical Limit)')}</label>
                                <input
                                  type="number"
                                  className="config-input"
                                  placeholder={t('provider.placeholderDefaultWindow', 'Default 128000')}
                                  style={{ height: '32px', width: '100%', boxSizing: 'border-box', fontSize: '0.78rem', padding: '0.25rem 0.6rem' }}
                                  value={editModelContextWindow}
                                  onChange={(e) => setEditModelContextWindow(e.target.value)}
                                />
                              </div>
                              <div style={{ flex: '1 1 calc(33.33% - 1rem)', minWidth: '180px', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                <label style={{ fontSize: '0.74rem', color: 'rgba(255,255,255,0.7)', fontWeight: 500 }}>{t('provider.contextTokens', 'Context Tokens (Compaction Threshold)')}</label>
                                <input
                                  type="number"
                                  className="config-input"
                                  placeholder={t('provider.placeholderDefaultWindow', 'Default 128000')}
                                  style={{ height: '32px', width: '100%', boxSizing: 'border-box', fontSize: '0.78rem', padding: '0.25rem 0.6rem' }}
                                  value={editModelContextTokens}
                                  onChange={(e) => setEditModelContextTokens(e.target.value)}
                                />
                              </div>
                              <div style={{ flex: '1 1 calc(33.33% - 1rem)', minWidth: '180px', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                <label style={{ fontSize: '0.74rem', color: 'rgba(255,255,255,0.7)', fontWeight: 500 }}>{t('provider.maxTokens', 'Max Output Tokens (Output Limit)')}</label>
                                <input
                                  type="number"
                                  className="config-input"
                                  placeholder={t('provider.defaultTokens', 'Default 4096')}
                                  style={{ height: '32px', width: '100%', boxSizing: 'border-box', fontSize: '0.78rem', padding: '0.25rem 0.6rem' }}
                                  value={editModelMaxTokens}
                                  onChange={(e) => setEditModelMaxTokens(e.target.value)}
                                />
                              </div>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', width: '100%' }}>
                              <label style={{ fontSize: '0.74rem', color: 'rgba(255,255,255,0.7)', fontWeight: 500 }}>{t('provider.capabilities', 'Supported Capabilities')}</label>
                              <div style={{ display: 'flex', gap: '1.2rem', padding: '0.2rem 0', flexWrap: 'wrap' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.78rem', cursor: 'pointer' }}>
                                  <input
                                    type="checkbox"
                                    checked={editModelCapabilities.includes('text')}
                                    onChange={() => toggleEditCapability('text')}
                                  />
                                  <span>{t('provider.capText', 'Text Chat (text)')}</span>
                                </label>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.78rem', cursor: 'pointer' }}>
                                  <input
                                    type="checkbox"
                                    checked={editModelCapabilities.includes('image')}
                                    onChange={() => toggleEditCapability('image')}
                                  />
                                  <span>{t('provider.capImage', 'Vision / Image (image)')}</span>
                                </label>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.78rem', cursor: 'pointer' }}>
                                  <input
                                    type="checkbox"
                                    checked={editModelCapabilities.includes('audio')}
                                    onChange={() => toggleEditCapability('audio')}
                                  />
                                  <span>{t('provider.capAudio', 'Audio / Voice (audio)')}</span>
                                </label>
                              </div>
                            </div>
                          </div>
                        </>
                      ) : (
                        <>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.03)', paddingBottom: '0.35rem' }}>
                            <div className="model-item-title-box" style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                              <span>{m.name || m.id}</span>
                              <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.06)', padding: '0.1rem 0.4rem', borderRadius: '4px', fontFamily: 'monospace' }}>{m.id}</span>
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                              <button
                                className="btn-action edit"
                                title={t('common.edit', 'Edit')}
                                onClick={() => startEditModel(m)}
                              >
                                {t('common.edit', 'Edit')}
                              </button>
                              <button
                                className="btn-action delete"
                                title={t('common.delete', 'Delete')}
                                onClick={() => handleDeleteModel(m.id)}
                              >
                                {t('common.delete', 'Delete')}
                              </button>
                            </div>
                          </div>

                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem 1.2rem', padding: '0.2rem 0' }}>
                            <div style={{ flex: '1 1 calc(50% - 1.2rem)', minWidth: '220px', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                              <span style={{ color: 'var(--text-secondary)', fontSize: '0.72rem' }}>{t('provider.windowAndContext', 'Window / Context Limit')}</span>
                              <span style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-primary)' }}>
                                {m.contextWindow || 128000} {m.contextTokens ? t('provider.inputLimit', '(Input limit: {tokens})', { tokens: m.contextTokens }) : ''}
                              </span>
                            </div>
                            <div style={{ flex: '1 1 calc(50% - 1.2rem)', minWidth: '220px', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                              <span style={{ color: 'var(--text-secondary)', fontSize: '0.72rem' }}>{t('provider.pricingSummary', 'Pricing (/ 1M tokens)')}</span>
                              <span style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-primary)' }}>
                                {t('provider.priceInput', 'Input: {price}', { price: m.inputPrice })} | {t('provider.priceOutput', 'Output: {price}', { price: m.outputPrice })} {m.cachedInputPrice > 0 ? t('provider.priceCached', '| Cached: {price}', { price: m.cachedInputPrice }) : ''}
                              </span>
                            </div>
                            <div style={{ flex: '1 1 calc(50% - 1.2rem)', minWidth: '220px', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                              <span style={{ color: 'var(--text-secondary)', fontSize: '0.72rem' }}>{t('provider.maxOutputTokens', 'Max Output Tokens')}</span>
                              <span style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-primary)' }}>
                                {m.maxTokens ? t('provider.tokensUnit', '{count} tokens', { count: m.maxTokens }) : t('provider.defaultTokens', 'Default 4096')}
                              </span>
                            </div>
                            <div style={{ flex: '1 1 calc(50% - 1.2rem)', minWidth: '220px', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                              <span style={{ color: 'var(--text-secondary)', fontSize: '0.72rem' }}>{t('provider.supportedCaps', 'Capabilities')}</span>
                              <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.1rem' }}>
                                {Array.isArray(m.capabilities) && m.capabilities.length > 0 ? (
                                  m.capabilities.map(cap => (
                                    <span key={cap} style={{ fontSize: '0.68rem', padding: '0.1rem 0.35rem', borderRadius: '4px', background: 'rgba(59, 130, 246, 0.12)', color: 'var(--color-primary, #60a5fa)', border: '1px solid rgba(59, 130, 246, 0.25)' }}>
                                      {cap}
                                    </span>
                                  ))
                                ) : (
                                  <span style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>{t('provider.regularText', 'Standard Text')}</span>
                                )}
                              </div>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  ))
                )}

                {showAddModelForm && (
                  <div className="model-item" style={{ padding: '0.85rem 1.1rem', background: 'rgba(59, 130, 246, 0.04)', borderRadius: '8px', border: '1px dashed rgba(59, 130, 246, 0.35)', display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: '0.65rem', boxSizing: 'border-box', width: '100%' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.04)', paddingBottom: '0.35rem' }}>
                      <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-primary, #3b82f6)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <span style={{ background: 'rgba(59, 130, 246, 0.15)', padding: '0.1rem 0.35rem', borderRadius: '4px', fontSize: '0.7rem' }}>+ {t('common.new', 'New')}</span>
                        <span>{t('provider.btnAssociateModel', 'Associate New Model')}</span>
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                        <button
                          className="btn-action edit"
                          title={t('common.confirm', 'Confirm')}
                          onClick={handleAddModel}
                        >
                          {t('common.confirm', 'Confirm')}
                        </button>
                        <button
                          className="btn-action delete"
                          title={t('common.cancel', 'Cancel')}
                          onClick={() => setShowAddModelForm(false)}
                        >
                          {t('common.cancel', 'Cancel')}
                        </button>
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', paddingTop: '0.3rem' }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem 1rem', width: '100%' }}>
                        <div style={{ flex: '1 1 calc(50% - 1rem)', minWidth: '200px', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                          <label style={{ fontSize: '0.74rem', color: 'rgba(255, 255, 255, 0.7)', fontWeight: 500 }}>
                            {t('provider.modelPhysicalId', 'Model Physical ID')} <span style={{ color: 'var(--color-danger, #ef4444)' }}>*</span>
                          </label>
                          <input
                            type="text"
                            placeholder={t('provider.placeholderModelId', 'e.g. deepseek-chat')}
                            className="config-input"
                            style={{ height: '32px', width: '100%', boxSizing: 'border-box', fontSize: '0.78rem', padding: '0.25rem 0.6rem' }}
                            value={newModelId}
                            onChange={(e) => setNewModelId(e.target.value)}
                          />
                        </div>
                        <div style={{ flex: '1 1 calc(50% - 1rem)', minWidth: '200px', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                          <label style={{ fontSize: '0.74rem', color: 'rgba(255, 255, 255, 0.7)', fontWeight: 500 }}>
                            {t('provider.modelFriendlyName', 'Model Display Name')} <span style={{ color: 'var(--color-danger, #ef4444)' }}>*</span>
                          </label>
                          <input
                            type="text"
                            placeholder={t('provider.placeholderModelName', 'e.g. DeepSeek V3')}
                            className="config-input"
                            style={{ height: '32px', width: '100%', boxSizing: 'border-box', fontSize: '0.78rem', padding: '0.25rem 0.6rem' }}
                            value={newModelName}
                            onChange={(e) => setNewModelName(e.target.value)}
                          />
                        </div>
                      </div>

                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem 1rem', width: '100%' }}>
                        <div style={{ flex: '1 1 calc(33.33% - 1rem)', minWidth: '180px', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                          <label style={{ fontSize: '0.74rem', color: 'rgba(255, 255, 255, 0.7)', fontWeight: 500 }}>{t('provider.inputPrice', 'Input Price (/ 1M)')}</label>
                          <input
                            type="number"
                            step="0.0001"
                            placeholder="0"
                            className="config-input"
                            style={{ height: '32px', width: '100%', boxSizing: 'border-box', fontSize: '0.78rem', padding: '0.25rem 0.6rem' }}
                            value={newModelInputPrice}
                            onChange={(e) => setNewModelInputPrice(e.target.value)}
                          />
                        </div>
                        <div style={{ flex: '1 1 calc(33.33% - 1rem)', minWidth: '180px', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                          <label style={{ fontSize: '0.74rem', color: 'rgba(255, 255, 255, 0.7)', fontWeight: 500 }}>{t('provider.cachedInputPrice', 'Cached Input Price (/ 1M)')}</label>
                          <input
                            type="number"
                            step="0.0001"
                            placeholder="0"
                            className="config-input"
                            style={{ height: '32px', width: '100%', boxSizing: 'border-box', fontSize: '0.78rem', padding: '0.25rem 0.6rem' }}
                            value={newModelCachedInputPrice}
                            onChange={(e) => setNewModelCachedInputPrice(e.target.value)}
                          />
                        </div>
                        <div style={{ flex: '1 1 calc(33.33% - 1rem)', minWidth: '180px', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                          <label style={{ fontSize: '0.74rem', color: 'rgba(255, 255, 255, 0.7)', fontWeight: 500 }}>{t('provider.outputPrice', 'Output Price (/ 1M)')}</label>
                          <input
                            type="number"
                            step="0.0001"
                            placeholder="0"
                            className="config-input"
                            style={{ height: '32px', width: '100%', boxSizing: 'border-box', fontSize: '0.78rem', padding: '0.25rem 0.6rem' }}
                            value={newModelOutputPrice}
                            onChange={(e) => setNewModelOutputPrice(e.target.value)}
                          />
                        </div>
                      </div>

                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem 1rem', width: '100%' }}>
                        <div style={{ flex: '1 1 calc(33.33% - 1rem)', minWidth: '180px', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                          <label style={{ fontSize: '0.74rem', color: 'rgba(255, 255, 255, 0.7)', fontWeight: 500 }}>{t('provider.contextWindow', 'Context Window (Physical Limit)')}</label>
                          <input
                            type="number"
                            className="config-input"
                            placeholder={t('provider.placeholderDefaultWindow', 'Default 128000')}
                            style={{ height: '32px', width: '100%', boxSizing: 'border-box', fontSize: '0.78rem', padding: '0.25rem 0.6rem' }}
                            value={newModelContextWindow}
                            onChange={(e) => setNewModelContextWindow(e.target.value)}
                          />
                        </div>
                        <div style={{ flex: '1 1 calc(33.33% - 1rem)', minWidth: '180px', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                          <label style={{ fontSize: '0.74rem', color: 'rgba(255, 255, 255, 0.7)', fontWeight: 500 }}>{t('provider.contextTokensInput', 'Context Tokens (Input Control)')}</label>
                          <input
                            type="number"
                            placeholder={t('provider.placeholderDefaultContext', 'Default 128000 (triggers compaction)')}
                            className="config-input"
                            style={{ height: '32px', width: '100%', boxSizing: 'border-box', fontSize: '0.78rem', padding: '0.25rem 0.6rem' }}
                            value={newModelContextTokens}
                            onChange={(e) => setNewModelContextTokens(e.target.value)}
                          />
                        </div>
                        <div style={{ flex: '1 1 calc(33.33% - 1rem)', minWidth: '180px', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                          <label style={{ fontSize: '0.74rem', color: 'rgba(255, 255, 255, 0.7)', fontWeight: 500 }}>{t('provider.maxTokensControl', 'Max Output Tokens (Output Control)')}</label>
                          <input
                            type="number"
                            placeholder={t('provider.placeholderDefaultMaxTokens', 'Default 4096 (per reply limit)')}
                            className="config-input"
                            style={{ height: '32px', width: '100%', boxSizing: 'border-box', fontSize: '0.78rem', padding: '0.25rem 0.6rem' }}
                            value={newModelMaxTokens}
                            onChange={(e) => setNewModelMaxTokens(e.target.value)}
                          />
                        </div>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', width: '100%' }}>
                        <label style={{ fontSize: '0.74rem', color: 'rgba(255, 255, 255, 0.7)', fontWeight: 500 }}>{t('provider.capabilities', 'Supported Capabilities')}</label>
                        <div style={{ display: 'flex', gap: '1.2rem', padding: '0.2rem 0', flexWrap: 'wrap' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.78rem', cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={newModelCapabilities.includes('text')}
                              onChange={() => toggleNewCapability('text')}
                            />
                            <span>{t('provider.capText', 'Text Chat (text)')}</span>
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.78rem', cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={newModelCapabilities.includes('image')}
                              onChange={() => toggleNewCapability('image')}
                            />
                            <span>{t('provider.capImage', 'Vision / Image (image)')}</span>
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.8rem', cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={newModelCapabilities.includes('audio')}
                              onChange={() => toggleNewCapability('audio')}
                            />
                            <span>{t('provider.capAudio', 'Audio / Voice (audio)')}</span>
                          </label>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {!showAddModelForm && (
                <div style={{ marginTop: '0.5rem' }}>
                  <button
                    type="button"
                    className="btn-action"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '0.4rem 0.85rem', fontSize: '0.76rem', background: 'rgba(255, 255, 255, 0.04)', border: '1px dashed rgba(255, 255, 255, 0.15)', borderRadius: '6px', cursor: 'pointer', color: 'var(--text-secondary)' }}
                    onClick={() => {
                      setEditingModelId('');
                      setShowAddModelForm(true);
                    }}
                  >
                    <span>+ {t('provider.btnAssociateModel', 'Associate New Model')}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div style={{ color: 'var(--text-secondary)', fontStyle: 'italic', padding: '2rem', textAlign: 'center' }}>
            {t('provider.emptySelectPrompt', 'Please select or add a model provider on the left to configure.')}
          </div>
        )}
      </div>

      {confirmModal && (
        <div className="confirm-modal-overlay">
          <div className="confirm-modal-card">
            <div className="confirm-modal-title">
              <span>{confirmModal.title}</span>
            </div>
            <div className="confirm-modal-desc">
              {confirmModal.message}
            </div>
            <div className="confirm-modal-actions">
              <button className="btn-secondary" style={{ height: '32px', padding: '0 1rem' }} onClick={() => setConfirmModal(null)}>
                {t('common.cancel', 'Cancel')}
              </button>
              <button className="btn-primary" style={{ height: '32px', padding: '0 1rem', background: '#f43f5e', borderColor: '#f43f5e' }} onClick={confirmModal.onConfirm}>
                {t('provider.btnConfirmDelete', 'Confirm Delete')}
              </button>
            </div>
          </div>
        </div>
      )}

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
