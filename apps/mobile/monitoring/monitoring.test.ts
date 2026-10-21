// The sink's behaviour, plus two static assertions about the module graph.
//
// The static half matters as much as the behavioural half: "no network" and
// "not wired to the DEV diagnostics" are properties of the SHAPE of the code,
// and a future edit breaks them silently. Read as source, the way
// tests/dev-production-safety.test.ts and tests/font-tokens.test.ts already do.

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { MonitoringReport } from '../domain/errorRedaction';
import { reportError, reportEvent } from './report';
import { configureMonitoring, resetMonitoringProvider } from './provider';
import { CAPACITY, clearReports, readReports } from './sink';

const MONITORING_DIR = resolve('apps/mobile/monitoring');

beforeEach(() => {
  clearReports();
  resetMonitoringProvider();
});

describe('monitoring sink', () => {
  it('records locally and sends nothing when no provider is configured', () => {
    reportEvent('db.init.failed', { shopId: 'shop-1' });

    const stored = readReports();
    expect(stored).toHaveLength(1);
    expect(stored[0]!.event).toBe('db.init.failed');
    expect(stored[0]!.contextKeysPresent).toEqual(['shopId']);
    // The shipped Batch 1 state: a buffer entry and no delivery path at all.
    expect(stored[0]).not.toHaveProperty('delivered');
  });

  it('is bounded and evicts oldest-first', () => {
    for (let index = 0; index < CAPACITY + 10; index += 1) {
      reportEvent('sync.cycle.failed', { attempt: index } as never);
    }
    expect(readReports()).toHaveLength(CAPACITY);
  });

  it('hands the provider the redacted report and nothing else', () => {
    const delivered: MonitoringReport[] = [];
    configureMonitoring({ name: 'double', deliver: (r) => delivered.push(r) });

    const error = new Error('contains 4821 and +8801712345678');
    reportError({ event: 'sync.halted', error, route: 'sale', syncPhase: 'push' });

    expect(delivered).toHaveLength(1);
    expect(JSON.stringify(delivered[0])).not.toContain('4821');
    expect(JSON.stringify(delivered[0])).not.toContain('8801712345678');
    expect(delivered[0]!.route).toBe('sale');
    expect(delivered[0]!.syncPhase).toBe('push');
  });

  it('never throws, and still buffers, when the provider throws', () => {
    configureMonitoring({
      name: 'hostile',
      deliver: () => {
        throw new Error('provider exploded');
      },
    });
    expect(() => reportEvent('db.recovery.pending')).not.toThrow();
    expect(readReports()).toHaveLength(1);
  });

  it('returns void rather than a promise, so no caller can be made to await it', () => {
    expect(reportEvent('db.init.failed')).toBeUndefined();
  });

  it('drops an unknown event without recording it', () => {
    reportError({ event: 'not.an.event' as never });
    expect(readReports()).toHaveLength(0);
  });

  it('reads a corrupt stored buffer as empty rather than throwing', async () => {
    // A cleared data dir, a partial write or a hand-edited value all land here.
    // A broken diagnostic buffer must never become a second failure on top of
    // the one being reported.
    const { createMMKV } = await import('react-native-mmkv');
    const raw = createMMKV({ id: 'muthoy-monitoring' });
    for (const corrupt of ['not json at all', '{"not":"an array"}', '[1,2,3]', '[{}]']) {
      raw.set('reports', corrupt);
      expect(() => readReports()).not.toThrow();
      expect(readReports()).toEqual([]);
    }
    // And a write on top of a corrupt value still succeeds.
    raw.set('reports', 'not json at all');
    expect(() => reportEvent('db.init.failed')).not.toThrow();
    expect(readReports()).toHaveLength(1);
  });
});

describe('monitoring module graph', () => {
  function stripComments(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  }

  function sources(): { path: string; text: string }[] {
    return readdirSync(MONITORING_DIR)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .map((name) => ({ path: name, text: readFileSync(join(MONITORING_DIR, name), 'utf8') }));
  }

  it('finds the monitoring sources', () => {
    expect(sources().map((file) => file.path).sort())
      .toEqual(['index.ts', 'provider.ts', 'report.ts', 'sink.ts']);
  });

  it('contains no network call — Batch 1 ships no hosted delivery', () => {
    for (const file of sources()) {
      const code = stripComments(file.text);
      for (const forbidden of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'navigator.send']) {
        expect(code, `${file.path} must not reference ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('never imports the DEV diagnostics, which deliberately retain raw context', () => {
    // Comments stripped first: this directory's headers DISCUSS runtimeDiagnostics
    // and why it stays disconnected, which is documentation, not a dependency.
    for (const file of sources()) {
      expect(stripComments(file.text), `${file.path} must not import runtimeDiagnostics`)
        .not.toContain('runtimeDiagnostics');
    }
  });

  it('never reads message, cause or stack off an error', () => {
    for (const file of sources()) {
      const code = stripComments(file.text);
      for (const forbidden of ['.message', '.cause', '.stack']) {
        expect(code, `${file.path} must not read ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});
