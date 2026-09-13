import { beforeEach, describe, expect, it } from 'vitest';
import { createLocalAdapter } from './localAdapter';

/** Enough of the Storage interface for the adapter, with a switch for a full disk. */
class FakeStorage implements Storage {
  private items = new Map<string, string>();
  full = false;

  get length() {
    return this.items.size;
  }
  key(index: number) {
    return [...this.items.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.full) throw new DOMException('quota', 'QuotaExceededError');
    this.items.set(key, value);
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
  clear() {
    this.items.clear();
  }
  [name: string]: unknown;
}

describe('local project adapter', () => {
  let storage: FakeStorage;

  beforeEach(() => {
    storage = new FakeStorage();
  });

  const adapter = () => createLocalAdapter(storage);

  it('round-trips a project', async () => {
    const store = adapter();
    const created = await store.create('Bracket', 'cube(10);');
    const read = await store.get(created.id);
    expect(read).toEqual(created);
    expect(await store.list()).toEqual([
      { id: created.id, name: 'Bracket', updatedAt: created.updatedAt },
    ]);
  });

  it('keeps projects across adapter instances, since the store is the browser', async () => {
    const created = await adapter().create('Bracket', 'cube(10);');
    expect((await adapter().get(created.id)).source).toBe('cube(10);');
  });

  it('patches only what it is given, and moves updatedAt', async () => {
    const store = adapter();
    const created = await store.create('Bracket', 'cube(10);');
    const updated = await store.update(created.id, { source: 'sphere(5);' });
    expect(updated.name).toBe('Bracket');
    expect(updated.source).toBe('sphere(5);');
    expect(updated.createdAt).toBe(created.createdAt);
    expect(Date.parse(updated.updatedAt)).toBeGreaterThanOrEqual(Date.parse(created.createdAt));
  });

  it('lists the most recently changed first', async () => {
    const store = adapter();
    const first = await store.create('First', 'a');
    await store.create('Second', 'b');
    // Written in the same millisecond in a fast test, so the order is only
    // meaningful once one of them has actually moved on.
    await store.update(first.id, { source: 'a2' });
    expect((await store.list()).map((project) => project.name)).toEqual(['First', 'Second']);
  });

  it('removes a project, and treats removing a missing one as done', async () => {
    const store = adapter();
    const created = await store.create('Bracket', 'cube(10);');
    await store.remove(created.id);
    await store.remove(created.id);
    expect(await store.list()).toEqual([]);
    await expect(store.get(created.id)).rejects.toThrow();
  });

  it('refuses a name another project already has', async () => {
    const store = adapter();
    await store.create('Bracket', 'cube(10);');
    await expect(store.create('bracket', 'sphere(5);')).rejects.toThrow(/already exists/);
    await expect(store.create('  Bracket  ', 'sphere(5);')).rejects.toThrow(/already exists/);
    expect(await store.list()).toHaveLength(1);
  });

  it('refuses a rename onto another project, but lets one keep its own name', async () => {
    const store = adapter();
    const first = await store.create('Bracket', 'a');
    await store.create('Hook', 'b');
    await expect(store.update(first.id, { name: 'Hook' })).rejects.toThrow(/already exists/);
    // Saving a project without touching its name must not trip over itself.
    await expect(store.update(first.id, { name: 'Bracket' })).resolves.toBeTruthy();
    await expect(store.update(first.id, { source: 'c' })).resolves.toBeTruthy();
  });

  it('stores names trimmed, since that is what it compares', async () => {
    const store = adapter();
    const created = await store.create('  Bracket  ', 'a');
    expect(created.name).toBe('Bracket');
  });

  it('reports a full store rather than losing the save quietly', async () => {
    const store = adapter();
    storage.full = true;
    expect(await store.canWrite()).toBe(false);
    await expect(store.create('Bracket', 'cube(10);')).rejects.toThrow(/out of space/);
  });

  it('treats an unreadable store as empty rather than failing to start', async () => {
    storage.setItem('scad-studio:projects', '{ not json');
    expect(await adapter().list()).toEqual([]);
  });

  it('drops entries that are not projects', async () => {
    storage.setItem('scad-studio:projects', JSON.stringify({ a: { id: 'a' }, b: null }));
    expect(await adapter().list()).toEqual([]);
  });

  it('stays usable when reaching for localStorage itself throws', async () => {
    // A sandboxed frame or a browser told to refuse site data throws on the
    // property access, before anything has been read. The app still has to start.
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('denied', 'SecurityError');
      },
    });
    try {
      const store = createLocalAdapter();
      expect(await store.canWrite()).toBe(false);
      expect(await store.list()).toEqual([]);
      await expect(store.create('Bracket', 'cube(10);')).rejects.toThrow(/not allowing/);
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});
