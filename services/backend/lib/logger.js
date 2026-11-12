const SECRET_FIELD = /(authorization|cookie|password|secret|token|key|api.?key|credential)/i;

function sanitize(value, fieldName = '') {
  if (SECRET_FIELD.test(fieldName)) return '[redacted]';
  if (value instanceof Error) return value.message;
  if (Array.isArray(value)) return value.map((item) => sanitize(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitize(item, key)]));
  }
  return value;
}

function formatValue(value) {
  if (typeof value === 'string' && /^[a-zA-Z0-9_./:-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

function write(level, scope, message, details = {}) {
  const metadata = Object.entries(sanitize(details))
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${formatValue(value)}`)
    .join(' ');
  const line = `${new Date().toISOString()} ${level.padEnd(5)} [TaxFlow] ${scope.padEnd(10)} ${message}${metadata ? ` ${metadata}` : ''}`;

  if (level === 'ERROR') console.error(line);
  else if (level === 'WARN') console.warn(line);
  else console.log(line);
}

module.exports = {
  info: (scope, message, details) => write('INFO', scope, message, details),
  warn: (scope, message, details) => write('WARN', scope, message, details),
  error: (scope, message, details) => write('ERROR', scope, message, details),
  sanitize,
  formatValue
};
