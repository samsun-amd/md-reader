import { useEffect, useState } from 'react';
import FileTree from './FileTree';
import './Sidebar.css';

export default function Sidebar({ selectedFile, onSelect }) {
  const [tree, setTree] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = () => {
    setLoading(true);
    setError(null);
    fetch('/api/files')
      .then((r) => r.json())
      .then((data) => { setTree(data); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  };

  useEffect(() => { refresh(); }, []);

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-title">Files</span>
        <button className="refresh-btn" onClick={refresh} title="Refresh">↺</button>
      </div>
      <div className="sidebar-tree">
        {loading && <div className="sidebar-status">Loading…</div>}
        {error && <div className="sidebar-status error">{error}</div>}
        {!loading && !error && tree.map((root) => (
          <FileTree
            key={root.path}
            node={root}
            depth={0}
            selectedFile={selectedFile}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}
