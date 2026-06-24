'use strict';

/*
  Minimal structured logger. One JSON line per event so PM2 log capture stays
  greppable. No dependency. Levels: debug (suppressed unless OPS_DEBUG), info,
  warn, error.
*/

const DEBUG = /^(1|true|yes|on)$/i.test(String(process.env.OPS_DEBUG || ''));

function emit(level, msg, meta) {
  const record = {
    ts: new Date().toISOString(),
    level,
    msg,
  };
  if (meta && typeof meta === 'object') Object.assign(record, meta);
  const line = JSON.stringify(record);
  if (level === 'error') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

module.exports = {
  debug(msg, meta) {
    if (DEBUG) emit('debug', msg, meta);
  },
  info(msg, meta) {
    emit('info', msg, meta);
  },
  warn(msg, meta) {
    emit('warn', msg, meta);
  },
  error(msg, meta) {
    emit('error', msg, meta);
  },
};
