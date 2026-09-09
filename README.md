# Scad Studio

A simple, intuitive editor and renderer for [OpenSCAD](https://openscad.org/) designs, built for
making things to 3D print. Write `.scad` code in an editor with syntax highlighting, render it in
the browser, spin the model around on a virtual print bed, and export an STL ready for slicing.

Everything runs client-side: the actual OpenSCAD engine is compiled to WebAssembly and executes in
a Web Worker, so nothing is uploaded anywhere.

## Designs folder

`designs/` is where you keep your own `.scad` files to iterate on. It's git-ignored —
bring your own designs, none are bundled into the app or committed to this repo.
Nothing under it is built either; the dev server just serves and watches it, so
pick a file from **Designs…** and the editor follows it: change the file on disk in
any editor and the new text appears here, no reload. It does *not* re-render on its
own; press Render when you want to see it. If the editor has edits of its own when
the file changes, you get the choice rather than losing them — and only then, since
what is remembered across a reload is a flag saying whether you had edited, not a
second copy of the text to compare against.

The toolbar's **One piece** / **N loose pieces** check (see below) works on any
design you drop in there — it's a general printability check, not tied to any
particular file.

## How it works

- **Editor** — Monaco (the VS Code editor) with a small custom OpenSCAD language definition
  (`src/editor/scadLanguage.ts`) for syntax highlighting.
- **Rendering** — a real build of OpenSCAD compiled to WebAssembly (the same one used by the
  official [openscad-playground](https://github.com/openscad/openscad-playground)) runs inside a
  dedicated Web Worker (`src/openscad/openscadWorker.ts`), so heavy renders never freeze the UI.
  It compiles your `.scad` source straight to an STL.
- **Viewer** — a Three.js scene (`src/viewer/ModelViewer.tsx`) with a 220mm print-bed grid, so you
  can see roughly how a design will sit on the plate.
- **Text** — the WASM engine ships without any fonts, so the worker mounts the ones in
  `public/fonts/` into its virtual filesystem along with a `fonts.conf` before each render.
  It also enables OpenSCAD's `textmetrics()`, which is how a design can measure its own
  lettering and scale it to fit.
- **Printability** — `src/openscad/meshCheck.ts` runs union-find over the STL's shared
  vertices to count disconnected solids.
- **Following a file** — `vite/scadDesigns.ts` is a dev-server plugin that lists `designs/`,
  serves a design on request, and pushes the new text down Vite's own hot-update socket when
  one changes on disk. `src/designs.ts` is the browser side of it. None of it exists in a
  production build, where there is no server to watch anything and the app simply has no
  designs folder.

## Hosting it

```sh
docker compose up -d --build      # http://127.0.0.1:8080
```

The image is a two-stage build: node fetches the engine, builds the app and
pre-compresses everything, then Caddy serves `dist/` and nothing else. The engine
download sits in its own layer ahead of the source copy, so editing a file does not
re-fetch 10MB of WebAssembly.

Nothing is computed server-side — every render happens in the visitor's browser —
so the only cost of hosting this is bytes. Which makes compression the whole game:

| | raw | brotli |
|---|---|---|
| `openscad.wasm` | 9.16 MB | 1.93 MB |
| everything a cold visit needs | ~12 MB | ~3 MB |

`scripts/precompress.mjs` writes `.br`/`.gz` beside each compressible file at build
time and Caddy serves those directly. Compressing a 9MB binary at brotli-11 costs
seconds of CPU, which is fine once in a container build and absurd per request.
Repeat visits cost close to nothing: `/assets/*` is content-hashed and immutable,
while the engine and fonts revalidate, since those keep their names across versions
and a year of immutable caching would strand anyone holding an old copy.

Put whatever you like in front of it for TLS — a Cloudflare tunnel reaches the
container over the docker network. Two things are worth checking rather than
assuming, if you do: that `.wasm` is actually being cached at the edge (it is not a
default-cached extension, so it wants an explicit cache rule), and that the edge is
not re-compressing what is already compressed here.

## Getting started

```sh
npm install
npm run setup   # downloads the OpenSCAD WASM engine (~10MB) into public/openscad/
npm run dev
```

Then open the printed local URL. Press **Render** (or `Cmd/Ctrl+Enter` while editing) to compile
your design, and **Download STL** to save the result for your slicer.

`npm run setup` only needs to run once — the engine is vendored into `public/openscad/`, which is
git-ignored since it's a large prebuilt binary you can always re-fetch.

## Notes

- The OpenSCAD engine itself is GPL-licensed; this app just loads and runs it. Designs you create
  with it are yours — using GPL tooling to make something doesn't make the something GPL.
- The bundled fonts (Norican, Pacifico, Dancing Script, Great Vibes, Lobster, Open Sans) are
  OFL/Apache licensed; their license texts sit next to them in `public/fonts/`.
- The bundled language support covers common OpenSCAD keywords and built-in modules/functions; it's
  not a full language server, so there's no autocomplete or inline error squiggles yet — errors
  show up in the console panel after a render.
