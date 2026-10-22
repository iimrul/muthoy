#!/usr/bin/env node
// W4-06 — provision one ADMIN_ACCOUNTS entry without a plaintext password ever
// touching the repo, an env file in git, or a shell history line.
//
// The password is read from STDIN, never from argv: a command line is visible
// in the process table and is kept by the shell's history. Usage:
//
//   node scripts/admin-hash-password.mjs founder
//   (then type the password, press Enter)
//
// It prints ONE ADMIN_ACCOUNTS element and the matching ADMIN_ROLES line. It
// never writes a file, and it never prints the password back.

import { pbkdf2Sync, randomBytes } from 'node:crypto';

const ITERATIONS = 600_000;
const KEY_BYTES = 32;
const SALT_BYTES = 16;
const DIGEST = 'sha256';

const username = process.argv[2]?.trim();
if (!username) {
  console.error('Usage: node scripts/admin-hash-password.mjs <username>   (password on stdin)');
  process.exit(2);
}
if (username !== process.argv[2]) {
  console.error('Username must not have leading or trailing spaces.');
  process.exit(2);
}

async function readPassword() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}

const password = await readPassword();
if (password.length < 12) {
  console.error('Password must be at least 12 characters.');
  process.exit(2);
}

const salt = randomBytes(SALT_BYTES);
const hash = pbkdf2Sync(password, salt, ITERATIONS, KEY_BYTES, DIGEST).toString('hex');

console.log('ADMIN_ACCOUNTS element:');
console.log(JSON.stringify({ username, salt: salt.toString('hex'), hash }));
console.log('');
console.log('ADMIN_ROLES entry (choose one role: super_admin | billing | support | read_only):');
console.log(JSON.stringify({ [username]: 'read_only' }));
