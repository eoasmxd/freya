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
          setAuthMode(authData.mode);
          if (authData.mode === 'device_flow') {
            setUserCode(authData.userCode || '');
            setVerificationUri(authData.verificationUri || authData.verification_uri || '');
            startDevicePolling();
          } else {
            setAuthUrl(authData.authUrl || '');
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

  const startDevicePolling = () => {
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
        } else if (data.data?.status === 'error') {
          clearPolling();
          setErrorMsg(data.data.error || 'Device flow authorization failed or expired');
        }
      } catch {
      }
    }, 3000);
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
    <div className="confirm-modal-overlay" onClick={onClose}>
      <div className="confirm-modal-card mcp-auth-card" onClick={(e) => e.stopPropagation()}>
        <div className="confirm-modal-title">
          <span>{t('mcp.authModalTitle', 'MCP Server [{id}] Authentication', { id: serverId })}</span>
        </div>

        {loading ? (
          <div style={{ padding: '1.5rem 0', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            {t('mcp.loading', 'Loading MCP server configuration...')}
          </div>
        ) : errorMsg ? (
          <div style={{ margin: '1rem 0' }}>
            <div style={{ padding: '0.75rem', borderRadius: '8px', background: 'rgba(239, 68, 68, 0.1)', color: '#f87171', fontSize: '0.85rem' }}>
              {errorMsg}
            </div>
            <div className="confirm-modal-actions" style={{ marginTop: '1.2rem' }}>
              <button className="btn-secondary" onClick={onClose}>
                {t('common.close', 'Close')}
              </button>
            </div>
          </div>
        ) : authMode === 'device_flow' ? (
          <div className="mcp-auth-content">
            <div className="mcp-auth-step">
              <span className="mcp-step-label">{t('mcp.deviceStep1', '1. Open authorization URL in your browser:')}</span>
              <a
                href={verificationUri}
                target="_blank"
                rel="noreferrer"
                className="btn-primary mcp-auth-link-btn"
              >
                {t('mcp.deviceOpenPage', 'Go to Device Auth Page ↗')}
              </a>
            </div>

            <div className="mcp-auth-step">
              <span className="mcp-step-label">{t('mcp.deviceStep2', '2. Enter the device user code below:')}</span>
              <div className="mcp-user-code-box">
                <span className="mcp-user-code">{userCode}</span>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleCopyCode}
                  style={{ padding: '0.3rem 0.75rem', fontSize: '0.8rem' }}
                >
                  {copied ? t('common.copied', 'Copied') : t('common.copy', 'Copy')}
                </button>
              </div>
            </div>

            <div className="mcp-auth-waiting">
              {t('mcp.deviceWaiting', '⏳ Waiting for browser confirmation... It will connect automatically once finished')}
            </div>

            <div className="confirm-modal-actions" style={{ marginTop: '1.5rem' }}>
              <button className="btn-secondary" onClick={onClose}>
                {t('common.cancel', 'Cancel')}
              </button>
            </div>
          </div>
        ) : (
          <div className="mcp-auth-content">
            <div className="mcp-auth-step">
              <span className="mcp-step-label">{t('mcp.oauthStep1', 'Click the link below to login and authorize in a new window:')}</span>
              <a
                href={authUrl}
                target="_blank"
                rel="noreferrer"
                className="btn-primary mcp-auth-link-btn"
              >
                {t('mcp.oauthClickAuth', 'Go to Authorization Page ↗')}
              </a>
            </div>

            <div className="mcp-auth-step" style={{ marginTop: '1.2rem' }}>
              <span className="mcp-step-label">
                {t('mcp.oauthManualInput', 'If callback connection failed, paste the full URL from your browser address bar here:')}
              </span>
              <input
                type="text"
                className="config-input"
                style={{ width: '100%', marginTop: '0.4rem', boxSizing: 'border-box' }}
                placeholder={t('mcp.oauthManualPlaceholder', 'Paste full callback URL (e.g. {example}) or authorization code', {
                  example: `${typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000'}/api/mcp/oauth/callback?code=...`
                })}
                value={callbackInput}
                onChange={(e) => setCallbackInput(e.target.value)}
              />
            </div>

            <div className="confirm-modal-actions" style={{ marginTop: '1.5rem' }}>
              <button className="btn-secondary" onClick={onClose}>
                {t('common.cancel', 'Cancel')}
              </button>
              <button
                className="btn-primary"
                onClick={handleSubmitCallback}
                disabled={!callbackInput.trim() || isSubmitting}
              >
                {isSubmitting ? '...' : t('mcp.oauthSubmitCallback', 'Submit Callback URL to Exchange Token')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
