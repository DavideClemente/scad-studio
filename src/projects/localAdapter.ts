import { isNameTaken } from './names';
import type { ProjectSummary, ScadProject, StorageAdapter } from './types';

/**
 * Projects kept in the browser, on this machine, in this browser profile.
 *
 * This is the whole of storage in a self-hosted build, and the fallback in every
 * build that has no backend configured. Nothing here touches the network.
 *
 * The store is one JSON blob under one key rather than a key per project with an
 * index alongside. Sources are text measured in kilobytes, so rewriting the lot
 * on every save costs nothing worth counting, and it removes the failure the
 * split version invites: an index that survives a write the projects did not.
 */

const STORAGE_KEY = 'scad-studio:projects';

type Stored = Record<string, ScadProject>;

/**
 * localStorage is not always there to be had: a sandboxed frame or a browser told
 * to refuse site data throws on the *property access* itself, before anything has
 * been read. So it is reached for in here, once, rather than in a default
 * argument where the throw would escape.
 */
function defaultStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function newId(): string {
  // Available in every browser that can run the rest of this app, but not in
  // every context (crypto.randomUUID wants a secure origin), so it is asked for
  // rather than assumed.
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ?? `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isProject(value: unknown): value is ScadProject {
  if (typeof value !== 'object' || value === null) return false;
  const project = value as Partial<ScadProject>;
  return (
    typeof project.id === 'string' &&
    typeof project.name === 'string' &&
    typeof project.source === 'string' &&
    typeof project.createdAt === 'string' &&
    typeof project.updatedAt === 'string'
  );
}

/**
 * Anything unreadable is treated as an empty store rather than an error: a
 * half-written or hand-edited key should cost the user their saved projects at
 * worst, not the ability to open the app.
 */
function read(storage: Storage): Stored {
  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return {};
  }
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const projects: Stored = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (isProject(value)) projects[id] = value;
    }
    return projects;
  } catch {
    return {};
  }
}

function write(storage: Storage, projects: Stored) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(projects));
  } catch {
    // Unlike the autosave, a save the user asked for cannot fail quietly.
    throw new Error('Could not save: this browser is out of space for stored projects.');
  }
}

/**
 * Names are what the user picks a project by, so two projects may not share one.
 * The comparison itself lives in names.ts, because the dialog that asks for a
 * name has to refuse exactly what this refuses.
 */
function nameClash(name: string): never {
  throw new Error(`A project called “${name}” already exists.`);
}

function summarise(project: ScadProject): ProjectSummary {
  return { id: project.id, name: project.name, updatedAt: project.updatedAt };
}

function unavailable(): never {
  throw new Error('This browser is not allowing pages to store data, so projects cannot be saved here.');
}

export function createLocalAdapter(storage?: Storage): StorageAdapter {
  const store = storage ?? defaultStorage();

  const load = (): [Storage, Stored] => {
    if (!store) unavailable();
    return [store, read(store)];
  };

  return {
    kind: 'local',

    // A store that reads is not necessarily a store that writes: quota is only
    // discovered by trying, so this asks the question the same way a save does.
    async canWrite() {
      if (!store) return false;
      const probe = `${STORAGE_KEY}:probe`;
      try {
        store.setItem(probe, '1');
        store.removeItem(probe);
        return true;
      } catch {
        return false;
      }
    },

    async list() {
      if (!store) return [];
      return Object.values(read(store))
        .map(summarise)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },

    async get(id) {
      const [, projects] = load();
      const project = projects[id];
      if (!project) throw new Error('That project is no longer saved in this browser.');
      return project;
    },

    async create(name, source) {
      const [target, projects] = load();
      const trimmed = name.trim();
      if (isNameTaken(Object.values(projects), trimmed)) nameClash(trimmed);
      const now = new Date().toISOString();
      const project: ScadProject = { id: newId(), name: trimmed, source, createdAt: now, updatedAt: now };
      write(target, { ...projects, [project.id]: project });
      return project;
    },

    async update(id, patch) {
      const [target, projects] = load();
      const existing = projects[id];
      if (!existing) throw new Error('That project is no longer saved in this browser.');
      const renamed = patch.name === undefined ? undefined : patch.name.trim();
      if (renamed !== undefined && isNameTaken(Object.values(projects), renamed, id)) nameClash(renamed);
      const project: ScadProject = {
        ...existing,
        ...patch,
        ...(renamed === undefined ? {} : { name: renamed }),
        updatedAt: new Date().toISOString(),
      };
      write(target, { ...projects, [id]: project });
      return project;
    },

    async remove(id) {
      const [target, projects] = load();
      if (!(id in projects)) return;
      const { [id]: _removed, ...rest } = projects;
      write(target, rest);
    },
  };
}
