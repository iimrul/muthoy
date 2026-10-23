#!/usr/bin/env node
// W4-06 — provision one ADMIN_ACCOUNTS entry without a plaintext password ever
// touching the repo, an env file in git, or a shell history line.
//
// The password is read from STDIN, never from argv: a command line is visible in
// the process table and is kept by the shell's history.
//
//   node scripts/admin-hash-password.mjs founder
//   Password: <typed, not echoed, then Enter>
//
// It prints ONE ADMIN_ACCOUNTS element and the matching ADMIN_ROLES line. It
// never writes a file, and it never prints the password back.
//
// It reads ONE LINE, not stdin-to-EOF. Reading to EOF meant an interactive
// terminal waited forever for Ctrl-D while the instructions said "press Enter",
// and the password echoed in clear text the whole time. Found by the final
// acceptance review. A piped password still works, so CI and scripted use are
// unchanged.

import { createInterface } from 'node:readline';
import { pbkdf2Sync, randomBytes } from 'node:crypto';

const ITERATIONS = 600_000;
const KEY_BYTES = 32;
const SALT_BYTES = 16;
const DIGEST = 'sha256';
const MIN_PASSWORD_LENGTH = 12;
// lib/adminLogin.ts truncates the submitted password at 256 characters, so a
// longer one would hash here and then never verify at login.
const MAX_PASSWORD_LENGTH = 256;

const username = process.argv[2];
if (!username || username.trim() !== username || username.length === 0) {
  console.error('Usage: node scripts/admin-hash-password.mjs <username>   (password on stdin)');
  console.error('The username must have no leading or trailing spaces.');
  process.exit(2);
}

/** One line, with the terminal echo off when there is a terminal. */
function readPasswordLine() {
  return new Promise((resolve, reject) => {
    const isTerminal = process.stdin.isTTY === true;
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: isTerminal,
    });

    if (isTerminal) {
      process.stdout.write('Password: ');
      // Suppress the echo of everything typed after the prompt.
      rl._writeToOutput = () => {};
    }

    // Resolve BEFORE closing: rl.close() emits 'close' SYNCHRONOUSLY, so
    // closing first let the empty-input fallback below settle the promise and
    // the real line was thrown away — every password read as empty.
    let settled = false;
    rl.once('line', (line) => {
      settled = true;
      if (isTerminal) process.stdout.write('\n');
      resolve(line);
      rl.close();
    });
    rl.once('close', () => {
      // Input ended with no line at all: Ctrl-C, Ctrl-D, or an empty pipe.
      if (!settled) resolve('');
    });
    rl.once('error', reject);
  });
}

const password = (await readPasswordLine()).replace(/\r$/, '');

if (password.length < MIN_PASSWORD_LENGTH) {
  console.error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  process.exit(2);
}
if (password.length > MAX_PASSWORD_LENGTH) {
  console.error(
    `Password must be at most ${MAX_PASSWORD_LENGTH} characters: the login route `
    + 'truncates there, so a longer one would never verify.',
  );
  process.exit(2);
}

const salt = randomBytes(SALT_BYTES);
const hash = pbkdf2Sync(password, salt, ITERATIONS, KEY_BYTES, DIGEST).toString('hex');

console.log('ADMIN_ACCOUNTS element:');
console.log(JSON.stringify({ username, salt: salt.toString('hex'), hash }));
console.log('');
console.log('ADMIN_ROLES entry (choose one role: super_admin | billing | support | read_only):');
console.log(JSON.stringify({ [username]: 'read_only' }));
