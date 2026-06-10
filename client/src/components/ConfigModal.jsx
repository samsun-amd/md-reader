import { useEffect, useState, useCallback } from 'react';
import './ConfigModal.css';

const EMPTY_LOCAL = { type: 'local', id: '', name: '', path: '' };
const EMPTY_REMOTE = {
  type: 'remote', id: '', name: '', host: '', machineName: '', port: 22,
  user: '', password: '', clearPassword: false, os: 'posix', remotePath: '~',
};

// Form-based editor for config.json roots. Never shows raw JSON; passwords are
// write-only (the server never sends plaintext back).
export default function ConfigModal({ onClose, onChanged }) {
  const [roots, setRoots] = useState([]);
  const [loadError, setLoadError] = useState(null);
  // editing: null = list view; otherwise the form draft (with `_mode`).
  const [editing, setEditing] = useState(null);
  const [formError, setFormError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/config/roots');
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || r.statusText);
      setRoots(data.roots || []);
      setLoadError(null);
    } catch (e) {
      setLoadError(e.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Close on Escape (list view only, so a half-typed form isn't lost by accident).
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !editing) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, onClose]);

  const startAdd = (type) => {
    setFormError(null);
    setEditing({ ...(type === 'remote' ? EMPTY_REMOTE : EMPTY_LOCAL), _mode: 'add' });
  };

  const startEdit = (root) => {
    setFormError(null);
    if (root.type === 'remote') {
      setEditing({
        ...EMPTY_REMOTE,
        ...root,
        password: '',            // never prefill; blank = keep existing
        clearPassword: false,
        _mode: 'edit',
        _hadPassword: root.hasPassword,
      });
    } else {
      setEditing({ ...EMPTY_LOCAL, ...root, _mode: 'edit' });
    }
  };

  const setField = (key, value) => setEditing((d) => ({ ...d, [key]: value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!editing) return;
    setFormError(null);

    const d = editing;
    if (!d.id.trim()) { setFormError('ID is required'); return; }
    if (d.type === 'remote') {
      if (!d.host.trim()) { setFormError('Host is required'); return; }
      if (!d.user.trim()) { setFormError('User is required'); return; }
    } else if (!d.path.trim()) {
      setFormError('Path is required'); return;
    }

    // Build request body. For remote, apply the password sentinel:
    //   clearPassword -> ""   |  non-empty input -> new value  |  else omit.
    const body = { id: d.id.trim(), name: d.name.trim(), type: d.type };
    if (d.type === 'remote') {
      Object.assign(body, {
        host: d.host.trim(),
        machineName: d.machineName.trim(),
        port: Number(d.port) > 0 ? Number(d.port) : 22,
        user: d.user.trim(),
        os: d.os === 'windows' ? 'windows' : 'posix',
        remotePath: d.remotePath.trim() || '~',
      });
      if (d.clearPassword) body.password = '';
      else if (d.password) body.password = d.password;
      // else: omit password -> server keeps existing
    } else {
      body.path = d.path.trim();
    }

    const isEdit = d._mode === 'edit';
    const url = isEdit
      ? `/api/config/roots/${encodeURIComponent(d.id.trim())}`
      : '/api/config/roots';
    setBusy(true);
    try {
      const r = await fetch(url, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || r.statusText);
      setRoots(data.roots || []);
      setEditing(null);
      onChanged?.();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (root) => {
    if (!window.confirm(`Delete root "${root.name || root.id}"?\n\nThis only removes it from the sidebar; no files are deleted.`)) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/config/roots/${encodeURIComponent(root.id)}`, { method: 'DELETE' });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || r.statusText);
      setRoots(data.roots || []);
      onChanged?.();
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const localRoots = roots.filter((r) => r.type === 'local');
  const remoteRoots = roots.filter((r) => r.type === 'remote');

  return (
    <div className="cfg-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !editing) onClose(); }}>
      <div className="cfg-modal" role="dialog" aria-modal="true">
        <div className="cfg-head">
          <span className="cfg-title">Manage roots</span>
          <button className="cfg-x" onClick={onClose} title="Close">×</button>
        </div>

        {editing ? (
          <RootForm
            draft={editing}
            error={formError}
            busy={busy}
            onField={setField}
            onSubmit={submit}
            onCancel={() => { setEditing(null); setFormError(null); }}
          />
        ) : (
          <div className="cfg-body">
            {loadError && <div className="cfg-error">{loadError}</div>}

            <div className="cfg-section-head">
              <span>Local</span>
              <button className="cfg-add" onClick={() => startAdd('local')}>+ Add local</button>
            </div>
            {localRoots.length === 0
              ? <div className="cfg-empty">No local roots.</div>
              : localRoots.map((r) => (
                <RootRow key={r.id} root={r} summary={r.path}
                  onEdit={() => startEdit(r)} onDelete={() => remove(r)} disabled={busy} />
              ))}

            <div className="cfg-section-head">
              <span>Remote</span>
              <button className="cfg-add" onClick={() => startAdd('remote')}>+ Add remote</button>
            </div>
            {remoteRoots.length === 0
              ? <div className="cfg-empty">No remote roots.</div>
              : remoteRoots.map((r) => (
                <RootRow key={r.id} root={r}
                  summary={`${r.user}@${r.machineName ? `${r.machineName} (${r.host})` : r.host}:${r.remotePath}`}
                  badge={r.hasPassword ? '●●●●' : 'no password'}
                  onEdit={() => startEdit(r)} onDelete={() => remove(r)} disabled={busy} />
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RootRow({ root, summary, badge, onEdit, onDelete, disabled }) {
  return (
    <div className="cfg-row">
      <div className="cfg-row-main">
        <span className="cfg-row-name">{root.name || root.id}</span>
        <span className="cfg-row-sub">{summary}</span>
      </div>
      {badge && <span className="cfg-row-badge">{badge}</span>}
      <div className="cfg-row-actions">
        <button className="cfg-btn" onClick={onEdit} disabled={disabled}>Edit</button>
        <button className="cfg-btn danger" onClick={onDelete} disabled={disabled}>Delete</button>
      </div>
    </div>
  );
}

function RootForm({ draft, error, busy, onField, onSubmit, onCancel }) {
  const isEdit = draft._mode === 'edit';
  const isRemote = draft.type === 'remote';
  const pwPlaceholder = isEdit
    ? (draft._hadPassword ? 'Leave blank to keep current' : 'No password set')
    : 'SSH password (optional)';

  return (
    <form className="cfg-form" onSubmit={onSubmit}>
      <div className="cfg-form-title">
        {isEdit ? 'Edit' : 'Add'} {isRemote ? 'remote' : 'local'} root
      </div>

      <label className="cfg-field">
        <span>ID</span>
        <input value={draft.id} disabled={isEdit}
          onChange={(e) => onField('id', e.target.value)}
          placeholder="unique-id" autoFocus={!isEdit} />
      </label>

      <label className="cfg-field">
        <span>Name</span>
        <input value={draft.name}
          onChange={(e) => onField('name', e.target.value)}
          placeholder="Shown in the sidebar" />
      </label>

      {!isRemote && (
        <label className="cfg-field">
          <span>Path</span>
          <input value={draft.path}
            onChange={(e) => onField('path', e.target.value)}
            placeholder="~/notes" />
        </label>
      )}

      {isRemote && (
        <>
          <div className="cfg-field-row">
            <label className="cfg-field grow">
              <span>Host</span>
              <input value={draft.host}
                onChange={(e) => onField('host', e.target.value)}
                placeholder="10.0.0.5 or hostname" />
            </label>
            <label className="cfg-field port">
              <span>Port</span>
              <input type="number" value={draft.port}
                onChange={(e) => onField('port', e.target.value)} placeholder="22" />
            </label>
          </div>

          <label className="cfg-field">
            <span>Machine name</span>
            <input value={draft.machineName}
              onChange={(e) => onField('machineName', e.target.value)}
              placeholder="Sub-tab label (defaults to host)" />
          </label>

          <label className="cfg-field">
            <span>User</span>
            <input value={draft.user}
              onChange={(e) => onField('user', e.target.value)} placeholder="root" />
          </label>

          <label className="cfg-field">
            <span>Password</span>
            <input type="password" value={draft.password}
              disabled={draft.clearPassword}
              onChange={(e) => onField('password', e.target.value)}
              placeholder={pwPlaceholder} autoComplete="new-password" />
          </label>

          {isEdit && draft._hadPassword && (
            <label className="cfg-check">
              <input type="checkbox" checked={draft.clearPassword}
                onChange={(e) => onField('clearPassword', e.target.checked)} />
              <span>Clear saved password</span>
            </label>
          )}

          <div className="cfg-field-row">
            <label className="cfg-field grow">
              <span>Remote path</span>
              <input value={draft.remotePath}
                onChange={(e) => onField('remotePath', e.target.value)} placeholder="~" />
            </label>
            <label className="cfg-field os">
              <span>OS</span>
              <select value={draft.os} onChange={(e) => onField('os', e.target.value)}>
                <option value="posix">posix</option>
                <option value="windows">windows</option>
              </select>
            </label>
          </div>
        </>
      )}

      {error && <div className="cfg-error">{error}</div>}

      <div className="cfg-form-actions">
        <button type="button" className="cfg-btn" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="submit" className="cfg-btn primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}
