#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CLASSIFICATION_MANIFEST,
  assertManifestMatchesMigrations,
  classCounts,
} from './classify-migrations.mjs';

const START = '<!-- rollback-classification:start -->';
const END = '<!-- rollback-classification:end -->';

function replaceBlock(source, body) {
  const start = source.indexOf(START);
  const end = source.indexOf(END);
  if (start < 0 || end < start) throw new Error('Missing generated rollback markers');
  return `${source.slice(0, start)}${START}\n${body.trim()}\n${END}${source.slice(end + END.length)}`;
}

export function generatedBlocks() {
  const { pg } = assertManifestMatchesMigrations();
  const counts = classCounts(pg);
  const headline = `A: ${counts.A} · B: ${counts.B} · C: ${counts.C} — of ${pg.length}`;
  const pgRefs = pg.map((row) => `\`${row.name.replace(/\.sql$/, '')}\` (${row.class})`).join(' · ');
  const writes = CLASSIFICATION_MANIFEST.sqliteDataWrites.map((id) => `\`${id}\``).join(' · ');
  const drops = CLASSIFICATION_MANIFEST.sqliteDropsTables.map((id) => `\`${id}\``).join(' · ');
  return {
    rollback: `**${headline}.**\n\nPostgreSQL classifications: ${pgRefs}\n\nSQLite migration-time data writes: ${writes}\n\nSQLite table drops: ${drops}`,
    backend: `Rollback classification: **${headline}.** Source: [rollback-classification.json](rollback-classification.json).`,
    mobile: `Generated rollback references: migration-time data writes ${writes}. Table drops ${drops}. Source: [rollback-classification.json](../../../backend/supabase/migrations/rollback-classification.json).`,
  };
}

export function renderRollbackDocs(sources) {
  const blocks = generatedBlocks();
  return {
    rollback: replaceBlock(sources.rollback, blocks.rollback),
    backend: replaceBlock(sources.backend, blocks.backend),
    mobile: replaceBlock(sources.mobile, blocks.mobile),
  };
}

const paths = {
  rollback: resolve('backend/supabase/migrations/ROLLBACK.md'),
  backend: resolve('backend/supabase/migrations/README.md'),
  mobile: resolve('apps/mobile/db/README.md'),
};

export function checkOrWrite(mode = '--check') {
  const sources = Object.fromEntries(
    Object.entries(paths).map(([key, path]) => [key, readFileSync(path, 'utf8')]),
  );
  const rendered = renderRollbackDocs(sources);
  const drift = Object.keys(paths).filter((key) => rendered[key] !== sources[key]);
  if (mode === '--write') {
    for (const key of Object.keys(paths)) writeFileSync(paths[key], rendered[key]);
    return [];
  }
  if (drift.length) throw new Error(`Generated rollback documentation drift: ${drift.join(', ')}`);
  return drift;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  checkOrWrite(process.argv[2] ?? '--check');
}
