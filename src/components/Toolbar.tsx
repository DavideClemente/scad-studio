import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
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
  /** Separate solids in the last render; more than one means the model isn't a single connected piece. */
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

/** A badge whose meaning isn't obvious from its label alone: shows the given
 * text in a visible popover on hover or keyboard focus, rather than relying on
 * the browser's native (easy-to-miss) title tooltip. */
function InfoBadge({ className, info, children }: { className: string; info: string; children: ReactNode }) {
  return (
    <span className={`info-badge ${className}`} tabIndex={0}>
      {children}
      <span className="info-badge-icon" aria-hidden="true">
        ⓘ
      </span>
      <span className="info-badge-tooltip" role="tooltip">
        {info}
      </span>
    </span>
  );
}

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
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    file.text().then((text) => onOpenSource(text, file.name));
  };

  // Close the file menu on an outside click, so it behaves like a normal menu
  // rather than staying open until one of its own items is picked.
  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  return (
    <header className="toolbar">
      <div className="brand-menu" ref={menuRef}>
        <button
          className="toolbar-brand"
          onClick={() => setMenuOpen((open) => !open)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title="New, Open, Save"
        >
          Scad Studio
          <span className="brand-caret">▾</span>
        </button>
        {menuOpen && (
          <div className="brand-dropdown" role="menu">
            <button
              className="dropdown-item"
              role="menuitem"
              onClick={() => {
                onNew();
                setMenuOpen(false);
              }}
            >
              New
            </button>
            <button
              className="dropdown-item"
              role="menuitem"
              onClick={() => {
                fileInputRef.current?.click();
                setMenuOpen(false);
              }}
            >
              Open
            </button>
            <button
              className="dropdown-item"
              role="menuitem"
              onClick={() => {
                onSaveScad();
                setMenuOpen(false);
              }}
            >
              Save
            </button>
          </div>
        )}
        <input ref={fileInputRef} type="file" accept=".scad" hidden onChange={handleFileChange} />
      </div>

      <div className="toolbar-group">
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
          <InfoBadge
            className="link-name"
            info={`Following designs/${openDesign}. Changes to it on disk land here; press Render to build them.`}
          >
            <span className="link-dot" />
            {openDesign}
          </InfoBadge>
        )}
        {status === 'success' && shells != null && (
          <InfoBadge
            className={`shells ${shells === 1 ? 'shells-ok' : 'shells-warn'}`}
            info={
              shells === 1
                ? 'The whole model is one connected solid.'
                : `The model is made of ${shells} separate pieces, not connected to one another.`
            }
          >
            {shells === 1 ? 'One piece' : `${shells} loose pieces`}
          </InfoBadge>
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
