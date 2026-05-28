import { useEffect, useState, useCallback } from 'react';
import FileTree from './FileTree';
import './Sidebar.css';

export default function Sidebar({ selectedFile, onSelect }) {
  const [tree, setTree] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch('/api/files')
      .then((r) => r.json())
      .then((data) => { setTree(data); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const showToast = useCallback((msg, kind = 'info') => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const uploadFiles = useCallback(async (folderPath, fileList) => {
    const files = Array.from(fileList).filter((f) => /\.(md|mdx)$/i.test(f.name));
    if (files.length === 0) {
      showToast('No .md/.mdx files in drop', 'error');
      return;
    }
    const form = new FormData();
    form.append('folder', folderPath);
    for (const f of files) form.append('files', f);
    try {
      const r = await fetch('/api/upload', { method: 'POST', body: form });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || r.statusText);
      const w = data.written?.length || 0;
      const s = data.skipped?.length || 0;
      const renamed = data.written?.filter((x) => x.savedAs !== x.original) || [];
      let msg = `Uploaded ${w} file${w === 1 ? '' : 's'}`;
      if (renamed.length) msg += ` (${renamed.length} renamed)`;
      if (s) msg += `, skipped ${s}`;
      showToast(msg, s && !w ? 'error' : 'info');
      refresh();
    } catch (e) {
      showToast(`Upload failed: ${e.message}`, 'error');
    }
  }, [refresh, showToast]);

  const createFile = useCallback(async (folderPath) => {
    const name = window.prompt('New file name (.md will be added if omitted):', 'untitled.md');
    if (!name) return;
    try {
      const r = await fetch('/api/files/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: folderPath, name }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || r.statusText);
      showToast(`Created ${data.name}`);
      refresh();
      onSelect(data.path);
    } catch (e) {
      showToast(`Create failed: ${e.message}`, 'error');
    }
  }, [refresh, showToast, onSelect]);

  const renameFile = useCallback(async (filePath, currentName) => {
    const newName = window.prompt('Rename to:', currentName);
    if (!newName || newName === currentName) return;
    try {
      const r = await fetch('/api/files/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, newName }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || r.statusText);
      showToast(`Renamed to ${data.name}`);
      refresh();
      if (selectedFile === filePath) onSelect(data.path);
    } catch (e) {
      showToast(`Rename failed: ${e.message}`, 'error');
    }
  }, [refresh, showToast, selectedFile, onSelect]);

  const deleteFile = useCallback(async (filePath, fileName) => {
    if (!window.confirm(`Delete "${fileName}"?\n\nPath: ${filePath}\n\nThis cannot be undone.`)) return;
    try {
      const r = await fetch(`/api/files?path=${encodeURIComponent(filePath)}`, {
        method: 'DELETE',
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || r.statusText);
      showToast(`Deleted ${fileName}`);
      refresh();
      if (selectedFile === filePath) onSelect(null);
    } catch (e) {
      showToast(`Delete failed: ${e.message}`, 'error');
    }
  }, [refresh, showToast, selectedFile, onSelect]);

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
            onUpload={uploadFiles}
            onCreateFile={createFile}
            onRenameFile={renameFile}
            onDeleteFile={deleteFile}
          />
        ))}
      </div>
      {toast && (
        <div className={`sidebar-toast ${toast.kind}`}>{toast.msg}</div>
      )}
    </div>
  );
}
