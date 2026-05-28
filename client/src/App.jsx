import { useState, useCallback, useRef } from 'react';
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
  const viewerScrollRef = useRef(null);

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
        <Sidebar selectedFile={selectedFile} onSelect={setSelectedFile} />
      </div>
      <div className="resize-handle" onMouseDown={handleSidebarDrag} />
      <div className="content-panel">
        <MarkdownViewer
          filePath={selectedFile}
          scrollRef={viewerScrollRef}
          onHeadingsChange={setHeadings}
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
