# Scad Studio

A simple, intuitive editor and renderer for [OpenSCAD](https://openscad.org/) designs, built for
making things to 3D print. Write `.scad` code in an editor with syntax highlighting, render it in
the browser, spin the model around on a virtual print bed, and export an STL ready for slicing.

Everything runs client-side: the actual OpenSCAD engine is compiled to WebAssembly and executes in
a Web Worker, so nothing is uploaded anywhere.

## How it works

- **Editor** — Monaco (the VS Code editor) with a small custom OpenSCAD language definition
  (`src/editor/scadLanguage.ts`) for syntax highlighting.
- **Rendering** — a real build of OpenSCAD compiled to WebAssembly (the same one used by the
  official [openscad-playground](https://github.com/openscad/openscad-playground)) runs inside a
  dedicated Web Worker (`src/openscad/openscadWorker.ts`), so heavy renders never freeze the UI.
  It compiles your `.scad` source straight to an STL.
- **Viewer** — a Three.js scene (`src/viewer/ModelViewer.tsx`) with a 220mm print-bed grid, so you
  can see roughly how a design will sit on the plate.

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
- The bundled language support covers common OpenSCAD keywords and built-in modules/functions; it's
  not a full language server, so there's no autocomplete or inline error squiggles yet — errors
  show up in the console panel after a render.
