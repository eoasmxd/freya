import React, { useEffect, useState } from 'react';

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
      console.error('加载技能列表失败:', err);
      showToast('加载技能列表失败', 'error');
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
        showToast(`技能 "${skillId}" 已${enabled ? '启用' : '禁用'}`, 'success');
        loadSkills();
      } else {
        showToast(`切换技能状态失败: ${json.message || json.error}`, 'error');
      }
    } catch (err) {
      console.error('切换技能状态失败:', err);
      showToast('切换技能状态失败', 'error');
    }
  };

  if (loading && skills.length === 0) {
    return <div style={{ padding: '1rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>正在加载技能卡配置...</div>;
  }

  if (!loading && skills.length === 0) {
    return (
      <div style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
        暂未扫描到任何技能卡。可在 <code>~/.freya/skills/</code> 目录下添加 <code>*.md</code> 技能卡文件。
      </div>
    );
  }

  const getSourceTagMeta = (source?: string) => {
    switch (source) {
      case 'builtin':
        return { label: '内置', bg: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa' };
      case 'launch':
        return { label: '集成', bg: 'rgba(168, 85, 247, 0.15)', color: '#c084fc' };
      case 'runtime':
      default:
        return { label: '自定义', bg: 'rgba(16, 185, 129, 0.15)', color: '#34d399' };
    }
  };

  return (
    <div className="plugins-list">
      {skills.map((skill) => {
        const displayName = skill.name || skill.id;
        const displayDesc = skill.description || '未提供描述信息';
        const tagMeta = getSourceTagMeta(skill.source);

        return (
          <div key={skill.id} className="plugin-card">
            <div>
              <div className="plugin-title">
                {displayName}
                <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 'normal', marginLeft: '0.5rem' }}>
                  ({skill.id})
                </span>
                <span
                  style={{
                    fontSize: '0.68rem',
                    marginLeft: '0.5rem',
                    padding: '0.1rem 0.4rem',
                    borderRadius: '4px',
                    background: tagMeta.bg,
                    color: tagMeta.color
                  }}
                >
                  {tagMeta.label}
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
