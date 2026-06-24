'use strict';

/*
  Money Watch — "Coffer Wards" → money_alerts.

  Daily. Reads the reconciled `snapshot` from /daemon-read (never calls Shopify/PayPal
  directly — reuses the Treasury's reconciliation incl. its PayPal dedup). Emits rows
  ONLY on genuine anomalies/milestones; quiet when normal. No Haiku.

  The cockpit read bundle is fetched once per cycle and passed in by the orchestrator
  so Money Watch and Stale-Quest don't each hit /daemon-read.
*/

const cockpit = require('../lib/cockpit');
const { getWatermark, setWatermark } = require('../lib/watermark');
const { detectMoneyAlerts } = require('../domain/money-analysis');

const WM = 'money:preorders';

async function run(ctx = {}) {
  const bundle = ctx.bundle || (await cockpit.read());
  const snapshot = bundle.snapshot || {};

  // Previous preorder count for idempotent milestone-crossing detection.
  const prev = getWatermark(WM);
  const lastPreorders = prev != null && prev !== '' ? Number(prev) : null;

  const { rows, signals } = detectMoneyAlerts(snapshot, { lastPreorders });

  const capturedAt = new Date().toISOString();
  const stamped = rows.map((r) => ({ ...r, captured_at: capturedAt }));

  if (stamped.length > 0) {
    await cockpit.ingest('money_alerts', stamped);
  }

  // Advance the milestone watermark to the latest observed preorder count.
  const cur = snapshot.firstStroke && typeof snapshot.firstStroke.preorders === 'number'
    ? snapshot.firstStroke.preorders
    : null;
  if (cur != null) setWatermark(WM, String(cur));

  return { signals, detail: { alerts: stamped.length } };
}

module.exports = { run };
