import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import rehypeSlug from 'rehype-slug';
import GithubSlugger from 'github-slugger';
import CodeMirror from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView } from '@codemirror/view';
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
        if (!cancelled && ref.current) ref.current.innerHTML = svg;
      }).catch((e) => {
        if (!cancelled && ref.current) ref.current.textContent = `Mermaid error: ${e.message}`;
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
  return <code className={className}>{children}</code>;
}

function extractHeadings(markdown) {
  const slugger = new GithubSlugger();
  const lines = markdown.split('\n');
  const headings = [];
  let inFence = false;
  let fenceMarker = '';

  for (const raw of lines) {
    const fenceMatch = raw.match(/^(\s*)(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[2][0];
      if (!inFence) { inFence = true; fenceMarker = marker; }
      else if (marker === fenceMarker) { inFence = false; }
      continue;
    }
    if (inFence) continue;

    const m = raw.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!m) continue;
    const level = m[1].length;
    const text = m[2].replace(/`([^`]+)`/g, '$1').trim();
    if (!text) continue;
    headings.push({ level, text, id: slugger.slug(text) });
  }
  return headings;
}

function Preview({ markdown: text }) {
  return (
    <ReactMarkdown
      className="markdown-body"
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeSlug, rehypeHighlight, rehypeKatex]}
      components={{ code: CodeBlock }}
    >
      {text}
    </ReactMarkdown>
  );
}

const MODE_READ = 'read';
const MODE_SPLIT = 'split';
const MODE_EDIT = 'edit';

export default function MarkdownViewer({ filePath, scrollRef, onHeadingsChange }) {
  const [savedContent, setSavedContent] = useState('');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState(MODE_READ);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const internalRef = useRef(null);
  const bodyRef = scrollRef || internalRef;
  const dirty = content !== savedContent;

  useEffect(() => {
    if (!filePath) { setContent(''); setSavedContent(''); return; }
    if (dirty && !window.confirm('You have unsaved changes. Discard them?')) {
      return;
    }
    setLoading(true);
    setError(null);
    setSaveError(null);
    fetch(`/api/content?path=${encodeURIComponent(filePath)}`)
      .then((r) => {
        if (!r.ok) return r.json().then((d) => { throw new Error(d.error || r.statusText); });
        return r.text();
      })
      .then((text) => { setContent(text); setSavedContent(text); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
    // intentionally not depending on `dirty` (would re-run on every keystroke)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath]);

  const headings = useMemo(() => extractHeadings(content), [content]);

  useEffect(() => { onHeadingsChange?.(headings); }, [headings, onHeadingsChange]);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [filePath, bodyRef]);

  const save = useCallback(async () => {
    if (!filePath || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const r = await fetch('/api/content', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, content }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || r.statusText);
      setSavedContent(content);
    } catch (e) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  }, [filePath, content, saving]);

  // Ctrl+S / Cmd+S
  useEffect(() => {
    if (mode === MODE_READ) return;
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [mode, save]);

  const cmExtensions = useMemo(() => [
    markdown(),
    EditorView.lineWrapping,
  ], []);

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
        <span className="viewer-path">
          {dirty && <span className="dirty-dot" title="Unsaved changes">●</span>}
          {filePath}
        </span>
        <div className="viewer-actions">
          <div className="mode-toggle" role="group">
            {[MODE_READ, MODE_SPLIT, MODE_EDIT].map((m) => (
              <button
                key={m}
                className={`mode-btn${mode === m ? ' active' : ''}`}
                onClick={() => setMode(m)}
              >
                {m === MODE_READ ? 'Read' : m === MODE_SPLIT ? 'Split' : 'Edit'}
              </button>
            ))}
          </div>
          <button
            className="save-btn"
            onClick={save}
            disabled={!dirty || saving || mode === MODE_READ}
            title="Save (Ctrl+S)"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
      {saveError && <div className="viewer-status error">Save failed: {saveError}</div>}
      {loading && <div className="viewer-status">Loading…</div>}
      {error && <div className="viewer-status error">{error}</div>}

      {!loading && !error && (
        <div className={`viewer-content mode-${mode}`}>
          {(mode === MODE_EDIT || mode === MODE_SPLIT) && (
            <div className="editor-pane">
              <CodeMirror
                value={content}
                theme={oneDark}
                extensions={cmExtensions}
                onChange={(v) => setContent(v)}
                basicSetup={{
                  lineNumbers: true,
                  highlightActiveLine: true,
                  foldGutter: true,
                  history: true,
                }}
                height="100%"
              />
            </div>
          )}
          {(mode === MODE_READ || mode === MODE_SPLIT) && (
            <div className="viewer-body" ref={bodyRef}>
              <Preview markdown={content} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
