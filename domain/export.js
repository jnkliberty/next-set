import { tables } from '../server/schema.js';
import { canonical } from './model.js';

export function exportData(data) {
  return { version: 1, tables: Object.fromEntries(tables.map(table => [table, data[table] || []])) };
}

export async function exportHashes(data) {
  return Object.fromEntries(await Promise.all(tables.map(async table => {
    const rows = [...(data[table] || [])].sort((a,b) => a.id.localeCompare(b.id, 'en'));
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(rows)));
    return [table, { count: rows.length, hash: [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('') }];
  })));
}
