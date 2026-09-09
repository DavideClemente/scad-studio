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
  loadEditorDirty,
  loadOpenDesign,
  saveAutosave,
  saveEditorDirty,
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
  const [rememberedDirty] = useState(loadEditorDirty);
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

  // Kept in step by applySource below rather than at render time, so that code
  // deciding which side moved always reads what the editor holds now, not what it
  // held at the last paint.
  const sourceRef = useRef(source);

  // What the followed file said last time we read it, and whether the editor has
  // gone past it. Both live only for this page — the flag is persisted, the text
  // is not, and neither is ever compared against something written at a different
  // moment.
  const diskRef = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  const setDirty = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty;
    saveEditorDirty(dirty);
  }, []);

  // The one place the editor's contents change. `fromDisk` says which side moved:
  // a change read from the file leaves the two in step, a change typed here does
  // not — unless it happens to type the file's text back, which is worth noticing
  // because it means there is nothing to disagree about any more.
  const applySource = useCallback(
    (text: string, fromDisk: boolean) => {
      sourceRef.current = text;
      setSource(text);
      if (fromDisk) diskRef.current = text;
      setDirty(fromDisk ? false : text !== diskRef.current);
    },
    [setDirty],
  );

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
    setStl(null);
    setStatus('idle');
    setOpenDesign(null);
    setConflict(null);
    diskRef.current = null;
    applySource('', true);
  }, [source, applySource]);

  // A file picked through the file input is a detached copy — the browser gives
  // no way back to it — so opening one drops any link the editor had rather than
  // leaving a stale name in the toolbar.
  const handleOpenSource = useCallback(
    (text: string, _name: string) => {
      setOpenDesign(null);
      setConflict(null);
      diskRef.current = null;
      applySource(text, true);
    },
    [applySource],
  );

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
        diskRef.current = text;
        // The editor was in step with the file when the page was last closed, so
        // whatever the file says now is simply the newer version of it.
        if (text === sourceRef.current) setDirty(false);
        else if (rememberedDirty) setConflict(text);
        else applySource(text, true);
      } finally {
        restoredRef.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rememberedDesign, rememberedDirty, applySource, setDirty]);

  // Only once the restore above has had its turn: until then openDesign is null
  // because nothing has been opened yet, not because nothing should be.
  useEffect(() => {
    if (restoredRef.current) saveOpenDesign(openDesign);
  }, [openDesign]);

  const handleOpenDesign = useCallback(async (designPath: string) => {
    const text = await loadDesign(designPath);
    applySource(text, true);
    setConflict(null);
    setOpenDesign(designPath);
    setLinkNote(null);
  }, [applySource]);

  // Follow the open design for as long as one is open. A change lands in the
  // editor on its own — but it does not render: which source gets built is the
  // user's call, and rendering a file caught half-written is worse than not
  // rendering at all.
  useEffect(() => {
    return onDesignChanged(({ path, text }) => {
      if (path !== openDesignRef.current) return;
      if (text === sourceRef.current) {
        diskRef.current = text;
        setDirty(false);
        setConflict(null);
        return;
      }
      // Untouched here since the last read, so the file wins outright.
      if (!dirtyRef.current) {
        applySource(text, true);
        setLinkNote(`Updated from ${path}`);
        return;
      }
      setConflict(text);
    });
  }, [applySource, setDirty]);

  // The note reports something that already happened; it should not sit there
  // claiming it forever.
  useEffect(() => {
    if (!linkNote) return;
    const timeout = setTimeout(() => setLinkNote(null), 4000);
    return () => clearTimeout(timeout);
  }, [linkNote]);

  const handleTakeDisk = useCallback(() => {
    if (conflict === null) return;
    applySource(conflict, true);
    setConflict(null);
  }, [conflict, applySource]);

  // Keeping the editor's version records what the file says all the same: the
  // editor is now knowingly ahead of it, so the *next* write to the file is a
  // fresh disagreement and has to be offered again rather than applied silently.
  const handleKeepMine = useCallback(() => {
    if (conflict === null) return;
    diskRef.current = conflict;
    setDirty(true);
    setConflict(null);
  }, [conflict, setDirty]);

  const handleSaveScad = useCallback(() => {
    download(new Blob([source], { type: 'text/plain' }), 'design.scad');
  }, [source]);

  const handleDownloadStl = useCallback(() => {
    if (!stl) return;
    download(new Blob([stl], { type: 'model/stl' }), 'model.stl');
  }, [stl]);

  // An example is a detached copy, like a file opened from disk: it drops any
  // link the editor had rather than leaving a stale name in the toolbar.
  const handleSelectExample = useCallback(
    (exampleSource: string) => {
      setOpenDesign(null);
      setConflict(null);
      diskRef.current = null;
      applySource(exampleSource, true);
    },
    [applySource],
  );

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
          <CodeEditor value={source} onChange={(next) => applySource(next, false)} />
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
