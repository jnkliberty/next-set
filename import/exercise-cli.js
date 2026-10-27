import { readFileSync } from 'node:fs';
import { Store } from '../server/store.js';
import { readExerciseDb } from './exercisedb.js';
import { applyImport } from './apply.js';
import { validateOperation } from '../server/schema.js';

// node import/exercise-cli.js [--dry-run] [--source data/exercisedb.json] [--db data/workout.sqlite]
const args = process.argv.slice(2), dryRun = args.includes('--dry-run');
const option = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
const source = option('--source', 'data/exercisedb.json'), path = option('--db', process.env.DB_PATH || 'data/workout.sqlite');

const store = new Store(path);
try {
  const existing = store.rows('exercise').filter(row => row.source !== 'exercisedb');
  const rows = readExerciseDb(readFileSync(source), existing);
  const operations = rows.map(row => ({ id: `import:exercise:${row.id}`, table: 'exercise', row: { ...row, rev: 1, device_id: 'importer', updated_at: 0, deleted_at: null } }));
  let counts = { applied: 0, duplicate: 0, rejected: 0 };
  if (dryRun) operations.forEach(validateOperation);
  else counts = applyImport(store, operations);
  const after = store.rows('exercise').length;
  console.log(JSON.stringify({ dryRun, existing: existing.length, new: rows.length, withHowTo: rows.filter(row => row.instructions).length, total: dryRun ? existing.length + rows.length : after, operations: counts }, null, 2));
} catch (error) {
  console.error(`Exercise import stopped: ${error.message}`);
  process.exitCode = 1;
} finally { store.close(); }
