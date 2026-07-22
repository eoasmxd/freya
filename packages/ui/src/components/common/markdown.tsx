import React from 'react';

const CodeBlockContainer: React.FC<{ code: string; lang: string; index: number }> = ({ code, lang, index }) => {
  const copyCode = () => {
    navigator.clipboard.writeText(code);
  };

  return (
    <div key={`code-${index}`} className="md-code-block-container">
      <div className="md-code-block-header">
        <span className="lang">{lang || 'text'}</span>
        <button className="copy-btn" onClick={copyCode}>📋 复制</button>
      </div>
      <pre className="md-code-block">
        <code>
          {code.split('\n').map((line, idx) => {
            let renderedLine: React.ReactNode = line;
            if (line.trim().startsWith('//') || line.trim().startsWith('#')) {
              renderedLine = <span className="md-code-comment">{line}</span>;
            } else {
              const words = line.split(/(".*?"|'.*?'|`.*?`|\b(const|let|var|function|return|import|export|class|extends|async|await|try|catch|if|else|for|while|new|default|interface|type)\b)/g);
              renderedLine = words.map((w, wIdx) => {
                if (!w) return null;
                if (/^(const|let|var|function|return|import|export|class|extends|async|await|try|catch|if|else|for|while|new|default|interface|type)$/.test(w)) {
                  return <span key={wIdx} className="md-code-keyword">{w}</span>;
                }
                if ((w.startsWith('"') && w.endsWith('"')) || (w.startsWith("'") && w.endsWith("'")) || (w.startsWith('`') && w.endsWith('`'))) {
                  return <span key={wIdx} className="md-code-string">{w}</span>;
                }
                return w;
              });
            }
            return <div key={idx}>{renderedLine}</div>;
          })}
        </code>
      </pre>
    </div>
  );
};

function renderTableElement(table: { headers: string[]; rows: string[][] }, index: number) {
  return (
    <table key={`table-${index}`}>
      <thead>
        <tr>
          {table.headers.map((h, i) => (
            <th key={`th-${i}`}>{parseInlineMarkdown(h)}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.rows.map((row, rIdx) => (
          <tr key={`tr-${rIdx}`}>
            {row.map((cell, cIdx) => (
              <td key={`td-${cIdx}`}>{parseInlineMarkdown(cell)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function renderMarkdown(content: string): React.ReactNode[] {
  if (!content) return [];
  const parts = content.split(/(```[\s\S]*?```)/g);

  return parts.map((part, index) => {
    if (part.startsWith('```')) {
      const match = part.match(/```(\w*)\n([\s\S]*?)```/);
      const lang = match ? match[1] : '';
      const code = match ? match[2] : part.slice(3, -3);

      return <CodeBlockContainer key={`code-block-${index}`} code={code} lang={lang} index={index} />;
    }

    const lines = part.split('\n');
    const renderedElements: React.ReactNode[] = [];
    let rawListItems: { indent: number; content: string }[] = [];
    let currentTable: { headers: string[]; rows: string[][] } | null = null;
    let currentBlockquoteLines: string[] = [];

    const renderNestedList = (items: { indent: number; content: string }[], key: string) => {
      interface TreeNode {
        content: string;
        children: TreeNode[];
        indent: number;
      }
      const rootNodes: TreeNode[] = [];
      const stack: TreeNode[] = [];

      for (const item of items) {
        const node: TreeNode = {
          content: item.content,
          children: [],
          indent: item.indent
        };

        while (stack.length > 0 && stack[stack.length - 1].indent >= item.indent) {
          stack.pop();
        }

        if (stack.length === 0) {
          rootNodes.push(node);
        } else {
          stack[stack.length - 1].children.push(node);
        }
        stack.push(node);
      }

      const renderTreeNodes = (nodes: TreeNode[], prefix: string, customKey?: string): React.ReactElement | null => {
        if (nodes.length === 0) return null;
        return (
          <ul key={customKey} style={{ margin: '0.2rem 0', paddingLeft: '1.3rem' }}>
            {nodes.map((node, idx) => (
              <li key={`${prefix}-${idx}`}>
                {parseInlineMarkdown(node.content)}
                {node.children.length > 0 && renderTreeNodes(node.children, `${prefix}-${idx}`)}
              </li>
            ))}
          </ul>
        );
      };

      return renderTreeNodes(rootNodes, key, key);
    };

    const renderBlockquote = (linesArray: string[], key: string) => {
      const content = linesArray.map(l => l.replace(/^\s*>\s?/, '')).join('\n');
      return (
        <blockquote key={key} className="md-blockquote">
          {renderMarkdown(content)}
        </blockquote>
      );
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const cleanLine = line.trim();

      const isQuoteRow = cleanLine.startsWith('>');
      if (!isQuoteRow && currentBlockquoteLines.length > 0) {
        renderedElements.push(renderBlockquote(currentBlockquoteLines, `quote-${i}`));
        currentBlockquoteLines = [];
      }

      const listMatch = line.match(/^(\s*)([-*])\s+(.*)$/);
      const isListRow = !!listMatch;
      if (!isListRow && rawListItems.length > 0) {
        renderedElements.push(renderNestedList(rawListItems, `list-${i}`));
        rawListItems = [];
      }

      const isTableRow = cleanLine.startsWith('|');
      if (!isTableRow && currentTable) {
        renderedElements.push(renderTableElement(currentTable, i));
        currentTable = null;
      }

      if (!cleanLine) {
        renderedElements.push(<div key={`empty-${i}`} style={{ height: '0.4rem' }} />);
        continue;
      }

      const isHrRow = /^[*-]{3,}$/.test(cleanLine);
      if (isHrRow) {
        renderedElements.push(<hr key={`hr-${i}`} />);
        continue;
      }

      if (isQuoteRow) {
        currentBlockquoteLines.push(line);
      } else if (isListRow) {
        rawListItems.push({
          indent: listMatch![1].length,
          content: listMatch![3]
        });
      } else if (isTableRow) {
        const cells = line.split('|').map(c => c.trim());
        if (cells[0] === '') cells.shift();
        if (cells[cells.length - 1] === '') cells.pop();

        const isDivider = cells.length > 0 && cells.every(c => /^[ :-]+$/.test(c));
        if (isDivider) {
          continue;
        }

        if (!currentTable) {
          currentTable = { headers: cells, rows: [] };
        } else {
          currentTable.rows.push(cells);
        }
      } else {
        if (cleanLine.startsWith('#')) {
          const hMatch = cleanLine.match(/^(#{1,6})\s+(.*)$/);
          if (hMatch) {
            const level = hMatch[1].length;
            const text = hMatch[2];
            const Tag = `h${level}` as keyof JSX.IntrinsicElements;
            renderedElements.push(<Tag key={`h-${i}`}>{parseInlineMarkdown(text)}</Tag>);
            continue;
          }
        }

        renderedElements.push(<p key={`p-${i}`}>{parseInlineMarkdown(line)}</p>);
      }
    }

    if (currentBlockquoteLines.length > 0) {
      renderedElements.push(renderBlockquote(currentBlockquoteLines, 'quote-final'));
    }

    if (rawListItems.length > 0) {
      renderedElements.push(renderNestedList(rawListItems, 'list-final'));
    }

    if (currentTable) {
      renderedElements.push(renderTableElement(currentTable, lines.length));
    }

    return (
      <div key={`text-${index}`}>
        {renderedElements}
      </div>
    );
  });
}


export function parseInlineMarkdown(text: string): React.ReactNode[] {
  if (!text) return [];
  const parts = text.split(/(!\[.*?\]\(.*?\)|\[.*?\]\(.*?\)|\*\*.*?\*\*|`.*?`)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('![') && part.endsWith(')')) {
      const match = part.match(/!\[(.*?)\]\((.*?)\)/);
      if (match) {
        const [, alt, url] = match;
        return (
          <img
            key={idx}
            src={url}
            alt={alt}
            className="md-image"
            style={{ maxWidth: '100%', maxHeight: '300px', display: 'block', borderRadius: '8px', margin: '0.8rem 0', border: '1px solid var(--border-color, #e0e0e0)' }}
          />
        );
      }
    }
    if (part.startsWith('[') && part.endsWith(')')) {
      const match = part.match(/\[(.*?)\]\((.*?)\)/);
      if (match) {
        const [, linkText, url] = match;
        return (
          <a
            key={idx}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="md-link"
            style={{ color: '#0066cc', textDecoration: 'underline', wordBreak: 'break-all' }}
          >
            {parseInlineMarkdown(linkText)}
          </a>
        );
      }
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={idx}>{parseInlineMarkdown(part.slice(2, -2))}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={idx} className="md-code-inline">{part.slice(1, -1)}</code>;
    }
    return part;
  });
}
