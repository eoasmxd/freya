import React, { useState } from 'react';
import { useI18n } from '../../../../i18n/index.js';
import type { McpServerStatusItem } from './types.js';

interface McpToolsDrawerProps {
  server: McpServerStatusItem;
  onClose: () => void;
}

/**
 * MCP 工具清单抽屉组件
 * Drawer component displaying the list of tools provided by an MCP server
 */
export const McpToolsDrawer: React.FC<McpToolsDrawerProps> = ({ server, onClose }) => {
  const { t } = useI18n();
  const [filterKeyword, setFilterKeyword] = useState('');
  const [expandedSchemaTool, setExpandedSchemaTool] = useState<string | null>(null);

  const tools = server.tools || [];
  const filteredTools = tools.filter(tool => {
    if (!filterKeyword.trim()) return true;
    const kw = filterKeyword.toLowerCase();
    const name = (tool.name || '').toLowerCase();
    const orig = (tool.originalName || '').toLowerCase();
    const desc = (tool.description || '').toLowerCase();
    return name.includes(kw) || orig.includes(kw) || desc.includes(kw);
  });

  return (
    <div className="mcp-drawer-overlay" onClick={onClose}>
      <div className="mcp-drawer-container" onClick={(e) => e.stopPropagation()}>
        <div className="mcp-drawer-header">
          <div className="mcp-drawer-title-group">
            <h3 className="mcp-drawer-title">
              {t('mcp.toolsDrawerTitle', 'Server [{id}] Tools List', { id: server.id })}
            </h3>
            <span className="mcp-drawer-badge">{tools.length}</span>
          </div>
          <button className="modal-close" onClick={onClose} title={t('common.close', 'Close')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        {tools.length > 0 && (
          <div className="mcp-drawer-search">
            <input
              type="text"
              className="config-input"
              style={{ width: '100%' }}
              placeholder={t('common.search', 'Search tools by name or description...')}
              value={filterKeyword}
              onChange={(e) => setFilterKeyword(e.target.value)}
            />
          </div>
        )}

        <div className="mcp-drawer-body">
          {tools.length === 0 ? (
            <div className="mcp-drawer-empty">
              {t('mcp.toolsDrawerEmpty', 'No tools mounted for this server. It may not be ready yet or tools are excluded by filter rules.')}
            </div>
          ) : filteredTools.length === 0 ? (
            <div className="mcp-drawer-empty">
              {t('common.noResults', 'No matching tools found.')}
            </div>
          ) : (
            <div className="mcp-tools-list">
              {filteredTools.map((tool) => {
                const isSchemaOpen = expandedSchemaTool === tool.name;
                return (
                  <div key={tool.name} className="mcp-tool-card">
                    <div className="mcp-tool-header">
                      <div className="mcp-tool-names">
                        <span className="mcp-tool-name">{tool.name}</span>
                        {tool.originalName !== tool.name && (
                          <span className="mcp-tool-original" title="Original remote tool name">
                            ({tool.originalName})
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        className="btn-plugin-config"
                        onClick={() => setExpandedSchemaTool(isSchemaOpen ? null : tool.name)}
                      >
                        {isSchemaOpen ? t('chat.fold', '▲ Fold') : t('chat.expand', '▼ Expand')} Schema
                      </button>
                    </div>

                    <div className="mcp-tool-desc">
                      {tool.description || t('skill.noDesc', 'No description provided')}
                    </div>

                    {isSchemaOpen && (
                      <div className="mcp-tool-schema">
                        <pre className="mcp-schema-code">
                          {JSON.stringify(tool.parameters, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
