import React, { useEffect, useState } from 'react';
import { useI18n } from '../../../i18n';

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
  manualOnly?: boolean;
  readonly?: boolean;
  uiHint?: string;
  enumValues?: (string | { value: string; label?: string })[];
  children?: ConfigFieldSchema[];
}

export const GlobalConfigPanel: React.FC<GlobalConfigPanelProps> = ({ getApiUrl }) => {
  const { t } = useI18n();

  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [schemas, setSchemas] = useState<Record<string, ConfigFieldSchema[]>>({});
  const [dynamicValues, setDynamicValues] = useState<Record<string, any>>({});
  const [tempSelectedSources, setTempSelectedSources] = useState<Record<string, string>>({});
  const [tempAliases, setTempAliases] = useState<Record<string, string>>({});
  const [tempChildInputs, setTempChildInputs] = useState<Record<string, Record<string, any>>>({});
  const [addingChildFieldKey, setAddingChildFieldKey] = useState<string | null>(null);
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
        showToast(t('global.saveSuccess', 'Configuration saved successfully'), 'success');
        setTempAliases({});
        setTempChildInputs({});
        setEditingChild(null);
        setEditingChildInputs({});
        setAddingChildFieldKey(null);
        setInitialValues(finalValues);
        setIsDirty(false);
        loadGlobalConfig();
      } else {
        showToast(t('global.saveFailed', 'Failed to save configuration: {error}', { error: json.error || json.message }), 'error');
      }
    } catch (err) {
      console.error(err);
      showToast(t('global.saveError', 'Failed to save configuration'), 'error');
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
      showToast(t('global.selectValidSource', 'Please select a valid model source'), 'error');
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
    showToast(t('global.bindingAdded', 'Model binding added'), 'success');
  };

  const handleRemoveBinding = (fieldKey: string, index: number) => {
    setDynamicValues(prev => {
      const list = Array.isArray(prev[fieldKey]) ? prev[fieldKey] : [];
      return { ...prev, [fieldKey]: list.filter((_, idx) => idx !== index) };
    });
    showToast(t('global.bindingRemoved', 'Model binding removed'), 'success');
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

  const handleStartAddChild = (fieldKey: string, childrenSchemas: ConfigFieldSchema[]) => {
    setEditingChild(null);
    setEditingChildInputs({});
    const initialInputs: Record<string, any> = {};
    for (const child of childrenSchemas) {
      if (child.defaultValue !== undefined) {
        initialInputs[child.key] = child.defaultValue;
      } else if (child.type === 'boolean') {
        initialInputs[child.key] = false;
      } else {
        initialInputs[child.key] = '';
      }
    }
    setTempChildInputs(prev => ({
      ...prev,
      [fieldKey]: initialInputs
    }));
    setAddingChildFieldKey(fieldKey);
  };

  const handleCancelAddChild = (fieldKey: string) => {
    setTempChildInputs(prev => ({
      ...prev,
      [fieldKey]: {}
    }));
    setAddingChildFieldKey(null);
  };

  const handleConfirmAddChild = (fieldKey: string, childrenSchemas: ConfigFieldSchema[]) => {
    const inputs = tempChildInputs[fieldKey] || {};
    for (const child of childrenSchemas) {
      if (child.required && (inputs[child.key] === undefined || String(inputs[child.key]).trim() === '')) {
        showToast(t('global.requiredField', 'Please fill in required field: {field}', { field: child.description || child.key }), 'error');
        return;
      }
    }

    const newItem: Record<string, any> = {};
    for (const child of childrenSchemas) {
      let val = inputs[child.key];
      if (val === undefined || val === '') {
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
    setAddingChildFieldKey(null);
    showToast(t('global.itemAddedHint', 'New item added, click save to persist changes'), 'info');
  };

  const handleRemoveChildItem = (fieldKey: string, index: number) => {
    setDynamicValues(prev => {
      const list = Array.isArray(prev[fieldKey]) ? prev[fieldKey] : [];
      return { ...prev, [fieldKey]: list.filter((_, idx) => idx !== index) };
    });
    showToast(t('global.itemRemoved', 'Item removed'), 'success');
  };

  const handleStartEditChild = (fieldKey: string, index: number, item: any) => {
    setAddingChildFieldKey(null);
    setEditingChild({ fieldKey, index });
    setEditingChildInputs(item || {});
  };

  const handleSaveChildItem = (fieldKey: string, index: number, childrenSchemas: ConfigFieldSchema[]) => {
    for (const child of childrenSchemas) {
      if (child.required && (!editingChildInputs[child.key] || String(editingChildInputs[child.key]).trim() === '')) {
        showToast(t('global.requiredField', 'Please fill in required field: {field}', { field: child.description || child.key }), 'error');
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
    showToast(t('global.itemSaved', 'Changes saved'), 'success');
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
          const cat = field.category || t('global.defaultCategory', 'General Settings');
          if (!fieldsByCategory[cat]) fieldsByCategory[cat] = [];
          fieldsByCategory[cat].push(field);
        }

        if (Object.keys(fieldsByCategory).length === 0) return null;

        const friendlyNsName = ns === 'core'
          ? t('global.coreNsName', 'Core System Parameters')
          : ns.startsWith('@eoasmxd/freya-plugin-')
            ? t('global.pluginNsPrefix', 'Plugin Config: {name}', { name: ns.replace('@eoasmxd/freya-plugin-', '') })
            : t('global.extNsPrefix', 'Extension Config: {name}', { name: ns });

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
                              <label className="config-label" style={{ fontSize: '0.82rem', color: field.readonly ? 'rgba(255, 255, 255, 0.45)' : 'rgba(255, 255, 255, 0.85)', fontWeight: 500, margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                                {field.description || field.key}
                                {field.readonly && <span title={t('global.fieldReadonlyHint', 'Current item is locked as read-only')} style={{ fontSize: '12px', cursor: 'help' }}>🔒</span>}
                              </label>
                              <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{t('global.fallbackChainHint', 'Fallback Chain (Higher has greater priority)')}</span>
                            </div>

                            <div className="models-list" style={{ margin: '0.4rem 0', marginLeft: '0.6rem', paddingLeft: '0.85rem', borderLeft: '2px solid rgba(255, 255, 255, 0.08)', display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                              {bindings.length === 0 ? (
                                <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', padding: '0.4rem 0', fontStyle: 'italic' }}>
                                  {t('global.noModelBound', 'No runtime model bound. System will use default routing.')}
                                </div>
                              ) : (
                                bindings.map((b, idx) => (
                                  <div key={idx} className="model-item" style={{ padding: '0.55rem 0.85rem', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.03)' }}>
                                    <div className="model-name" style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                      <span style={{ background: 'rgba(255,255,255,0.08)', padding: '0.1rem 0.35rem', borderRadius: '4px', fontSize: '0.7rem' }}>#{idx + 1}</span>
                                      <span style={{ fontWeight: 600 }}>{b.name}</span>
                                      <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 'normal' }}>
                                        ({b.provider} / {b.model})
                                      </span>
                                    </div>
                                    {!field.readonly && (
                                      <div style={{ display: 'flex', gap: '0.4rem' }}>
                                        <button
                                          className="btn-action edit"
                                          title={t('global.moveUp', 'Move up')}
                                          disabled={idx === 0}
                                          onClick={() => handleMoveBinding(field.key, idx, 'up')}
                                        >
                                          ▲
                                        </button>
                                        <button
                                          className="btn-action edit"
                                          title={t('global.moveDown', 'Move down')}
                                          disabled={idx === bindings.length - 1}
                                          onClick={() => handleMoveBinding(field.key, idx, 'down')}
                                        >
                                          ▼
                                        </button>
                                        <button
                                          className="btn-action delete"
                                          title={t('common.remove', 'Remove')}
                                          onClick={() => handleRemoveBinding(field.key, idx)}
                                        >
                                          {t('common.remove', 'Remove')}
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                ))
                              )}
                            </div>

                            {!field.readonly && (
                              <div style={{ display: 'flex', gap: '0.65rem', alignItems: 'center', marginTop: '0.4rem', marginLeft: '0.6rem' }}>
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
                                  placeholder={t('global.aliasPlaceholder', 'Custom alias (optional)')}
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
                                  {t('global.btnBind', 'Bind')}
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    }

                    if (field.type === 'array' && Array.isArray(field.children) && field.children.length > 0) {
                      const itemsList = Array.isArray(currentValue) ? currentValue : [];
                      const childInputs = tempChildInputs[field.key] || {};
                      const isAddingThisField = addingChildFieldKey === field.key;

                      return (
                        <div key={field.key} className="config-group" style={{ margin: '0.6rem 0' }}>
                          <div className="crud-form-card" style={{ margin: 0, borderStyle: 'solid', borderColor: 'rgba(255,255,255,0.06)', padding: '1rem', gap: '0.8rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.04)', paddingBottom: '0.5rem' }}>
                              <label className="config-label" style={{ fontSize: '0.84rem', color: field.readonly ? 'rgba(255, 255, 255, 0.45)' : 'rgba(255, 255, 255, 0.9)', fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                                {field.description || field.key}
                                {field.readonly && <span title={t('global.fieldReadonlyHint', 'Current item is locked as read-only')} style={{ fontSize: '12px', cursor: 'help' }}>🔒</span>}
                              </label>
                              <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{t('global.configuredItemsCount', '{count} items configured', { count: itemsList.length })}</span>
                            </div>

                            <div className="models-list" style={{ margin: '0.6rem 0', marginLeft: '1.2rem', paddingLeft: '1rem', borderLeft: '2px solid rgba(255, 255, 255, 0.1)', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                              {itemsList.length === 0 && !isAddingThisField ? (
                                <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', padding: '0.4rem 0', fontStyle: 'italic' }}>
                                  {t('global.emptyChildList', 'List is empty. Click "+ Add Item" below to create one.')}
                                </div>
                              ) : (
                                itemsList.map((item: any, idx) => {
                                  const isEditing = editingChild?.fieldKey === field.key && editingChild?.index === idx;

                                  return (
                                    <div key={idx} className="model-item" style={{ padding: '0.85rem 1.1rem', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: '0.65rem', boxSizing: 'border-box', width: '100%' }}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.03)', paddingBottom: '0.35rem' }}>
                                        <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'rgba(255, 255, 255, 0.65)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                          <span style={{ background: 'rgba(255,255,255,0.08)', padding: '0.1rem 0.35rem', borderRadius: '4px', fontSize: '0.7rem' }}>#{idx + 1}</span>
                                          <span>{item[field.children![0].key] ? String(item[field.children![0].key]) : t('global.defaultItemLabel', 'Item')}</span>
                                        </div>
                                        <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                                          {!field.readonly && (isEditing ? (
                                            <>
                                              <button
                                                className="btn-action edit"
                                                title={t('common.save', 'Save')}
                                                onClick={() => handleSaveChildItem(field.key, idx, field.children || [])}
                                              >
                                                {t('common.save', 'Save')}
                                              </button>
                                              <button
                                                className="btn-action delete"
                                                title={t('common.cancel', 'Cancel')}
                                                onClick={() => { setEditingChild(null); setEditingChildInputs({}); }}
                                              >
                                                {t('common.cancel', 'Cancel')}
                                              </button>
                                            </>
                                          ) : (
                                            <>
                                              <button
                                                className="btn-action edit"
                                                title={t('common.edit', 'Edit')}
                                                onClick={() => handleStartEditChild(field.key, idx, item)}
                                              >
                                                {t('common.edit', 'Edit')}
                                              </button>
                                              <button
                                                className="btn-action delete"
                                                title={t('common.delete', 'Delete')}
                                                onClick={() => handleRemoveChildItem(field.key, idx)}
                                              >
                                                {t('common.delete', 'Delete')}
                                              </button>
                                            </>
                                          ))}
                                        </div>
                                      </div>

                                      {isEditing ? (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', paddingTop: '0.3rem' }}>
                                          {field.children?.map(child => {
                                            const isPassword = child.uiHint === 'password' || child.sensitive;
                                            const childVal = editingChildInputs[child.key] ?? '';

                                            return (
                                              <div key={child.key} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', width: '100%' }}>
                                                <label style={{ fontSize: '0.74rem', color: 'rgba(255,255,255,0.7)', fontWeight: 500 }}>
                                                  {child.description || child.key}
                                                  {child.required && <span style={{ color: 'var(--color-danger, #ef4444)', marginLeft: '0.2rem' }}>*</span>}
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
                                                    style={{ height: '32px', width: '100%', boxSizing: 'border-box', fontSize: '0.78rem', padding: '0.25rem 0.6rem' }}
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
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem 1.2rem', padding: '0.2rem 0' }}>
                                          {field.children?.map(child => {
                                            const isSensitive = child.sensitive || child.uiHint === 'password';
                                            const valStr = isSensitive ? '******' : (item[child.key] !== undefined && item[child.key] !== '' ? String(item[child.key]) : '-');
                                            return (
                                              <div key={child.key} style={{ flex: '1 1 calc(50% - 1.2rem)', minWidth: '240px', maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: '0.2rem', overflow: 'hidden' }}>
                                                <span style={{ color: 'var(--text-secondary)', fontSize: '0.72rem', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{child.description || child.key}</span>
                                                <span style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: '0.8rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={isSensitive ? undefined : valStr}>{valStr}</span>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })
                              )}

                              {isAddingThisField && (
                                <div className="model-item" style={{ padding: '0.85rem 1.1rem', background: 'rgba(59, 130, 246, 0.04)', borderRadius: '8px', border: '1px dashed rgba(59, 130, 246, 0.35)', display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: '0.65rem', boxSizing: 'border-box', width: '100%' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.04)', paddingBottom: '0.35rem' }}>
                                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-primary, #3b82f6)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                      <span style={{ background: 'rgba(59, 130, 246, 0.15)', padding: '0.1rem 0.35rem', borderRadius: '4px', fontSize: '0.7rem' }}>+ {t('common.new', 'New')}</span>
                                      <span>{t('global.enterNewItem', 'Enter New Item')}</span>
                                    </div>
                                    <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                                      <button
                                        className="btn-action edit"
                                        title={t('common.confirm', 'Confirm')}
                                        onClick={() => handleConfirmAddChild(field.key, field.children || [])}
                                      >
                                        {t('common.confirm', 'Confirm')}
                                      </button>
                                      <button
                                        className="btn-action delete"
                                        title={t('common.cancel', 'Cancel')}
                                        onClick={() => handleCancelAddChild(field.key)}
                                      >
                                        {t('common.cancel', 'Cancel')}
                                      </button>
                                    </div>
                                  </div>

                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', paddingTop: '0.3rem' }}>
                                    {field.children.map(child => {
                                      const isPassword = child.uiHint === 'password' || child.sensitive;
                                      const childVal = childInputs[child.key] ?? '';
                                      const placeholderText = child.required ? `${child.description || child.key} (${t('common.required', 'Required')})` : (child.description || child.key);

                                      return (
                                        <div key={child.key} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', width: '100%' }}>
                                          <label style={{ fontSize: '0.74rem', color: 'rgba(255, 255, 255, 0.7)', fontWeight: 500 }}>
                                            {child.description || child.key}
                                            {child.required && <span style={{ color: 'var(--color-danger, #ef4444)', marginLeft: '0.2rem' }}>*</span>}
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
                                              style={{ height: '32px', width: '100%', boxSizing: 'border-box', fontSize: '0.78rem', padding: '0.25rem 0.6rem' }}
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
                                  </div>
                                </div>
                              )}
                            </div>

                            {!field.readonly && !isAddingThisField && (
                              <div style={{ marginTop: '0.5rem', marginLeft: '1.2rem' }}>
                                <button
                                  type="button"
                                  className="btn-action"
                                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '0.4rem 0.85rem', fontSize: '0.76rem', background: 'rgba(255, 255, 255, 0.04)', border: '1px dashed rgba(255, 255, 255, 0.15)', borderRadius: '6px', cursor: 'pointer', color: 'var(--text-secondary)' }}
                                  onClick={() => handleStartAddChild(field.key, field.children || [])}
                                >
                                  <span>+ {t('global.btnAddItem', 'Add Item')}</span>
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    }

                    const displayLabel = field.description || field.key;
                    const isBoolean = field.type === 'boolean';

                    return (
                      <div key={field.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 0.25rem', borderBottom: '1px solid rgba(255, 255, 255, 0.025)' }}>
                        <label className="config-label" style={{ fontSize: '0.84rem', color: field.readonly ? 'rgba(255, 255, 255, 0.45)' : 'rgba(255, 255, 255, 0.85)', fontWeight: 500, margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                          {displayLabel}
                          {field.readonly && <span title={t('global.fieldReadonlyHint', 'Current item is locked as read-only')} style={{ fontSize: '12px', cursor: 'help' }}>🔒</span>}
                        </label>
                        {isBoolean ? (
                          <label className="switch" style={{ margin: 0, opacity: field.readonly ? 0.5 : 1, cursor: field.readonly ? 'not-allowed' : 'pointer' }}>
                            <input
                              type="checkbox"
                              disabled={field.readonly}
                              checked={Boolean(currentValue)}
                              onChange={(e) => setDynamicValues(prev => ({ ...prev, [field.key]: e.target.checked }))}
                            />
                            <span className="slider" />
                          </label>
                        ) : field.enumValues && field.enumValues.length > 0 ? (
                          <select
                            disabled={field.readonly}
                            className="config-input"
                            style={{ width: '280px', height: '34px', boxSizing: 'border-box', margin: 0, opacity: field.readonly ? 0.5 : 1, cursor: field.readonly ? 'not-allowed' : undefined }}
                            value={currentValue ?? field.defaultValue ?? (typeof field.enumValues[0] === 'object' ? field.enumValues[0]?.value : field.enumValues[0])}
                            onChange={(e) => setDynamicValues(prev => ({ ...prev, [field.key]: e.target.value }))}
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
                            disabled={field.readonly}
                            className="config-input"
                            style={{ width: '280px', height: '34px', boxSizing: 'border-box', margin: 0, opacity: field.readonly ? 0.5 : 1, cursor: field.readonly ? 'not-allowed' : undefined }}
                            value={currentValue ?? ''}
                            onChange={(e) => setDynamicValues(prev => ({ ...prev, [field.key]: Number(e.target.value) }))}
                          />
                        ) : (
                          <input
                            type="text"
                            disabled={field.readonly}
                            className="config-input"
                            style={{ width: '280px', height: '34px', boxSizing: 'border-box', margin: 0, opacity: field.readonly ? 0.5 : 1, cursor: field.readonly ? 'not-allowed' : undefined }}
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
        title={isDirty ? t('global.dirtyHint', 'Unsaved changes, click to save') : t('global.cleanHint', 'No changes')}
      >
        <span style={{ fontSize: '1.1rem' }}>{isDirty ? '💾' : '✓'}</span>
        {isDirty ? t('global.btnSaveConfig', 'Save Config') : t('global.btnCleanConfig', 'No Changes')}
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
