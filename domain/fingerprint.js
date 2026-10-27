import { canonical } from './model.js';

export async function fingerprints(sets, dates) {
  return Promise.all(dates.map(async date => {
    const rows = sets.filter(row => row.local_date === date).sort((a, b) => a.id.localeCompare(b.id, 'en'));
    const bytes = new TextEncoder().encode(canonical(rows));
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return { date, count: rows.filter(row => row.deleted_at == null).length,
      hash: [...new Uint8Array(hash)].map(n => n.toString(16).padStart(2, '0')).join('') };
  }));
}
