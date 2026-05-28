import { useState, useEffect, useRef } from 'react';
import './FileTree.css';

const ChevronRight = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
    <path d="M4.5 2.5l4 3.5-4 3.5V2.5z" />
  </svg>
);

const FolderIcon = ({ open }) => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
    {open
      ? <path d="M1.75 4.5A1.75 1.75 0 0 0 0 6.25v6A1.75 1.75 0 0 0 1.75 14h12.5A1.75 1.75 0 0 0 16 12.25V6.25a1.75 1.75 0 0 0-1.75-1.75H8.56l-.7-1.06A1.75 1.75 0 0 0 6.44 2.5H1.75A1.75 1.75 0 0 0 0 4.25v.25h1.75z" />
      : <path d="M1.75 2.5A1.75 1.75 0 0 0 0 4.25v7.5A1.75 1.75 0 0 0 1.75 13.5h12.5A1.75 1.75 0 0 0 16 11.75v-7A1.75 1.75 0 0 0 14.25 3H8.06l-.7-1.06A1.75 1.75 0 0 0 5.94 1H1.75z" />
    }
  </svg>
);

const FileIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
    <path d="M2 1.75A1.75 1.75 0 0 1 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25V1.75z" />
  </svg>
);

const DotsIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
    <circle cx="3" cy="8" r="1.5" />
    <circle cx="8" cy="8" r="1.5" />
    <circle cx="13" cy="8" r="1.5" />
  </svg>
);

function NodeMenu({ items, onClose, anchorRect }) {
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', esc);
    };
  }, [onClose]);

  const style = anchorRect ? {
    position: 'fixed',
    top: anchorRect.bottom + 2,
    left: Math.min(anchorRect.left, window.innerWidth - 180),
  } : {};

  return (
    <div className="node-menu" style={style} ref={ref}>
      {items.map((it) => (
        <button
          key={it.label}
          className={`node-menu-item${it.danger ? ' danger' : ''}`}
          onClick={(e) => { e.stopPropagation(); onClose(); it.onClick(); }}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

export default function FileTree({
  node, depth, selectedFile, onSelect,
  onUpload, onCreateFile, onRenameFile, onDeleteFile,
}) {
  const [expanded, setExpanded] = useState(depth === 0);
  const [dragOver, setDragOver] = useState(false);
  const [menuRect, setMenuRect] = useState(null);
  const isDir = node.type === 'dir' || node.type === 'root';
  const isSelected = node.path === selectedFile;
  const indent = depth * 12;

  const handleClick = () => {
    if (isDir) setExpanded((v) => !v);
    else onSelect(node.path);
  };

  const handleDragEnter = (e) => {
    if (!isDir) return;
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  };
  const handleDragOver = (e) => {
    if (!isDir) return;
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  };
  const handleDragLeave = (e) => {
    if (!isDir) return;
    e.stopPropagation();
    setDragOver(false);
  };
  const handleDrop = (e) => {
    if (!isDir) return;
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      onUpload?.(node.path, files);
      if (!expanded) setExpanded(true);
    }
  };

  const openMenu = (e) => {
    e.stopPropagation();
    setMenuRect(e.currentTarget.getBoundingClientRect());
  };

  const menuItems = isDir
    ? [{ label: 'New file…', onClick: () => onCreateFile?.(node.path) }]
    : [
        { label: 'Rename…', onClick: () => onRenameFile?.(node.path, node.name) },
        { label: 'Delete', danger: true, onClick: () => onDeleteFile?.(node.path, node.name) },
      ];

  return (
    <div className="tree-node">
      <div
        className={`tree-row${isSelected ? ' selected' : ''}${isDir ? ' dir' : ' file'}${dragOver ? ' drag-over' : ''}`}
        style={{ paddingLeft: `${8 + indent}px` }}
        onClick={handleClick}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        title={node.path}
      >
        {isDir && (
          <span className={`chevron${expanded ? ' open' : ''}`}>
            <ChevronRight />
          </span>
        )}
        <span className="tree-icon">
          {isDir ? <FolderIcon open={expanded} /> : <FileIcon />}
        </span>
        <span className="tree-name">{node.name}</span>
        <button
          className="tree-menu-btn"
          onClick={openMenu}
          title="More actions"
          aria-label="More actions"
        >
          <DotsIcon />
        </button>
      </div>

      {menuRect && (
        <NodeMenu
          items={menuItems}
          onClose={() => setMenuRect(null)}
          anchorRect={menuRect}
        />
      )}

      {isDir && expanded && node.children && (
        <div className="tree-children">
          {node.children.map((child) => (
            <FileTree
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedFile={selectedFile}
              onSelect={onSelect}
              onUpload={onUpload}
              onCreateFile={onCreateFile}
              onRenameFile={onRenameFile}
              onDeleteFile={onDeleteFile}
            />
          ))}
        </div>
      )}
    </div>
  );
}
