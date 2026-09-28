import { mkdir, rm, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

await access('dist/config.xml');
await access('dist/index.html');
await mkdir('artifacts', { recursive: true });
const output = resolve('artifacts/immich-kiosk-UNSIGNED.wgt');
await rm(output, { force: true });
execFileSync('zip', ['-q', '-X', '-r', output, '.'], { cwd: 'dist', stdio: 'inherit' });
console.log('Created artifacts/immich-kiosk-UNSIGNED.wgt (ZIP only, NOT signed or TV-installable).');
