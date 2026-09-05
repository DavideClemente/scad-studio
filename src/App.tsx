import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { CodeEditor } from './editor/CodeEditor';
import { ModelViewer } from './viewer/ModelViewer';
import { Toolbar } from './components/Toolbar';
import { ConsolePanel } from './components/ConsolePanel';
import { OpenScadClient, RenderError } from './openscad/client';
import { DEFAULT_SOURCE } from './examples';
import { loadAutosave, saveAutosave } from './storage';
import './App.css';

type Status = 'idle' | 'rendering' | 'success' | 'error';

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function App() {
  const [source, setSource] = useState(() => loadAutosave() ?? DEFAULT_SOURCE);
  const [status, setStatus] = useState<Status>('idle');
  const [stl, setStl] = useState<ArrayBuffer | null>(null);
  const [stdout, setStdout] = useState('');
  const [stderr, setStderr] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastRenderMs, setLastRenderMs] = useState<number | null>(null);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [editorWidthPct, setEditorWidthPct] = useState(55);
  const [isResizing, setIsResizing] = useState(false);
  const workspaceRef = useRef<HTMLDivElement>(null);

  // Created once for the lifetime of the page (not disposed on unmount): App
  // never unmounts in practice, and disposing from a useEffect cleanup would
  // kill the worker during React StrictMode's dev-only mount->cleanup->mount
  // cycle, since it's never recreated afterwards.
  const clientRef = useRef<OpenScadClient | null>(null);
  if (!clientRef.current) {
    clientRef.current = new OpenScadClient();
  }

  const sourceRef = useRef(source);
  sourceRef.current = source;

  useEffect(() => {
    const timeout = setTimeout(() => saveAutosave(source), 400);
    return () => clearTimeout(timeout);
  }, [source]);

  const handleRender = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    setStatus('rendering');
    setErrorMessage(null);

    try {
      const result = await client.render(sourceRef.current);
      setStl(result.stl);
      setStdout(result.stdout);
      setStderr(result.stderr);
      setLastRenderMs(result.durationMs);
      setStatus('success');
    } catch (err) {
      const renderError = err instanceof RenderError ? err : null;
      setStdout(renderError?.stdout ?? '');
      setStderr(renderError?.stderr ?? '');
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setStatus('error');
      setConsoleOpen(true);
    }
  }, []);

  useEffect(() => {
    handleRender();
    // Render once on load; subsequent renders are user-triggered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleNew = useCallback(() => {
    if (source.trim() && !confirm('Discard the current design and start a blank one?')) return;
    setSource('');
    setStl(null);
    setStatus('idle');
  }, [source]);

  const handleOpenSource = useCallback((text: string, _name: string) => {
    setSource(text);
  }, []);

  const handleSaveScad = useCallback(() => {
    download(new Blob([source], { type: 'text/plain' }), 'design.scad');
  }, [source]);

  const handleDownloadStl = useCallback(() => {
    if (!stl) return;
    download(new Blob([stl], { type: 'model/stl' }), 'model.stl');
  }, [stl]);

  const handleSelectExample = useCallback((exampleSource: string) => {
    setSource(exampleSource);
  }, []);

  const stlAvailable = useMemo(() => stl != null, [stl]);

  const handleDividerMouseDown = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    event.preventDefault();
    setIsResizing(true);

    const rect = workspace.getBoundingClientRect();

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const pct = ((moveEvent.clientX - rect.left) / rect.width) * 100;
      setEditorWidthPct(Math.min(80, Math.max(20, pct)));
    };
    const handleMouseUp = () => {
      setIsResizing(false);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, []);

  return (
    <div className="app">
      <Toolbar
        status={status}
        lastRenderMs={lastRenderMs}
        stlAvailable={stlAvailable}
        onRender={handleRender}
        onNew={handleNew}
        onOpenSource={handleOpenSource}
        onSaveScad={handleSaveScad}
        onDownloadStl={handleDownloadStl}
        onSelectExample={handleSelectExample}
      />
      <main className={`workspace ${isResizing ? 'is-resizing' : ''}`} ref={workspaceRef}>
        <div className="pane pane-editor" style={{ width: `${editorWidthPct}%` }}>
          <CodeEditor value={source} onChange={setSource} onRenderShortcut={handleRender} />
        </div>
        <div className="divider" onMouseDown={handleDividerMouseDown} />
        <div className="pane pane-viewer">
          <ModelViewer stl={stl} />
        </div>
      </main>
      <ConsolePanel
        open={consoleOpen}
        onToggle={() => setConsoleOpen((open) => !open)}
        stdout={stdout}
        stderr={stderr}
        errorMessage={errorMessage}
      />
    </div>
  );
}
