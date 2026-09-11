import { FONTS, FONTS_CONF } from '../fonts';
import { countShells } from './meshCheck';

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
  /** Separate solids in the result; anything above 1 falls apart when printed. */
  shells: number;
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
    mkdir: (path: string) => void;
    writeFile: (path: string, data: string | Uint8Array) => void;
    readFile: (path: string) => Uint8Array;
  };
  ENV: Record<string, string>;
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

// Fetched once and reused: the worker outlives individual renders, but each
// render gets a fresh WASM instance with an empty filesystem to populate.
let fontCache: Map<string, Uint8Array> | null = null;

async function loadFonts(): Promise<Map<string, Uint8Array>> {
  if (fontCache) return fontCache;
  const entries = await Promise.all(
    FONTS.map(async (font) => {
      const response = await fetch(`/fonts/${font.file}`);
      if (!response.ok) throw new Error(`Could not load font ${font.file} (HTTP ${response.status}).`);
      return [font.file, new Uint8Array(await response.arrayBuffer())] as const;
    }),
  );
  fontCache = new Map(entries);
  return fontCache;
}

function mountFonts(instance: OpenScadModule, fonts: Map<string, Uint8Array>) {
  // Some of these already exist in the emscripten filesystem (/tmp always does),
  // and mkdir throws rather than no-op'ing on those.
  const ensureDir = (path: string) => {
    try {
      instance.FS.mkdir(path);
    } catch {
      /* already there */
    }
  };

  ensureDir('/fonts');
  for (const [file, data] of fonts) instance.FS.writeFile(`/fonts/${file}`, data);
  instance.FS.writeFile('/fonts/fonts.conf', FONTS_CONF);
  ensureDir('/tmp');
  ensureDir('/tmp/fontconfig');
  instance.ENV.FONTCONFIG_FILE = '/fonts/fonts.conf';
  instance.ENV.FONTCONFIG_PATH = '/fonts';
  instance.ENV.HOME = '/tmp';
}

/**
 * Lines the engine prints on every single run, about parts of itself this build
 * never uses. They say nothing about the design being rendered, and leaving them
 * in means the console opens with the same noise every time and the user learns
 * to skim past it — including past the lines that do matter.
 */
const ENGINE_NOISE = [/^Could not initialize localization/];

function isEngineNoise(line: string): boolean {
  return ENGINE_NOISE.some((pattern) => pattern.test(line.trim()));
}

async function runRender(source: string) {
  const stdout: string[] = [];
  const stderr: string[] = [];

  const [OpenSCAD, fonts] = await Promise.all([loadOpenScad(), loadFonts()]);
  const instance = await OpenSCAD({
    noInitialRun: true,
    print: (text: string) => stdout.push(text),
    printErr: (text: string) => {
      if (!isEngineNoise(text)) stderr.push(text);
    },
  });

  mountFonts(instance, fonts);
  instance.FS.writeFile('/input.scad', source);
  // binstl keeps big text-heavy models small, and `textmetrics` is what lets a
  // design measure its own lettering and scale it to fit.
  const exitCode = instance.callMain([
    '/input.scad',
    '-o', '/output.stl',
    '--backend=manifold',
    '--export-format=binstl',
    '--enable=textmetrics',
  ]);

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
    const shells = countShells(buffer);
    ctx.postMessage({ type: 'success', id, stl: buffer, stdout, stderr, durationMs, shells }, [buffer]);
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
