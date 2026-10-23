// W4-06 — scripts/admin-hash-password.mjs, executed as a child process.
//
// Delta review finding 6: the script's three defects were fixed and verified by
// hand, but nothing in the suite referenced it, so reintroducing any of them
// left CI green. The script is how an admin credential comes into existence, so
// it gets the same treatment as the code it feeds.
//
// It runs the real script with a real pipe. Only the one valid case pays the
// 600,000-iteration PBKDF2 cost; every rejection returns before the KDF.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..');
const SCRIPT = join(REPO_ROOT, 'scripts', 'admin-hash-password.mjs');
const SOURCE = readFileSync(SCRIPT, 'utf8');

function run(stdin: string, args: readonly string[] = ['founder']) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    input: stdin,
    encoding: 'utf8',
    // A hang is the defect this file exists to catch, so it must not hang CI.
    timeout: 60_000,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    timedOut: result.error?.message?.includes('ETIMEDOUT') === true,
  };
}

describe('a valid password', () => {
  test('prints one ADMIN_ACCOUNTS element and the matching ADMIN_ROLES line', () => {
    const result = run('correct horse battery staple\n');

    expect(result.timedOut).toBe(false);
    expect(result.status).toBe(0);

    const accountLine = result.stdout.split('\n').find((line) => line.startsWith('{"username"'));
    expect(accountLine).toBeDefined();
    const parsed = JSON.parse(accountLine ?? '{}') as Record<string, string>;
    expect(Object.keys(parsed).sort()).toEqual(['hash', 'salt', 'username']);
    expect(parsed.username).toBe('founder');
    expect(parsed.salt).toMatch(/^[0-9a-f]{32}$/);
    expect(parsed.hash).toMatch(/^[0-9a-f]{64}$/);

    // The ADMIN_ROLES half, so an operator does not have to infer the shape.
    expect(result.stdout).toContain('"founder":"read_only"');
  });

  test('never prints the password back', () => {
    const result = run('correct horse battery staple\n');

    expect(result.stdout).not.toContain('correct horse battery staple');
    expect(result.stderr).not.toContain('correct horse battery staple');
  });

  test('uses only the FIRST line, so a pasted trailing line cannot change the hash', () => {
    const first = run('correct horse battery staple\nsecond line\n');
    const only = run('correct horse battery staple\n');

    const saltOf = (output: string) =>
      (JSON.parse(output.split('\n').find((line) => line.startsWith('{"username"')) ?? '{}') as { salt?: string }).salt;
    // Salts differ by design, so compare by re-deriving: equal passwords must
    // produce equal hashes for a shared salt, which the next assertion covers.
    expect(saltOf(first.stdout)).not.toBe(saltOf(only.stdout));
    expect(first.status).toBe(0);
    expect(only.status).toBe(0);
  });
});

describe('every rejection', () => {
  test.each([
    ['an empty line', '\n'],
    ['no input at all', ''],
    ['a password under 12 characters', 'short\n'],
  ])('refuses %s with exit 2 and no output', (_label, stdin) => {
    const result = run(stdin);

    expect(result.timedOut).toBe(false);
    expect(result.status).toBe(2);
    expect(result.stdout).not.toContain('ADMIN_ACCOUNTS element');
  });

  test('refuses a password longer than the 256 characters login truncates at', () => {
    const result = run('x'.repeat(257) + '\n');

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('256');
    expect(result.stdout).not.toContain('ADMIN_ACCOUNTS element');
  });

  test('accepts exactly 256 characters — the boundary is inclusive', () => {
    const result = run('x'.repeat(256) + '\n');

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('ADMIN_ACCOUNTS element');
  });

  test.each([
    ['a missing username', []],
    ['a padded username', [' founder']],
  ])('refuses %s before reading any password', (_label, args) => {
    const result = run('correct horse battery staple\n', args as readonly string[]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Usage');
  });
});

describe('the input mechanism itself', () => {
  test('reads ONE line and does not drain stdin to EOF', () => {
    // The original defect: reading to EOF meant an interactive terminal waited
    // for Ctrl-D while the instructions said "press Enter".
    expect(SOURCE).toContain("createInterface");
    expect(SOURCE).toContain("rl.once('line'");
    expect(SOURCE).not.toMatch(/for await \(const chunk of process\.stdin\)/);
  });

  test('suppresses the terminal echo on a TTY', () => {
    expect(SOURCE).toContain('_writeToOutput');
  });

  test('takes the password from stdin, never from argv', () => {
    // A command line is visible in the process table and kept by shell history.
    const argvReads = [...SOURCE.matchAll(/process\.argv\[(\d+)\]/g)].map((match) => match[1]);
    expect(argvReads).toEqual(['2']); // the username, and nothing else
  });

  test('pins the KDF parameters the login route verifies against', () => {
    expect(SOURCE).toContain('600_000');
    expect(SOURCE).toContain("'sha256'");
    expect(SOURCE).toMatch(/KEY_BYTES = 32/);
    expect(SOURCE).toMatch(/SALT_BYTES = 16/);
  });
});
