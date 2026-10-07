import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

// A throwaway PostgreSQL SERVER for the few things PGlite cannot show.
//
// PGlite (harness.ts) is one backend: two sessions can never truly overlap in
// it, so a lock that serializes them is never actually exercised. This starts
// a real cluster from the machine's own PostgreSQL binaries — initdb into a
// temp directory, a free port, trust auth on 127.0.0.1 only — and talks to it
// through `psql`, one process per session, so every session is its own
// backend. No npm driver is involved.
//
// Nothing here is reachable from outside the machine, and the whole cluster is
// deleted when the suite stops it.

const EXE = process.platform === 'win32' ? '.exe' : '';
const TOOLS = ['initdb', 'pg_ctl', 'psql'] as const;

/**
 * The directory holding initdb, pg_ctl and psql, or null when this machine has
 * no PostgreSQL. PG_BIN_DIR wins; then PATH; then Debian/Ubuntu's versioned
 * directories, which is where GitHub's ubuntu-latest runner keeps them.
 */
export function findPostgresBin(): string | null {
  const candidates: string[] = [];
  if (process.env.PG_BIN_DIR) candidates.push(process.env.PG_BIN_DIR);
  candidates.push(...(process.env.PATH ?? '').split(delimiter));
  const debian = '/usr/lib/postgresql';
  if (existsSync(debian)) {
    const versions = readdirSync(debian).filter((name) => /^\d+$/.test(name));
    versions.sort((left, right) => Number(right) - Number(left));
    candidates.push(...versions.map((version) => join(debian, version, 'bin')));
  }
  return candidates.find((dir) =>
    dir.length > 0 && TOOLS.every((tool) => existsSync(join(dir, `${tool}${EXE}`)))) ?? null;
}

export interface PsqlResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** A psql session whose input is still open: statements run as they are written. */
export interface OpenSession {
  write(sql: string): void;
  /** Closes the input; psql runs what is left, disconnects and exits. */
  end(): Promise<PsqlResult>;
  readonly exited: boolean;
}

export interface ServerPostgres {
  /** Runs `sql` in a new session — its own backend — and waits for it to finish. */
  run(sql: string): Promise<PsqlResult>;
  /** Like run, but throws unless psql exits cleanly, and returns its output. */
  query(sql: string): Promise<string>;
  /** Starts a session and leaves it open. */
  open(firstSql: string): OpenSession;
  stop(): void;
}

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === 'object') resolvePort(address.port);
        else reject(new Error('no free port'));
      });
    });
  });
}

function tool(bin: string, name: (typeof TOOLS)[number]): string {
  return join(bin, `${name}${EXE}`);
}

function mustSucceed(label: string, result: ReturnType<typeof spawnSync>): void {
  if (result.status !== 0) {
    throw new Error(`${label} failed (${result.status}): ${String(result.stderr ?? '')}${String(result.stdout ?? '')}`);
  }
}

export async function startServerPostgres(bin: string): Promise<ServerPostgres> {
  const dataDir = mkdtempSync(join(tmpdir(), 'muthoy-pg-'));
  const cluster = join(dataDir, 'data');
  const logFile = join(dataDir, 'server.log');
  const port = await freePort();

  mustSucceed('initdb', spawnSync(
    tool(bin, 'initdb'),
    ['-D', cluster, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--locale=C', '-N'],
    { encoding: 'utf8' },
  ));
  // Settings go in the file rather than through pg_ctl -o, which is handed to
  // a shell on every platform and quotes differently on each.
  appendFileSync(join(cluster, 'postgresql.conf'), [
    '',
    `port = ${port}`,
    "listen_addresses = '127.0.0.1'",
    "unix_socket_directories = ''",
    'max_connections = 64',
    'fsync = off',
    'synchronous_commit = off',
    'full_page_writes = off',
    '',
  ].join('\n'));
  // stdio ignored: on Windows the postmaster would otherwise inherit the pipe
  // and spawnSync would wait for the server itself to exit.
  mustSucceed('pg_ctl start', spawnSync(
    tool(bin, 'pg_ctl'),
    ['-D', cluster, '-l', logFile, '-w', '-t', '60', 'start'],
    { stdio: 'ignore' },
  ));

  const children = new Set<ChildProcess>();
  const psqlArgs = [
    '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
    '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', 'postgres',
  ];
  const env = { ...process.env, PGCONNECT_TIMEOUT: '10', PGCLIENTENCODING: 'UTF8' };

  function launch(): { child: ChildProcess; done: Promise<PsqlResult> } {
    const child = spawn(tool(bin, 'psql'), psqlArgs, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    children.add(child);
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    const done = new Promise<PsqlResult>((resolveDone, reject) => {
      child.once('error', reject);
      child.once('close', (code) => {
        children.delete(child);
        resolveDone({ code, stdout, stderr });
      });
    });
    return { child, done };
  }

  const server: ServerPostgres = {
    async run(sql) {
      const { child, done } = launch();
      child.stdin?.end(sql);
      return done;
    },
    async query(sql) {
      const result = await server.run(sql);
      if (result.code !== 0) throw new Error(`psql failed (${result.code}): ${result.stderr}`);
      return result.stdout;
    },
    open(firstSql) {
      const { child, done } = launch();
      let exited = false;
      void done.then(() => { exited = true; });
      child.stdin?.write(firstSql);
      return {
        write: (sql) => { child.stdin?.write(sql); },
        end: () => { child.stdin?.end(); return done; },
        get exited() { return exited; },
      };
    },
    stop() {
      for (const child of children) child.kill();
      spawnSync(tool(bin, 'pg_ctl'), ['-D', cluster, '-m', 'immediate', '-w', 'stop'], { stdio: 'ignore' });
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
  };
  return server;
}
