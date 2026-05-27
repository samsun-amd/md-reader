import { useState, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import MarkdownViewer from './components/MarkdownViewer';
import './App.css';

export default function App() {
  const [selectedFile, setSelectedFile] = useState(null);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [isDragging, setIsDragging] = useState(false);

  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    setIsDragging(true);

    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const onMouseMove = (e) => {
      const newWidth = Math.min(600, Math.max(160, startWidth + e.clientX - startX));
      setSidebarWidth(newWidth);
    };
    const onMouseUp = () => {
      setIsDragging(false);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [sidebarWidth]);

  return (
    <div className={`app-layout${isDragging ? ' dragging' : ''}`}>
      <div className="sidebar-panel" style={{ width: sidebarWidth }}>
        <Sidebar selectedFile={selectedFile} onSelect={setSelectedFile} />
      </div>
      <div className="resize-handle" onMouseDown={handleMouseDown} />
      <div className="content-panel">
        <MarkdownViewer filePath={selectedFile} />
      </div>
    </div>
  );
}
