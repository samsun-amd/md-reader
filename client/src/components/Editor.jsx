import { useMemo, useCallback } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView } from '@codemirror/view';
import { undo, redo, undoDepth, redoDepth } from '@codemirror/commands';

// Lazy-loaded so Read-only users never download the CodeMirror bundle.
// onReady hands the parent a small API (view + bound undo/redo) so the
// toolbar can drive history without importing CodeMirror itself, keeping
// those modules in this lazy chunk.
export default function Editor({ value, onChange, onReady, onHistoryChange }) {
  const extensions = useMemo(() => [markdown(), EditorView.lineWrapping], []);

  const reportHistory = useCallback((view) => {
    onHistoryChange?.({
      canUndo: undoDepth(view.state) > 0,
      canRedo: redoDepth(view.state) > 0,
    });
  }, [onHistoryChange]);

  const handleCreate = useCallback((view) => {
    onReady?.({
      view,
      undo: () => { undo(view); view.focus(); },
      redo: () => { redo(view); view.focus(); },
      // Fractional source line at a given scroller offset (document-top
      // coordinates, i.e. the value of cm-scroller.scrollTop).
      offsetToLine: (y) => {
        const block = view.lineBlockAtHeight(y);
        const startLine = view.state.doc.lineAt(block.from).number;
        const frac = block.height > 0 ? (y - block.top) / block.height : 0;
        return startLine + Math.min(1, Math.max(0, frac));
      },
      // Inverse: scroller offset for a (possibly fractional) source line.
      lineToOffset: (line) => {
        const doc = view.state.doc;
        const n = Math.min(doc.lines, Math.max(1, Math.floor(line)));
        const frac = line - Math.floor(line);
        const block = view.lineBlockAt(doc.line(n).from);
        return block.top + frac * block.height;
      },
    });
    reportHistory(view);
  }, [onReady, reportHistory]);

  const handleUpdate = useCallback((vu) => {
    if (vu.docChanged) reportHistory(vu.view);
  }, [reportHistory]);

  return (
    <CodeMirror
      value={value}
      theme={oneDark}
      extensions={extensions}
      onChange={onChange}
      onCreateEditor={handleCreate}
      onUpdate={handleUpdate}
      basicSetup={{
        lineNumbers: true,
        highlightActiveLine: true,
        foldGutter: true,
        history: true,
      }}
      height="100%"
    />
  );
}
