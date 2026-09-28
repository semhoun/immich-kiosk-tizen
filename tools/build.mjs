import { cp, lstat, readdir, rm, access } from 'node:fs/promises';
import { join } from 'node:path';

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
await rm('dist', { recursive: true, force: true });
await cp('app', 'dist', { recursive: true });
console.log('Built local web assets and config.xml in dist/.');
