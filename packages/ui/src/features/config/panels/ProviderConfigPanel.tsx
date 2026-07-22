import React, { useEffect, useState } from 'react';

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
  const [newModelInputPrice, setNewModelInputPrice] = useState(0);
  const [newModelOutputPrice, setNewModelOutputPrice] = useState(0);
  const [newModelCachedInputPrice, setNewModelCachedInputPrice] = useState(0);
  const [newModelContextWindow, setNewModelContextWindow] = useState(4096);
  const [newModelContextTokens, setNewModelContextTokens] = useState('');
  const [newModelMaxTokens, setNewModelMaxTokens] = useState('');
  const [newModelCapabilities, setNewModelCapabilities] = useState<string[]>(['text']);

  const [editingModelId, setEditingModelId] = useState('');
  const [editModelName, setEditModelName] = useState('');
  const [editModelInputPrice, setEditModelInputPrice] = useState(0);
  const [editModelOutputPrice, setEditModelOutputPrice] = useState(0);
  const [editModelCachedInputPrice, setEditModelCachedInputPrice] = useState(0);
  const [editModelContextWindow, setEditModelContextWindow] = useState(4096);
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
        showToast('提供商配置已保存', 'success');
        loadProviders();
      } else {
        showToast(`保存失败: ${json.message}`, 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('保存提供商配置失败', 'error');
    }
  };

  const handleAddProvider = async () => {
    if (!newProvId.trim() || !newProvName.trim()) {
      showToast('请填写提供商唯一标识与显示名称', 'error');
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
        showToast('提供商已添加', 'success');
        const addedId = newProvId.trim();
        setNewProvId('');
        setNewProvName('');
        setNewProvBaseURL('');
        setNewProvApiKey('');
        setShowAddProviderForm(false);
        setSelectedProviderId(addedId);
        loadProviders();
      } else {
        showToast(`添加失败: ${json.message}`, 'error');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteProvider = (pId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmModal({
      title: '删除模型提供商',
      message: `确定要永久删除模型提供商 "${pId}" 及其绑定的全部模型配置吗？该操作不可撤销。`,
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          const res = await fetch(getApiUrl(`/api/config/providers/${pId}`), {
            method: 'DELETE'
          });
          const json = await res.json();
          if (json.success) {
            showToast('提供商已删除', 'success');
            if (selectedProviderId === pId) {
              setSelectedProviderId('');
            }
            loadProviders();
          } else {
            showToast(`删除失败: ${json.message}`, 'error');
          }
        } catch (err) {
          console.error(err);
          showToast('删除提供商发生异常', 'error');
        }
      }
    });
  };

  const handleAddModel = async () => {
    if (!selectedProviderId) return;
    if (!newModelId.trim() || !newModelName.trim()) {
      showToast('请填写模型物理标识与友好名称', 'error');
      return;
    }
    try {
      const body: any = {
        id: newModelId.trim(),
        name: newModelName.trim(),
        inputPrice: Number(newModelInputPrice),
        outputPrice: Number(newModelOutputPrice),
        cachedInputPrice: Number(newModelCachedInputPrice),
        contextWindow: Number(newModelContextWindow),
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
        showToast('模型关联已添加', 'success');
        setNewModelId('');
        setNewModelName('');
        setNewModelInputPrice(0);
        setNewModelOutputPrice(0);
        setNewModelCachedInputPrice(0);
        setNewModelContextWindow(4096);
        setNewModelContextTokens('');
        setNewModelMaxTokens('');
        setNewModelCapabilities(['text']);
        setShowAddModelForm(false);
        loadProviders();
      } else {
        showToast(`添加失败: ${json.message}`, 'error');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const startEditModel = (model: Model) => {
    setEditingModelId(model.id);
    setEditModelName(model.name || '');
    setEditModelInputPrice(model.inputPrice || 0);
    setEditModelOutputPrice(model.outputPrice || 0);
    setEditModelCachedInputPrice(model.cachedInputPrice || 0);
    setEditModelContextWindow(model.contextWindow || 4096);
    setEditModelContextTokens(model.contextTokens !== undefined && model.contextTokens !== null ? String(model.contextTokens) : '');
    setEditModelMaxTokens(model.maxTokens !== undefined && model.maxTokens !== null ? String(model.maxTokens) : '');
    setEditModelCapabilities(Array.isArray(model.capabilities) ? model.capabilities : ['text']);
  };

  const handleSaveModel = async (modelId: string) => {
    if (!selectedProviderId) return;
    try {
      const body: any = {
        name: editModelName.trim(),
        inputPrice: Number(editModelInputPrice),
        outputPrice: Number(editModelOutputPrice),
        cachedInputPrice: Number(editModelCachedInputPrice),
        contextWindow: Number(editModelContextWindow),
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
        showToast('模型配置已更新', 'success');
        setEditingModelId('');
        loadProviders();
      } else {
        showToast(`更新失败: ${json.message}`, 'error');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteModel = (modelId: string) => {
    if (!selectedProviderId) return;
    setConfirmModal({
      title: '删除关联模型配置',
      message: `确定要断开并删除模型 "${modelId}" 的配置绑定吗？该操作不可撤销。`,
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          const res = await fetch(getApiUrl(`/api/config/models/${selectedProviderId}/${modelId}`), {
            method: 'DELETE'
          });
          const json = await res.json();
          if (json.success) {
            showToast('模型已删除', 'success');
            loadProviders();
          } else {
            showToast(`删除失败: ${json.message}`, 'error');
          }
        } catch (err) {
          console.error(err);
          showToast('删除模型发生异常', 'error');
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
                title="删除"
                onClick={(e) => handleDeleteProvider(p.id, e)}
              >
                删除
              </button>
            </div>
          ))}
        </div>

        <button
          className="btn-secondary"
          style={{ padding: '0.45rem', fontSize: '0.8rem' }}
          onClick={() => setShowAddProviderForm(!showAddProviderForm)}
        >
          {showAddProviderForm ? '取消' : '添加提供商'}
        </button>

        {showAddProviderForm && (
          <div className="crud-form-card" style={{ padding: '0.8rem', gap: '0.5rem', margin: 0 }}>
            <input
              type="text"
              placeholder="唯一 ID (例如 deepseek)"
              className="config-input"
              style={{ fontSize: '0.78rem', padding: '0.4rem 0.6rem' }}
              value={newProvId}
              onChange={(e) => setNewProvId(e.target.value)}
            />
            <input
              type="text"
              placeholder="显示名称"
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
                  {t === 'openai' ? 'OpenAI 兼容规格' : `${t} 规格`}
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Base URL 终点"
              className="config-input"
              style={{ fontSize: '0.78rem', padding: '0.4rem 0.6rem' }}
              value={newProvBaseURL}
              onChange={(e) => setNewProvBaseURL(e.target.value)}
            />
            <input
              type="password"
              placeholder="API Key"
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
              确认添加
            </button>
          </div>
        )}
      </div>

      <div className="providers-content">
        {selectedProviderId ? (
          <div className="provider-card">
            <div className="config-group">
              <label className="config-label">提供商显示名称</label>
              <input
                type="text"
                className="config-input"
                value={providerUpdates.name || ''}
                onChange={(e) => setProviderUpdates(prev => ({ ...prev, name: e.target.value }))}
              />
            </div>
            <div className="config-group">
              <label className="config-label">API 终点 (Base URL)</label>
              <input
                type="text"
                className="config-input"
                value={providerUpdates.baseURL || ''}
                onChange={(e) => setProviderUpdates(prev => ({ ...prev, baseURL: e.target.value }))}
              />
            </div>
            <div className="config-group">
              <label className="config-label">凭证密钥 (API Key)</label>
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
                保存提供商基础配置
              </button>
            </div>

            <div style={{ marginTop: '0.8rem', borderTop: '1px solid rgba(255,255,255,0.03)', paddingTop: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <label className="config-label">关联大模型列表</label>
                <button
                  className="btn-header"
                  onClick={() => setShowAddModelForm(!showAddModelForm)}
                >
                  {showAddModelForm ? '取消' : '关联新模型'}
                </button>
              </div>

              {showAddModelForm && (
                <div className="crud-form-card">
                  <div className="crud-form-row">
                    <div className="config-group">
                      <label className="config-label" style={{ fontSize: '0.74rem' }}>模型物理 ID</label>
                      <input
                        type="text"
                        placeholder="如 deepseek-chat"
                        className="config-input"
                        value={newModelId}
                        onChange={(e) => setNewModelId(e.target.value)}
                      />
                    </div>
                    <div className="config-group">
                      <label className="config-label" style={{ fontSize: '0.74rem' }}>模型友好名称</label>
                      <input
                        type="text"
                        placeholder="如 DeepSeek V3"
                        className="config-input"
                        value={newModelName}
                        onChange={(e) => setNewModelName(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="crud-form-row">
                    <div className="config-group">
                      <label className="config-label" style={{ fontSize: '0.74rem' }}>输入单价 (/ 1M Tokens)</label>
                      <input
                        type="number"
                        step="0.0001"
                        className="config-input"
                        value={newModelInputPrice}
                        onChange={(e) => setNewModelInputPrice(Number(e.target.value))}
                      />
                    </div>
                    <div className="config-group">
                      <label className="config-label" style={{ fontSize: '0.74rem' }}>缓存输入单价 (/ 1M Tokens)</label>
                      <input
                        type="number"
                        step="0.0001"
                        className="config-input"
                        value={newModelCachedInputPrice}
                        onChange={(e) => setNewModelCachedInputPrice(Number(e.target.value))}
                      />
                    </div>
                  </div>
                  <div className="crud-form-row">
                    <div className="config-group">
                      <label className="config-label" style={{ fontSize: '0.74rem' }}>输出单价 (/ 1M Tokens)</label>
                      <input
                        type="number"
                        step="0.0001"
                        className="config-input"
                        value={newModelOutputPrice}
                        onChange={(e) => setNewModelOutputPrice(Number(e.target.value))}
                      />
                    </div>
                    <div className="config-group">
                      <label className="config-label" style={{ fontSize: '0.74rem' }}>上下文窗口 (Context Window)</label>
                      <input
                        type="number"
                        className="config-input"
                        value={newModelContextWindow}
                        onChange={(e) => setNewModelContextWindow(Number(e.target.value))}
                      />
                    </div>
                  </div>
                  <div className="crud-form-row">
                    <div className="config-group">
                      <label className="config-label" style={{ fontSize: '0.74rem' }}>上下文上限 Token (可选)</label>
                      <input
                        type="number"
                        placeholder="留空表示不限制"
                        className="config-input"
                        value={newModelContextTokens}
                        onChange={(e) => setNewModelContextTokens(e.target.value)}
                      />
                    </div>
                    <div className="config-group">
                      <label className="config-label" style={{ fontSize: '0.74rem' }}>最大输出限制 Token (可选)</label>
                      <input
                        type="number"
                        placeholder="留空表示不限制"
                        className="config-input"
                        value={newModelMaxTokens}
                        onChange={(e) => setNewModelMaxTokens(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="config-group">
                    <label className="config-label" style={{ fontSize: '0.74rem' }}>支持的能力类型 (Capabilities)</label>
                    <div style={{ display: 'flex', gap: '1.2rem', padding: '0.2rem 0' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.8rem', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={newModelCapabilities.includes('text')}
                          onChange={() => toggleNewCapability('text')}
                        />
                        <span>文本对话 (text)</span>
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.8rem', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={newModelCapabilities.includes('image')}
                          onChange={() => toggleNewCapability('image')}
                        />
                        <span>图像生成 (image)</span>
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.8rem', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={newModelCapabilities.includes('audio')}
                          onChange={() => toggleNewCapability('audio')}
                        />
                        <span>音频处理 (audio)</span>
                      </label>
                    </div>
                  </div>
                  <div className="tab-actions">
                    <button className="btn-primary" onClick={handleAddModel}>
                      确认新增并绑定
                    </button>
                  </div>
                </div>
              )}

              <div className="models-list">
                {(providers.find(p => p.id === selectedProviderId)?.models || []).map((m: Model) => (
                  <div key={m.id} className="model-item">
                    {editingModelId === m.id ? (
                      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        <div className="crud-form-row">
                          <div className="config-group" style={{ margin: 0 }}>
                            <label className="config-label" style={{ fontSize: '0.72rem' }}>模型名称</label>
                            <input
                              type="text"
                              className="config-input"
                              value={editModelName}
                              onChange={(e) => setEditModelName(e.target.value)}
                            />
                          </div>
                          <div className="config-group" style={{ margin: 0 }}>
                            <label className="config-label" style={{ fontSize: '0.72rem' }}>窗口容量</label>
                            <input
                              type="number"
                              className="config-input"
                              value={editModelContextWindow}
                              onChange={(e) => setEditModelContextWindow(Number(e.target.value))}
                            />
                          </div>
                        </div>
                        <div className="crud-form-row">
                          <div className="config-group" style={{ margin: 0 }}>
                            <label className="config-label" style={{ fontSize: '0.72rem' }}>输入单价 (/ 1M)</label>
                            <input
                              type="number"
                              step="0.0001"
                              className="config-input"
                              value={editModelInputPrice}
                              onChange={(e) => setEditModelInputPrice(Number(e.target.value))}
                            />
                          </div>
                          <div className="config-group" style={{ margin: 0 }}>
                            <label className="config-label" style={{ fontSize: '0.72rem' }}>缓存输入单价 (/ 1M)</label>
                            <input
                              type="number"
                              step="0.0001"
                              className="config-input"
                              value={editModelCachedInputPrice}
                              onChange={(e) => setEditModelCachedInputPrice(Number(e.target.value))}
                            />
                          </div>
                        </div>
                        <div className="crud-form-row">
                          <div className="config-group" style={{ margin: 0 }}>
                            <label className="config-label" style={{ fontSize: '0.72rem' }}>输出单价 (/ 1M)</label>
                            <input
                              type="number"
                              step="0.0001"
                              className="config-input"
                              value={editModelOutputPrice}
                              onChange={(e) => setEditModelOutputPrice(Number(e.target.value))}
                            />
                          </div>
                          <div className="config-group" style={{ margin: 0 }}>
                            <label className="config-label" style={{ fontSize: '0.72rem' }}>最大输出限制 (可选)</label>
                            <input
                              type="number"
                              className="config-input"
                              placeholder="无限制"
                              value={editModelMaxTokens}
                              onChange={(e) => setEditModelMaxTokens(e.target.value)}
                            />
                          </div>
                        </div>
                        <div className="config-group" style={{ margin: 0 }}>
                          <label className="config-label" style={{ fontSize: '0.72rem' }}>上下文 Token 限制 (可选)</label>
                          <input
                            type="number"
                            className="config-input"
                            placeholder="无限制"
                            value={editModelContextTokens}
                            onChange={(e) => setEditModelContextTokens(e.target.value)}
                          />
                        </div>
                        <div className="config-group" style={{ margin: 0 }}>
                          <label className="config-label" style={{ fontSize: '0.72rem' }}>支持的能力类型 (Capabilities)</label>
                          <div style={{ display: 'flex', gap: '1.2rem', padding: '0.2rem 0' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.8rem', cursor: 'pointer' }}>
                              <input
                                type="checkbox"
                                checked={editModelCapabilities.includes('text')}
                                onChange={() => toggleEditCapability('text')}
                              />
                              <span>文本对话 (text)</span>
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.8rem', cursor: 'pointer' }}>
                              <input
                                type="checkbox"
                                checked={editModelCapabilities.includes('image')}
                                onChange={() => toggleEditCapability('image')}
                              />
                              <span>图像生成 (image)</span>
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.8rem', cursor: 'pointer' }}>
                              <input
                                type="checkbox"
                                checked={editModelCapabilities.includes('audio')}
                                onChange={() => toggleEditCapability('audio')}
                              />
                              <span>音频处理 (audio)</span>
                            </label>
                          </div>
                        </div>
                        <div className="tab-actions">
                          <button className="btn-secondary" style={{ height: '30px', padding: '0 0.8rem' }} onClick={() => setEditingModelId('')}>
                            取消
                          </button>
                          <button className="btn-primary" style={{ height: '30px', padding: '0 0.8rem' }} onClick={() => handleSaveModel(m.id)}>
                            保存修改
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div style={{ flex: 1 }}>
                          <div className="model-name">
                            {m.name || m.id}{' '}
                            <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 'normal' }}>
                              ({m.id})
                            </span>
                          </div>
                          <div className="model-details" style={{ marginTop: '0.25rem', lineHeight: '1.4' }}>
                            <span>窗口: {m.contextWindow || '未指定'}</span>
                            {m.contextTokens && <span> (限制: {m.contextTokens})</span>}
                            <span> | 输入: {m.inputPrice} (1M)</span>
                            {m.cachedInputPrice > 0 && <span> (缓存: {m.cachedInputPrice} (1M))</span>}
                            <span> | 输出: {m.outputPrice} (1M)</span>
                            {m.maxTokens && <span> | 最大输出: {m.maxTokens}</span>}
                            <div style={{ marginTop: '0.15rem', color: '#888' }}>
                              能力类型: {Array.isArray(m.capabilities) && m.capabilities.length > 0 ? m.capabilities.join(', ') : '无'}
                            </div>
                          </div>
                        </div>
                        <div className="model-actions">
                          <button
                            className="btn-action edit"
                            title="修改模型参数"
                            onClick={() => startEditModel(m)}
                          >
                            编辑
                          </button>
                          <button
                            className="btn-action delete"
                            title="删除"
                            onClick={() => handleDeleteModel(m.id)}
                          >
                            删除
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ color: 'var(--text-secondary)', fontStyle: 'italic', padding: '2rem', textAlign: 'center' }}>
            请在左侧选择或添加一个模型提供商以进行配置。
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
                取消
              </button>
              <button className="btn-primary" style={{ height: '32px', padding: '0 1rem', background: '#f43f5e', borderColor: '#f43f5e' }} onClick={confirmModal.onConfirm}>
                确定删除
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
