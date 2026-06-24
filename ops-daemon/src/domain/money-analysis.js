'use strict';

/*
  Money Watch analysis — PURE. Reads the reconciled snapshot (from /daemon-read; the
  daemon never calls Shopify/PayPal directly) and flags genuine anomalies/milestones.
  Quiet when normal: emits rows ONLY on something worth Wei's attention.

  Expected snapshot contract (owner-defined via Lovable; all fields optional — missing
  pieces are skipped, never thrown). Reuses the Treasury's reconciliation upstream,
  including its PayPal dedup — we consume the reconciled numbers, not raw transactions:

    snapshot = {
      asOf: ISO string,
      refunds:  { amount: number, trailingWeeklyAvgAmount: number, count?: number },
      payments: { failed: number, disputed: number },
      revenue:  { weekToDateAmount: number, trailingWeeklyAvgAmount: number },
      launch:   { label: string, value: number }   // product-agnostic milestone counter
    }

  `launch` is a generic product-launch counter (e.g. Art of Double Bass 3.0 sales). When
  the owner populates it in /daemon-read, milestone crossings fire automatically — no
  daemon change needed. (First Stroke was the original example and has been removed.)

  Thresholds are tunable via opts (the owner tunes live — build step 7).
*/

const LAUNCH_MILESTONES = [50, 100, 250, 500, 1000, 2500];

function num(v) {
  return typeof v === 'number' && isFinite(v) ? v : null;
}

/**
 * @param {object} snapshot
 * @param {object} [opts]
 * @param {number} [opts.refundSpikeRatio=2.0]   refunds vs trailing avg
 * @param {number} [opts.revenueDipRatio=0.6]    week revenue below this * trailing avg → dip
 * @param {number} [opts.revenueSpikeRatio=1.8]  week revenue above this * trailing avg → spike
 * @param {number} [opts.failedThreshold=1]      failed/disputed count at/above → flag
 * @param {number|null} [opts.lastValue=null]    previous launch counter (watermark) for milestone-crossing
 * @returns {{ rows: object[], signals: object[] }}  rows lack captured_at (module stamps it)
 */
function detectMoneyAlerts(snapshot, opts = {}) {
  const {
    refundSpikeRatio = 2.0,
    revenueDipRatio = 0.6,
    revenueSpikeRatio = 1.8,
    failedThreshold = 1,
    lastValue = null,
  } = opts;

  const rows = [];
  const signals = [];
  const s = snapshot || {};

  const push = (type, detail, value, severity, needsAttention) => {
    rows.push({ type, detail, value, severity, needs_attention: needsAttention });
    signals.push({ source: 'money', severity, needsAttention, title: detail, detail });
  };

  // --- Refund spike ---
  const refundAmt = num(s.refunds && s.refunds.amount);
  const refundAvg = num(s.refunds && s.refunds.trailingWeeklyAvgAmount);
  if (refundAmt != null && refundAvg != null && refundAvg > 0) {
    if (refundAmt >= refundAvg * refundSpikeRatio) {
      push(
        'refund_spike',
        `Refunds ${refundAmt} vs trailing avg ${refundAvg} (${(refundAmt / refundAvg).toFixed(1)}x)`,
        refundAmt,
        'warn',
        true
      );
    }
  }

  // --- Failed / disputed payments ---
  const failed = num(s.payments && s.payments.failed);
  if (failed != null && failed >= failedThreshold) {
    push('failed_payments', `${failed} failed payment(s) on the reconciled ledger`, failed, 'warn', true);
  }
  const disputed = num(s.payments && s.payments.disputed);
  if (disputed != null && disputed >= failedThreshold) {
    push('disputed_payments', `${disputed} disputed payment(s) — chargeback risk`, disputed, 'critical', true);
  }

  // --- Revenue dip / spike vs trailing weeks ---
  const rev = num(s.revenue && s.revenue.weekToDateAmount);
  const revAvg = num(s.revenue && s.revenue.trailingWeeklyAvgAmount);
  if (rev != null && revAvg != null && revAvg > 0) {
    if (rev <= revAvg * revenueDipRatio) {
      push(
        'revenue_dip',
        `Week revenue ${rev} is well below trailing avg ${revAvg}`,
        rev,
        'notice',
        true
      );
    } else if (rev >= revAvg * revenueSpikeRatio) {
      push(
        'revenue_spike',
        `Week revenue ${rev} is well above trailing avg ${revAvg}`,
        rev,
        'notice',
        false
      );
    }
  }

  // --- Product-launch milestone (idempotent via lastValue) ---
  const launchVal = num(s.launch && s.launch.value);
  if (launchVal != null) {
    const label = (s.launch && s.launch.label) || 'launch';
    const crossed = LAUNCH_MILESTONES.filter(
      (m) => launchVal >= m && (lastValue == null || lastValue < m)
    );
    // Only emit on a genuine crossing (lastValue known and below the milestone).
    for (const m of crossed) {
      if (lastValue != null && lastValue < m) {
        push(
          'milestone',
          `${label} crossed ${m} (now ${launchVal})`,
          launchVal,
          'notice',
          true
        );
      }
    }
  }

  return { rows, signals };
}

module.exports = { detectMoneyAlerts, LAUNCH_MILESTONES };
