import { createContext, useContext } from 'react';
import type { ProjectSummary, ScadProject } from './types';

/** The saved project the editor is working on, and the text it held when saved. */
export type OpenProject = {
  id: string;
  name: string;
  /**
   * What was written the last time this project was saved or opened. The editor
   * compares its own text against this to know whether there is anything to save.
   */
  savedSource: string;
};

/**
 * What the editor is allowed to know about storage. Which backend is behind this
 * is `kind` and nothing more — no component asks whether it is talking to a
 * browser or a server, and none of them handles a failure: an operation that goes
 * wrong reports false or null and leaves the reason in `error`.
 */
export type ProjectsApi = {
  kind: 'local' | 'cloud';
  /** False when storage is unreachable or writing is not permitted right now. */
  canWrite: boolean;
  projects: ProjectSummary[];
  open: OpenProject | null;
  error: string | null;
  dismissError: () => void;
  refresh: () => Promise<void>;
  /** Reads a project and makes it the open one. Null if it could not be read. */
  load: (id: string) => Promise<ScadProject | null>;
  /** Overwrites the open project. False if there was none, or it failed. */
  save: (source: string) => Promise<boolean>;
  /** Saves a copy under a new name and makes that the open one. */
  saveAs: (name: string, source: string) => Promise<boolean>;
  rename: (id: string, name: string) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
  /** Forgets which project is open, without touching what is stored. */
  detach: () => void;
};

export const ProjectsContext = createContext<ProjectsApi | null>(null);

export function useProjects(): ProjectsApi {
  const api = useContext(ProjectsContext);
  if (!api) throw new Error('useProjects must be used inside a ProjectsProvider.');
  return api;
}
