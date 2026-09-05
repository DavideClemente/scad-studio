import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { CodeEditor } from './editor/CodeEditor';
import { ModelViewer } from './viewer/ModelViewer';
import { Toolbar } from './components/Toolbar';
import { ConsolePanel } from './components/ConsolePanel';
import { OpenScadClient, RenderError } from './openscad/client';
import { DEFAULT_SOURCE } from './examples';
import {
  loadAutosave,
  loadDiskText,
  loadOpenDesign,
  saveAutosave,
  saveDiskText,
  saveOpenDesign,
} from './storage';
import { listDesigns, loadDesign, onDesignChanged } from './designs';
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
  const [shells, setShells] = useState<number | null>(null);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [editorWidthPct, setEditorWidthPct] = useState(55);
  const [designs, setDesigns] = useState<string[]>([]);
  // The design in designs/ this editor is showing, if any. Changes to that file
  // land in the editor; every other file in the folder is ignored.
  const [openDesign, setOpenDesign] = useState<string | null>(null);
  // Read once at the first render: the effect that persists openDesign runs on
  // mount too, and would clear this before the restore below could read it.
  const [rememberedDesign] = useState(loadOpenDesign);
  const [rememberedDisk] = useState(loadDiskText);
  const restoredRef = useRef(false);
  // A change on disk that would overwrite edits made here, held back until the
  // choice is made. Null whenever the editor and the file agree.
  const [conflict, setConflict] = useState<string | null>(null);
  const [linkNote, setLinkNote] = useState<string | null>(null);
  const openDesignRef = useRef<string | null>(null);
  openDesignRef.current = openDesign;
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

  // What the followed file said last time we read it. The editor is free to differ
  // from it — that is exactly the case a disk change must not silently discard.
  // Persisted as well as held, so a reload still knows which side moved.
  const diskRef = useRef<string | null>(null);
  const setDisk = useCallback((text: string | null) => {
    diskRef.current = text;
    saveDiskText(text);
  }, []);

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
      setShells(result.shells);
      setStatus('success');
    } catch (err) {
      const renderError = err instanceof RenderError ? err : null;
      setStdout(renderError?.stdout ?? '');
      setStderr(renderError?.stderr ?? '');
      setErrorMessage(err instanceof Error ? err.message : String(err));
      setShells(null);
      setStatus('error');
      setConsoleOpen(true);
    }
  }, []);

  useEffect(() => {
    handleRender();
    // Render once on load; subsequent renders are user-triggered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        handleRender();
      }
    };
    // Capture phase: must run before Monaco's own bubble-phase handler, or
    // it inserts a newline into the source before we can prevent it.
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [handleRender]);

  const handleNew = useCallback(() => {
    if (source.trim() && !confirm('Discard the current design and start a blank one?')) return;
    setSource('');
    setStl(null);
    setStatus('idle');
    setOpenDesign(null);
    setConflict(null);
    setDisk(null);
  }, [source, setDisk]);

  // A file picked through the file input is a detached copy — the browser gives
  // no way back to it — so opening one drops any link the editor had rather than
  // leaving a stale name in the toolbar.
  const handleOpenSource = useCallback((text: string, _name: string) => {
    setSource(text);
    setOpenDesign(null);
    setConflict(null);
    setDisk(null);
  }, [setDisk]);

  // On load, pick the folder back up and re-open whatever design was open last
  // time. The file on disk is the authority, but the editor may be holding an
  // autosaved copy that has moved on from it, so a difference is put to the user
  // rather than resolved here.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const found = await listDesigns();
        if (cancelled) return;
        setDesigns(found);

        if (!rememberedDesign || !found.includes(rememberedDesign)) return;
        const text = await loadDesign(rememberedDesign).catch(() => null);
        if (cancelled || text === null) return;

        setOpenDesign(rememberedDesign);
        // The editor was in step with the file when the page was last closed, so
        // whatever the file says now is simply the newer version of it.
        const editorWasClean = sourceRef.current === rememberedDisk;
        setDisk(text);
        if (text === sourceRef.current) return;
        if (editorWasClean) setSource(text);
        else setConflict(text);
      } finally {
        restoredRef.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rememberedDesign, rememberedDisk, setDisk]);

  // Only once the restore above has had its turn: until then openDesign is null
  // because nothing has been opened yet, not because nothing should be.
  useEffect(() => {
    if (restoredRef.current) saveOpenDesign(openDesign);
  }, [openDesign]);

  const handleOpenDesign = useCallback(async (designPath: string) => {
    const text = await loadDesign(designPath);
    setSource(text);
    setDisk(text);
    setConflict(null);
    setOpenDesign(designPath);
    setLinkNote(null);
  }, [setDisk]);

  // Follow the open design for as long as one is open. A change lands in the
  // editor on its own — but it does not render: which source gets built is the
  // user's call, and rendering a file caught half-written is worse than not
  // rendering at all.
  useEffect(() => {
    return onDesignChanged(({ path, text }) => {
      if (path !== openDesignRef.current) return;
      if (text === sourceRef.current) {
        setDisk(text);
        setConflict(null);
        return;
      }
      // Untouched here since the last read, so the file wins outright.
      if (diskRef.current === null || sourceRef.current === diskRef.current) {
        setDisk(text);
        setSource(text);
        setLinkNote(`Updated from ${path}`);
        return;
      }
      setConflict(text);
    });
  }, [setDisk]);

  // The note reports something that already happened; it should not sit there
  // claiming it forever.
  useEffect(() => {
    if (!linkNote) return;
    const timeout = setTimeout(() => setLinkNote(null), 4000);
    return () => clearTimeout(timeout);
  }, [linkNote]);

  const handleTakeDisk = useCallback(() => {
    if (conflict === null) return;
    setDisk(conflict);
    setSource(conflict);
    setConflict(null);
  }, [conflict, setDisk]);

  // Keeping the editor's version records what the file says all the same: the
  // editor is now knowingly ahead of it, so the *next* write to the file is a
  // fresh disagreement and has to be offered again rather than applied silently.
  const handleKeepMine = useCallback(() => {
    if (conflict === null) return;
    setDisk(conflict);
    setConflict(null);
  }, [conflict, setDisk]);

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
        shells={shells}
        designs={designs}
        onOpenDesign={handleOpenDesign}
        openDesign={openDesign}
        linkNote={linkNote}
        conflict={conflict !== null}
        onTakeDisk={handleTakeDisk}
        onKeepMine={handleKeepMine}
      />
      <main className={`workspace ${isResizing ? 'is-resizing' : ''}`} ref={workspaceRef}>
        <div className="pane pane-editor" style={{ width: `${editorWidthPct}%` }}>
          <CodeEditor value={source} onChange={setSource} />
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
