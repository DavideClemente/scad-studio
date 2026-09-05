#!/usr/bin/env node
// Downloads the prebuilt OpenSCAD WebAssembly engine (the same one used by
// https://github.com/openscad/openscad-playground) into public/openscad/,
// where the app loads it at runtime. Not committed to git because it's a
// ~10MB binary that can always be re-fetched.

import { createWriteStream, existsSync, mkdirSync, rmSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WASM_BUILD_URL =
  'https://files.openscad.org/playground/OpenSCAD-2025.03.25.wasm24456-WebAssembly-web.zip';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const targetDir = path.join(__dirname, '..', 'public', 'openscad');
const zipPath = path.join(targetDir, '_download.zip');

async function main() {
  const jsPath = path.join(targetDir, 'openscad.js');
  const wasmPath = path.join(targetDir, 'openscad.wasm');

  if (existsSync(jsPath) && existsSync(wasmPath)) {
    console.log('OpenSCAD WASM already present in public/openscad/, skipping download.');
    return;
  }

  mkdirSync(targetDir, { recursive: true });
  console.log(`Downloading OpenSCAD WASM engine from:\n  ${WASM_BUILD_URL}`);

  const response = await fetch(WASM_BUILD_URL);
  if (!response.ok || !response.body) {
    throw new Error(`Download failed: HTTP ${response.status} ${response.statusText}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(zipPath));

  console.log('Extracting...');
  try {
    execFileSync('unzip', ['-o', zipPath, '-d', targetDir], { stdio: 'inherit' });
  } catch {
    throw new Error(
      'Could not run "unzip" to extract the archive. Install unzip, or extract ' +
        `${zipPath} into ${targetDir} manually, then re-run this script.`,
    );
  } finally {
    rmSync(zipPath, { force: true });
  }

  if (!existsSync(jsPath) || !existsSync(wasmPath)) {
    throw new Error('Extraction finished but openscad.js / openscad.wasm are missing.');
  }

  console.log('Done: public/openscad/openscad.js and openscad.wasm are ready.');
}

main().catch((err) => {
  console.error(`\nFailed to set up the OpenSCAD WASM engine: ${err.message}`);
  process.exit(1);
});
