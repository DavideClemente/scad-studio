/**
 * The shape of saved work, and the one interface everything that saves it has to
 * satisfy.
 *
 * Deliberately small: five operations over plain text. Anything a particular
 * backend needs on top of this — signing in, sharing, quotas — belongs behind a
 * separate optional interface, so the browser-only adapter never has to stub out
 * methods that mean nothing to it.
 */

export type ScadProject = {
  id: string;
  name: string;
  source: string;
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601. */
  updatedAt: string;
  shareToken?: string | null;
};

/** What a project list needs; deliberately not the source, which can be large. */
export type ProjectSummary = {
  id: string;
  name: string;
  updatedAt: string;
};

export type StorageAdapter = {
  readonly kind: 'local' | 'cloud';
  /**
   * Whether writes are permitted right now — storage reachable, signed in, under
   * quota. The adapter owns this decision so the UI can ask one question instead
   * of knowing which backend it is talking to and what could be wrong with it.
   */
  canWrite(): Promise<boolean>;
  list(): Promise<ProjectSummary[]>;
  get(id: string): Promise<ScadProject>;
  create(name: string, source: string): Promise<ScadProject>;
  update(id: string, patch: Partial<Pick<ScadProject, 'name' | 'source'>>): Promise<ScadProject>;
  remove(id: string): Promise<void>;
};
