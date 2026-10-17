import React, { useEffect, useState, useRef } from 'react';
import { useI18n } from '../../../../i18n/index.js';

interface McpAuthModalProps {
  serverId: string;
  getApiUrl: (path: string) => string;
  onClose: () => void;
  onSuccess: () => void;
}

/**
 * MCP 服务鉴权引导弹窗
 * Authentication modal supporting OAuth 2.1 authorization code flow and RFC 8628 Device Flow
 */
export const McpAuthModal: React.FC<McpAuthModalProps> = ({
  serverId,
  getApiUrl,
  onClose,
  onSuccess
}) => {
  const { t } = useI18n();
  const [loading, setLoading] = useState<boolean>(true);
  const [authMode, setAuthMode] = useState<'device_flow' | 'browser' | null>(null);
  const [userCode, setUserCode] = useState<string>('');
  const [verificationUri, setVerificationUri] = useState<string>('');
  const [authUrl, setAuthUrl] = useState<string>('');
  const [callbackInput, setCallbackInput] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearPolling = () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  useEffect(() => {
    let isMounted = true;

    const startAuth = async () => {
      try {
        setLoading(true);
        setErrorMsg('');
        const res = await fetch(getApiUrl('/api/config/mcp/auth'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serverId, action: 'initiate' })
        });
        const data = await res.json();
        if (!isMounted) return;

        if (data.success && data.data) {
          const authData = data.data;
          const isDevice = authData.type === 'device' || authData.mode === 'device_flow';
          setAuthMode(isDevice ? 'device_flow' : 'browser');
          if (isDevice) {
            const info = authData.info || authData;
            setUserCode(info.userCode || info.user_code || '');
            setVerificationUri(info.verificationUriComplete || info.verification_uri_complete || info.verificationUri || info.verification_uri || '');
            startPolling('device_flow');
          } else {
            setAuthUrl(authData.authorizationUrl || authData.authUrl || '');
            startPolling('browser');
          }
        } else {
          setErrorMsg(data.message || data.error || 'Failed to initiate authorization');
        }
      } catch (err: any) {
        if (!isMounted) return;
        setErrorMsg(err.message || 'Network error occurred during authorization');
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    startAuth();

    return () => {
      isMounted = false;
      clearPolling();
    };
  }, [serverId]);

  const startPolling = (mode: 'device_flow' | 'browser') => {
    clearPolling();
    pollTimerRef.current = setInterval(async () => {
      try {
        const res = await fetch(getApiUrl('/api/config/mcp/auth'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serverId, action: 'poll' })
        });
        const data = await res.json();
        if (data.success && data.data?.status === 'success') {
          clearPolling();
          onSuccess();
        } else if (data.data?.status === 'error' && mode === 'device_flow') {
          clearPolling();
          setErrorMsg(data.data.error || 'Device flow authorization failed or expired');
        }
      } catch {
      }
    }, 2500);
  };

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(userCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
    }
  };

  const handleSubmitCallback = async () => {
    if (!callbackInput.trim()) return;
    try {
      setIsSubmitting(true);
      setErrorMsg('');

      let code = callbackInput.trim();
      let redirectUri: string | undefined;

      try {
        const urlObj = new URL(code);
        const queryCode = urlObj.searchParams.get('code');
        if (queryCode) {
          code = queryCode;
          redirectUri = `${urlObj.origin}${urlObj.pathname}`;
        }
      } catch {
      }

      const res = await fetch(getApiUrl('/api/config/mcp/auth'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverId,
          action: 'callback',
          code,
          redirectUri
        })
      });
      const data = await res.json();
      if (data.success) {
        onSuccess();
      } else {
        setErrorMsg(data.message || data.error || 'Token exchange failed');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to exchange token');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="confirm-modal-overlay" onClick={(e) => e.stopPropagation()}>
      <div className="mcp-auth-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="mcp-auth-dialog-header">
          <div className="mcp-auth-dialog-title-group">
            <span className="mcp-auth-dialog-icon">🔑</span>
            <h3 className="mcp-auth-dialog-title">
              {t('mcp.authModalTitle', 'MCP Server [{id}] Authentication', { id: serverId })}
            </h3>
            <span className="mcp-auth-badge">OAuth 2.1</span>
          </div>
          <button className="modal-close" onClick={onClose} title={t('common.close', 'Close')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <div className="mcp-auth-dialog-body">
          {loading ? (
            <div style={{ padding: '3rem 0', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
              {t('mcp.loading', 'Loading MCP server configuration...')}
            </div>
          ) : errorMsg ? (
            <div className="mcp-auth-step-card" style={{ border: '1px solid rgba(239, 68, 68, 0.3)', background: 'rgba(239, 68, 68, 0.08)' }}>
              <div style={{ color: '#f87171', fontSize: '0.9rem', lineHeight: '1.5' }}>
                ⚠️ {errorMsg}
              </div>
            </div>
          ) : authMode === 'device_flow' ? (
            <div className="mcp-auth-content">
              <div className="mcp-auth-step-card">
                <div className="mcp-step-card-header">
                  <span className="mcp-step-num">01</span>
                  <span className="mcp-step-heading">{t('mcp.deviceStep1', 'Check and copy the device user code below:')}</span>
                </div>
                <div className="mcp-user-code-box">
                  <span className="mcp-user-code">{userCode}</span>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={handleCopyCode}
                    style={{ padding: '0.4rem 0.95rem', fontSize: '0.82rem' }}
                  >
                    {copied ? t('common.copied', 'Copied') : t('common.copy', 'Copy')}
                  </button>
                </div>
              </div>

              <div className="mcp-auth-step-card">
                <div className="mcp-step-card-header">
                  <span className="mcp-step-num">02</span>
                  <span className="mcp-step-heading">{t('mcp.deviceStep2', 'Open authorization URL in your browser and enter code:')}</span>
                </div>
                <a
                  href={verificationUri}
                  target="_blank"
                  rel="noreferrer"
                  className="mcp-auth-link-btn"
                  onClick={handleCopyCode}
                >
                  {t('mcp.deviceOpenPage', 'Go to Device Auth Page ↗')}
                </a>
              </div>

              <div className="mcp-auth-notice-banner">
                <span style={{ fontSize: '1.1rem', marginRight: '8px' }}>⚠️</span>
                <span>{t('mcp.deviceKeepOpenNotice', 'Please keep this window open: freya is actively polling for authorization and will connect automatically.')}</span>
              </div>

              <div className="mcp-auth-polling-status">
                <span className="mcp-polling-pulse"></span>
                <span>{t('mcp.devicePollingActive', 'Listening for authorization confirmation in browser...')}</span>
              </div>
            </div>
          ) : (
            <div className="mcp-auth-content">
              <div className="mcp-auth-step-card">
                <div className="mcp-step-card-header">
                  <span className="mcp-step-num">01</span>
                  <span className="mcp-step-heading">{t('mcp.oauthStep1', 'Click the link below to login and authorize in a new window:')}</span>
                </div>
                <a
                  href={authUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mcp-auth-link-btn"
                >
                  {t('mcp.oauthClickAuth', 'Go to Authorization Page ↗')}
                </a>
              </div>

              <div className="mcp-auth-polling-status">
                <span className="mcp-polling-pulse"></span>
                <span>{t('mcp.devicePollingActive', 'Listening for authorization confirmation in browser...')}</span>
              </div>

              <div className="mcp-auth-step-card">
                <div className="mcp-step-card-header">
                  <span className="mcp-step-num">02</span>
                  <span className="mcp-step-heading">
                    {t('mcp.oauthManualInput', 'If callback connection failed, paste the full URL from your browser address bar here:')}
                  </span>
                </div>
                <input
                  type="text"
                  className="config-input"
                  style={{ width: '100%', boxSizing: 'border-box' }}
                  placeholder={t('mcp.oauthManualPlaceholder', 'Paste full callback URL (e.g. {example}) or authorization code', {
                    example: `${typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'}/api/mcp/oauth/callback?code=...`
                  })}
                  value={callbackInput}
                  onChange={(e) => setCallbackInput(e.target.value)}
                />
                <button
                  className="btn-primary"
                  onClick={handleSubmitCallback}
                  disabled={!callbackInput.trim() || isSubmitting}
                  style={{ marginTop: '0.4rem' }}
                >
                  {isSubmitting ? '...' : t('mcp.oauthSubmitCallback', 'Submit Callback URL to Exchange Token')}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="mcp-auth-dialog-footer">
          <button className="btn-secondary" onClick={onClose} style={{ minWidth: '88px' }}>
            {t('common.cancel', 'Cancel')}
          </button>
        </div>
      </div>
    </div>
  );
};
