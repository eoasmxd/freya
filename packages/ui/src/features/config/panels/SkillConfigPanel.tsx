import React, { useEffect, useState } from 'react';
import { useI18n } from '../../../i18n/index.js';

interface SkillEntry {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  source: 'builtin' | 'launch' | 'runtime';
}

interface SkillConfigPanelProps {
  getApiUrl: (path: string) => string;
}

export const SkillConfigPanel: React.FC<SkillConfigPanelProps> = ({ getApiUrl }) => {
  const { t } = useI18n();
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [toasts, setToasts] = useState<{ id: string; message: string; type: 'success' | 'error' | 'info' }[]>([]);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    const id = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID()
      : Math.random().toString(36).substring(2, 15);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  };

  const loadSkills = async () => {
    try {
      setLoading(true);
      const res = await fetch(getApiUrl('/api/config/skills'));
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setSkills(json.data);
      }
    } catch (err) {
      console.error('Failed to load skills list:', err);
      showToast(t('skill.loadFailed', 'Failed to load skills list'), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSkills();
  }, []);

  const toggleSkill = async (skillId: string, enabled: boolean) => {
    try {
      const res = await fetch(getApiUrl('/api/config/skills/toggle'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skillId, enabled })
      });
      const json = await res.json();
      if (json.success) {
        const statusText = enabled ? t('skill.enabled', 'enabled') : t('skill.disabled', 'disabled');
        showToast(t('skill.toggleSuccess', 'Skill "{id}" {status}', { id: skillId, status: statusText }), 'success');
        loadSkills();
      } else {
        showToast(t('skill.toggleFailed', 'Failed to change skill status: {error}', { error: json.message || json.error }), 'error');
      }
    } catch (err) {
      console.error('Failed to toggle skill status:', err);
      showToast(t('skill.toggleError', 'Failed to change skill status'), 'error');
    }
  };

  if (loading && skills.length === 0) {
    return <div style={{ padding: '1rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{t('skill.loading', 'Loading skills configuration...')}</div>;
  }

  if (!loading && skills.length === 0) {
    return (
      <div style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
        {t('skill.emptyHint', 'No skill cards found. You can add *.md files under ~/.freya/skills/.')}
      </div>
    );
  }

  const getSourceTagMeta = (source?: string) => {
    switch (source) {
      case 'builtin':
        return { label: t('skill.sourceBuiltin', 'Builtin'), bg: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa' };
      case 'launch':
        return { label: t('skill.sourceLaunch', 'Packaged'), bg: 'rgba(168, 85, 247, 0.15)', color: '#c084fc' };
      case 'runtime':
      default:
        return { label: t('skill.sourceCustom', 'Custom'), bg: 'rgba(16, 185, 129, 0.15)', color: '#34d399' };
    }
  };

  return (
    <div className="plugins-list">
      {skills.map((skill) => {
        const displayName = skill.name || skill.id;
        const displayDesc = skill.description || t('skill.noDesc', 'No description provided');
        const tagMeta = getSourceTagMeta(skill.source);

        return (
          <div key={skill.id} className="plugin-card">
            <div>
              <div className="plugin-title">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                  <span>{displayName}</span>
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
                </div>
                <span className="plugin-id-tag">
                  ({skill.id})
                </span>
              </div>
              <div className="plugin-desc">{displayDesc}</div>
            </div>
            <div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={skill.enabled}
                  onChange={(e) => toggleSkill(skill.id, e.target.checked)}
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
