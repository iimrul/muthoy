// Read source and saved read-only catalog metadata. Never contacts a database.
import ts from 'typescript';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const evidence = join(import.meta.dirname, 'evidence');
const envelope = JSON.parse(readFileSync(join(evidence, 'dev-catalog.json'), 'utf8'));
const result = JSON.parse(envelope.content[0].text).result;
const catalog = JSON.parse(result.split(/<untrusted-data-[^>]+>\n/)[1].split('\n</untrusted-data-')[0])[0].catalog;
const tables = new Map();
for (const column of catalog.public_tables) {
  if (!tables.has(column.table)) tables.set(column.table, new Set());
  tables.get(column.table).add(column.column);
}
const functions = new Map(catalog.public_functions.map((f) => [f.name, f]));
const selects = new Set(catalog.service_role_grants.filter((g) => g.privilege === 'SELECT').map((g) => g.table));
const dependencies = [];
const issues = [];
const unresolved = [];
const files = [];
function walk(dir) {
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', '.turbo', 'test'].includes(f.name)) continue;
    const p = join(dir, f.name);
    if (f.isDirectory()) walk(p);
    else if (/\.tsx?$/.test(f.name) && !/\.test\./.test(f.name)) files.push(p);
  }
}
walk(join(root, 'apps/admin'));
for (const file of files) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const constants = new Map();
  const evaluate = (node) => {
    if (!node) return null;
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isIdentifier(node)) return constants.get(node.text) ?? null;
    if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node)) return evaluate(node.expression);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const a = evaluate(node.left), b = evaluate(node.right);
      return a !== null && b !== null ? a + b : null;
    }
    return null;
  };
  function constant(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const value = evaluate(node.initializer);
      if (value !== null) constants.set(node.name.text, value);
    }
    ts.forEachChild(node, constant);
  }
  constant(source);
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const location = { file: file.slice(root.length + 1).replaceAll('\\', '/'), line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1 };
      if (method === 'from') {
        if (['Array', 'Buffer', 'Uint8Array', 'Object'].includes(node.expression.expression.getText(source))) return;
        const table = evaluate(node.arguments[0]);
        if (table !== null) {
          dependencies.push({ ...location, kind: 'table', name: table });
          if (!tables.has(table)) issues.push({ ...location, kind: 'missing_table', name: table });
          else if (!selects.has(table)) issues.push({ ...location, kind: 'missing_select_grant', name: table });
        } else unresolved.push({ ...location, expression: node.getText(source) });
      }
      if (method === 'select') {
        let chain = node.expression.expression;
        while (ts.isCallExpression(chain) && ts.isPropertyAccessExpression(chain.expression) && chain.expression.name.text !== 'from') chain = chain.expression.expression;
        if (ts.isCallExpression(chain) && ts.isPropertyAccessExpression(chain.expression) && chain.expression.name.text === 'from') {
          const table = evaluate(chain.arguments[0]);
          const columns = evaluate(node.arguments[0]);
          if (table !== null && columns !== null && tables.has(table)) {
            for (const column of columns.split(',')) {
              if (/^[a-z_]+$/.test(column) && !tables.get(table).has(column)) issues.push({ ...location, kind: 'missing_column', table, column });
            }
          } else if (columns === null) unresolved.push({ ...location, expression: node.getText(source).slice(0, 160) });
        }
      }
      if (method === 'rpc') {
        const name = evaluate(node.arguments[0]);
        if (name !== null) {
          dependencies.push({ ...location, kind: 'function', name });
          if (!functions.has(name)) issues.push({ ...location, kind: 'missing_function', name });
          else if (!functions.get(name).service_role_execute) issues.push({ ...location, kind: 'missing_execute_grant', name });
        } else unresolved.push({ ...location, expression: node.getText(source).slice(0, 160) });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
const hosted = JSON.parse(JSON.parse(readFileSync(join(evidence, 'dev-migrations.json'), 'utf8')).content[0].text).migrations;
const versions = new Set(hosted.map((m) => m.version));
const missingMigrations = readdirSync(join(root, 'backend/supabase/migrations')).filter((f) => /^\d+.*\.sql$/.test(f) && !versions.has(f.split('_')[0]));
const receipt = { checkedAt: new Date().toISOString(), project: 'btfprhticjgeihcngpif', readOnly: true, scope: 'Public DEV catalog; literal/static Admin source dependencies. No records or RPCs executed.', sourceFiles: files.length, hostedMigrations: hosted.length, localMigrations: readdirSync(join(root, 'backend/supabase/migrations')).filter((f) => /^\d+.*\.sql$/.test(f)).length, missingMigrations, missingTables: [...new Set(issues.filter((i) => i.kind === 'missing_table').map((i) => i.name))].sort(), missingFunctions: [...new Set(issues.filter((i) => i.kind === 'missing_function').map((i) => i.name))].sort(), dependencies, issues, unresolved, status: issues.length ? 'FAIL' : 'PARTIAL' };
writeFileSync(join(evidence, 'database-parity.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify({ ...receipt, dependencies: dependencies.length, issues: issues.length, unresolved: unresolved.length }, null, 2));
process.exitCode = issues.length ? 1 : 0;
