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
