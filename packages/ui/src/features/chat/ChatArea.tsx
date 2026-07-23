import React, { useState } from 'react';
import { renderMarkdown } from '../../components/common/markdown.jsx';

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
            <span>🔧 使用工具: {toolName}</span>
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            {statusText} {isExpanded ? '▲ 折叠' : '▼ 展开'}
          </span>
        </div>
        {isExpanded && (
          <div className="tool-card-body">
            <pre>
              <div><strong>输入参数:</strong> {JSON.stringify(toolArgs, null, 2)}</div>
              <div style={{ marginTop: '0.5rem' }}><strong>输出结果:</strong> {typeof result === 'object' ? JSON.stringify(result, null, 2) : result}</div>
            </pre>
          </div>
        )}
      </div>
    );
  } catch {
    return (
      <div className="message-bubble assistant" style={{ fontStyle: 'italic' }}>
        🔧 工具调用信息解析失败
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
  const hasRunning = items.some((item) => {
    try {
      const data = JSON.parse(item.content);
      return data.status !== 'completed' && data.status !== 'failed';
    } catch {
      return false;
    }
  });

  let statusText = '已全部执行完成';
  if (hasRunning) {
    statusText = '执行中...';
  } else if (isLatestGroup && isGenerating) {
    statusText = '思考中...';
  }

  return (
    <div className={`tool-group-container ${isExpanded ? 'expanded' : 'collapsed'}`} key={groupId}>
      <div className="tool-group-header" onClick={onToggleGroup}>
        <div className="tool-group-title">
          <span>🛠️ 工具调用过程</span>
          <span style={{ fontSize: '0.75rem', fontWeight: 400, color: 'var(--text-secondary)' }}>
            (共 {items.length} 步 · {statusText})
          </span>
        </div>
        <span className="tool-group-action-hint">
          {isExpanded ? '▲ 折叠' : '▼ 展开'}
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
              <span>🛠️ 工具调用过程 ({items.length} 步 · {statusText})</span>
              <span className="tool-group-footer-btn">▲ 折叠</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const ChatArea: React.FC<ChatAreaProps> = ({ messages, chatPanelRef, isGenerating }) => {
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
        const displayName = isUser ? '👤 用户' : '🤖 Freya';

        return (
          <div key={msg.id} className={`message-wrapper ${msg.role}`}>
            <div className="message-meta">
              <span className="name">{displayName}</span>
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
