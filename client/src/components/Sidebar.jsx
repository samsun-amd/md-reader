import { useEffect, useState, useCallback, useMemo, Fragment } from 'react';
import FileTree from './FileTree';
import ConfigModal from './ConfigModal';
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

// The inner (real filesystem) path of a token, i.e. everything after '::'.
// A root's path keeps whatever trailing slash its config had (`"path": "~/"`
// yields `/home/me/`), so strip it — otherwise every prefix test below fails.
function innerPathOfToken(token) {
  if (typeof token !== 'string') return '';
  const sep = token.indexOf('::');
  if (sep < 0) return '';
  return token.slice(sep + 2).replace(/\/+$/, '');
}

// Pins are stored relative to the root's base so config.json stays portable and
// readable. The root tree node carries the expanded base in its own token, which
// is what makes the conversion possible without asking the server.
function relPathOf(rootNode, token) {
  const base = innerPathOfToken(rootNode?.path);
  const inner = innerPathOfToken(token);
  if (!base || !inner || !inner.startsWith(`${base}/`)) return null;
  return inner.slice(base.length + 1);
}

// Find the tree node for a pinned relative path inside an already-loaded root
// tree. Pins are an alternate entry point into that tree, not a second data
// source — so an expanded pin costs no extra request.
function findNodeByRel(rootNode, rel) {
  const segments = rel.split('/');
  let node = rootNode;
  for (const seg of segments) {
    if (!node?.children) return null;
    node = node.children.find((c) => c.name === seg && c.type === 'dir');
    if (!node) return null;
  }
  return node;
}

export default function Sidebar({ selectedFile, onSelect, readOnly = false }) {
  const [roots, setRoots] = useState([]);
  const [rootsError, setRootsError] = useState(null);
  // Per-root tree state: { [id]: { status: 'idle'|'loading'|'ready'|'error', tree, error } }
  const [trees, setTrees] = useState({});
  const [tab, setTab] = useState('local'); // 'local' | 'remote'
  const [activeMachine, setActiveMachine] = useState(null); // host key of active sub-tab
  const [toast, setToast] = useState(null);
  const [showConfig, setShowConfig] = useState(false);

  // A remote root is a machine, one for one — it always opens at the remote
  // home, and reaching a specific folder is what pins are for. So a sub-tab
  // maps straight onto a root; no grouping step.
  const localRoots = useMemo(() => roots.filter((r) => r.type === 'local'), [roots]);
  const remoteRoots = useMemo(() => roots.filter((r) => r.type === 'remote'), [roots]);

  // What the current tab shows: all local roots, or the one selected machine.
  // Both the pinned block and the tree iterate this, so they can never disagree.
  const visibleRoots = useMemo(() => {
    if (tab === 'local') return localRoots;
    const active = remoteRoots.find((r) => r.id === activeMachine);
    return active ? [active] : [];
  }, [tab, localRoots, remoteRoots, activeMachine]);

  const showToast = useCallback((msg, kind = 'info') => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // Load (or reload) a single root's tree. Each root is independent, so one
  // slow/offline remote never blocks local roots or other remotes.
  const loadRoot = useCallback(async (id) => {
    // Clearing trees or starting another load invalidates this request.
    const request = Symbol();
    setTrees((prev) => ({ ...prev, [id]: { ...prev[id], status: 'loading', error: null, request } }));
    let state;
    try {
      const r = await fetch(`/api/files/root/${encodeURIComponent(id)}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || r.statusText);
      state = { status: 'ready', tree: data, error: null };
    } catch (e) {
      state = { status: 'error', tree: null, error: e.message };
    }
    setTrees((prev) => prev[id]?.request === request ? { ...prev, [id]: state } : prev);
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

  // Load only the visible roots. Refreshing a remote must not also scan local
  // folders, which may live on slow Windows or network filesystems.
  useEffect(() => {
    for (const r of visibleRoots) {
      if (!trees[r.id]) loadRoot(r.id);
    }
  }, [visibleRoots, trees, loadRoot]);

  // Default the active machine sub-tab to the first one once roots arrive.
  useEffect(() => {
    if (!remoteRoots.some((r) => r.id === activeMachine)) {
      setActiveMachine(remoteRoots[0]?.id ?? null);
    }
  }, [remoteRoots, activeMachine]);

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

  // After the config editor changes roots, the server has already reloaded its
  // config and dropped remote connections, so just rebuild the client view.
  const refreshAfterConfig = useCallback(async () => {
    setTrees({});
    await loadRoots();
    showToast('Roots updated');
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

  // Pin/unpin a folder. Pins live in config.json (server-side) so they follow
  // the machine, not the browser. The tree itself is untouched — a pin is only
  // a second way in — so there is nothing to reload but the root list.
  const setPin = useCallback(async (rootId, rel, pinned) => {
    try {
      const r = await fetch(`/api/config/roots/${encodeURIComponent(rootId)}/pins`, {
        method: pinned ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rel }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || r.statusText);
      await loadRoots();
      showToast(pinned ? `Unpinned ${rel}` : `Pinned ${rel}`);
    } catch (e) {
      showToast(`${pinned ? 'Unpin' : 'Pin'} failed: ${e.message}`, 'error');
    }
  }, [loadRoots, showToast]);

  // Toggle from a tree row, which knows a token but not its relative path.
  const togglePin = useCallback((folderToken) => {
    const id = rootIdOfToken(folderToken);
    const rel = relPathOf(trees[id]?.tree, folderToken);
    if (!id || !rel) { showToast('Cannot pin this folder', 'error'); return; }
    const pinned = (roots.find((r) => r.id === id)?.pins || []).includes(rel);
    setPin(id, rel, pinned);
  }, [trees, roots, setPin, showToast]);

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
        onUpload={readOnly ? undefined : uploadFiles}
        onCreateFile={readOnly ? undefined : createFile}
        onRenameFile={readOnly ? undefined : renameFile}
        onDeleteFile={readOnly ? undefined : deleteFile}
        onTogglePin={togglePin}
        pinnedRels={rootMeta.pins}
        rootNode={state.tree}
      />
    );
  }, [trees, selectedFile, onSelect, uploadFiles, createFile, renameFile, deleteFile, loadRoot,
    readOnly, togglePin]);

  // The pinned block for one root. Renders straight out of the loaded tree, so
  // it inherits that root's loading/error state instead of having its own.
  // depth={1} makes each pin collapsed by default (FileTree opens only depth 0).
  const renderPins = useCallback((rootMeta) => {
    const pins = rootMeta.pins || [];
    if (!pins.length) return null;
    const state = trees[rootMeta.id];
    return (
      <div className="sidebar-pins">
        <div className="sidebar-pins-title">Pinned</div>
        {state?.status !== 'ready'
          ? <div className="sidebar-status">Loading…</div>
          : pins.map((rel) => {
            const node = findNodeByRel(state.tree, rel);
            // Folder gone (renamed/deleted on the machine). Say so and offer
            // the only useful action rather than silently dropping the row.
            if (!node) {
              return (
                <div key={rel} className="sidebar-pin-missing" title={`${rel} no longer exists`}>
                  <span className="sidebar-pin-missing-name">{rel}</span>
                  <button className="retry-btn" onClick={() => setPin(rootMeta.id, rel, true)}>
                    Unpin
                  </button>
                </div>
              );
            }
            return (
              <FileTree
                key={rel}
                node={{ ...node, name: rel }}
                depth={0}
                defaultExpanded={false}
                selectedFile={selectedFile}
                onSelect={onSelect}
                onUpload={readOnly ? undefined : uploadFiles}
                onCreateFile={readOnly ? undefined : createFile}
                onRenameFile={readOnly ? undefined : renameFile}
                onDeleteFile={readOnly ? undefined : deleteFile}
                onTogglePin={togglePin}
                pinnedRels={pins}
                rootNode={state.tree}
              />
            );
          })}
      </div>
    );
  }, [trees, selectedFile, onSelect, uploadFiles, createFile, renameFile, deleteFile,
    readOnly, togglePin, setPin]);

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
        <div className="sidebar-header-actions">
          {!readOnly && (
            <button className="refresh-btn" onClick={() => setShowConfig(true)} title="Manage roots">⚙</button>
          )}
          <button className="refresh-btn" onClick={reloadConfig} title="Reload config & refresh">↺</button>
        </div>
      </div>

      {tab === 'remote' && remoteRoots.length > 0 && (
        <div className="sidebar-subtabs">
          {remoteRoots.map((r) => (
            <button
              key={r.id}
              className={`sidebar-subtab${activeMachine === r.id ? ' active' : ''}`}
              onClick={() => setActiveMachine(r.id)}
              title={r.host ? `${r.name} (${r.host})` : r.name}
            >
              {r.name}
            </button>
          ))}
        </div>
      )}

      {/* Pinned block sits above the tree and below the tabs: fixed to the top
          so its position never moves, growing downward with the pin count. */}
      {!rootsError && visibleRoots.map((r) => (
        <Fragment key={`pins-${r.id}`}>{renderPins(r)}</Fragment>
      ))}

      <div className="sidebar-tree">
        {rootsError && <div className="sidebar-status error">{rootsError}</div>}

        {!rootsError && tab === 'local' && localRoots.length === 0 && (
          <div className="sidebar-status">No local roots configured.</div>
        )}
        {!rootsError && tab === 'remote' && remoteRoots.length === 0 && (
          <div className="sidebar-status">No remote roots configured.</div>
        )}
        {!rootsError && visibleRoots.map((r) => <div key={r.id}>{renderRoot(r)}</div>)}
      </div>

      {toast && (
        <div className={`sidebar-toast ${toast.kind}`}>{toast.msg}</div>
      )}

      {showConfig && !readOnly && (
        <ConfigModal
          onClose={() => setShowConfig(false)}
          onChanged={refreshAfterConfig}
        />
      )}
    </div>
  );
}
