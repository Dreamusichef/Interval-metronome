'use strict';

/*
  Central config + env loading for the Ops Daemon.

  We deliberately avoid a dotenv dependency (keep the tree minimal: only
  @anthropic-ai/sdk, better-sqlite3, node-cron). This module parses a .env file
  itself — a tiny, forgiving KEY=VALUE reader — and populates process.env for any
  key not already set by the real environment (PM2 / shell env always wins).

  All secrets come from /opt/ops-daemon/.env (gitignored). This file references
  env vars only; it never hardcodes or guesses a key value.
*/

const fs = require('fs');
const path = require('path');

function parseEnvFile(contents) {
  const out = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key) continue;
    let value = line.slice(eq + 1).trim();
    // Strip matching surrounding quotes, if present.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

// Load .env once, without overriding anything already in the real environment.
function loadEnvFile() {
  const candidate =
    process.env.OPS_ENV_FILE || path.join(process.cwd(), '.env');
  let contents;
  try {
    contents = fs.readFileSync(candidate, 'utf8');
  } catch {
    return; // No .env file — rely on the real environment (e.g. PM2 env).
  }
  const parsed = parseEnvFile(contents);
  for (const [k, v] of Object.entries(parsed)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

loadEnvFile();

function bool(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return /^(1|true|yes|on)$/i.test(v.trim());
}

function str(name, fallback = '') {
  const v = process.env[name];
  return v === undefined ? fallback : v;
}

const config = {
  tz: str('DAEMON_TZ', 'Asia/Singapore'),
  // Daily cycle just after Pulse's nightly intake (~22:55 SGT; day boundary 23:00 SGT).
  dailyCron: str('DAILY_CRON', '10 23 * * *'),

  dbPath: str('OPS_DB_PATH', path.join(process.cwd(), 'ops.db')),

  modules: {
    email: bool('MODULE_EMAIL_ENABLED', true),
    money: bool('MODULE_MONEY_ENABLED', true),
    funnel: bool('MODULE_FUNNEL_ENABLED', true),
    painpoints: bool('MODULE_PAINPOINTS_ENABLED', true),
    stalequest: bool('MODULE_STALEQUEST_ENABLED', true),
    // Review Watch ships disabled by design (no review app collecting reviews yet).
    review: bool('MODULE_REVIEW_ENABLED', false),
  },

  anthropic: {
    apiKey: str('ANTHROPIC_API_KEY'),
    // Only the Pain-Point Miner calls Haiku. Standalone API key, NOT the subscription.
    model: 'claude-haiku-4-5',
  },

  arcane: {
    ingestUrl: str('ARCANE_INGEST_URL'),
    readUrl: str('ARCANE_READ_URL'),
    apiKey: str('DAEMON_API_KEY'),
  },

  kit: {
    apiKey: str('KIT_API_KEY'),
  },

  dojo: {
    publicJsonUrl: str(
      'DOJO_PUBLIC_JSON_URL',
      'https://dreamusichef.github.io/aodhq-dojo-dashboard/dojo-data.public.json'
    ),
  },

  discord: {
    briefWebhookUrl: str('DISCORD_BRIEF_WEBHOOK_URL'),
  },

  hashSalt: str('DAEMON_HASH_SALT'),
};

/*
  Per-module required-env validation. Returns an array of human-readable warnings
  for enabled modules whose required vars are missing. The daemon does NOT crash on
  these — module isolation means a misconfigured module fails its own run only.
*/
function validate() {
  const warnings = [];
  const need = (cond, msg) => {
    if (!cond) warnings.push(msg);
  };

  // The cockpit is shared by every module (everything writes a brief at minimum).
  need(config.arcane.ingestUrl, 'ARCANE_INGEST_URL is not set (cockpit ingest disabled).');
  need(config.arcane.readUrl, 'ARCANE_READ_URL is not set (cockpit read disabled).');
  need(config.arcane.apiKey, 'DAEMON_API_KEY is not set (cockpit auth will fail).');

  if (config.modules.email) {
    need(config.kit.apiKey, 'MODULE_EMAIL_ENABLED but KIT_API_KEY is not set.');
  }
  if (config.modules.painpoints) {
    need(config.anthropic.apiKey, 'MODULE_PAINPOINTS_ENABLED but ANTHROPIC_API_KEY is not set.');
    need(config.hashSalt, 'MODULE_PAINPOINTS_ENABLED but DAEMON_HASH_SALT is not set (handles cannot be hashed).');
  }
  if (config.modules.funnel) {
    need(config.dojo.publicJsonUrl, 'MODULE_FUNNEL_ENABLED but DOJO_PUBLIC_JSON_URL is not set.');
  }
  // The Brief reaches Wei via the webhook; without it, briefs still persist to the cockpit.
  need(config.discord.briefWebhookUrl, 'DISCORD_BRIEF_WEBHOOK_URL is not set (brief will persist but not push to Discord).');

  return warnings;
}

config.validate = validate;

module.exports = config;
