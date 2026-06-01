import { useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView } from '@codemirror/view';

// Lazy-loaded so Read-only users never download the CodeMirror bundle.
export default function Editor({ value, onChange }) {
  const extensions = useMemo(() => [markdown(), EditorView.lineWrapping], []);
  return (
    <CodeMirror
      value={value}
      theme={oneDark}
      extensions={extensions}
      onChange={onChange}
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
