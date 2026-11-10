const PATCH_FIELDS = new Set(['status', 'progress', 'due_date', 'assigned_to', 'notes', 'form_type']);
const TASK_STATUSES = new Set(['Pending', 'In Progress', 'Docs Received', 'Filed']);

function validateTaskPatch(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('A task update object is required.');
  }
  const keys = Object.keys(body);
  if (!keys.length) throw new Error('At least one task field must be updated.');

  const unsupported = keys.find(key => !PATCH_FIELDS.has(key));
  if (unsupported) throw new Error(`Unsupported task field: ${unsupported}.`);

  const updates = {};
  for (const key of keys) {
    const value = body[key];
    if (key === 'status') {
      if (!TASK_STATUSES.has(value)) throw new Error('Task status is invalid.');
    } else if (key === 'progress') {
      if (!Number.isInteger(value) || value < 0 || value > 100) {
        throw new Error('Task progress must be an integer from 0 to 100.');
      }
    } else if (key === 'due_date') {
      const date = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? new Date(`${value}T00:00:00.000Z`)
        : null;
      if (!date || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
        throw new Error('Task due date must be a valid YYYY-MM-DD date.');
      }
    } else if (typeof value !== 'string' || value.length > (key === 'notes' ? 5000 : 255)) {
      throw new Error(`Task ${key.replace('_', ' ')} must be text within the allowed length.`);
    }
    updates[key] = value;
  }
  return updates;
}

module.exports = { validateTaskPatch };
