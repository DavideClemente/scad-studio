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
