"""Run only in a disposable SDK container with empty anonymous volumes."""
import os
import pathlib
import pty
import select
import shutil
import subprocess
import time
import xml.etree.ElementTree as ET
import zipfile

root = pathlib.Path('/certificates')
if (list(root.iterdir()) or pathlib.Path('/signing/profiles.xml').exists()
        or pathlib.Path('/signing/tizen-studio-data/profile/profiles.xml').exists()
        or pathlib.Path('/signing/.keyring-password').exists()):
    raise RuntimeError('Refusing to test with existing certificate or profile files')
password = 'synthetic-test-password'
empty_profile = pathlib.Path('/signing/tizen-studio-data/profile/profiles.xml')
empty_profile.parent.mkdir(parents=True, exist_ok=True)
os.chown(empty_profile.parent, 1000, 1000)
empty_profile.write_text('<profiles version="3.1" active=""></profiles>')
os.chown(empty_profile, 1000, 1000)
subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
                '-subj', '/CN=DisposableTest', '-keyout', '/tmp/test.key', '-out', '/tmp/test.crt'],
               check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
for name in ['author', 'distributor']:
    subprocess.run(['openssl', 'pkcs12', '-legacy', '-export', '-inkey', '/tmp/test.key', '-in', '/tmp/test.crt',
                    '-out', str(root / (name + '.p12')), '-passout', 'pass:' + password], check=True)
    os.chmod(root / (name + '.p12'), 0o400)
    os.chown(root / (name + '.p12'), 1000, 1000)
os.chmod(root, 0o555)


def run_profile(answers, action='profile-create', path_override=None):
    pid, fd = pty.fork()
    if pid == 0:
        os.setgroups([])
        os.setgid(1000)
        os.setuid(1000)
        os.environ['HOME'] = '/signing'
        if path_override:
            os.environ['PATH'] = path_override + ':' + os.environ['PATH']
        os.execv('/usr/local/bin/with-keyring', ['with-keyring', '/bin/sh', '/workspace/tools/tizen.sh', action, 'DisposableTest'])
    transcript = b''
    sent = 0
    prompts = [b'Author certificate password: ', b'Distributor password (Enter = same as author): ']
    deadline = time.monotonic() + 60
    try:
        while time.monotonic() < deadline:
            if select.select([fd], [], [], 0.5)[0]:
                try:
                    data = os.read(fd, 4096)
                except OSError:
                    break
                if not data:
                    break
                transcript += data
                if sent < len(answers) and prompts[sent] in transcript:
                    os.write(fd, answers[sent].encode() + b'\n')
                    sent += 1
        else:
            os.kill(pid, 9)
            raise AssertionError('Interactive profile test timed out')
    finally:
        os.close(fd)
        _, status = os.waitpid(pid, 0)
    assert password.encode() not in transcript, 'Password was echoed'
    return os.waitstatus_to_exitcode(status), transcript.decode(errors='replace')


code, output = run_profile(['incorrect-test-password', ''])
assert code == 1 and 'Cannot open author.p12' in output, output
assert not pathlib.Path('/signing/profiles.xml').exists()
code, output = run_profile([password, ''])
assert code == 0 and 'Signing profile created' in output, output
profile = pathlib.Path('/signing/profiles.xml')
assert password not in profile.read_text(), 'Password stored in plaintext'
assert profile.stat().st_mode & 0o777 == 0o600
for item in ET.parse(profile).getroot().iter():
    reference = item.attrib.get('password', '')
    if reference:
        assert reference.startswith('/signing/certificates/')
        assert reference.endswith('.pwd')
        assert not pathlib.Path(reference).exists(), 'Modern Linux SDK uses Secret Service, not a sidecar'
keyring = pathlib.Path('/signing/.local/share/keyrings/login.keyring')
assert keyring.is_file() and password.encode() not in keyring.read_bytes()
assert pathlib.Path('/signing/.keyring-password').stat().st_mode & 0o777 == 0o600
for log in pathlib.Path('/signing').rglob('*.log'):
    assert password.encode() not in log.read_bytes(), 'Password found in SDK log'
original = profile.read_bytes()
code, output = run_profile([])
assert code == 2 and 'already exists' in output, output
assert profile.read_bytes() == original

# Reproduce the old broken profile: XML references keyring identifiers that were
# never stored. Repair must back up XML and preserve source files.
broken = original.replace(b'/signing/certificates/', b'/certificates/')
profile.write_bytes(broken)
empty_profile.write_bytes(broken)
sources = {f.name: f.read_bytes() for f in root.glob('*.p12')}
code, output = run_profile([password, ''], 'profile-repair')
assert code == 0, output
assert any(p.read_bytes() == broken for p in pathlib.Path('/signing').glob('profile-backup.*/profiles.xml'))
assert {f.name: f.read_bytes() for f in root.glob('*.p12')} == sources
for item in ET.parse(profile).getroot().iter():
    if item.attrib.get('password'):
        assert item.attrib['password'].startswith('/signing/certificates/')

# A vendor failure after touching its registry must restore both XML copies.
fake = pathlib.Path('/tmp/failing-tizen')
fake.mkdir()
stub = fake / 'tizen'
stub.write_text('#!/bin/sh\nif [ "$1" = security-profiles ]; then\n'
                'printf "<corrupt/>" > /signing/tizen-studio-data/profile/profiles.xml\n'
                'exit 1\nfi\nexec /opt/tizen-studio/tools/ide/bin/tizen "$@"\n')
stub.chmod(0o755)
before = (profile.read_bytes(), empty_profile.read_bytes())
code, output = run_profile([password, ''], 'profile-repair', str(fake))
assert code == 1, output
assert (profile.read_bytes(), empty_profile.read_bytes()) == before

work = pathlib.Path('/signing/sdk-sign-test')
shutil.copytree('/workspace/app', work / 'app')
(work / 'out').mkdir()
(work / 'out-next-container').mkdir()
for directory, dirs, files in os.walk(work):
    os.chown(directory, 1000, 1000)
    for name in files:
        os.chown(pathlib.Path(directory) / name, 1000, 1000)
signed = subprocess.run(['gosu', '1000:1000', '/usr/local/bin/with-keyring', 'tizen', 'package', '-t', 'wgt', '-s', 'DisposableTest',
                         '-o', str(work / 'out'), '--', str(work / 'app')],
                        capture_output=True, text=True, env={**os.environ, 'HOME': '/signing'}, timeout=60)
assert signed.returncode == 0, signed.stdout + signed.stderr
widgets = list((work / 'out').glob('*.wgt'))
assert len(widgets) == 1
with zipfile.ZipFile(widgets[0]) as widget:
    assert {'author-signature.xml', 'signature1.xml'} <= set(widget.namelist())
print('PASS hidden import, read-only source, persistent encrypted keyring, backup/repair and fresh-session SDK signing')
