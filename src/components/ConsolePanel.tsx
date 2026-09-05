type Props = {
  open: boolean;
  onToggle: () => void;
  stdout: string;
  stderr: string;
  errorMessage: string | null;
};

export function ConsolePanel({ open, onToggle, stdout, stderr, errorMessage }: Props) {
  const hasContent = Boolean(stdout || stderr || errorMessage);

  return (
    <section className={`console-panel ${open ? 'open' : ''}`}>
      <button className="console-toggle" onClick={onToggle}>
        Console {hasContent && !open ? '•' : ''} {open ? '▾' : '▸'}
      </button>
      {open && (
        <div className="console-body">
          {errorMessage && <pre className="console-error">{errorMessage}</pre>}
          {stderr && <pre className="console-stderr">{stderr}</pre>}
          {stdout && <pre className="console-stdout">{stdout}</pre>}
          {!hasContent && <p className="console-empty">No output yet. Render your design to see logs here.</p>}
        </div>
      )}
    </section>
  );
}
