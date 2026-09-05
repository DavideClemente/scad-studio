import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';

/**
 * Serves the .scad files in designs/ and tells the browser when one of them
 * changes on disk.
 *
 * The editor in the page is a copy: open a design, edit the file in a real editor
 * (or have something else write it), and the page keeps showing what the file said
 * when it was opened. Reloading by hand works but loses the viewer state, and the
 * point of keeping the file on disk is to be able to work on it from both ends.
 *
 * So the dev server watches the folder and pushes the new text down the channel
 * Vite already keeps open for hot updates. Nothing is re-rendered as a result —
 * the page decides what to do with it, and rendering is the user's call.
 *
 * None of this exists in a production build: there is no server there to watch
 * anything, and the client treats a missing endpoint as "no designs folder".
 */

const LIST_URL = '/__scad/designs';
const FILE_URL = '/__scad/file';
export const CHANGED_EVENT = 'scad:changed';

async function scadFilesIn(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.scad'))
    // parentPath is absolute; the client only ever sees paths relative to designs/.
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
    .sort();
}

export function scadDesigns(folder = 'designs'): Plugin {
  let dir = '';

  const send = async (server: ViteDevServer, file: string) => {
    if (!file.startsWith(dir + path.sep) || !file.endsWith('.scad')) return;
    const relative = path.relative(dir, file);
    try {
      server.ws.send({
        type: 'custom',
        event: CHANGED_EVENT,
        data: { path: relative, text: await readFile(file, 'utf8') },
      });
    } catch {
      // Deleted between the event and the read, or unreadable: there is nothing
      // to send, and the page is no worse off than before.
    }
  };

  return {
    name: 'scad-designs',
    apply: 'serve',

    configResolved(config) {
      dir = path.resolve(config.root, folder);
    },

    configureServer(server) {
      server.watcher.add(dir);
      server.watcher.on('change', (file) => void send(server, file));
      server.watcher.on('add', (file) => void send(server, file));

      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');

        if (url.pathname === LIST_URL) {
          const files = await scadFilesIn(dir).catch(() => []);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(files));
          return;
        }

        if (url.pathname === FILE_URL) {
          const asked = url.searchParams.get('path') ?? '';
          // Resolve first and check afterwards: "../.." and symlink-ish paths are
          // only visible once they have been made absolute.
          const file = path.resolve(dir, asked);
          if (!file.startsWith(dir + path.sep) || !file.endsWith('.scad')) {
            res.statusCode = 400;
            res.end('Not a design');
            return;
          }
          try {
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.end(await readFile(file, 'utf8'));
          } catch {
            res.statusCode = 404;
            res.end('No such design');
          }
          return;
        }

        next();
      });
    },
  };
}
