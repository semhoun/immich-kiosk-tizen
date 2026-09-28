import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.xml': 'application/xml', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };

export function createStaticServer(directory = 'dist') {
  const root = resolve(directory);
  return createServer(async (request, response) => {
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { Allow: 'GET, HEAD' }).end();
        return;
      }
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (pathname.split('/').some(part => part.startsWith('.'))) throw new Error('Path rejected');
      let path = await realpath(resolve(root, '.' + pathname));
      const canonicalRoot = await realpath(root);
      if (path !== canonicalRoot && !path.startsWith(canonicalRoot + sep)) throw new Error('Path rejected');
      if ((await stat(path)).isDirectory()) path = await realpath(resolve(path, 'index.html'));
      if (!path.startsWith(canonicalRoot + sep)) throw new Error('Path rejected');
      const body = await readFile(path);
      response.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT || 8080);
  const server = createStaticServer(process.env.SERVE_DIR || 'dist');
  server.listen(port, process.env.HOST || '0.0.0.0', () => console.log(`Preview on container port ${port}`));
}
