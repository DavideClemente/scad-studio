import { useEffect, useState } from 'react';
import { useProjects } from '../projects/context';
import { isNameTaken } from '../projects/names';
import { useDialog } from './dialogContext';

/**
 * The list of saved projects, and what can be done to one. Reads storage through
 * the context rather than being handed a list, because opening, renaming and
 * deleting are all storage's business — the only thing it asks the editor for is
 * what to do once a project has been read, which is `onOpen`.
 */
export function ProjectsDialog({ onClose, onOpen }: { onClose: () => void; onOpen: (id: string) => void }) {
  const projects = useProjects();
  const dialog = useDialog();
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleRename = async (id: string, current: string) => {
    const name = await dialog.promptText({
      title: 'Rename project',
      label: 'Project name',
      value: current,
      confirmLabel: 'Rename',
      // Its own name is not a clash with itself, so the project renaming is
      // left out of the comparison.
      validate: (candidate) =>
        isNameTaken(projects.projects, candidate, id)
          ? `A project called “${candidate}” already exists. Pick another name.`
          : null,
    });
    if (!name || name === current) return;
    setBusy(id);
    await projects.rename(id, name);
    setBusy(null);
  };

  const handleDelete = async (id: string, name: string) => {
    const confirmed = await dialog.confirm({
      title: `Delete “${name}”?`,
      message: 'The project and everything saved in it goes for good. This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!confirmed) return;
    setBusy(id);
    await projects.remove(id);
    setBusy(null);
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label="Saved projects">
        <header className="modal-header">
          <h2 className="modal-title">Projects</h2>
          <button className="btn btn-small" onClick={onClose}>
            Close
          </button>
        </header>

        {projects.error && <p className="modal-error">{projects.error}</p>}

        {projects.projects.length === 0 ? (
          <p className="modal-empty">
            {projects.canWrite
              ? 'Nothing saved yet. Save the design you are working on to keep it here.'
              : 'This browser is not allowing pages to store data, so projects cannot be saved here.'}
          </p>
        ) : (
          <ul className="project-list">
            {projects.projects.map((project) => (
              <li key={project.id} className={`project-row ${projects.open?.id === project.id ? 'is-open' : ''}`}>
                <button
                  className="project-open"
                  // The row reads as name-then-date to the eye; without this it
                  // reaches the accessibility tree as a button with no name at all.
                  aria-label={`Open ${project.name}`}
                  onClick={() => onOpen(project.id)}
                  disabled={busy === project.id}
                >
                  <span className="project-name">{project.name}</span>
                  <span className="project-time">{new Date(project.updatedAt).toLocaleString()}</span>
                </button>
                <button
                  className="btn btn-small"
                  onClick={() => handleRename(project.id, project.name)}
                  disabled={busy === project.id}
                >
                  Rename
                </button>
                <button
                  className="btn btn-small"
                  onClick={() => handleDelete(project.id, project.name)}
                  disabled={busy === project.id}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="modal-footnote">
          {projects.kind === 'local'
            ? 'Saved in this browser on this machine. Clearing site data removes them.'
            : 'Saved to your account.'}
        </p>
      </div>
    </div>
  );
}
