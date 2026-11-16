// Integration verification only. Never imported by the application.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const root = path.resolve(__dirname, '../../..');
const privateRoots = [root, path.join(root, 'apps/admin'), path.join(root, 'apps/mobile')];

function checkFile(value) {
  if (typeof value !== 'string' && !(value instanceof URL) && !Buffer.isBuffer(value)) return;
  const file = path.resolve(value instanceof URL ? require('node:url').fileURLToPath(value) : String(value));
  if (file === path.join(root, 'apps/mobile/.env')) return;
  if (privateRoots.includes(path.dirname(file)) && /^\.env(?:\.|$)/i.test(path.basename(file)) && !file.endsWith('.example')) {
    throw new Error('INTEGRATION_PRIVATE_ENV_READ_REFUSED');
  }
}
for (const name of ['readFileSync', 'readFile', 'openSync', 'open', 'createReadStream']) {
  const original = fs[name];
  fs[name] = function (value, ...args) { checkFile(value); return original.call(this, value, ...args); };
}
for (const name of ['readFile', 'open']) {
  const original = fs.promises[name];
  fs.promises[name] = function (value, ...args) { checkFile(value); return original.call(this, value, ...args); };
}

// Tests use mocks/in-memory adapters; the Admin HTTP matrix uses loopback only.
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  let host;
  let first = args[0];
  if (Array.isArray(first)) first = first[0];
  if (first && typeof first === 'object') {
    if (first.path) return connect.apply(this, args); // Node worker IPC/named pipe.
    host = first.host;
  } else if (typeof first === 'number') {
    host = typeof args[1] === 'string' ? args[1] : undefined;
  } else if (typeof first === 'string' && !/^\d+$/.test(first)) {
    return connect.apply(this, args); // Named pipe.
  }
  if (host && !['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
    throw new Error('INTEGRATION_NON_LOOPBACK_CONNECTION_REFUSED');
  }
  return connect.apply(this, args);
};
// Existing app/backup/test databases must never be opened. Only this run's new
// disposable scratch root and in-memory databases are permitted.
// Loading SQLite for this guard must not add diagnostics to unrelated CLI
// output contracts. Suppress only this load's exact experimental notice;
// application warnings and every refusal remain untouched.
const emitWarning = process.emitWarning;
let sqlite;
try {
  process.emitWarning = function (warning, ...args) {
    if (warning === 'SQLite is an experimental feature and might change at any time' && args[0] === 'ExperimentalWarning') return;
    return emitWarning.call(this, warning, ...args);
  };
  sqlite = require('node:sqlite');
} finally {
  process.emitWarning = emitWarning;
}
const NativeDatabase = sqlite.DatabaseSync;
sqlite.DatabaseSync = class IntegrationDatabase extends NativeDatabase {
  constructor(file, ...options) {
    if (file !== ':memory:') {
      const name = path.resolve(String(file));
      const scratch = path.resolve(process.env.TEMP);
      if (!name.startsWith(scratch + path.sep)) throw new Error('INTEGRATION_EXISTING_DATABASE_OPEN_REFUSED');
    }
    super(file, ...options);
  }
};
require('node:module').syncBuiltinESMExports();
