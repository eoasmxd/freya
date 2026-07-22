import React, { useEffect, useRef, useState } from 'react';
import { ChatHeader } from './features/chat/ChatHeader.jsx';
import { ChatArea } from './features/chat/ChatArea.jsx';
import { ChatFooter } from './features/chat/ChatFooter.jsx';
import { ConfigModal } from './features/config/ConfigModal.jsx';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isTyping?: boolean;
  isTool?: boolean;
}

interface BillingInfo {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedPromptTokens: number;
  cost: number;
}

const generateId = () => {
  return (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : Math.random().toString(36).substring(2, 15);
};

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [billing, setBilling] = useState<BillingInfo>({
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    cachedPromptTokens: 0,
    cost: 0
  });

  const [showConfig, setShowConfig] = useState(false);
  const [confirmModal, setConfirmModal] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string>(generateId());
  const chatPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chatPanelRef.current) {
      chatPanelRef.current.scrollTop = chatPanelRef.current.scrollHeight;
    }
  }, [messages]);

  const getApiUrl = (path: string) => {
    const isDev = import.meta.env.DEV;
    const host = isDev ? 'http://localhost:3000' : '';
    return `${host}${path}`;
  };

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let isUnmounted = false;

    function connect() {
      if (isUnmounted) return;

      const isDev = import.meta.env.DEV;
      const wsUrl = isDev
        ? 'ws://localhost:3000'
        : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        let clientId = sessionStorage.getItem('freya_clientId');
        if (!clientId) {
          clientId = generateId();
          sessionStorage.setItem('freya_clientId', clientId);
        }
        ws!.send(JSON.stringify({ event: 'client:reconnect', data: { clientId } }));
      };

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          const { event: eventName, data } = payload;

          if (eventName === 'server:connected') {
            setMessages((prev) => {
              if (prev.length > 0) return prev;
              return [{
                id: 'sys-init',
                role: 'assistant',
                content: data.message
              }];
            });
          } else if (eventName === 'server:reply') {
            setMessages((prev) => [
              ...prev,
              {
                id: generateId(),
                role: 'assistant',
                content: data.text,
                isTyping: false
              }
            ]);
          } else if (eventName === 'server:delta') {
            setMessages((prev) => {
              const lastMsg = prev[prev.length - 1];
              if (lastMsg && lastMsg.role === 'assistant' && lastMsg.isTyping && !lastMsg.isTool) {
                return [
                  ...prev.slice(0, -1),
                  { ...lastMsg, content: lastMsg.content + data.text }
                ];
              } else {
                return [
                  ...prev,
                  {
                    id: generateId(),
                    role: 'assistant',
                    content: data.text,
                    isTyping: true
                  }
                ];
              }
            });
          } else if (eventName === 'server:billing') {
            setBilling({
              promptTokens: data.promptTokens,
              completionTokens: data.completionTokens,
              totalTokens: data.totalTokens,
              cachedPromptTokens: data.cachedPromptTokens,
              cost: data.cost
            });
          } else if (eventName === 'server:tool_status') {
            const toolCallId = data.toolCallId;
            const toolName = data.toolName;
            const status = data.status;
            const toolArgs = data.arguments;
            const result = data.result;
            setMessages((prev) => {
              let id = '';
              if (toolCallId) {
                id = `tool-${toolCallId}`;
              } else {
                let safeArgsString = '';
                try {
                  safeArgsString = JSON.stringify(toolArgs);
                } catch {
                  safeArgsString = String(toolArgs);
                }
                id = `tool-${toolName}-${safeArgsString}`;
              }
              const existingIndex = prev.findIndex((m) => m.id === id);

              let statusText = '正在执行...';
              if (status === 'completed') {
                statusText = '执行成功';
              } else if (status === 'failed') {
                statusText = `执行失败: ${result || ''}`;
              }

              let safeResult = result;
              try {
                JSON.stringify(result);
              } catch {
                safeResult = typeof result === 'object' ? String(result) : result;
              }

              let safeArgs = toolArgs;
              try {
                JSON.stringify(toolArgs);
              } catch {
                safeArgs = typeof toolArgs === 'object' ? String(toolArgs) : toolArgs;
              }

              const toolMsg: Message = {
                id,
                role: 'assistant',
                content: JSON.stringify({
                  toolName,
                  status,
                  arguments: safeArgs,
                  result: safeResult,
                  statusText
                }),
                isTool: true
              };

              if (existingIndex > -1) {
                const updated = [...prev];
                updated[existingIndex] = toolMsg;
                return updated;
              } else {
                return [...prev, toolMsg];
              }
            });
          } else if (eventName === 'server:status') {
            setIsGenerating(data.status === 'generating');
          } else if (eventName === 'server:completed') {
            setIsGenerating(false);
            setMessages((prev) => {
              const lastMsg = prev[prev.length - 1];
              if (lastMsg && lastMsg.role === 'assistant') {
                return [
                  ...prev.slice(0, -1),
                  { ...lastMsg, isTyping: false }
                ];
              }
              return prev;
            });
          }
        } catch (err) {
          console.error('WS payload parse error:', err);
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        setIsGenerating(false);
        if (!isUnmounted) {
          reconnectTimer = setTimeout(connect, 3000);
        }
      };

      ws.onerror = (err) => {
        console.error('WS connection error:', err);
        ws!.close();
      };
    }

    connect();

    return () => {
      isUnmounted = true;
      if (ws) ws.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, []);

  const handleSend = () => {
    if (!input.trim() || !isConnected) return;
    setMessages((prev) => [
      ...prev,
      {
        id: generateId(),
        role: 'user',
        content: input
      }
    ]);
    setInput('');
    setIsGenerating(true);

    if (wsRef.current) {
      wsRef.current.send(JSON.stringify({
        event: 'client:message',
        data: {
          sessionId: sessionIdRef.current,
          content: input
        }
      }));
    }
  };

  const handleInterrupt = () => {
    if (!isConnected || !isGenerating) return;
    wsRef.current?.send(JSON.stringify({
      event: 'client:interrupt',
      data: { sessionId: sessionIdRef.current }
    }));
    setIsGenerating(false);

    setMessages((prev) => {
      const lastMsg = prev[prev.length - 1];
      if (lastMsg && lastMsg.role === 'assistant' && lastMsg.isTyping) {
        return [
          ...prev.slice(0, -1),
          { ...lastMsg, content: lastMsg.content + ' [生成已中断]', isTyping: false }
        ];
      }
      return prev;
    });
  };

  const handleClear = () => {
    setConfirmModal({
      title: '重置当前会话',
      message: '确定要清空当前对话历史并重置会话吗？该操作不可撤销。',
      onConfirm: () => {
        setConfirmModal(null);
        setMessages([]);
        setBilling({
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          cachedPromptTokens: 0,
          cost: 0
        });
        if (wsRef.current && isConnected) {
          wsRef.current.send(JSON.stringify({
            event: 'client:message',
            data: {
              sessionId: sessionIdRef.current,
              content: '/reset'
            }
          }));
        }
      }
    });
  };

  return (
    <div className="app-container">
      <ChatHeader
        isConnected={isConnected}
        onClear={handleClear}
        onOpenConfig={() => setShowConfig(true)}
      />

      <ChatArea
        messages={messages}
        chatPanelRef={chatPanelRef}
        isGenerating={isGenerating}
      />

      <ChatFooter
        input={input}
        isConnected={isConnected}
        isGenerating={isGenerating}
        billing={billing}
        onChangeInput={setInput}
        onSend={handleSend}
        onInterrupt={handleInterrupt}
      />

      {showConfig && (
        <ConfigModal
          onClose={() => setShowConfig(false)}
          getApiUrl={getApiUrl}
        />
      )}

      {confirmModal && (
        <div className="confirm-modal-overlay">
          <div className="confirm-modal-card">
            <div className="confirm-modal-title">
              <span>⚠️</span>
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
                确定重置
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
