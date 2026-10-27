import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertExerciseDb, readExerciseDb } from '../import/exercisedb.js';
import { validateOperation } from '../server/schema.js';

const row = (id, name, extra = {}) => ({ id, name, body_part: 'back', equipment: 'cable', target: 'upper back', secondary_muscles: ['rhomboids', 'hip flexors', 'biceps'],
  instruction_steps: { en: ['Made-up first step.', ' ', 'Made-up second step.'] }, image: 'images/x.jpg', gif_url: 'videos/x.gif', ...extra });

test('made-up dataset rows map muscles and equipment, skip duplicates and never keep media', () => {
  const rows = convertExerciseDb([
    row('0001', 'cable seated row'), row('0002', 'Cable Seated Row (female)'), row('0003', 'example face pull'),
    row('0004', 'kettlebell swing', { equipment: 'kettlebell', target: 'glutes', secondary_muscles: [] }),
    row('0005', 'weighted dip', { equipment: 'weighted', target: 'pectorals' }), row('0006', 'rower', { body_part: 'cardio', target: 'cardiovascular system' }),
  ], [{ name: 'Example Face Pull', aliases: [] }]);
  assert.deepEqual(rows.map(r => r.name), ['Cable Seated Row', 'Kettlebell Swing', 'Weighted Dip', 'Rower']);
  assert.deepEqual([rows[0].primary, rows[0].secondary, rows[0].equipment], [['middle back'], ['biceps'], 'cable']);
  assert.deepEqual([rows[1].equipment, rows[1].weight_basis], ['dumbbell', 'per_hand']);
  assert.deepEqual([rows[2].equipment, rows[2].weight_basis, rows[2].primary], ['bodyweight', 'added_to_bodyweight', ['chest']]);
  assert.deepEqual([rows[3].conditioning, rows[3].primary], [true, []]);
  assert.equal(rows[0].instructions, 'Made-up first step.\nMade-up second step.');
  assert.ok(!JSON.stringify(rows).match(/jpg|gif|image/));
  for (const r of rows) validateOperation({ id: r.id, table: 'exercise', row: { ...r, rev: 1, device_id: 'importer', updated_at: 0, deleted_at: null } });
  assert.throws(() => readExerciseDb(Buffer.from('[]')), /checksum/);
});
