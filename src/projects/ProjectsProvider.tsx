import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { loadOpenProject, saveOpenProject } from '../storage';
import { createAdapter } from './adapter';
import { ProjectsContext } from './context';
import type { OpenProject, ProjectsApi } from './context';
import type { ScadProject, StorageAdapter } from './types';

/**
 * Holds the storage adapter and everything the editor needs to know about saved
 * work. The point of the seam is that the components above it never learn which
 * adapter they got: the same menu items, the same list, the same errors, whether
 * projects live in this browser or on a server.
 *
 * It does not hold the editor's text. The editor owns that, and hands it over to
 * be saved — otherwise there would be two copies of the source in play and a
 * question about which one is current.
 */
export function ProjectsProvider({ children, adapter }: { children: ReactNode; adapter?: StorageAdapter }) {
  // One adapter for the life of the page, built on the first render and never
  // rebuilt. `adapter` is for tests and for a host that wants to supply its own;
  // the app passes nothing and gets whatever the configuration selects.
  const [store] = useState<StorageAdapter>(() => adapter ?? createAdapter());

  const [projects, setProjects] = useState<ProjectsApi['projects']>([]);
  const [open, setOpen] = useState<OpenProject | null>(null);
  const [canWrite, setCanWrite] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The restore below runs after the first paint, so until it has had its turn a
  // null `open` means "not looked yet", not "nothing was open".
  const restoredRef = useRef(false);

  const fail = useCallback((err: unknown) => {
    setError(err instanceof Error ? err.message : String(err));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [found, writable] = await Promise.all([store.list(), store.canWrite()]);
      setProjects(found);
      setCanWrite(writable);
    } catch (err) {
      fail(err);
    }
  }, [store, fail]);

  const remember = useCallback((project: ScadProject) => {
    setOpen({ id: project.id, name: project.name, savedSource: project.source });
  }, []);

  // On load: the list, and the project that was open last time. Its stored text
  // is not put into the editor — the autosave has already restored what the user
  // was looking at, which may have moved on from what was saved, and taking the
  // saved copy instead would throw that away.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await refresh();
        const rememberedId = loadOpenProject();
        if (cancelled || !rememberedId) return;
        const project = await store.get(rememberedId).catch(() => null);
        if (cancelled || !project) return;
        remember(project);
      } finally {
        restoredRef.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [store, refresh, remember]);

  useEffect(() => {
    if (restoredRef.current) saveOpenProject(open?.id ?? null);
  }, [open]);

  const api = useMemo<ProjectsApi>(() => {
    return {
      kind: store.kind,
      canWrite,
      projects,
      open,
      error,
      dismissError: () => setError(null),
      refresh,

      async load(id) {
        setError(null);
        try {
          const project = await store.get(id);
          remember(project);
          return project;
        } catch (err) {
          fail(err);
          // A project that cannot be read should not stay listed as the open one.
          setOpen((current) => (current?.id === id ? null : current));
          await refresh();
          return null;
        }
      },

      async save(source) {
        if (!open) return false;
        setError(null);
        try {
          remember(await store.update(open.id, { source }));
          await refresh();
          return true;
        } catch (err) {
          fail(err);
          return false;
        }
      },

      async saveAs(name, source) {
        setError(null);
        try {
          remember(await store.create(name, source));
          await refresh();
          return true;
        } catch (err) {
          fail(err);
          return false;
        }
      },

      async rename(id, name) {
        setError(null);
        try {
          const project = await store.update(id, { name });
          setOpen((current) => (current?.id === id ? { ...current, name: project.name } : current));
          await refresh();
          return true;
        } catch (err) {
          fail(err);
          return false;
        }
      },

      async remove(id) {
        setError(null);
        try {
          await store.remove(id);
          setOpen((current) => (current?.id === id ? null : current));
          await refresh();
          return true;
        } catch (err) {
          fail(err);
          return false;
        }
      },

      detach: () => setOpen(null),
    };
  }, [store, canWrite, projects, open, error, refresh, remember, fail]);

  return <ProjectsContext.Provider value={api}>{children}</ProjectsContext.Provider>;
}
