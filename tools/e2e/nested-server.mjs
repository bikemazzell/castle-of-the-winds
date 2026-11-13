// Nested-hosting static server (CODE-QUALITY Task 10).
// Serves <repo>/dist under a /nested/ prefix with SPA index fallback, so the
// production asset base ('./') is exercised exactly like a sub-directory deploy.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const port = Number(process.argv[2] ?? 0) || 4919;
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist');
const PREFIX = '/nested';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };

const server = http.createServer((req, res) => {
  const rel = (req.url ?? '/').slice(PREFIX.length).split('?')[0] || '/';
  const file = path.normalize(path.join(dist, rel));
  if (!file.startsWith(dist)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  const target = fs.existsSync(file) && fs.statSync(file).isFile()
    ? file
    : path.join(dist, 'index.html'); // SPA fallback
  fs.readFile(target, (err, data) => {
    if (err) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(target)] ?? 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`nested server on http://127.0.0.1:${port}${PREFIX}/ serving ${dist}\n`);
});
