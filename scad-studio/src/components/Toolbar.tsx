import { useRef } from 'react';
import type { ChangeEvent } from 'react';
import { EXAMPLES } from '../examples';

type Status = 'idle' | 'rendering' | 'success' | 'error';

type Props = {
  status: Status;
  lastRenderMs: number | null;
  stlAvailable: boolean;
  onRender: () => void;
  onNew: () => void;
  onOpenSource: (source: string, name: string) => void;
  onSaveScad: () => void;
  onDownloadStl: () => void;
  onSelectExample: (source: string) => void;
  /** Separate solids in the last render; more than one won't survive printing. */
  shells: number | null;
  /** The .scad files in designs/, which the dev server watches. Empty in a build. */
  designs: string[];
  onOpenDesign: (path: string) => void;
  /** The design the editor is following, if any. */
  openDesign: string | null;
  /** Something that just happened to the link, worth a line for a few seconds. */
  linkNote: string | null;
  /** The linked file changed while the editor held edits of its own. */
  conflict: boolean;
  onTakeDisk: () => void;
  onKeepMine: () => void;
};

export function Toolbar({
  status,
  lastRenderMs,
  stlAvailable,
  onRender,
  onNew,
  onOpenSource,
  onSaveScad,
  onDownloadStl,
  onSelectExample,
  shells,
  designs,
  onOpenDesign,
  openDesign,
  linkNote,
  conflict,
  onTakeDisk,
  onKeepMine,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    file.text().then((text) => onOpenSource(text, file.name));
  };

  return (
    <header className="toolbar">
      <div className="toolbar-brand">Scad Studio</div>

      <div className="toolbar-group">
        <button className="btn" onClick={onNew} title="Start a blank design">
          New
        </button>
        <button className="btn" onClick={() => fileInputRef.current?.click()} title="Open a .scad file">
          Open
        </button>
        <input ref={fileInputRef} type="file" accept=".scad" hidden onChange={handleFileChange} />
        <button className="btn" onClick={onSaveScad} title="Download the current source as .scad">
          Save
        </button>

        {designs.length > 0 && (
          <select
            className="btn"
            value={openDesign ?? ''}
            onChange={(event) => {
              if (event.target.value) onOpenDesign(event.target.value);
            }}
            title="Open a design from designs/. Edits made to it on disk show up here."
          >
            <option value="" disabled>
              Designs…
            </option>
            {designs.map((design) => (
              <option key={design} value={design}>
                {design}
              </option>
            ))}
          </select>
        )}

        <select
          className="btn"
          defaultValue=""
          onChange={(event) => {
            const example = EXAMPLES.find((item) => item.id === event.target.value);
            if (example) onSelectExample(example.source);
            event.target.value = '';
          }}
        >
          <option value="" disabled>
            Examples…
          </option>
          {EXAMPLES.map((example) => (
            <option key={example.id} value={example.id}>
              {example.name}
            </option>
          ))}
        </select>
      </div>

      <div className="toolbar-group toolbar-group-right">
        {conflict ? (
          <span className="link-conflict">
            {openDesign} changed on disk, and so did this editor.
            <button className="btn btn-small" onClick={onTakeDisk}>
              Use the file
            </button>
            <button className="btn btn-small" onClick={onKeepMine}>
              Keep mine
            </button>
          </span>
        ) : (
          linkNote && <span className="link-note">{linkNote}</span>
        )}
        {openDesign && !conflict && (
          <span
            className="link-name"
            title={`Following designs/${openDesign}. Changes to it on disk land here; press Render to build them.`}
          >
            <span className="link-dot" />
            {openDesign}
          </span>
        )}
        {status === 'success' && shells != null && (
          <span
            className={`shells ${shells === 1 ? 'shells-ok' : 'shells-warn'}`}
            title={
              shells === 1
                ? 'The whole model is one connected solid, so nothing can fall off while printing.'
                : `The model is in ${shells} separate pieces. They will print as loose parts — connect them before slicing.`
            }
          >
            {shells === 1 ? 'One piece' : `${shells} loose pieces`}
          </span>
        )}
        <span className={`status status-${status}`}>
          {status === 'rendering' && 'Rendering…'}
          {status === 'success' && lastRenderMs != null && `Rendered in ${(lastRenderMs / 1000).toFixed(1)}s`}
          {status === 'error' && 'Render failed'}
          {status === 'idle' && 'Ready'}
        </span>
        <button
          className="btn"
          onClick={onDownloadStl}
          disabled={!stlAvailable}
          title="Download the rendered model as .stl"
        >
          Download STL
        </button>
        <button className="btn btn-primary" onClick={onRender} disabled={status === 'rendering'} title="Ctrl/Cmd+Enter">
          {status === 'rendering' ? 'Rendering…' : 'Render'}
        </button>
      </div>
    </header>
  );
}
