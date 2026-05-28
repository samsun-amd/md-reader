import { useEffect, useMemo, useRef, useState } from 'react';
import './TocPanel.css';

function buildTree(headings) {
  const root = { level: 0, children: [] };
  const stack = [root];
  for (const h of headings) {
    const node = { ...h, children: [] };
    while (stack.length > 1 && stack[stack.length - 1].level >= h.level) stack.pop();
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  }
  return root.children;
}

function TocNode({ node, activeId, collapsed, onToggle, onClick }) {
  const hasChildren = node.children.length > 0;
  const isCollapsed = collapsed.has(node.id);
  const isActive = activeId === node.id;

  return (
    <li className="toc-node">
      <div className={`toc-row level-${node.level}${isActive ? ' active' : ''}`} data-id={node.id}>
        {hasChildren ? (
          <button
            className="toc-toggle"
            onClick={() => onToggle(node.id)}
            aria-label={isCollapsed ? 'Expand' : 'Collapse'}
          >
            {isCollapsed ? '▸' : '▾'}
          </button>
        ) : (
          <span className="toc-toggle placeholder" />
        )}
        <a
          href={`#${node.id}`}
          className="toc-link"
          onClick={(e) => { e.preventDefault(); onClick(node.id); }}
          title={node.text}
        >
          {node.text}
        </a>
      </div>
      {hasChildren && !isCollapsed && (
        <ul className="toc-list">
          {node.children.map((c) => (
            <TocNode
              key={c.id}
              node={c}
              activeId={activeId}
              collapsed={collapsed}
              onToggle={onToggle}
              onClick={onClick}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export default function TocPanel({ headings, scrollContainerRef, collapsed: panelCollapsed, onTogglePanel }) {
  const tree = useMemo(() => buildTree(headings), [headings]);
  const [collapsedNodes, setCollapsedNodes] = useState(() => new Set());
  const [activeId, setActiveId] = useState(null);
  const listRef = useRef(null);

  useEffect(() => {
    setCollapsedNodes(new Set());
    setActiveId(headings[0]?.id || null);
  }, [headings]);

  useEffect(() => {
    const container = scrollContainerRef?.current;
    if (!container || headings.length === 0) return;

    // Wait a tick for markdown to render
    const timer = setTimeout(() => {
      const elements = headings
        .map((h) => container.querySelector(`#${CSS.escape(h.id)}`))
        .filter(Boolean);
      if (elements.length === 0) return;

      const visible = new Map();
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) visible.set(entry.target.id, entry.boundingClientRect.top);
            else visible.delete(entry.target.id);
          }
          if (visible.size > 0) {
            const topId = [...visible.entries()].sort((a, b) => a[1] - b[1])[0][0];
            setActiveId(topId);
          } else {
            const containerTop = container.getBoundingClientRect().top;
            let candidate = null;
            for (const el of elements) {
              if (el.getBoundingClientRect().top - containerTop <= 0) candidate = el.id;
              else break;
            }
            if (candidate) setActiveId(candidate);
          }
        },
        {
          root: container,
          rootMargin: '0px 0px -70% 0px',
          threshold: [0, 1],
        }
      );

      for (const el of elements) observer.observe(el);
      cleanup = () => observer.disconnect();
    }, 50);

    let cleanup = null;
    return () => {
      clearTimeout(timer);
      if (cleanup) cleanup();
    };
  }, [headings, scrollContainerRef]);

  useEffect(() => {
    if (!activeId || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-id="${CSS.escape(activeId)}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [activeId]);

  const toggleNode = (id) => {
    setCollapsedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const scrollTo = (id) => {
    const container = scrollContainerRef?.current;
    if (!container) return;
    const target = container.querySelector(`#${CSS.escape(id)}`);
    if (!target) return;
    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const offset = targetRect.top - containerRect.top + container.scrollTop - 12;
    container.scrollTo({ top: offset, behavior: 'smooth' });
    history.replaceState(null, '', `#${id}`);
    setActiveId(id);
  };

  if (panelCollapsed) {
    return (
      <div className="toc-collapsed">
        <button className="toc-expand-btn" onClick={onTogglePanel} title="Show table of contents">
          ☰
        </button>
      </div>
    );
  }

  return (
    <div className="toc-panel">
      <div className="toc-header">
        <span className="toc-title">Contents</span>
        <button className="toc-collapse-btn" onClick={onTogglePanel} title="Hide table of contents">
          ✕
        </button>
      </div>
      <div className="toc-body" ref={listRef}>
        {headings.length === 0 ? (
          <div className="toc-empty">No headings</div>
        ) : (
          <ul className="toc-list root">
            {tree.map((n) => (
              <TocNode
                key={n.id}
                node={n}
                activeId={activeId}
                collapsed={collapsedNodes}
                onToggle={toggleNode}
                onClick={scrollTo}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
