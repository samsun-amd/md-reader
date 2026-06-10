import { useEffect, useState, useRef, useMemo, useCallback, lazy, Suspense } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import rehypeSlug from 'rehype-slug';
import GithubSlugger from 'github-slugger';
import 'katex/dist/katex.min.css';
import 'highlight.js/styles/github-dark.css';
import './MarkdownViewer.css';

const Editor = lazy(() => import('./Editor'));

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

// react-markdown does not parse HTML by default, so raw HTML comments are
// rendered as plain text. Strip them before passing to the renderer so they
// remain invisible (matching GitHub / CommonMark behavior). Comments inside
// fenced code blocks must be preserved.
function stripHtmlComments(text) {
  const lines = text.split('\n');
  let inFence = false;
  let fenceMarker = '';
  const kept = [];
  let buffer = '';
  const flush = () => {
    if (!buffer) return;
    kept.push(buffer.replace(/<!--[\s\S]*?-->/g, ''));
    buffer = '';
  };
  for (const raw of lines) {
    const fenceMatch = raw.match(/^(\s*)(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[2][0];
      if (!inFence) { flush(); inFence = true; fenceMarker = marker; kept.push(raw); continue; }
      if (marker === fenceMarker) { inFence = false; kept.push(raw); continue; }
    }
    if (inFence) { kept.push(raw); continue; }
    buffer += (buffer ? '\n' : '') + raw;
  }
  flush();
  return kept.join('\n');
}

// Stamp every top-level rendered element with its originating markdown line
// (1-based) as data-source-line, so split-mode scroll sync can anchor on real
// source positions instead of a height ratio. Lines are relative to the cleaned
// text; they match the editor's document exactly except below a multi-line HTML
// comment (rare), where stripHtmlComments collapses lines and anchors drift a
// little — acceptable for a scroll heuristic.
function rehypeSourceLines() {
  return (tree) => {
    for (const node of tree.children) {
      const line = node.position?.start?.line;
      if (node.type === 'element' && line) {
        node.properties = node.properties || {};
        node.properties['dataSourceLine'] = line;
      }
    }
  };
}

function Preview({ markdown: text }) {
  const cleaned = useMemo(() => stripHtmlComments(text), [text]);
  return (
    <ReactMarkdown
      className="markdown-body"
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeSlug, rehypeHighlight, rehypeKatex, rehypeSourceLines]}
      components={{ code: CodeBlock }}
    >
      {cleaned}
    </ReactMarkdown>
  );
}

const MODE_READ = 'read';
const MODE_SPLIT = 'split';
const MODE_EDIT = 'edit';

export default function MarkdownViewer({ filePath, scrollRef, onHeadingsChange, onDirtyChange, readOnly = false }) {
  const [savedContent, setSavedContent] = useState('');
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState(MODE_READ);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [history, setHistory] = useState({ canUndo: false, canRedo: false });
  const [editorReady, setEditorReady] = useState(false);
  const internalRef = useRef(null);
  const bodyRef = scrollRef || internalRef;
  const editorApiRef = useRef(null);
  const editorPaneRef = useRef(null);
  const dirty = content !== savedContent;

  const handleEditorReady = useCallback((api) => {
    editorApiRef.current = api;
    setEditorReady(true);
  }, []);
  const doUndo = useCallback(() => editorApiRef.current?.undo(), []);
  const doRedo = useCallback(() => editorApiRef.current?.redo(), []);

  // In read-only mode the editor is never available; force Read so an edit/split
  // view can't linger if the flag flips on.
  useEffect(() => {
    if (readOnly && mode !== MODE_READ) setMode(MODE_READ);
  }, [readOnly, mode]);

  // Report dirty state to the parent, which guards file switches against
  // discarding unsaved edits (see App.requestSelect).
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (!filePath) { setContent(''); setSavedContent(''); return; }
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
  }, [filePath]);

  // The editor only exists in edit/split mode. When it unmounts, drop the
  // stale view handle and history flags so the toolbar reflects reality.
  useEffect(() => {
    if (mode === MODE_READ) {
      editorApiRef.current = null;
      setEditorReady(false);
      setHistory({ canUndo: false, canRedo: false });
    }
  }, [mode]);

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

  // Synced scrolling in split mode. Anchoring on source lines (not a height
  // ratio) keeps the panes aligned even when blocks render at wildly different
  // heights than their source — a tall code block, a one-line heading, etc.
  // Each preview block carries data-source-line; we interpolate between the two
  // blocks straddling the viewport top to get a fractional line, then ask the
  // other pane where that line sits. A flag breaks the programmatic-scroll echo.
  useEffect(() => {
    if (mode !== MODE_SPLIT || loading || error) return;
    const preview = bodyRef.current;
    const editor = editorPaneRef.current?.querySelector('.cm-scroller');
    const api = editorApiRef.current;
    if (!preview || !editor || !api) return;

    // Ordered (top, line) anchors for the preview's top-level blocks. Measure
    // each block's offset relative to the scroller's content top via rects —
    // offsetTop is relative to the nearest positioned ancestor (here the page,
    // not the scroller), which adds a constant skew that compounds downward.
    let anchors = [];
    const measure = () => {
      anchors = [];
      const base = preview.getBoundingClientRect().top - preview.scrollTop;
      for (const el of preview.querySelectorAll('.markdown-body > [data-source-line]')) {
        anchors.push({
          top: el.getBoundingClientRect().top - base,
          line: Number(el.dataset.sourceLine),
        });
      }
    };
    measure();

    // Fractional source line at the preview's current scroll position.
    const previewToLine = () => {
      const y = preview.scrollTop;
      if (!anchors.length) return 1;
      if (y <= anchors[0].top) return anchors[0].line;
      for (let i = 0; i < anchors.length - 1; i++) {
        const a = anchors[i], b = anchors[i + 1];
        if (y < b.top) {
          const frac = (y - a.top) / (b.top - a.top);
          return a.line + frac * (b.line - a.line);
        }
      }
      return anchors[anchors.length - 1].line;
    };

    // Preview scroll offset for a fractional source line (inverse of above).
    const lineToPreview = (line) => {
      if (!anchors.length) return 0;
      if (line <= anchors[0].line) return anchors[0].top;
      for (let i = 0; i < anchors.length - 1; i++) {
        const a = anchors[i], b = anchors[i + 1];
        if (line < b.line) {
          const frac = b.line > a.line ? (line - a.line) / (b.line - a.line) : 0;
          return a.top + frac * (b.top - a.top);
        }
      }
      return anchors[anchors.length - 1].top;
    };

    let active = null;
    const release = () => requestAnimationFrame(() => { active = null; });
    const onEditorScroll = () => {
      if (active && active !== 'editor') return;
      active = 'editor';
      const line = api.offsetToLine(editor.scrollTop);
      preview.scrollTop = lineToPreview(line);
      release();
    };
    const onPreviewScroll = () => {
      if (active && active !== 'preview') return;
      active = 'preview';
      const line = previewToLine();
      editor.scrollTop = api.lineToOffset(line);
      release();
    };

    editor.addEventListener('scroll', onEditorScroll, { passive: true });
    preview.addEventListener('scroll', onPreviewScroll, { passive: true });
    // Block heights shift as images load or the editor reflows; re-measure.
    const ro = new ResizeObserver(measure);
    ro.observe(preview.querySelector('.markdown-body') || preview);
    return () => {
      editor.removeEventListener('scroll', onEditorScroll);
      preview.removeEventListener('scroll', onPreviewScroll);
      ro.disconnect();
    };
  }, [mode, loading, error, editorReady, content, bodyRef]);

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
          {mode !== MODE_READ && (
            <div className="history-controls" role="group">
              <button
                className="history-btn"
                onClick={doUndo}
                disabled={!history.canUndo}
                title="Undo (Ctrl+Z)"
                aria-label="Undo"
              >↶</button>
              <button
                className="history-btn"
                onClick={doRedo}
                disabled={!history.canRedo}
                title="Redo (Ctrl+Shift+Z)"
                aria-label="Redo"
              >↷</button>
            </div>
          )}
          {readOnly ? (
            <span className="read-only-badge" title="Server is in read-only mode">Read-only</span>
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>
      {saveError && <div className="viewer-status error">Save failed: {saveError}</div>}
      {loading && <div className="viewer-status">Loading…</div>}
      {error && <div className="viewer-status error">{error}</div>}

      {!loading && !error && (
        <div className={`viewer-content mode-${mode}`}>
          {(mode === MODE_EDIT || mode === MODE_SPLIT) && (
            <div className="editor-pane" ref={editorPaneRef}>
              <Suspense fallback={<div className="viewer-status">Loading editor…</div>}>
                <Editor
                  value={content}
                  onChange={(v) => setContent(v)}
                  onReady={handleEditorReady}
                  onHistoryChange={setHistory}
                />
              </Suspense>
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
