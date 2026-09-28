import { cp, lstat, readdir, rm, access, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from 'esbuild';

// Refuse links and hidden/private files rather than accidentally shipping credentials.
async function validate(directory) {
  for (const name of await readdir(directory)) {
    if (name.startsWith('.') || /\.(p12|pfx|pem|key|wgt)$/i.test(name)) {
      throw new Error('Private or generated file found in app; build refused.');
    }
    const path = join(directory, name);
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error('Symlinks are not permitted in app.');
    if (info.isDirectory()) await validate(path);
    else if (!info.isFile()) throw new Error('Unsupported app file type.');
  }
}
await validate('app');
await access('app/index.html');
await access('app/config.xml');
const manifest = await readFile('app/config.xml', 'utf8');
const version = manifest.match(/<widget\b[^>]*\bversion="(\d+\.\d+\.\d+)"/);
if (!version) throw new Error('Missing or invalid widget version in config.xml.');
await rm('dist', { recursive: true, force: true });
await cp('app', 'dist', { recursive: true });
await build({ entryPoints: ['app/main.js'], outfile: 'dist/main.js', bundle: true, format: 'iife', target: 'chrome69', legalComments: 'none' });
const html = await readFile('dist/index.html', 'utf8');
await writeFile('dist/index.html', html.replace('<script type="module" src="main.js"></script>', '<script defer src="main.js"></script>').replace('__APP_VERSION__', version[1]));
console.log('Built classic Chromium 69 bundle, local assets and config.xml in dist/.');
