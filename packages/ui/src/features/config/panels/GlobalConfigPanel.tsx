import React, { useEffect, useState } from 'react';

interface GlobalConfigPanelProps {
  getApiUrl: (path: string) => string;
}

interface AvailableModel {
  providerId: string;
  modelId: string;
  displayName: string;
}

interface ModelBinding {
  provider: string;
  model: string;
  name: string;
}

interface ConfigFieldSchema {
  key: string;
  defaultValue: any;
  description?: string;
  type: 'string' | 'number' | 'boolean' | 'array' | string;
  category?: string;
  required?: boolean;
  sensitive?: boolean;
  uiHint?: string;
  children?: ConfigFieldSchema[];
}

export const GlobalConfigPanel: React.FC<GlobalConfigPanelProps> = ({ getApiUrl }) => {
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [schemas, setSchemas] = useState<Record<string, ConfigFieldSchema[]>>({});
  const [dynamicValues, setDynamicValues] = useState<Record<string, any>>({});
  const [tempSelectedSources, setTempSelectedSources] = useState<Record<string, string>>({});
  const [tempAliases, setTempAliases] = useState<Record<string, string>>({});
  const [tempChildInputs, setTempChildInputs] = useState<Record<string, Record<string, any>>>({});
  const [editingChild, setEditingChild] = useState<{ fieldKey: string; index: number } | null>(null);
  const [editingChildInputs, setEditingChildInputs] = useState<Record<string, any>>({});
  const [toasts, setToasts] = useState<{ id: string; message: string; type: 'success' | 'error' | 'info' }[]>([]);
  const [initialValues, setInitialValues] = useState<Record<string, any> | null>(null);
  const [isDirty, setIsDirty] = useState(false);

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

  const loadGlobalConfig = async () => {
    try {
      const provRes = await fetch(getApiUrl('/api/config/providers'));
      const provJson = await provRes.json();
      const options: AvailableModel[] = [];
      if (provJson.success && Array.isArray(provJson.data)) {
        for (const p of provJson.data) {
          if (Array.isArray(p.models)) {
            for (const m of p.models) {
              options.push({
                providerId: p.id,
                modelId: m.id,
                displayName: `${p.name} - ${m.name || m.id} (${m.id})`
              });
            }
          }
        }
      }
      setAvailableModels(options);

      const schemaRes = await fetch(getApiUrl('/api/config/schema'));
      const schemaJson = await schemaRes.json();
      let activeSchemas: Record<string, ConfigFieldSchema[]> = {};
      if (schemaJson.success && schemaJson.data) {
        activeSchemas = schemaJson.data;
        setSchemas(activeSchemas);
      }

      const res = await fetch(getApiUrl('/api/config'));
      const json = await res.json();
      if (json.success && json.data) {
        const flatValues: Record<string, any> = {};
        const defaultSources: Record<string, string> = {};

        for (const [ns, fields] of Object.entries(activeSchemas)) {
          for (const field of fields) {
            const val = getValueByPath(json.data, field.key);
            flatValues[field.key] = val !== undefined ? val : field.defaultValue;

            if (field.type === 'array' && field.key.startsWith('models.') && options.length > 0) {
              defaultSources[field.key] = `${options[0].providerId}:::${options[0].modelId}`;
            }
          }
        }
        setDynamicValues(flatValues);
        setTempSelectedSources(defaultSources);
        setInitialValues(flatValues);
        setIsDirty(false);
      }
    } catch (err) {
      console.error('WS load global config failed:', err);
    }
  };

  const saveGlobalConfig = async () => {
    try {
      const finalValues = { ...dynamicValues };

      for (const fields of Object.values(schemas)) {
        for (const field of fields) {
          if (field.type === 'array' && field.key.startsWith('models.')) {
            const selectedSource = tempSelectedSources[field.key];
            if (selectedSource) {
              const [pId, mId] = selectedSource.split(':::');
              const alias = (tempAliases[field.key] || '').trim();
              
              if (alias) {
                const list: ModelBinding[] = Array.isArray(finalValues[field.key]) ? finalValues[field.key] : [];
                const exists = list.some(b => b.provider === pId && b.model === mId);
                if (!exists) {
                  finalValues[field.key] = [...list, {
                    provider: pId,
                    model: mId,
                    name: alias
                  }];
                }
              }
            }
          }

          if (field.type === 'array' && Array.isArray(field.children) && field.children.length > 0) {
            const inputs = tempChildInputs[field.key];
            if (inputs && Object.keys(inputs).length > 0) {
              let hasAnyInput = false;
              let requiredFilled = true;

              for (const child of field.children) {
                const val = inputs[child.key];
                if (val !== undefined && String(val).trim() !== '') {
                  hasAnyInput = true;
                }
                if (child.required && (!val || String(val).trim() === '')) {
                  requiredFilled = false;
                }
              }

              if (hasAnyInput && requiredFilled) {
                const newItem: Record<string, any> = {};
                for (const child of field.children) {
                  let childVal = inputs[child.key];
                  if (childVal === undefined) {
                    childVal = child.defaultValue !== undefined ? child.defaultValue : '';
                  }
                  if (child.type === 'number') {
                    childVal = Number(childVal);
                  } else if (child.type === 'boolean') {
                    childVal = Boolean(childVal);
                  }
                  newItem[child.key] = childVal;
                }
                const list = Array.isArray(finalValues[field.key]) ? finalValues[field.key] : [];
                finalValues[field.key] = [...list, newItem];
              }
            }
          }
        }
      }

      const updates: Record<string, any> = {};
      
      for (const [keyPath, val] of Object.entries(finalValues)) {
        let typedVal: any = val;
        let matchedField: ConfigFieldSchema | null = null;
        for (const fields of Object.values(schemas)) {
          const f = fields.find(item => item.key === keyPath);
          if (f) {
            matchedField = f;
            break;
          }
        }
        if (matchedField) {
          if (matchedField.type === 'number') {
            typedVal = Number(val);
          } else if (matchedField.type === 'boolean') {
            typedVal = Boolean(val);
          }
        }
        updates[keyPath] = typedVal;
      }

      const res = await fetch(getApiUrl('/api/config/batch'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates })
      });
      const json = await res.json();
      if (json.success) {
        showToast('配置保存成功', 'success');
        setTempAliases({});
        setTempChildInputs({});
        setEditingChild(null);
        setEditingChildInputs({});
        setInitialValues(finalValues);
        setIsDirty(false);
        loadGlobalConfig();
      } else {
        showToast(`保存失败: ${json.error || json.message}`, 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('保存配置失败', 'error');
    }
  };

  useEffect(() => {
    loadGlobalConfig();
  }, []);

  useEffect(() => {
    if (!initialValues) return;
    const hasChanged = JSON.stringify(initialValues) !== JSON.stringify(dynamicValues);
    setIsDirty(hasChanged);
  }, [dynamicValues, initialValues]);

  const handleAddBinding = (fieldKey: string, sourceStr: string, alias: string) => {
    if (!sourceStr) {
      showToast('请选择有效的模型源', 'error');
      return;
    }
    const [pId, mId] = sourceStr.split(':::');
    const displayAlias = alias.trim() || mId;
    
    const newBinding: ModelBinding = {
      provider: pId,
      model: mId,
      name: displayAlias
    };

    setDynamicValues(prev => {
      const list = Array.isArray(prev[fieldKey]) ? prev[fieldKey] : [];
      return { ...prev, [fieldKey]: [...list, newBinding] };
    });

    setTempAliases(prev => ({ ...prev, [fieldKey]: '' }));
    showToast('模型绑定已添加', 'success');
  };

  const handleRemoveBinding = (fieldKey: string, index: number) => {
    setDynamicValues(prev => {
      const list = Array.isArray(prev[fieldKey]) ? prev[fieldKey] : [];
      return { ...prev, [fieldKey]: list.filter((_, idx) => idx !== index) };
    });
    showToast('模型绑定已移除', 'success');
  };

  const handleMoveBinding = (fieldKey: string, index: number, direction: 'up' | 'down') => {
    setDynamicValues(prev => {
      const list = Array.isArray(prev[fieldKey]) ? [...prev[fieldKey]] : [];
      if (direction === 'up' && index === 0) return prev;
      if (direction === 'down' && index === list.length - 1) return prev;

      const swapIdx = direction === 'up' ? index - 1 : index + 1;
      const temp = list[index];
      list[index] = list[swapIdx];
      list[swapIdx] = temp;

      return { ...prev, [fieldKey]: list };
    });
  };

  const handleAddChildItem = (fieldKey: string, childrenSchemas: ConfigFieldSchema[]) => {
    const inputs = tempChildInputs[fieldKey] || {};
    for (const child of childrenSchemas) {
      if (child.required && (!inputs[child.key] || String(inputs[child.key]).trim() === '')) {
        showToast(`请填写必填项: ${child.description || child.key}`, 'error');
        return;
      }
    }

    const newItem: Record<string, any> = {};
    for (const child of childrenSchemas) {
      let val = inputs[child.key];
      if (val === undefined) {
        val = child.defaultValue !== undefined ? child.defaultValue : '';
      }
      if (child.type === 'number') {
        val = Number(val);
      } else if (child.type === 'boolean') {
        val = Boolean(val);
      }
      newItem[child.key] = val;
    }

    setDynamicValues(prev => {
      const list = Array.isArray(prev[fieldKey]) ? prev[fieldKey] : [];
      return { ...prev, [fieldKey]: [...list, newItem] };
    });

    setTempChildInputs(prev => ({
      ...prev,
      [fieldKey]: {}
    }));
    showToast('项目已添加', 'success');
  };

  const handleRemoveChildItem = (fieldKey: string, index: number) => {
    setDynamicValues(prev => {
      const list = Array.isArray(prev[fieldKey]) ? prev[fieldKey] : [];
      return { ...prev, [fieldKey]: list.filter((_, idx) => idx !== index) };
    });
    showToast('项目已移除', 'success');
  };

  const handleStartEditChild = (fieldKey: string, index: number, item: any) => {
    setEditingChild({ fieldKey, index });
    setEditingChildInputs(item || {});
  };

  const handleSaveChildItem = (fieldKey: string, index: number, childrenSchemas: ConfigFieldSchema[]) => {
    for (const child of childrenSchemas) {
      if (child.required && (!editingChildInputs[child.key] || String(editingChildInputs[child.key]).trim() === '')) {
        showToast(`请填写必填项: ${child.description || child.key}`, 'error');
        return;
      }
    }

    setDynamicValues(prev => {
      const list = Array.isArray(prev[fieldKey]) ? [...prev[fieldKey]] : [];
      if (index >= 0 && index < list.length) {
        const newItem = { ...list[index] };
        for (const child of childrenSchemas) {
          let val = editingChildInputs[child.key];
          if (val === undefined) {
            val = child.defaultValue !== undefined ? child.defaultValue : '';
          }
          if (child.type === 'number') {
            val = Number(val);
          } else if (child.type === 'boolean') {
            val = Boolean(val);
          }
          newItem[child.key] = val;
        }
        list[index] = newItem;
      }
      return { ...prev, [fieldKey]: list };
    });

    setEditingChild(null);
    setEditingChildInputs({});
    showToast('修改已保存', 'success');
  };

  const sortedNamespaces = Object.keys(schemas).sort((a, b) => {
    if (a === 'core') return -1;
    if (b === 'core') return 1;
    return a.localeCompare(b);
  });

  return (
    <div>
      {sortedNamespaces.map((ns) => {
        const fields = schemas[ns] || [];
        
        const fieldsByCategory: Record<string, ConfigFieldSchema[]> = {};
        for (const field of fields) {
          const cat = field.category || '通用设置';
          if (!fieldsByCategory[cat]) fieldsByCategory[cat] = [];
          fieldsByCategory[cat].push(field);
        }

        if (Object.keys(fieldsByCategory).length === 0) return null;

        const friendlyNsName = ns === 'core' 
          ? '核心系统参数'
          : ns.startsWith('@eoasmxd/freya-plugin-')
            ? `插件专属配置: ${ns.replace('@eoasmxd/freya-plugin-', '')}`
            : `扩展模块配置: ${ns}`;

        return (
          <div key={ns} className="config-group" style={{ marginBottom: '1.8rem', borderBottom: '1px solid rgba(255,255,255,0.02)', paddingBottom: '1.2rem' }}>
            <label className="config-label" style={{ fontSize: '1.05rem', color: '#ffffff', fontWeight: 'bold', borderLeft: '3px solid var(--accent)', paddingLeft: '0.6rem', marginBottom: '1rem' }}>
              {friendlyNsName}
            </label>

            {Object.entries(fieldsByCategory).map(([category, items]) => (
              <div key={category} style={{ marginBottom: '1.4rem' }}>
                <div style={{ fontSize: '0.86rem', fontWeight: 600, color: 'rgba(255, 255, 255, 0.75)', borderLeft: '2px solid var(--accent)', paddingLeft: '0.5rem', marginTop: '1.4rem', marginBottom: '0.8rem' }}>
                  {category}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
                  {items.map((field) => {
                    const currentValue = dynamicValues[field.key];

                    if (field.type === 'array' && field.key.startsWith('models.')) {
                      const bindings: ModelBinding[] = Array.isArray(currentValue) ? currentValue : [];
                      const selectedSource = tempSelectedSources[field.key] || '';
                      const alias = tempAliases[field.key] || '';

                      return (
                        <div key={field.key} className="config-group" style={{ margin: '0.4rem 0' }}>
                          <div className="crud-form-card" style={{ margin: 0, borderStyle: 'solid', borderColor: 'rgba(255,255,255,0.04)', padding: '1rem', gap: '0.8rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.02)', paddingBottom: '0.4rem' }}>
                              <label className="config-label" style={{ fontSize: '0.82rem', color: 'rgba(255, 255, 255, 0.85)', fontWeight: 500, margin: 0 }}>
                                {field.description || field.key}
                              </label>
                              <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>降级 Fallback 链 (越靠上优先级越高)</span>
                            </div>

                            <div className="models-list" style={{ margin: '0.2rem 0' }}>
                              {bindings.length === 0 ? (
                                <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', padding: '0.5rem 0', fontStyle: 'italic' }}>
                                  当前场景未绑定任何运行时模型。系统将使用默认路由。
                                </div>
                              ) : (
                                bindings.map((b, idx) => (
                                  <div key={idx} className="model-item" style={{ padding: '0.5rem 0.8rem', background: 'rgba(255,255,255,0.01)' }}>
                                    <div className="model-name" style={{ fontSize: '0.8rem' }}>
                                      {b.name}{' '}
                                      <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 'normal' }}>
                                        ({b.provider} / {b.model})
                                      </span>
                                    </div>
                                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                                      <button
                                        className="btn-action edit"
                                        title="提高优先级"
                                        disabled={idx === 0}
                                        onClick={() => handleMoveBinding(field.key, idx, 'up')}
                                      >
                                        ▲
                                      </button>
                                      <button
                                        className="btn-action edit"
                                        title="降低优先级"
                                        disabled={idx === bindings.length - 1}
                                        onClick={() => handleMoveBinding(field.key, idx, 'down')}
                                      >
                                        ▼
                                      </button>
                                      <button
                                        className="btn-action delete"
                                        title="移除"
                                        onClick={() => handleRemoveBinding(field.key, idx)}
                                      >
                                        移除
                                      </button>
                                    </div>
                                  </div>
                                ))
                              )}
                            </div>

                            <div style={{ display: 'flex', gap: '0.65rem', alignItems: 'center', marginTop: '0.2rem' }}>
                              <select
                                className="config-input"
                                style={{ flex: 1, fontSize: '0.78rem', padding: '0.4rem 0.6rem', height: '32px' }}
                                value={selectedSource}
                                onChange={(e) => setTempSelectedSources(prev => ({ ...prev, [field.key]: e.target.value }))}
                              >
                                {availableModels.map((opt) => (
                                  <option key={`${opt.providerId}:::${opt.modelId}`} value={`${opt.providerId}:::${opt.modelId}`}>
                                    {opt.displayName}
                                  </option>
                                ))}
                              </select>
                              <input
                                type="text"
                                placeholder="自定义别名 (选填)"
                                className="config-input"
                                style={{ width: '160px', fontSize: '0.78rem', padding: '0.4rem 0.6rem', height: '32px', boxSizing: 'border-box' }}
                                value={alias}
                                onChange={(e) => setTempAliases(prev => ({ ...prev, [field.key]: e.target.value }))}
                              />
                              <button
                                className="btn-primary"
                                style={{ padding: '0.4rem 1rem', fontSize: '0.78rem', height: '32px' }}
                                onClick={() => handleAddBinding(field.key, selectedSource, alias)}
                              >
                                绑定
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    }

                    if (field.type === 'array' && Array.isArray(field.children) && field.children.length > 0) {
                      const itemsList = Array.isArray(currentValue) ? currentValue : [];
                      const childInputs = tempChildInputs[field.key] || {};

                      return (
                        <div key={field.key} className="config-group" style={{ margin: '0.4rem 0' }}>
                          <div className="crud-form-card" style={{ margin: 0, borderStyle: 'solid', borderColor: 'rgba(255,255,255,0.04)', padding: '1rem', gap: '0.8rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.02)', paddingBottom: '0.4rem' }}>
                              <label className="config-label" style={{ fontSize: '0.82rem', color: 'rgba(255, 255, 255, 0.85)', fontWeight: 500, margin: 0 }}>
                                {field.description || field.key}
                              </label>
                              <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>子配置项列表 ({itemsList.length} 项)</span>
                            </div>

                            <div className="models-list" style={{ margin: '0.2rem 0' }}>
                              {itemsList.length === 0 ? (
                                <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', padding: '0.5rem 0', fontStyle: 'italic' }}>
                                  当前列表为空。请在下方表单录入并添加新项目。
                                </div>
                              ) : (
                                itemsList.map((item: any, idx) => {
                                  const isEditing = editingChild?.fieldKey === field.key && editingChild?.index === idx;

                                  return (
                                    <div key={idx} className="model-item" style={{ padding: '0.55rem 0.85rem', background: 'rgba(255,255,255,0.01)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                      {isEditing ? (
                                        <div style={{ flex: 1, display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end', marginRight: '1rem' }}>
                                          {field.children?.map(child => {
                                            const isPassword = child.uiHint === 'password' || child.sensitive;
                                            const childVal = editingChildInputs[child.key] ?? '';

                                            return (
                                              <div key={child.key} style={{ flex: 1, minWidth: '130px' }}>
                                                <label style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.2rem' }}>
                                                  {child.description || child.key}
                                                </label>
                                                {child.type === 'boolean' ? (
                                                  <label className="switch" style={{ margin: '0.2rem 0' }}>
                                                    <input
                                                      type="checkbox"
                                                      checked={Boolean(childVal)}
                                                      onChange={(e) => setEditingChildInputs(prev => ({
                                                        ...prev,
                                                        [child.key]: e.target.checked
                                                      }))}
                                                    />
                                                    <span className="slider" />
                                                  </label>
                                                ) : (
                                                  <input
                                                    type={isPassword ? 'password' : child.type === 'number' ? 'number' : 'text'}
                                                    className="config-input"
                                                    style={{ height: '30px', boxSizing: 'border-box', fontSize: '0.78rem', padding: '0.15rem 0.4rem' }}
                                                    value={childVal}
                                                    onChange={(e) => setEditingChildInputs(prev => ({
                                                      ...prev,
                                                      [child.key]: e.target.value
                                                    }))}
                                                  />
                                                )}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      ) : (
                                        <div style={{ fontSize: '0.78rem', color: 'var(--text-primary)', display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
                                          {field.children?.map(child => {
                                            const isSensitive = child.sensitive || child.uiHint === 'password';
                                            const valStr = isSensitive ? '******' : String(item[child.key] ?? '');
                                            return (
                                              <span key={child.key}>
                                                <span style={{ color: 'var(--text-secondary)' }}>{child.description || child.key}:</span>{' '}
                                                <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{valStr}</span>
                                              </span>
                                            );
                                          })}
                                        </div>
                                      )}

                                      <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
                                        {isEditing ? (
                                          <>
                                            <button
                                              className="btn-action edit"
                                              title="保存"
                                              onClick={() => handleSaveChildItem(field.key, idx, field.children || [])}
                                            >
                                              保存
                                            </button>
                                            <button
                                              className="btn-action delete"
                                              title="取消"
                                              onClick={() => { setEditingChild(null); setEditingChildInputs({}); }}
                                            >
                                              取消
                                            </button>
                                          </>
                                        ) : (
                                          <>
                                            <button
                                              className="btn-action edit"
                                              title="编辑"
                                              onClick={() => handleStartEditChild(field.key, idx, item)}
                                            >
                                              编辑
                                            </button>
                                            <button
                                              className="btn-action delete"
                                              title="删除"
                                              onClick={() => handleRemoveChildItem(field.key, idx)}
                                            >
                                              删除
                                            </button>
                                          </>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })
                              )}
                            </div>

                            <div style={{ background: 'rgba(0,0,0,0.1)', padding: '0.75rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.02)', marginTop: '0.3rem' }}>
                              <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.3)', fontWeight: 600, marginBottom: '0.5rem' }}>添加新项</div>
                              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                                {field.children.map(child => {
                                  const isPassword = child.uiHint === 'password' || child.sensitive;
                                  const childVal = childInputs[child.key] ?? '';
                                  const placeholderText = child.required ? `${child.description} (必填)` : child.description;

                                  return (
                                    <div key={child.key} style={{ flex: 1, minWidth: '150px' }}>
                                      <label style={{ fontSize: '0.74rem', color: 'rgba(255, 255, 255, 0.7)', display: 'block', marginBottom: '0.2rem', fontWeight: 500 }}>
                                        {child.description || child.key}
                                      </label>
                                      {child.type === 'boolean' ? (
                                        <label className="switch" style={{ margin: '0.2rem 0' }}>
                                          <input
                                            type="checkbox"
                                            checked={Boolean(childVal)}
                                            onChange={(e) => setTempChildInputs(prev => ({
                                              ...prev,
                                              [field.key]: {
                                                ...(prev[field.key] || {}),
                                                [child.key]: e.target.checked
                                              }
                                            }))}
                                          />
                                          <span className="slider" />
                                        </label>
                                      ) : (
                                        <input
                                          type={isPassword ? 'password' : child.type === 'number' ? 'number' : 'text'}
                                          placeholder={placeholderText}
                                          className="config-input"
                                          style={{ height: '32px', boxSizing: 'border-box', fontSize: '0.78rem', padding: '0.2rem 0.5rem' }}
                                          value={childVal}
                                          onChange={(e) => setTempChildInputs(prev => ({
                                            ...prev,
                                            [field.key]: {
                                              ...(prev[field.key] || {}),
                                              [child.key]: e.target.value
                                            }
                                          }))}
                                        />
                                      )}
                                    </div>
                                  );
                                })}
                                <button
                                  className="btn-primary"
                                  style={{ padding: '0.4rem 1.2rem', fontSize: '0.78rem', height: '32px', flexShrink: 0 }}
                                  onClick={() => handleAddChildItem(field.key, field.children || [])}
                                >
                                  添加
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    }

                    const displayLabel = field.description || field.key;
                    const isBoolean = field.type === 'boolean';

                    return (
                      <div key={field.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 0.25rem', borderBottom: '1px solid rgba(255, 255, 255, 0.025)' }}>
                        <label className="config-label" style={{ fontSize: '0.84rem', color: 'rgba(255, 255, 255, 0.85)', fontWeight: 500, margin: 0 }}>
                          {displayLabel}
                        </label>
                        {isBoolean ? (
                          <label className="switch" style={{ margin: 0 }}>
                            <input
                              type="checkbox"
                              checked={Boolean(currentValue)}
                              onChange={(e) => setDynamicValues(prev => ({ ...prev, [field.key]: e.target.checked }))}
                            />
                            <span className="slider" />
                          </label>
                        ) : field.type === 'number' ? (
                          <input
                            type="number"
                            className="config-input"
                            style={{ width: '280px', height: '34px', boxSizing: 'border-box', margin: 0 }}
                            value={currentValue ?? ''}
                            onChange={(e) => setDynamicValues(prev => ({ ...prev, [field.key]: Number(e.target.value) }))}
                          />
                        ) : (
                          <input
                            type="text"
                            className="config-input"
                            style={{ width: '280px', height: '34px', boxSizing: 'border-box', margin: 0 }}
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
                              setDynamicValues(prev => ({ ...prev, [field.key]: val }));
                            }}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        );
      })}

      <button
        className={`floating-save-btn ${isDirty ? 'dirty' : 'clean'}`}
        onClick={saveGlobalConfig}
        disabled={!isDirty}
        title={isDirty ? '有未保存的修改，点击保存' : '配置无改变'}
      >
        <span style={{ fontSize: '1.1rem' }}>{isDirty ? '💾' : '✓'}</span>
        {isDirty ? '保存配置' : '无修改'}
      </button>

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
