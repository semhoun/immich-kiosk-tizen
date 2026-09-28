import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

// Ephemeral CA trusted only by this test browser. No certificate-error bypass.
export async function testTLS() {
  const home = await mkdtemp(join(tmpdir(), 'kiosk-tls-'));
  const run = args => execFileSync('openssl', args, { cwd: home, stdio: 'ignore' });
  try {
    run(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=Kiosk Test CA', '-addext', 'basicConstraints=critical,CA:TRUE', '-keyout', 'ca.key', '-out', 'ca.crt']);
    run(['req', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1', '-addext', 'extendedKeyUsage=serverAuth', '-keyout', 'server.key', '-out', 'server.csr']);
    run(['x509', '-req', '-in', 'server.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key', '-CAcreateserial', '-days', '1', '-copy_extensions', 'copy', '-out', 'server.crt']);
    run(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=Untrusted', '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', 'bad.key', '-out', 'bad.crt']);
    const db = join(home, '.pki', 'nssdb');
    await mkdir(db, { recursive: true });
    execFileSync('certutil', ['-N', '-d', `sql:${db}`, '--empty-password'], { stdio: 'ignore' });
    execFileSync('certutil', ['-A', '-d', `sql:${db}`, '-n', 'Kiosk Test CA', '-t', 'C,,', '-i', join(home, 'ca.crt')], { stdio: 'ignore' });
    return {
      home,
      trusted: { key: await readFile(join(home, 'server.key')), cert: await readFile(join(home, 'server.crt')) },
      untrusted: { key: await readFile(join(home, 'bad.key')), cert: await readFile(join(home, 'bad.crt')) },
      cleanup: () => rm(home, { recursive: true, force: true })
    };
  } catch (error) { await rm(home, { recursive: true, force: true }); throw error; }
}
