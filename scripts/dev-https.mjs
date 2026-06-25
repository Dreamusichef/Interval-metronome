#!/usr/bin/env node
'use strict';

/* Local HTTPS dev server for LAN testing (Web MIDI requires a secure context).
   Generates a self-signed cert in .dev-certs/ on first run (gitignored). */

import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const certDir = path.join(root, '.dev-certs');
const cert = path.join(certDir, 'cert.pem');
const key = path.join(certDir, 'key.pem');
const port = process.env.PORT || '8127';

/** Resolve openssl.exe on Windows (PATH, Git for Windows, Chocolatey install). */
function resolveOpenSsl() {
  if (process.env.OPENSSL_BIN && fs.existsSync(process.env.OPENSSL_BIN)) {
    return process.env.OPENSSL_BIN;
  }
  const candidates = [
    'openssl',
    'C:\\Program Files\\Git\\usr\\bin\\openssl.exe',
    'C:\\Program Files (x86)\\Git\\usr\\bin\\openssl.exe',
    'C:\\Program Files\\OpenSSL-Win64\\bin\\openssl.exe',
    'C:\\Program Files\\OpenSSL-Win32\\bin\\openssl.exe',
  ];
  for (const c of candidates) {
    if (c === 'openssl') {
      try {
        execSync('openssl version', { stdio: 'ignore' });
        return 'openssl';
      } catch (e) { /* try next */ }
      continue;
    }
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function ensureCerts() {
  if (fs.existsSync(cert) && fs.existsSync(key)) return;
  const openssl = resolveOpenSsl();
  if (!openssl) {
    console.error(
      '\n[dev:lan] OpenSSL not found.\n' +
      '  • Install Git for Windows (includes openssl), or\n' +
      '  • Run: choco install OpenSSL.Light -y\n' +
      '  • Or set OPENSSL_BIN to your openssl.exe path.\n'
    );
    process.exit(1);
  }
  fs.mkdirSync(certDir, { recursive: true });
  try {
    execSync(
      `"${openssl}" req -x509 -newkey rsa:2048 -nodes -keyout "${key}" -out "${cert}" -days 3650 -subj "/CN=localhost"`,
      { stdio: 'inherit' }
    );
  } catch (e) {
    console.error('\n[dev:lan] Could not generate HTTPS certs with OpenSSL.\n');
    process.exit(1);
  }
}

ensureCerts();

console.info(
  `\n[dev:lan] HTTPS on 0.0.0.0:${port}\n` +
  '  • This PC:     https://localhost:' + port + '\n' +
  '  • Other PCs:   https://<this-pc-lan-ip>:' + port + '\n' +
  '  Accept the browser certificate warning once per device.\n'
);

const child = spawn(
  'npx',
  ['-y', 'http-server', '-S', '-C', cert, '-K', key, '-p', port, '-c-1', '-a', '0.0.0.0'],
  { cwd: root, stdio: 'inherit', shell: true }
);
child.on('exit', (code) => process.exit(code == null ? 1 : code));
