import { useEffect, useState, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import 'highlight.js/styles/github-dark.css';
import './MarkdownViewer.css';

function MermaidBlock({ code }) {
  const ref = useRef(null);

  useEffect(() => {
    let cancelled = false;
    import('mermaid').then(({ default: mermaid }) => {
      mermaid.initialize({ startOnLoad: false, theme: 'dark' });
      const id = `mermaid-${Math.random().toString(36).slice(2)}`;
      mermaid.render(id, code).then(({ svg }) => {
        if (!cancelled && ref.current) {
          ref.current.innerHTML = svg;
        }
      }).catch((e) => {
        if (!cancelled && ref.current) {
          ref.current.textContent = `Mermaid error: ${e.message}`;
        }
      });
    });
    return () => { cancelled = true; };
  }, [code]);

  return <div className="mermaid-block" ref={ref} />;
}

function CodeBlock({ className, children }) {
  const match = /language-(\w+)/.exec(className || '');
  const lang = match?.[1];
  const code = String(children).replace(/\n$/, '');

  if (lang === 'mermaid') return <MermaidBlock code={code} />;
  return (
    <code className={className}>
      {children}
    </code>
  );
}

export default function MarkdownViewer({ filePath }) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!filePath) { setContent(''); return; }
    setLoading(true);
    setError(null);
    fetch(`/api/content?path=${encodeURIComponent(filePath)}`)
      .then((r) => {
        if (!r.ok) return r.json().then((d) => { throw new Error(d.error || r.statusText); });
        return r.text();
      })
      .then((text) => { setContent(text); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [filePath]);

  if (!filePath) {
    return (
      <div className="viewer-empty">
        <div className="viewer-empty-icon">📄</div>
        <div className="viewer-empty-text">Select a file to read</div>
      </div>
    );
  }

  return (
    <div className="viewer">
      <div className="viewer-header">
        <span className="viewer-path">{filePath}</span>
      </div>
      <div className="viewer-body">
        {loading && <div className="viewer-status">Loading…</div>}
        {error && <div className="viewer-status error">{error}</div>}
        {!loading && !error && (
          <ReactMarkdown
            className="markdown-body"
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeHighlight, rehypeKatex]}
            components={{ code: CodeBlock }}
          >
            {content}
          </ReactMarkdown>
        )}
      </div>
    </div>
  );
}
