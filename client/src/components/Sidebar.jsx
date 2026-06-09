import { useEffect, useState, useCallback, useMemo } from 'react';
import FileTree from './FileTree';
import './Sidebar.css';

// Pull the owning root id out of an opaque path token (`<type>:<id>::<inner>`).
// Used to refresh only the affected root after a file op.
function rootIdOfToken(token) {
  if (typeof token !== 'string') return null;
  const sep = token.indexOf('::');
  const head = sep < 0 ? token : token.slice(0, sep);
  const colon = head.indexOf(':');
  return colon < 0 ? null : head.slice(colon + 1);
}

export default function Sidebar({ selectedFile, onSelect }) {
  const [roots, setRoots] = useState([]);
  const [rootsError, setRootsError] = useState(null);
  // Per-root tree state: { [id]: { status: 'idle'|'loading'|'ready'|'error', tree, error } }
  const [trees, setTrees] = useState({});
  const [tab, setTab] = useState('local'); // 'local' | 'remote'
  const [activeMachine, setActiveMachine] = useState(null); // remote node name
  const [toast, setToast] = useState(null);

  const localRoots = useMemo(() => roots.filter((r) => r.type === 'local'), [roots]);
  const remoteRoots = useMemo(() => roots.filter((r) => r.type === 'remote'), [roots]);

  // Group remote roots by machine (node). One machine can host several folder
  // roots, so a sub-tab is a machine and shows all of its roots together.
  const machines = useMemo(() => {
    const order = [];
    const byNode = new Map();
    for (const r of remoteRoots) {
      const key = r.node || r.id;
      if (!byNode.has(key)) { byNode.set(key, []); order.push(key); }
      byNode.get(key).push(r);
    }
    return order.map((node) => ({ node, roots: byNode.get(node) }));
  }, [remoteRoots]);

  const showToast = useCallback((msg, kind = 'info') => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // Load (or reload) a single root's tree. Each root is independent, so one
  // slow/offline remote never blocks local roots or other remotes.
  const loadRoot = useCallback(async (id) => {
    setTrees((prev) => ({ ...prev, [id]: { ...prev[id], status: 'loading', error: null } }));
    try {
      const r = await fetch(`/api/files/root/${encodeURIComponent(id)}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || r.statusText);
      setTrees((prev) => ({ ...prev, [id]: { status: 'ready', tree: data, error: null } }));
    } catch (e) {
      setTrees((prev) => ({ ...prev, [id]: { status: 'error', tree: null, error: e.message } }));
    }
  }, []);

  // Fetch root metadata once (no remote contact) to build the tab structure.
  const loadRoots = useCallback(async () => {
    try {
      const r = await fetch('/api/files/roots');
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || r.statusText);
      setRoots(data);
      setRootsError(null);
    } catch (e) {
      setRootsError(e.message);
    }
  }, []);

  useEffect(() => { loadRoots(); }, [loadRoots]);

  // Local roots load eagerly (cheap, instant). Remote roots load lazily when
  // their sub-tab is first activated.
  useEffect(() => {
    for (const r of localRoots) {
      if (!trees[r.id]) loadRoot(r.id);
    }
  }, [localRoots, trees, loadRoot]);

  // Default the active machine sub-tab to the first one once roots arrive.
  useEffect(() => {
    if (activeMachine == null && machines.length) setActiveMachine(machines[0].node);
  }, [machines, activeMachine]);

  // Lazily load every root of the active machine when its sub-tab is shown.
  useEffect(() => {
    if (tab !== 'remote' || !activeMachine) return;
    const m = machines.find((x) => x.node === activeMachine);
    if (!m) return;
    for (const r of m.roots) {
      if (!trees[r.id]) loadRoot(r.id);
    }
  }, [tab, activeMachine, machines, trees, loadRoot]);

  // Re-read config.json on the server, then rebuild tabs and refresh only the
  // currently visible root (not every remote).
  const reloadConfig = useCallback(async () => {
    try {
      const r = await fetch('/api/config/reload', { method: 'POST' });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || r.statusText);
      showToast('Config reloaded');
    } catch (e) {
      showToast(`Reload failed: ${e.message}`, 'error');
    }
    setTrees({});
    await loadRoots();
  }, [loadRoots, showToast]);

  // Refresh whichever root a just-changed file belongs to.
  const refreshRoot = useCallback((id) => { if (id) loadRoot(id); }, [loadRoot]);

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
      refreshRoot(rootIdOfToken(folderPath));
    } catch (e) {
      showToast(`Upload failed: ${e.message}`, 'error');
    }
  }, [refreshRoot, showToast]);

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
      refreshRoot(rootIdOfToken(folderPath));
      onSelect(data.path);
    } catch (e) {
      showToast(`Create failed: ${e.message}`, 'error');
    }
  }, [refreshRoot, showToast, onSelect]);

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
      refreshRoot(rootIdOfToken(filePath));
      if (selectedFile === filePath) onSelect(data.path);
    } catch (e) {
      showToast(`Rename failed: ${e.message}`, 'error');
    }
  }, [refreshRoot, showToast, selectedFile, onSelect]);

  const deleteFile = useCallback(async (filePath, fileName) => {
    if (!window.confirm(`Delete "${fileName}"?\n\nPath: ${filePath}\n\nThis cannot be undone.`)) return;
    try {
      const r = await fetch(`/api/files?path=${encodeURIComponent(filePath)}`, {
        method: 'DELETE',
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || r.statusText);
      showToast(`Deleted ${fileName}`);
      refreshRoot(rootIdOfToken(filePath));
      if (selectedFile === filePath) onSelect(null);
    } catch (e) {
      showToast(`Delete failed: ${e.message}`, 'error');
    }
  }, [refreshRoot, showToast, selectedFile, onSelect]);

  const renderRoot = useCallback((rootMeta) => {
    const state = trees[rootMeta.id];
    if (!state || state.status === 'loading' || state.status === 'idle') {
      return <div className="sidebar-status">Loading…</div>;
    }
    if (state.status === 'error') {
      return (
        <div className="sidebar-status error" title={state.error}>
          {rootMeta.name}: {state.error}
          <button className="retry-btn" onClick={() => loadRoot(rootMeta.id)}>Retry</button>
        </div>
      );
    }
    return (
      <FileTree
        node={state.tree}
        depth={0}
        selectedFile={selectedFile}
        onSelect={onSelect}
        onUpload={uploadFiles}
        onCreateFile={createFile}
        onRenameFile={renameFile}
        onDeleteFile={deleteFile}
      />
    );
  }, [trees, selectedFile, onSelect, uploadFiles, createFile, renameFile, deleteFile, loadRoot]);

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-tabs">
          <button
            className={`sidebar-tab${tab === 'local' ? ' active' : ''}`}
            onClick={() => setTab('local')}
          >
            Local
          </button>
          <button
            className={`sidebar-tab${tab === 'remote' ? ' active' : ''}`}
            onClick={() => setTab('remote')}
          >
            Remote
          </button>
        </div>
        <button className="refresh-btn" onClick={reloadConfig} title="Reload config & refresh">↺</button>
      </div>

      {tab === 'remote' && machines.length > 0 && (
        <div className="sidebar-subtabs">
          {machines.map((m) => (
            <button
              key={m.node}
              className={`sidebar-subtab${activeMachine === m.node ? ' active' : ''}`}
              onClick={() => setActiveMachine(m.node)}
              title={m.node}
            >
              {m.node}
            </button>
          ))}
        </div>
      )}

      <div className="sidebar-tree">
        {rootsError && <div className="sidebar-status error">{rootsError}</div>}

        {!rootsError && tab === 'local' && (
          localRoots.length === 0
            ? <div className="sidebar-status">No local roots configured.</div>
            : localRoots.map((r) => <div key={r.id}>{renderRoot(r)}</div>)
        )}

        {!rootsError && tab === 'remote' && (
          machines.length === 0
            ? <div className="sidebar-status">No remote roots configured.</div>
            : activeMachine && (() => {
              const m = machines.find((x) => x.node === activeMachine);
              if (!m) return null;
              // One machine can host several folder roots — show them all.
              return m.roots.map((r) => <div key={r.id}>{renderRoot(r)}</div>);
            })()
        )}
      </div>

      {toast && (
        <div className={`sidebar-toast ${toast.kind}`}>{toast.msg}</div>
      )}
    </div>
  );
}
