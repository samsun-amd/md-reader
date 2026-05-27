import { useState } from 'react';
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

export default function FileTree({ node, depth, selectedFile, onSelect }) {
  const [expanded, setExpanded] = useState(depth === 0);
  const isDir = node.type === 'dir' || node.type === 'root';
  const isSelected = node.path === selectedFile;

  const indent = depth * 12;

  const handleClick = () => {
    if (isDir) {
      setExpanded((v) => !v);
    } else {
      onSelect(node.path);
    }
  };

  return (
    <div className="tree-node">
      <div
        className={`tree-row${isSelected ? ' selected' : ''}${isDir ? ' dir' : ' file'}`}
        style={{ paddingLeft: `${8 + indent}px` }}
        onClick={handleClick}
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
      </div>

      {isDir && expanded && node.children && (
        <div className="tree-children">
          {node.children.map((child) => (
            <FileTree
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedFile={selectedFile}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}
