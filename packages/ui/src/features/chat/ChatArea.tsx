import React, { useState } from 'react';
import { renderMarkdown } from '../../components/common/markdown.jsx';
import { useI18n } from '../../i18n/index.js';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isTyping?: boolean;
  isTool?: boolean;
}

interface ChatAreaProps {
  messages: Message[];
  chatPanelRef: React.RefObject<HTMLDivElement>;
  isGenerating?: boolean;
}

type RenderItem =
  | { type: 'message'; message: Message }
  | { type: 'tool_group'; groupId: string; items: Message[] };

const ToolCard: React.FC<{
  msg: Message;
  isExpanded: boolean;
  onToggle: () => void;
}> = ({ msg, isExpanded, onToggle }) => {
  const { t } = useI18n();

  try {
    const data = JSON.parse(msg.content);
    const toolName = data.toolName;
    const status = data.status;
    const toolArgs = data.arguments;
    const result = data.result;
    const statusText = data.statusText;

    return (
      <div className="tool-card-container">
        <div className="tool-card-header" onClick={onToggle}>
          <div className="tool-card-title">
            <span className={`tool-card-indicator ${status}`} />
            <span>🔧 {t('chat.toolUsing', 'Using tool: {name}', { name: toolName })}</span>
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            {statusText} {isExpanded ? t('chat.fold', '▲ Collapse') : t('chat.expand', '▼ Expand')}
          </span>
        </div>
        {isExpanded && (
          <div className="tool-card-body">
            <pre>
              <div><strong>{t('chat.inputParams', 'Input Arguments:')}</strong> {JSON.stringify(toolArgs, null, 2)}</div>
              <div style={{ marginTop: '0.5rem' }}><strong>{t('chat.outputResult', 'Output Result:')}</strong> {typeof result === 'object' ? JSON.stringify(result, null, 2) : result}</div>
            </pre>
          </div>
        )}
      </div>
    );
  } catch {
    return (
      <div className="message-bubble assistant" style={{ fontStyle: 'italic' }}>
        {t('chat.toolParseFailed', '🔧 Failed to parse tool invocation')}
      </div>
    );
  }
};

const ToolGroupCard: React.FC<{
  groupId: string;
  items: Message[];
  isExpanded: boolean;
  onToggleGroup: () => void;
  expandedTools: Record<string, boolean>;
  onToggleTool: (id: string) => void;
  isGenerating?: boolean;
  isLatestGroup?: boolean;
}> = ({ groupId, items, isExpanded, onToggleGroup, expandedTools, onToggleTool, isGenerating, isLatestGroup }) => {
  const { t } = useI18n();

  const hasRunning = items.some((item) => {
    try {
      const data = JSON.parse(item.content);
      return data.status !== 'completed' && data.status !== 'failed';
    } catch {
      return false;
    }
  });

  let statusText = t('chat.statusCompleted', 'Completed');
  if (hasRunning) {
    statusText = t('chat.statusRunning', 'Running...');
  } else if (isLatestGroup && isGenerating) {
    statusText = t('chat.statusThinking', 'Thinking...');
  }

  return (
    <div className={`tool-group-container ${isExpanded ? 'expanded' : 'collapsed'}`} key={groupId}>
      <div className="tool-group-header" onClick={onToggleGroup}>
        <div className="tool-group-title">
          <span>{t('chat.toolProcess', '🛠️ Tool Execution Steps')}</span>
          <span style={{ fontSize: '0.75rem', fontWeight: 400, color: 'var(--text-secondary)' }}>
            {t('chat.toolSteps', '({count} steps · {status})', { count: items.length, status: statusText })}
          </span>
        </div>
        <span className="tool-group-action-hint">
          {isExpanded ? t('chat.fold', '▲ Collapse') : t('chat.expand', '▼ Expand')}
        </span>
      </div>

      {isExpanded && (
        <div className="tool-group-body">
          {items.map((msg) => {
            let isToolExpanded = expandedTools[msg.id];
            if (isToolExpanded === undefined) {
              try {
                const data = JSON.parse(msg.content);
                isToolExpanded = data.status !== 'completed' && data.status !== 'failed';
              } catch {
                isToolExpanded = false;
              }
            }

            return (
              <ToolCard
                key={msg.id}
                msg={msg}
                isExpanded={isToolExpanded}
                onToggle={() => onToggleTool(msg.id)}
              />
            );
          })}
          {items.length > 1 && (
            <div className="tool-group-footer" onClick={onToggleGroup}>
              <span>{t('chat.toolFooterSummary', '🛠️ Tool Execution Steps ({count} steps · {status})', { count: items.length, status: statusText })}</span>
              <span className="tool-group-footer-btn">{t('chat.toolFooterFold', '▲ Collapse')}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const ChatArea: React.FC<ChatAreaProps> = ({ messages, chatPanelRef, isGenerating }) => {
  const { t } = useI18n();
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({});

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((prev) => ({
      ...prev,
      [groupId]: !prev[groupId]
    }));
  };

  const toggleTool = (id: string) => {
    setExpandedTools((prev) => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  React.useEffect(() => {
    if (chatPanelRef.current) {
      requestAnimationFrame(() => {
        if (chatPanelRef.current) {
          chatPanelRef.current.scrollTop = chatPanelRef.current.scrollHeight;
        }
      });
    }
  }, [messages, isGenerating]);

  const renderItems: RenderItem[] = [];
  let currentGroupItems: Message[] = [];

  messages.forEach((msg) => {
    if (msg.isTool) {
      currentGroupItems.push(msg);
    } else {
      if (currentGroupItems.length > 0) {
        renderItems.push({
          type: 'tool_group',
          groupId: `group-${currentGroupItems[0].id}`,
          items: currentGroupItems
        });
        currentGroupItems = [];
      }
      renderItems.push({ type: 'message', message: msg });
    }
  });

  if (currentGroupItems.length > 0) {
    renderItems.push({
      type: 'tool_group',
      groupId: `group-${currentGroupItems[0].id}`,
      items: currentGroupItems
    });
  }

  const lastGroupIndex = renderItems.map((item, idx) => item.type === 'tool_group' ? idx : -1).filter(idx => idx !== -1).pop();

  return (
    <div className="chat-panel" ref={chatPanelRef}>
      {renderItems.map((item, index) => {
        if (item.type === 'tool_group') {
          const { groupId, items } = item;
          const isLatestGroup = index === lastGroupIndex;

          const hasUnfinished = items.some((m) => {
            try {
              const data = JSON.parse(m.content);
              return data.status !== 'completed' && data.status !== 'failed';
            } catch {
              return false;
            }
          });

          let isGroupExpanded = expandedGroups[groupId];
          if (isGroupExpanded === undefined) {
            isGroupExpanded = Boolean((isLatestGroup && isGenerating) || hasUnfinished);
          }

          return (
            <ToolGroupCard
              key={groupId}
              groupId={groupId}
              items={items}
              isExpanded={isGroupExpanded}
              onToggleGroup={() => toggleGroup(groupId)}
              expandedTools={expandedTools}
              onToggleTool={toggleTool}
              isGenerating={isGenerating}
              isLatestGroup={isLatestGroup}
            />
          );
        }

        const msg = item.message;
        const isUser = msg.role === 'user';

        return (
          <div key={msg.id} className={`message-wrapper ${msg.role}`}>
            <div className="message-meta">
              {isUser ? (
                <span className="name">👤 {t('chat.user', 'User')}</span>
              ) : (
                <span className="name">
                  <img src="./icon.png" alt="Freya" className="bot-icon" />
                  <span>Freya</span>
                </span>
              )}
            </div>
            <div className={`message-bubble ${msg.isTyping ? 'cursor-typing' : ''}`}>
              <div className="message-content">
                {renderMarkdown(msg.content)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
