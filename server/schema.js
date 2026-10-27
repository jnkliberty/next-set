const text = value => typeof value === 'string' && value.length <= 20000;
const id = value => text(value) && value.length > 0 && value.length <= 200;
const number = value => Number.isFinite(value) && value >= 0;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const list = value => Array.isArray(value) && value.length <= 200 && value.every(id);
const bool = value => typeof value === 'boolean';
const choice = (...values) => value => values.includes(value);
const rating = value => number(value) && value <= 10;
const json = value => JSON.stringify(value).length <= 20000;
export const muscles = ['abdominals', 'abductors', 'adductors', 'biceps', 'calves', 'chest', 'forearms', 'glutes', 'hamstrings', 'lats', 'lower back', 'middle back', 'neck', 'quadriceps', 'shoulders', 'traps', 'triceps'];
const muscleList = value => list(value) && value.every(x => muscles.includes(x));
export class ValidationError extends Error {}
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && new Date(value).toISOString().slice(0, 10) === value;

export const fields = {
  exercise: { name: id, aliases: list, equipment: choice('barbell', 'dumbbell', 'cable', 'machine', 'bodyweight'), primary: muscleList, secondary: muscleList, weight_basis: choice('total', 'per_hand', 'per_side', 'added_to_bodyweight', 'assisted'), conditioning: bool, merged_into: id, pinned_note: text, source: id, instructions: text },
  program: { name: id, source: id, pinned_note: text },
  program_day: { program_id: id, position: integer, week: integer, day: integer, title: text },
  slot: { program_day_id: id, position: integer, exercise_id: id, group_id: id, group_kind: choice('superset', 'compound', 'drop_chain', 'rest_pause', 'tabata'), rest_seconds: integer, pinned_note: text },
  slot_set: { slot_id: id, position: integer, type: choice('warmup', 'working', 'drop', 'rest_pause', 'timed', 'failure'), reps_min: integer, reps_max: integer, seconds: number, target_effort: rating },
  run: { program_id: id, start_date: date, next_position: integer, status: choice('active', 'paused', 'done') },
  run_setting: { run_id: id, from_date: date, days_per_week: value => integer(value) && value >= 1 && value <= 7, weekdays: value => Array.isArray(value) && value.every(x => integer(x) && x <= 6) && new Set(value).size === value.length, weekly_target: integer },
  run_event: { run_id: id, kind: choice('done', 'skipped', 'moved', 'added', 'leave'), local_date: date, to_date: date, position: integer, reason: text, session_id: id },
  session: { run_id: id, program_day_id: id, started_at: integer, timezone: id, local_date: date, ended_at: integer, status: choice('open', 'done', 'finished_early'), off: bool, effort: rating, note: text, source: choice('app', 'stoppani') },
  session_slot: { session_id: id, position: integer, exercise_id: id, name: id, planned_exercise_id: id, group_id: id, group_kind: choice('superset', 'compound', 'drop_chain', 'rest_pause', 'tabata'), pinned_note: text, rest_seconds: integer },
  set: { session_slot_id: id, position: integer, type: choice('warmup', 'working', 'drop', 'rest_pause', 'timed', 'failure'), target_reps_min: integer, target_reps_max: integer, target_seconds: number, target_weight: number, target_effort: rating, target_reference: choice('same_range', 'other_range', 'none'), reference_set_id: id, weight: number, unit: choice('kg', 'lb'), grams: integer, reps: integer, seconds: number, reps_left: value => integer(value) && value <= 4, effort_source: choice('logged', 'assumed'), bodyweight_grams: integer, done_at: integer, local_date: date, note: text },
  set_edit: { set_id: id, field: id, old_value: json, new_value: json, reason: id, operation_id: id, incoming_rev: integer, incoming_device_id: id },
  event: { device: id, session_id: id, set_id: id, kind: choice('shown', 'tap', 'logged', 'sync_try', 'sync_result', 'count_check'), time: integer, detail: json },
  setting: { value: json },
};

const required = {
  exercise: ['name', 'equipment', 'primary', 'secondary', 'weight_basis', 'conditioning'],
  program: ['name'], program_day: ['program_id', 'position'], slot: ['program_day_id', 'position', 'exercise_id'],
  slot_set: ['slot_id', 'position', 'type'], run: ['program_id', 'start_date', 'status', 'next_position'],
  run_setting: ['run_id', 'from_date', 'days_per_week', 'weekdays', 'weekly_target'],
  run_event: ['run_id', 'kind', 'local_date'], session: ['started_at', 'timezone', 'local_date', 'status', 'source'],
  session_slot: ['session_id', 'position', 'exercise_id', 'name'],
  set: ['session_slot_id', 'position', 'type', 'local_date'], event: ['device', 'kind', 'time'], setting: ['value'],
};

export const tables = Object.keys(fields);
export const writableTables = tables.filter(table => table !== 'set_edit');
const metadata = { id, rev: value => integer(value) && value > 0, device_id: id, seq: integer, updated_at: integer, deleted_at: integer };

export function validateOperation(op) {
  try { validate(op); }
  catch { throw new ValidationError('Invalid operation'); }
}

function validate(op) {
  if (!op || !id(op.id) || !writableTables.includes(op.table)) throw new Error('Invalid operation');
  validateStoredRow(op.table, op.row);
}

export function validateStoredRow(table, row) {
  if (!tables.includes(table)) throw new Error('Invalid table');
  if (!row || Array.isArray(row) || typeof row !== 'object') throw new Error('Invalid row');
  for (const key of ['id', 'rev', 'device_id', 'updated_at']) {
    if (!metadata[key](row[key])) throw new Error('Invalid metadata');
  }
  for (const [key, value] of Object.entries(row)) {
    const validate = Object.hasOwn(metadata, key) ? metadata[key] : fields[table][key];
    if (!Object.hasOwn(metadata, key) && !Object.hasOwn(fields[table], key)) throw new Error('Unknown field');
    if (value !== null && !validate(value)) throw new Error('Invalid field');
  }
  for (const key of required[table] || []) {
    if (row[key] == null) throw new Error('Missing field');
  }
  for (const prefix of ['', 'target_']) {
    if (row[`${prefix}reps_min`] != null && row[`${prefix}reps_max`] != null
      && row[`${prefix}reps_min`] > row[`${prefix}reps_max`]) throw new Error('Invalid range');
  }
}
