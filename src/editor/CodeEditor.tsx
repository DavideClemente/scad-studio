import Editor from '@monaco-editor/react';
import type { BeforeMount } from '@monaco-editor/react';
import type { languages } from 'monaco-editor';
import { OPENSCAD_LANGUAGE_ID, openscadLanguageConfiguration, openscadMonarchLanguage } from './scadLanguage';

type Props = {
  value: string;
  onChange: (value: string) => void;
};

export function CodeEditor({ value, onChange }: Props) {
  const handleBeforeMount: BeforeMount = (monaco) => {
    if (monaco.languages.getLanguages().some((lang: languages.ILanguageExtensionPoint) => lang.id === OPENSCAD_LANGUAGE_ID)) return;
    monaco.languages.register({ id: OPENSCAD_LANGUAGE_ID, extensions: ['.scad'] });
    monaco.languages.setLanguageConfiguration(OPENSCAD_LANGUAGE_ID, openscadLanguageConfiguration);
    monaco.languages.setMonarchTokensProvider(OPENSCAD_LANGUAGE_ID, openscadMonarchLanguage);
  };

  return (
    <Editor
      height="100%"
      defaultLanguage={OPENSCAD_LANGUAGE_ID}
      theme="vs-dark"
      value={value}
      beforeMount={handleBeforeMount}
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
