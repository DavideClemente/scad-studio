import Editor from '@monaco-editor/react';
import type { BeforeMount, OnMount } from '@monaco-editor/react';
import type { languages } from 'monaco-editor';
import { useEffect, useRef } from 'react';
import { OPENSCAD_LANGUAGE_ID, openscadLanguageConfiguration, openscadMonarchLanguage } from './scadLanguage';

type Props = {
  value: string;
  onChange: (value: string) => void;
  onRenderShortcut: () => void;
};

export function CodeEditor({ value, onChange, onRenderShortcut }: Props) {
  const onRenderShortcutRef = useRef(onRenderShortcut);
  useEffect(() => {
    onRenderShortcutRef.current = onRenderShortcut;
  }, [onRenderShortcut]);

  const handleBeforeMount: BeforeMount = (monaco) => {
    if (monaco.languages.getLanguages().some((lang: languages.ILanguageExtensionPoint) => lang.id === OPENSCAD_LANGUAGE_ID)) return;
    monaco.languages.register({ id: OPENSCAD_LANGUAGE_ID, extensions: ['.scad'] });
    monaco.languages.setLanguageConfiguration(OPENSCAD_LANGUAGE_ID, openscadLanguageConfiguration);
    monaco.languages.setMonarchTokensProvider(OPENSCAD_LANGUAGE_ID, openscadMonarchLanguage);
  };

  const handleMount: OnMount = (editor, monaco) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => onRenderShortcutRef.current());
  };

  return (
    <Editor
      height="100%"
      defaultLanguage={OPENSCAD_LANGUAGE_ID}
      theme="vs-dark"
      value={value}
      beforeMount={handleBeforeMount}
      onMount={handleMount}
      onChange={(next) => onChange(next ?? '')}
      options={{
        minimap: { enabled: false },
        fontSize: 13,
        automaticLayout: true,
        tabSize: 2,
        wordWrap: 'on',
        scrollBeyondLastLine: false,
      }}
    />
  );
}
