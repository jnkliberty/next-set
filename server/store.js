import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { tables, validateOperation, ValidationError } from './schema.js';
import { canonical } from '../domain/model.js';
export { canonical } from '../domain/model.js';

function withoutSequence(row) {
  const { seq, ...data } = row;
  return data;
}

export class Store {
  constructor(path) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
    // Each named domain table stores a complete row, including copied targets.
    for (const table of tables) {
      this.db.exec(`CREATE TABLE IF NOT EXISTS "${table}" (id TEXT PRIMARY KEY, seq INTEGER NOT NULL UNIQUE, document TEXT NOT NULL CHECK(json_valid(document)))`);
    }
    this.db.exec(`CREATE TABLE IF NOT EXISTS _clock (id INTEGER PRIMARY KEY CHECK(id=1), seq INTEGER NOT NULL);
      INSERT OR IGNORE INTO _clock VALUES (1, 0);
      CREATE TABLE IF NOT EXISTS _operation (id TEXT PRIMARY KEY, digest TEXT NOT NULL, table_name TEXT NOT NULL, row_id TEXT NOT NULL);`);
  }

  close() { this.db.close(); }

  revision() { return String(this.db.prepare('SELECT seq FROM _clock WHERE id=1').get().seq); }

  get(table, id) {
    if (!tables.includes(table)) throw new Error('Invalid table');
    const found = this.db.prepare(`SELECT seq, document FROM "${table}" WHERE id=?`).get(id);
    return found ? { ...JSON.parse(found.document), seq: found.seq } : null;
  }

  rows(table, includeDeleted = false) {
    if (!tables.includes(table)) throw new Error('Invalid table');
    return this.db.prepare(`SELECT seq, document FROM "${table}" ORDER BY seq`).all()
      .map(row => ({ ...JSON.parse(row.document), seq: row.seq }))
      .filter(row => includeDeleted || row.deleted_at == null);
  }

  put(table, row) {
    const { seq } = this.db.prepare('UPDATE _clock SET seq=seq+1 WHERE id=1 RETURNING seq').get();
    this.db.prepare(`INSERT INTO "${table}" (id,seq,document) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET seq=excluded.seq,document=excluded.document`)
      .run(row.id, seq, canonical(withoutSequence(row)));
    return { ...withoutSequence(row), seq };
  }

  archive(op, previous, reason) {
    if (op.table !== 'set') return;
    const old = withoutSequence(previous);
    const incoming = withoutSequence(op.row);
    for (const field of new Set([...Object.keys(old), ...Object.keys(incoming)])) {
      if (canonical(old[field]) === canonical(incoming[field])) continue;
      this.put('set_edit', {
        id: randomUUID(), rev: 1, device_id: 'server', updated_at: Date.now(), deleted_at: null,
        set_id: incoming.id, field, old_value: old[field] ?? null, new_value: incoming[field] ?? null,
        reason, operation_id: op.id, incoming_rev: incoming.rev, incoming_device_id: incoming.device_id,
      });
    }
  }

  apply(op) {
    validateOperation(op);
    const row = withoutSequence(op.row);
    const digest = createHash('sha256').update(canonical({ table: op.table, row })).digest('hex');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const receipt = this.db.prepare('SELECT digest FROM _operation WHERE id=?').get(op.id);
      if (receipt && receipt.digest !== digest) throw new ValidationError('Conflicting operation ID');
      const previous = this.get(op.table, row.id);
      let status = 'duplicate';
      if (!receipt) {
        status = this.resolve(op, previous);
        this.db.prepare('INSERT INTO _operation VALUES (?,?,?,?)').run(op.id, digest, op.table, row.id);
      }
      const result = { id: op.id, status, row: this.get(op.table, row.id) };
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  resolve(op, previous) {
    if (previous && canonical(withoutSequence(previous)) === canonical(withoutSequence(op.row))) return 'duplicate';
    const wins = !previous || op.row.rev > previous.rev
      || (op.row.rev === previous.rev && op.row.device_id > previous.device_id);
    if (previous) this.archive(op, previous, wins ? 'overwritten' : 'rejected');
    if (wins) this.put(op.table, op.row);
    return wins ? 'applied' : 'rejected';
  }

  changes(since, limit = 500) {
    if (!Number.isSafeInteger(since) || since < 0) throw new Error('Invalid cursor');
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid page size');
    const query = tables.map(table => `SELECT '${table}' AS table_name,seq,document FROM "${table}" WHERE seq>?`).join(' UNION ALL ');
    const page = this.db.prepare(`${query} ORDER BY seq LIMIT ?`).all(...tables.map(() => since), limit + 1);
    const rows = page.slice(0, limit).map(row => ({ table: row.table_name, row: { ...JSON.parse(row.document), seq: row.seq } }));
    return { rows, cursor: rows.at(-1)?.row.seq ?? this.db.prepare('SELECT seq FROM _clock WHERE id=1').get().seq, more: page.length > limit };
  }
}
