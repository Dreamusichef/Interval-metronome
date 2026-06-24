'use strict';

/*
  Pain-Point taxonomy + prompt/parse helpers — PURE (no SDK, no I/O), so the prompt
  shape and parsers are unit-testable. The taxonomy aligns with the Six-Cornered
  Snowflake building blocks and is editable here.

  Two Haiku passes (orchestrated by the module):
    Pass 1 (classify): is this message a struggle? If yes → category + a short
                       canonical label + intensity 1-3.
    Pass 2 (dedup):    match the candidate label against existing canonical labels,
                       or NEW.

  The VERBATIM quote is NOT taken from the model — the module stores the student's
  raw message text so phrasing is preserved exactly and never paraphrased.
*/

const TAXONOMY = [
  { key: 'speed_bpm_ceiling', label: 'Speed / BPM ceiling' },
  { key: 'pedal_calibration', label: 'Pedal technique & calibration' },
  { key: 'foot_leg_mechanics', label: 'Foot / ankle / leg mechanics' },
  { key: 'timing_consistency', label: 'Timing & consistency' },
  { key: 'limb_independence', label: 'Limb independence' },
  { key: 'endurance_tension', label: 'Endurance / tension' },
  { key: 'injury_recovery', label: 'Injury / recovery' },
  { key: 'gear_setup', label: 'Gear & setup' },
  { key: 'practice_structure', label: 'Practice structure' },
  { key: 'motivation_discipline', label: 'Motivation / discipline' },
  { key: 'mindset_frustration', label: 'Mindset / frustration' },
  { key: 'progress_tracking', label: 'Progress tracking' },
  { key: 'other', label: 'Other' },
];

const TAXONOMY_KEYS = new Set(TAXONOMY.map((t) => t.key));

// Stable cached system prefix for pass 1. Identical across the whole nightly batch
// (and across nights), so it prompt-caches once the prefix passes Haiku's minimum.
const CLASSIFY_SYSTEM_PREFIX = [
  'You triage drumming-practice chat messages for a teacher.',
  'For each message decide if the student is expressing a STRUGGLE, frustration, blocker, or pain point with their drumming practice (not casual chat, wins, or logistics).',
  '',
  'Categories (use the key exactly):',
  ...TAXONOMY.map((t) => `- ${t.key}: ${t.label}`),
  '',
  'Respond with ONE JSON object and nothing else:',
  '{"is_struggle": boolean, "category": "<one key above>", "label": "<3-6 word canonical phrase for this struggle>", "intensity": 1|2|3}',
  'intensity: 1 = mild/passing, 2 = real friction, 3 = blocked/distressed.',
  'If is_struggle is false, set category to "other", label to "", intensity to 1.',
].join('\n');

// Stable cached system prefix for pass 2 (dedup / match-or-new).
const DEDUP_SYSTEM_PREFIX = [
  'You group drumming struggle labels into canonical buckets.',
  'Given a CANDIDATE label and a list of EXISTING canonical labels, decide if the candidate means substantially the same struggle as one of the existing labels.',
  'Respond with ONE JSON object and nothing else:',
  '{"match": "<exact existing label text, or empty string if none match>"}',
  'Only match when the meaning is essentially the same; otherwise return an empty string (it is a new bucket).',
].join('\n');

/** Build the per-message user content for pass 1. */
function buildClassifyUserContent(messageText) {
  return `Message:\n"""\n${String(messageText == null ? '' : messageText).slice(0, 4000)}\n"""`;
}

/** Build the user content for pass 2. */
function buildDedupUserContent(candidateLabel, existingLabels) {
  const list = (existingLabels || []).map((l) => `- ${l}`).join('\n') || '(none yet)';
  return `CANDIDATE: ${candidateLabel}\n\nEXISTING canonical labels:\n${list}`;
}

/** Extract the first balanced top-level JSON object from model text. */
function extractJson(text) {
  if (!text) return null;
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const slice = text.slice(start, i + 1);
        try {
          return JSON.parse(slice);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Parse a pass-1 classify result. Returns a normalized struggle descriptor, or
 * { isStruggle: false } when not a struggle or unparseable.
 */
function parseClassifyResult(text) {
  const obj = extractJson(text);
  if (!obj || obj.is_struggle !== true) return { isStruggle: false };

  const category = TAXONOMY_KEYS.has(obj.category) ? obj.category : 'other';
  let label = typeof obj.label === 'string' ? obj.label.trim() : '';
  if (!label) {
    // Fall back to the category label so there is always a bucket name.
    const t = TAXONOMY.find((x) => x.key === category);
    label = t ? t.label : 'Other';
  }
  let intensity = parseInt(obj.intensity, 10);
  if (!(intensity >= 1 && intensity <= 3)) intensity = 1;

  return { isStruggle: true, category, label, intensity };
}

/** Parse a pass-2 dedup result → the matched existing label, or null for NEW. */
function parseDedupResult(text, existingLabels) {
  const obj = extractJson(text);
  if (!obj || typeof obj.match !== 'string') return null;
  const match = obj.match.trim();
  if (!match) return null;
  // Only honor a match that exactly names an existing label (guards hallucination).
  const set = new Set(existingLabels || []);
  return set.has(match) ? match : null;
}

module.exports = {
  TAXONOMY,
  TAXONOMY_KEYS,
  CLASSIFY_SYSTEM_PREFIX,
  DEDUP_SYSTEM_PREFIX,
  buildClassifyUserContent,
  buildDedupUserContent,
  extractJson,
  parseClassifyResult,
  parseDedupResult,
};
