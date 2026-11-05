// CodeMirror, loaded on demand (see CodeField in fields.tsx).
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { EditorView } from '@codemirror/view';
import CodeMirror from '@uiw/react-codemirror';
import { useMemo } from 'react';

export type CodeLanguage = 'html' | 'css' | 'javascript';

export interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language: CodeLanguage;
  label: string;
  minHeight?: string;
}

const LANGUAGES = { html: () => html({ autoCloseTags: false }), css: () => css(), javascript: () => javascript() };

export default function CodeEditor({ value, onChange, language, label, minHeight = '4.5rem' }: CodeEditorProps) {
  const extensions = useMemo(
    () => [LANGUAGES[language](), EditorView.lineWrapping, EditorView.contentAttributes.of({ 'aria-label': label })],
    [language, label],
  );
  return (
    <CodeMirror
      className="code-editor"
      value={value}
      onChange={onChange}
      extensions={extensions}
      minHeight={minHeight}
      maxHeight="18rem"
      basicSetup={{ foldGutter: false, highlightActiveLine: false, highlightActiveLineGutter: false, autocompletion: false, closeBrackets: false }}
    />
  );
}
