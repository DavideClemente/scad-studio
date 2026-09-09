import { useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
import type { BeforeMount, OnMount } from '@monaco-editor/react';
import type { languages } from 'monaco-editor';
import { OPENSCAD_LANGUAGE_ID, openscadLanguageConfiguration, openscadMonarchLanguage } from './scadLanguage';
import { getDiagnosticMarkers, registerScadProviders } from './scadProviders';

const DIAGNOSTICS_DEBOUNCE_MS = 300;
const MARKER_OWNER = 'openscad';

type Props = {
  value: string;
  onChange: (value: string) => void;
};

export function CodeEditor({ value, onChange }: Props) {
  const changeListenerRef = useRef<{ dispose: () => void } | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleBeforeMount: BeforeMount = (monaco) => {
    if (!monaco.languages.getLanguages().some((lang: languages.ILanguageExtensionPoint) => lang.id === OPENSCAD_LANGUAGE_ID)) {
      monaco.languages.register({ id: OPENSCAD_LANGUAGE_ID, extensions: ['.scad'] });
      monaco.languages.setLanguageConfiguration(OPENSCAD_LANGUAGE_ID, openscadLanguageConfiguration);
      monaco.languages.setMonarchTokensProvider(OPENSCAD_LANGUAGE_ID, openscadMonarchLanguage);
    }
    registerScadProviders(monaco);
  };

  const handleMount: OnMount = (editorInstance, monaco) => {
    const model = editorInstance.getModel();
    if (!model) return;

    const runDiagnostics = () => {
      monaco.editor.setModelMarkers(model, MARKER_OWNER, getDiagnosticMarkers(monaco, model.getValue()));
    };
    runDiagnostics();

    changeListenerRef.current = model.onDidChangeContent(() => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(runDiagnostics, DIAGNOSTICS_DEBOUNCE_MS);
    });
  };

  useEffect(
    () => () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      changeListenerRef.current?.dispose();
    },
    [],
  );

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
