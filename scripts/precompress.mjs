#!/usr/bin/env node
// Writes .br and .gz next to every compressible file in dist/, for a web server
// that can serve them directly (Caddy's `precompressed`, nginx's *_static).
//
// Done once at build rather than per request on purpose: the OpenSCAD engine is a
// 9MB wasm binary that brotli takes to under 2MB, and compressing it at quality 11
// costs seconds of CPU. That is fine once in a container build and absurd on every
// cold visit.
//
// Only files worth the bytes are touched. Already-compressed formats (woff2, png,
// the fonts' own tables) either grow or save nothing, and every extra file here is
// one more thing for the server to stat on each request.

import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompress, constants, gzip } from 'node:zlib';
import { promisify } from 'node:util';

const brotliAsync = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

const COMPRESS = new Set(['.js', '.css', '.html', '.json', '.svg', '.wasm', '.txt', '.ttf']);
/** Below this, the request overhead outweighs anything compression saves. */
const MIN_BYTES = 1024;

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

let files = 0;
let raw = 0;
let br = 0;

for await (const file of walk(dist)) {
  if (!COMPRESS.has(path.extname(file))) continue;
  if (file.endsWith('.br') || file.endsWith('.gz')) continue;
  const { size } = await stat(file);
  if (size < MIN_BYTES) continue;

  const body = await readFile(file);
  const [brotli, gzipped] = await Promise.all([
    brotliAsync(body, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: 11,
        [constants.BROTLI_PARAM_SIZE_HINT]: body.length,
      },
    }),
    gzipAsync(body, { level: 9 }),
  ]);

  // A file that resists compression is better served as-is: the encoded copy costs
  // a stat on every request and saves nothing.
  if (brotli.length >= body.length * 0.95 && gzipped.length >= body.length * 0.95) continue;

  await writeFile(`${file}.br`, brotli);
  await writeFile(`${file}.gz`, gzipped);
  files += 1;
  raw += body.length;
  br += brotli.length;
}

const mb = (bytes) => (bytes / 1048576).toFixed(2);
console.log(`Pre-compressed ${files} files: ${mb(raw)}MB raw -> ${mb(br)}MB brotli.`);
