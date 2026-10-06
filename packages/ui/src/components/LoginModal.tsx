import React, { useState } from 'react';
import { useI18n } from '../i18n/index.js';

interface LoginModalProps {
  onSuccess: (token: string) => void;
  getApiUrl: (path: string) => string;
}

export const LoginModal: React.FC<LoginModalProps> = ({ onSuccess, getApiUrl }) => {
  const { t } = useI18n();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim() || loading) return;

    setLoading(true);
    setError('');

    try {
      const res = await fetch(getApiUrl('/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      const data = await res.json();
      if (res.ok && data.success && data.token) {
        onSuccess(data.token);
      } else {
        if (data.code === 'INVALID_PASSWORD' || data.error === 'Invalid password') {
          setError(t('auth.incorrectPassword', 'Incorrect password, please try again'));
        } else if (data.code === 'PASSWORD_REQUIRED' || data.error === 'Password required') {
          setError(t('auth.passwordRequired', 'Password is required'));
        } else {
          setError(data.error ? t(data.error, data.error) : t('auth.incorrectPassword', 'Incorrect password, please try again'));
        }
      }
    } catch {
      setError(t('auth.networkError', 'Authentication failed, please check connection'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="confirm-modal-overlay" style={{ zIndex: 9999, backdropFilter: 'blur(8px)' }}>
      <div className="confirm-modal-card" style={{ maxWidth: '420px', width: '90%' }}>
        <div className="confirm-modal-title" style={{ fontSize: '1.25rem' }}>
          <span>🔐</span>
          <span>{t('auth.loginTitle', 'Access Authentication')}</span>
        </div>
        <div className="confirm-modal-desc" style={{ marginBottom: '1.25rem' }}>
          {t('auth.loginDesc', 'This console is password protected. Please enter access password to continue.')}
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('auth.passwordPlaceholder', 'Enter access password...')}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '0.65rem 0.85rem',
              borderRadius: '6px',
              border: error ? '1px solid #f43f5e' : '1px solid rgba(255, 255, 255, 0.15)',
              background: 'rgba(255, 255, 255, 0.05)',
              color: '#fff',
              fontSize: '0.95rem',
              outline: 'none'
            }}
          />

          {error && (
            <div style={{ color: '#f43f5e', fontSize: '0.85rem', marginTop: '-0.25rem' }}>
              {error}
            </div>
          )}

          <div className="confirm-modal-actions" style={{ marginTop: '0.5rem', justifyContent: 'flex-end' }}>
            <button
              type="submit"
              className="btn-primary"
              disabled={loading || !password.trim()}
              style={{
                height: '36px',
                padding: '0 1.25rem',
                opacity: loading || !password.trim() ? 0.6 : 1,
                cursor: loading || !password.trim() ? 'not-allowed' : 'pointer'
              }}
            >
              {loading ? '...' : t('auth.unlock', 'Verify and Enter')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
