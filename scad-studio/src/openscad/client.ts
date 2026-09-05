export type RenderResult = {
  stl: ArrayBuffer;
  stdout: string;
  stderr: string;
  durationMs: number;
  /** Separate solids in the result; anything above 1 falls apart when printed. */
  shells: number;
};

export class RenderError extends Error {
  stdout: string;
  stderr: string;

  constructor(message: string, stdout: string, stderr: string) {
    super(message);
    this.name = 'RenderError';
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

type PendingEntry = {
  resolve: (result: RenderResult) => void;
  reject: (error: RenderError) => void;
};

type WorkerMessage =
  | {
      type: 'success';
      id: number;
      stl: ArrayBuffer;
      stdout: string;
      stderr: string;
      durationMs: number;
      shells: number;
    }
  | { type: 'failure'; id: number; error: string; stdout: string; stderr: string };

/** Talks to a single dedicated worker that runs the OpenSCAD WASM engine. */
export class OpenScadClient {
  private worker: Worker;
  private nextId = 0;
  private pending = new Map<number, PendingEntry>();

  constructor() {
    this.worker = new Worker(new URL('./openscadWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const data = event.data;
      const entry = this.pending.get(data.id);
      if (!entry) return;
      this.pending.delete(data.id);

      if (data.type === 'success') {
        entry.resolve({
          stl: data.stl,
          stdout: data.stdout,
          stderr: data.stderr,
          durationMs: data.durationMs,
          shells: data.shells,
        });
      } else {
        entry.reject(new RenderError(data.error, data.stdout, data.stderr));
      }
    };
  }

  render(source: string): Promise<RenderResult> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ type: 'render', id, source });
    });
  }

  dispose() {
    this.worker.terminate();
    this.pending.clear();
  }
}
