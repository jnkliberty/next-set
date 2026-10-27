import { addDays, todayDate, weekday } from '../domain/calendar.js';

// Invented records for screenshots and chart checks; no imported program or personal history.
export function progressFixture(store, mode = 'populated') {
  const put = (table, row) => store.put(table, { rev: 1, device_id: 'fixture', updated_at: 1, deleted_at: null, ...row });
  const exercises = [
    ['bench', 'Bench Press', 'barbell', 'total', ['chest'], ['triceps', 'shoulders'], 70],
    ['row', 'Barbell Row', 'barbell', 'total', ['middle back', 'lats'], ['biceps'], 55],
    ['squat', 'Back Squat', 'barbell', 'total', ['quadriceps', 'glutes'], ['hamstrings', 'lower back'], 85],
    ['incline', 'Incline Dumbbell Press', 'dumbbell', 'per_hand', ['chest'], ['triceps', 'shoulders'], 24],
    ['press', 'Overhead Press', 'barbell', 'total', ['shoulders'], ['triceps'], 35],
    ['curl', 'Dumbbell Curl', 'dumbbell', 'per_hand', ['biceps'], ['forearms'], 12],
    ['plank', 'Plank', 'bodyweight', 'total', ['abdominals'], [], 0],
  ];
  store.db.exec('BEGIN');
  try {
    for (const [id, name, equipment, weight_basis, primary, secondary] of exercises) put('exercise', { id, name, equipment, weight_basis, primary, secondary, conditioning: false });
    put('program', { id: 'demo', name: 'Sample Strength', source: 'fixture' });
    put('program_day', { id: 'demo-day', program_id: 'demo', position: 0, week: 1, day: 1, title: 'Sample session' });
    put('slot', { id: 'demo-slot', program_day_id: 'demo-day', exercise_id: 'bench', position: 0, rest_seconds: 90 });
    put('slot_set', { id: 'demo-set', slot_id: 'demo-slot', position: 0, type: 'working', reps_min: 6, reps_max: 8, target_effort: 8 });
    put('run', { id: 'demo-run', program_id: 'demo', start_date: addDays(todayDate(), -100), next_position: 0, status: 'active' });
    put('run_setting', { id: 'demo-schedule', run_id: 'demo-run', from_date: addDays(todayDate(), -100), days_per_week: 3, weekdays: [1, 3, 5], weekly_target: 3 });
    put('setting', { id: 'current_run', value: 'demo-run' });
    if (mode !== 'empty') seedSessions(put, exercises, mode);
    store.db.exec('COMMIT');
  } catch (error) { store.db.exec('ROLLBACK'); throw error; }
}

function seedSessions(put, exercises, mode) {
  let n = 0;
  for (let offset = 400; offset >= 1; offset--) {
    const date = addDays(todayDate(), -offset);
    if (![1, 3, 5].includes(weekday(date)) || (offset % 23 === 0)) continue;
    if (mode === 'sparse' && n > 0) continue;
    if (mode === 'sparse' && offset > 3) continue;
    const id = `demo-session-${n}`, start = Date.parse(`${date}T17:00:00Z`), off = n % 31 === 17;
    put('session', { id, run_id: 'demo-run', program_day_id: 'demo-day', local_date: date, timezone: 'America/Chicago', started_at: start, ended_at: start + (42 + n % 9) * 60000, source: 'app', status: 'done', off });
    const chosen = mode === 'sparse' ? [exercises[0]] : n % 2 === 0 ? [exercises[0], exercises[1], exercises[4], exercises[5]] : [exercises[2], exercises[3], exercises[1], exercises[6]];
    chosen.forEach((exercise, position) => {
      const [exerciseId, name, , , , , base] = exercise, slot = `${id}-${exerciseId}`;
      put('session_slot', { id: slot, session_id: id, position, exercise_id: exerciseId, name });
      for (let k = 0; k < 3; k++) {
        const weight = Math.round((base + Math.floor(n / 12) * (base > 40 ? 2.5 : 1) - (off ? 5 : 0)) * 2) / 2;
        put('set', { id: `${slot}-${k}`, session_slot_id: slot, position: k, type: exerciseId === 'plank' ? 'timed' : 'working', local_date: date, done_at: start + (position * 3 + k) * 180000,
          weight: exerciseId === 'plank' ? null : weight, grams: exerciseId === 'plank' ? null : weight * 1000, unit: 'kg', reps: exerciseId === 'plank' ? null : 6 + (n + k) % 3,
          seconds: exerciseId === 'plank' ? 30 + Math.floor(n / 12) * 5 : null, reps_left: k === 2 ? 1 : 2, target_reps_min: 6, target_reps_max: 8, target_effort: 8 });
      }
    });
    n++;
  }
}
