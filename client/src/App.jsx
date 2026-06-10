import { useState, useCallback, useRef, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import MarkdownViewer from './components/MarkdownViewer';
import TocPanel from './components/TocPanel';
import './App.css';

const TOC_COLLAPSED_WIDTH = 36;

export default function App() {
  const [selectedFile, setSelectedFile] = useState(null);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [tocWidth, setTocWidth] = useState(260);
  const [tocCollapsed, setTocCollapsed] = useState(false);
  const [draggingTarget, setDraggingTarget] = useState(null);
  const [headings, setHeadings] = useState([]);
  const [readOnly, setReadOnly] = useState(false);
  const viewerScrollRef = useRef(null);
  const dirtyRef = useRef(false);

  // Fetch the read-only flag once at startup. On failure we stay in the safe
  // default (false) — reading must keep working even if settings can't load.
  useEffect(() => {
    fetch('/api/config/settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setReadOnly(d.readOnly === true); })
      .catch(() => { /* keep default */ });
  }, []);

  // Guard genuine file switches (tree clicks, opening a new file) so unsaved
  // edits aren't silently dropped. The confirm lives here — not in the viewer's
  // load effect — because by the time the prop changes the selection is already
  // committed, so a cancel there can't restore the previous file.
  const requestSelect = useCallback((path) => {
    if (dirtyRef.current && !window.confirm('You have unsaved changes. Discard them?')) {
      return;
    }
    setSelectedFile(path);
  }, []);

  const startDrag = useCallback((target, startX, startWidth, min, max, sign) => {
    setDraggingTarget(target);
    const onMouseMove = (e) => {
      const delta = (e.clientX - startX) * sign;
      const newWidth = Math.min(max, Math.max(min, startWidth + delta));
      if (target === 'sidebar') setSidebarWidth(newWidth);
      else setTocWidth(newWidth);
    };
    const onMouseUp = () => {
      setDraggingTarget(null);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, []);

  const handleSidebarDrag = useCallback((e) => {
    e.preventDefault();
    startDrag('sidebar', e.clientX, sidebarWidth, 160, 600, 1);
  }, [sidebarWidth, startDrag]);

  const handleTocDrag = useCallback((e) => {
    e.preventDefault();
    if (tocCollapsed) return;
    startDrag('toc', e.clientX, tocWidth, 160, 600, -1);
  }, [tocWidth, tocCollapsed, startDrag]);

  return (
    <div className={`app-layout${draggingTarget ? ' dragging' : ''}`}>
      <div className="sidebar-panel" style={{ width: sidebarWidth }}>
        <Sidebar selectedFile={selectedFile} onSelect={requestSelect} readOnly={readOnly} />
      </div>
      <div className="resize-handle" onMouseDown={handleSidebarDrag} />
      <div className="content-panel">
        <MarkdownViewer
          filePath={selectedFile}
          scrollRef={viewerScrollRef}
          onHeadingsChange={setHeadings}
          onDirtyChange={(d) => { dirtyRef.current = d; }}
          readOnly={readOnly}
        />
      </div>
      {!tocCollapsed && (
        <div className="resize-handle" onMouseDown={handleTocDrag} />
      )}
      <div
        className="toc-panel-wrapper"
        style={{ width: tocCollapsed ? TOC_COLLAPSED_WIDTH : tocWidth }}
      >
        <TocPanel
          headings={headings}
          scrollContainerRef={viewerScrollRef}
          collapsed={tocCollapsed}
          onTogglePanel={() => setTocCollapsed((c) => !c)}
        />
      </div>
    </div>
  );
}
