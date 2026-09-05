// Runs inside a dedicated Web Worker so the OpenSCAD WASM engine never
// blocks the editor UI. `self` is cast to `any` at the boundary to avoid
// pulling in the "webworker" lib (which conflicts with the "dom" lib the
// rest of the app uses for its tsconfig).

type RenderRequest = {
  type: 'render';
  id: number;
  source: string;
};

type RenderSuccess = {
  type: 'success';
  id: number;
  stl: ArrayBuffer;
  stdout: string;
  stderr: string;
  durationMs: number;
};

type RenderFailure = {
  type: 'failure';
  id: number;
  error: string;
  stdout: string;
  stderr: string;
};

const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<RenderRequest>) => void) | null;
  postMessage: (message: RenderSuccess | RenderFailure, transfer?: Transferable[]) => void;
};

const OPENSCAD_JS_URL = '/openscad/openscad.js';

interface OpenScadModule {
  FS: {
    writeFile: (path: string, data: string) => void;
    readFile: (path: string) => Uint8Array;
  };
  callMain: (args: string[]) => number;
}

type OpenScadFactory = (overrides: Record<string, unknown>) => Promise<OpenScadModule>;

async function loadOpenScad(): Promise<OpenScadFactory> {
  try {
    // A fully-qualified URL is required here: inside a blob-backed module
    // worker, a root-relative specifier like "/openscad/openscad.js" fails
    // to resolve ("Failed to resolve module specifier").
    const url = new URL(OPENSCAD_JS_URL, self.location.origin).href;
    const mod = await import(/* @vite-ignore */ url);
    return mod.default as OpenScadFactory;
  } catch {
    throw new Error(
      'Could not load the OpenSCAD engine from /openscad/. Run "npm run setup" once, then reload.',
    );
  }
}

async function runRender(source: string) {
  const stdout: string[] = [];
  const stderr: string[] = [];

  const OpenSCAD = await loadOpenScad();
  const instance = await OpenSCAD({
    noInitialRun: true,
    print: (text: string) => stdout.push(text),
    printErr: (text: string) => stderr.push(text),
  });

  instance.FS.writeFile('/input.scad', source);
  const exitCode = instance.callMain(['/input.scad', '-o', '/output.stl', '--backend=manifold']);

  let stl: Uint8Array | null = null;
  try {
    stl = instance.FS.readFile('/output.stl');
  } catch {
    stl = null;
  }

  return { exitCode, stl, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
}

ctx.onmessage = async (event) => {
  const { id, source } = event.data;
  const start = performance.now();

  try {
    const { exitCode, stl, stdout, stderr } = await runRender(source);
    const durationMs = performance.now() - start;

    if (!stl || stl.byteLength === 0) {
      const message = stderr.trim() || `OpenSCAD exited with code ${exitCode} and produced no output.`;
      ctx.postMessage({ type: 'failure', id, error: message, stdout, stderr });
      return;
    }

    const buffer = stl.buffer.slice(stl.byteOffset, stl.byteOffset + stl.byteLength) as ArrayBuffer;
    ctx.postMessage({ type: 'success', id, stl: buffer, stdout, stderr, durationMs }, [buffer]);
  } catch (err) {
    ctx.postMessage({
      type: 'failure',
      id,
      error: err instanceof Error ? err.message : String(err),
      stdout: '',
      stderr: '',
    });
  }
};
