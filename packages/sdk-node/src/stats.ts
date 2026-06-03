import type { Message, Session } from './types';

/**
 * Mini support stats for self-hosted SDK deployments — the same shape the SaaS
 * `/api/v1/stats` returns (minus the per-project breakdown, since an SDK owns a
 * single deployment). Small, honest numbers, computed over the customer's store.
 */
export interface SdkStats {
  /** Inclusive window start (ISO-8601). */
  from: string;
  /** Window end (ISO-8601). */
  to: string;
  /** Conversations started in the window. */
  conversations: number;
  /** Daily conversation counts (oldest → newest). */
  conversationsSparkline: number[];
  /** Messages (any sender) in the window. */
  messages: number;
  /** Share of windowed conversations with ≥1 operator/AI reply (0..1). */
  responseRate: number;
  /** Median visitor-first → operator-first reply, in seconds (null if none). */
  medianFirstResponseSeconds: number | null;
  /** Conversations whose latest message is still from the visitor. */
  unansweredNow: number;
  csat: {
    /** CSAT% = ratings ≥4 ÷ responses (0..1), null when no responses. */
    percent: number | null;
    /** Mean score 1..5, null when no responses. */
    average: number | null;
    /** Ratings submitted in the window. */
    responses: number;
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Compute stats from session+message pairs already loaded from storage.
 * Pure function — no I/O — so it's trivially testable.
 */
export function computeStats(
  entries: Array<{ session: Session; messages: Message[] }>,
  opts: { from: Date; to: Date }
): SdkStats {
  const from = opts.from;
  const to = opts.to;
  const days = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / DAY_MS));
  const buckets = new Array(days).fill(0) as number[];

  let conversations = 0;
  let messages = 0;
  let answered = 0;
  let unansweredNow = 0;
  const frtSeconds: number[] = [];
  const csatScores: number[] = [];

  for (const { session, messages: msgs } of entries) {
    const created = session.createdAt.getTime();
    if (created < from.getTime() || created > to.getTime()) continue;
    conversations += 1;

    const idx = Math.floor((created - from.getTime()) / DAY_MS);
    if (idx >= 0 && idx < days) buckets[idx] += 1;

    const ordered = [...msgs].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    messages += ordered.length;

    let firstVisitor: Date | null = null;
    let firstOperator: Date | null = null;
    for (const m of ordered) {
      if (m.sender === 'visitor' && !firstVisitor) firstVisitor = m.timestamp;
      else if ((m.sender === 'operator' || m.sender === 'ai') && !firstOperator)
        firstOperator = m.timestamp;
      if (firstVisitor && firstOperator) break;
    }
    if (firstOperator) answered += 1;
    if (firstVisitor && firstOperator && firstOperator >= firstVisitor) {
      frtSeconds.push((firstOperator.getTime() - firstVisitor.getTime()) / 1000);
    }

    const last = ordered[ordered.length - 1];
    if (last && last.sender === 'visitor') unansweredNow += 1;

    if (session.csat?.score != null) csatScores.push(session.csat.score);
  }

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    conversations,
    conversationsSparkline: buckets,
    messages,
    responseRate: conversations === 0 ? 0 : answered / conversations,
    medianFirstResponseSeconds: median(frtSeconds),
    unansweredNow,
    csat: {
      percent:
        csatScores.length === 0 ? null : csatScores.filter((n) => n >= 4).length / csatScores.length,
      average:
        csatScores.length === 0
          ? null
          : csatScores.reduce((a, b) => a + b, 0) / csatScores.length,
      responses: csatScores.length,
    },
  };
}
