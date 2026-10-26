import { createHash } from 'node:crypto';
import { muscles } from '../server/schema.js';

// hasaneyldrm/exercises-dataset data/exercises.json, MIT for names and instruction text.
// Its images and GIFs are not MIT and are never read.
export const EXERCISEDB_SHA256 = '656634224b8977b99a6d765470ee123260d4979715eaa4e7c0b7c8bb0d79f93d';

const EQUIPMENT = {
  barbell: ['barbell', 'ez barbell', 'olympic barbell', 'trap bar'],
  dumbbell: ['dumbbell', 'kettlebell'],
  cable: ['cable', 'rope'],
  machine: ['leverage machine', 'smith machine', 'sled machine', 'assisted', 'upper body ergometer', 'skierg machine', 'stationary bike', 'elliptical machine', 'stepmill machine'],
};
const MUSCLE = {
  abs: 'abdominals', core: 'abdominals', obliques: 'abdominals', 'lower abs': 'abdominals', 'serratus anterior': 'chest',
  pectorals: 'chest', 'upper chest': 'chest', delts: 'shoulders', deltoids: 'shoulders', 'rear deltoids': 'shoulders', 'rotator cuff': 'shoulders',
  'upper back': 'middle back', back: 'middle back', rhomboids: 'middle back', 'latissimus dorsi': 'lats', spine: 'lower back',
  trapezius: 'traps', quads: 'quadriceps', soleus: 'calves', brachialis: 'biceps', 'levator scapulae': 'neck', sternocleidomastoid: 'neck',
  wrists: 'forearms', 'wrist flexors': 'forearms', 'wrist extensors': 'forearms', 'grip muscles': 'forearms', 'inner thighs': 'adductors', groin: 'adductors',
};
const muscle = name => MUSCLE[name] ?? (muscles.includes(name) ? name : null);
export const nameKey = name => name.toLowerCase().replace(/\((male|female)\)|\bv\.\s*\d+/g, '').replace(/[^a-z0-9]/g, '');
const title = name => name.replace(/(^|[\s(/-])([a-z])/g, (_, gap, letter) => gap + letter.toUpperCase());

export function equipmentOf(source) {
  return Object.entries(EQUIPMENT).find(([, names]) => names.includes(source))?.[0] ?? 'bodyweight';
}

export function readExerciseDb(bytes, existing = []) {
  if (createHash('sha256').update(bytes).digest('hex') !== EXERCISEDB_SHA256) throw new Error('ExerciseDB checksum mismatch');
  return convertExerciseDb(JSON.parse(bytes), existing);
}

export function convertExerciseDb(source, existing = []) {
  const seen = new Set(existing.flatMap(row => [row.name, ...(row.aliases || [])]).map(nameKey));
  const rows = [];
  for (const row of source) {
    const key = nameKey(row.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const primary = [muscle(row.target)].filter(Boolean);
    const secondary = [...new Set(row.secondary_muscles.map(muscle))].filter(name => name && !primary.includes(name));
    rows.push({
      id: `exdb:${row.id}`, name: title(row.name.replace(/\s*\((male|female)\)/g, '').trim()).slice(0, 200), aliases: [], equipment: equipmentOf(row.equipment),
      primary, secondary, weight_basis: ['dumbbell', 'kettlebell'].includes(row.equipment) ? 'per_hand' : row.equipment === 'weighted' ? 'added_to_bodyweight' : row.equipment === 'assisted' ? 'assisted' : 'total',
      conditioning: row.body_part === 'cardio', source: 'exercisedb', pinned_note: '',
      instructions: row.instruction_steps.en.map(step => step.trim()).filter(Boolean).join('\n').slice(0, 20000),
    });
  }
  return rows;
}
