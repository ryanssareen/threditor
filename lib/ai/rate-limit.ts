import 'server-only';

/**
 * M16 Unit 3: Firestore-backed rate limiter.
 *
 * Three buckets, all checked + incremented in a single transaction:
 *   /rateLimits/{uid}_{YYYYMMDDHH}        — per-user hourly (cap: 5)
 *   /rateLimits/{uid}_day_{YYYYMMDD}      — per-user daily (cap: 30)
 *   /rateLimits/ip_{ipHash}_{YYYYMMDDHH}  — per-IP hourly (cap: 15)
 *
 * Plus a global aggregate-cost kill switch read from /aiConfig/global:
 *   { enabled: boolean, todayTokens: number, todayDate: 'YYYYMMDD' }
 *
 * Doc-IDs encode the actor + window so a third party cannot spoof
 * them; rules deny all client access (admin SDK bypasses).
 *
 * Counters set `expireAt = now + 26h` so Firestore TTL sweep removes
 * them within ~24h after the window ends.
 *
 * `db.runTransaction` makes the gate atomic — concurrent requests
 * cannot both observe `count: 4` and both increment to `count: 5`.
 */

import { FieldValue, Timestamp } from 'firebase-admin/firestore';

import { getAdminFirebase } from '@/lib/firebase/admin';

export const HOUR_CAP = 5;
export const DAY_CAP = 30;
export const IP_HOUR_CAP = 15;

/**
 * Aggregate token cap below the Groq free-tier 100K TPD ceiling, with
 * headroom for retries. Read from /aiConfig/global.todayTokens — the
 * route increments this with `usage.total_tokens` after each gen.
 */
export const AGGREGATE_TOKEN_CAP = 80_000;

/**
 * Aggregate Cloudflare call cap. Cloudflare Workers AI free tier is
 * 10,000 Neurons/day. SDXL Lightning's per-call Neuron cost is not
 * separately documented but is expected to be roughly 1/3 of base
 * SDXL because `num_steps: 8` instead of 20. This cap (8,000 calls)
 * sets a budget assuming Lightning is ≥1.25× cheaper than base SDXL.
 *
 * The Groq token cap and the Cloudflare call cap share the same
 * /aiConfig/global doc and the same kill-switch transaction; either
 * tripping pauses both providers. Operators can also flip
 * `enabled: false` on the doc to pause everything immediately.
 */
export const AGGREGATE_CLOUDFLARE_CALL_CAP = 8_000;

const TTL_HOURS = 26;
const MS_PER_HOUR = 60 * 60 * 1000;

/** Format a Date as `YYYYMMDDHH` in UTC. */
function hourKey(d: Date): string {
  const y = d.getUTCFullYear().toString().padStart(4, '0');
  const m = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = d.getUTCDate().toString().padStart(2, '0');
  const h = d.getUTCHours().toString().padStart(2, '0');
  return `${y}${m}${day}${h}`;
}

/** Format a Date as `YYYYMMDD` in UTC. */
function dayKey(d: Date): string {
  const y = d.getUTCFullYear().toString().padStart(4, '0');
  const m = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = d.getUTCDate().toString().padStart(2, '0');
  return `${y}${m}${day}`;
}

/** Next hour boundary as ms-since-epoch. */
function nextHourBoundaryMs(d: Date): number {
  const next = new Date(d);
  next.setUTCMinutes(0, 0, 0);
  next.setUTCHours(next.getUTCHours() + 1);
  return next.getTime();
}

/** Next day boundary (UTC midnight). */
function nextDayBoundaryMs(d: Date): number {
  const next = new Date(d);
  next.setUTCHours(0, 0, 0, 0);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime();
}

export type CheckAndIncrementInput = {
  uid: string;
  /** SHA-256-of-(IP+salt) truncated to 16 hex chars. Empty string skips per-IP. */
  ipHash: string;
};

export type CheckAndIncrementAllowed = {
  allowed: true;
  remainingHour: number;
  remainingDay: number;
  /** Doc IDs the route should pass to refundSlot if it later decides to refund. */
  refundDocs: { user: string; userDay: string; ip: string | null };
};

export type CheckAndIncrementDenied = {
  allowed: false;
  reason: 'hour' | 'day' | 'ip' | 'aggregate';
  resetAt: number;
};

export type CheckAndIncrementResult =
  | CheckAndIncrementAllowed
  | CheckAndIncrementDenied;

/**
 * Atomically check and (if allowed) increment all three buckets +
 * the aggregate kill switch.
 *
 * The function NEVER throws on a deny outcome — only on a Firestore
 * outage, which the route maps to 503 (fail-closed).
 */
export async function checkAndIncrement(
  input: CheckAndIncrementInput,
  now: Date = new Date(),
): Promise<CheckAndIncrementResult> {
  const { db } = getAdminFirebase();
  const hk = hourKey(now);
  const dk = dayKey(now);
  const userDocId = `${input.uid}_${hk}`;
  const userDayDocId = `${input.uid}_day_${dk}`;
  const ipDocId = input.ipHash.length > 0 ? `ip_${input.ipHash}_${hk}` : null;

  const userRef = db.collection('rateLimits').doc(userDocId);
  const userDayRef = db.collection('rateLimits').doc(userDayDocId);
  const ipRef = ipDocId !== null ? db.collection('rateLimits').doc(ipDocId) : null;
  const configRef = db.collection('aiConfig').doc('global');

  const expireAt = Timestamp.fromMillis(now.getTime() + TTL_HOURS * MS_PER_HOUR);

  return db.runTransaction(async (tx) => {
    // 1. Aggregate kill switch (cheap to short-circuit on).
    const configSnap = await tx.get(configRef);
    if (configSnap.exists) {
      const cfg = configSnap.data() ?? {};
      if (cfg.enabled === false) {
        return {
          allowed: false,
          reason: 'aggregate',
          resetAt: nextDayBoundaryMs(now),
        };
      }
      const sameDay = cfg.todayDate === dk;
      const todayTokens =
        sameDay && typeof cfg.todayTokens === 'number' ? cfg.todayTokens : 0;
      if (todayTokens > AGGREGATE_TOKEN_CAP) {
        return {
          allowed: false,
          reason: 'aggregate',
          resetAt: nextDayBoundaryMs(now),
        };
      }
      const todayCloudflareCalls =
        sameDay && typeof cfg.todayCloudflareCalls === 'number'
          ? cfg.todayCloudflareCalls
          : 0;
      if (todayCloudflareCalls > AGGREGATE_CLOUDFLARE_CALL_CAP) {
        return {
          allowed: false,
          reason: 'aggregate',
          resetAt: nextDayBoundaryMs(now),
        };
      }
    }

    // 2. Read all three buckets in parallel.
    const [userSnap, userDaySnap, ipSnap] = await Promise.all([
      tx.get(userRef),
      tx.get(userDayRef),
      ipRef !== null ? tx.get(ipRef) : Promise.resolve(null),
    ]);

    const hourCount = (userSnap.data()?.count ?? 0) as number;
    const dayCount = (userDaySnap.data()?.count ?? 0) as number;
    const ipCount = (ipSnap?.data()?.count ?? 0) as number;

    // 3. Check caps in priority order: per-user hour > per-user day > per-IP.
    //    Hour-first ordering means the user sees the more relevant
    //    "you're going too fast" reason before the broader cap kicks in.
    if (hourCount >= HOUR_CAP) {
      return {
        allowed: false,
        reason: 'hour',
        resetAt: nextHourBoundaryMs(now),
      };
    }
    if (dayCount >= DAY_CAP) {
      return {
        allowed: false,
        reason: 'day',
        resetAt: nextDayBoundaryMs(now),
      };
    }
    if (ipRef !== null && ipCount >= IP_HOUR_CAP) {
      return {
        allowed: false,
        reason: 'ip',
        resetAt: nextHourBoundaryMs(now),
      };
    }

    // 4. Increment all three. Use { merge: true } via .set with FieldValue.
    tx.set(
      userRef,
      { count: FieldValue.increment(1), expireAt, kind: 'user_hour' },
      { merge: true },
    );
    tx.set(
      userDayRef,
      { count: FieldValue.increment(1), expireAt, kind: 'user_day' },
      { merge: true },
    );
    if (ipRef !== null) {
      tx.set(
        ipRef,
        { count: FieldValue.increment(1), expireAt, kind: 'ip_hour' },
        { merge: true },
      );
    }

    return {
      allowed: true,
      remainingHour: HOUR_CAP - 1 - hourCount,
      remainingDay: DAY_CAP - 1 - dayCount,
      refundDocs: {
        user: userDocId,
        userDay: userDayDocId,
        ip: ipDocId,
      },
    } as CheckAndIncrementAllowed;
  });
}

/**
 * Fire-and-forget transactional decrement on the same docs the
 * original transaction wrote, with floor-at-0 semantics.
 *
 * Called from the route ONLY when GroqAbortedError fires before any
 * LLM token streaming began (i.e., the only refund-eligible path).
 * Validation failures, rate-limit-from-Groq, auth, upstream, and
 * timeout-after-stream-started all keep the slot burned.
 */
export async function refundSlot(refundDocs: {
  user: string;
  userDay: string;
  ip: string | null;
}): Promise<void> {
  const { db } = getAdminFirebase();
  const userRef = db.collection('rateLimits').doc(refundDocs.user);
  const userDayRef = db.collection('rateLimits').doc(refundDocs.userDay);
  const ipRef =
    refundDocs.ip !== null
      ? db.collection('rateLimits').doc(refundDocs.ip)
      : null;

  try {
    await db.runTransaction(async (tx) => {
      const [userSnap, userDaySnap, ipSnap] = await Promise.all([
        tx.get(userRef),
        tx.get(userDayRef),
        ipRef !== null ? tx.get(ipRef) : Promise.resolve(null),
      ]);
      const userCount = (userSnap.data()?.count ?? 0) as number;
      const userDayCount = (userDaySnap.data()?.count ?? 0) as number;
      const ipCount = (ipSnap?.data()?.count ?? 0) as number;
      if (userCount > 0) {
        tx.set(userRef, { count: FieldValue.increment(-1) }, { merge: true });
      }
      if (userDayCount > 0) {
        tx.set(userDayRef, { count: FieldValue.increment(-1) }, { merge: true });
      }
      if (ipRef !== null && ipCount > 0) {
        tx.set(ipRef, { count: FieldValue.increment(-1) }, { merge: true });
      }
    });
  } catch (err) {
    // Refund is best-effort — the user's next call will succeed even
    // if a slot is leaked, and the bucket TTL-sweeps within 26h.
    console.error('rate-limit refund failed:', err);
  }
}

/**
 * Increment the aggregate-cost counter after a successful Groq call.
 * Self-resets on day rollover. Best-effort: a logging miss does not
 * fail the user-facing route.
 */
export async function bumpAggregateTokens(
  totalTokens: number,
  now: Date = new Date(),
): Promise<void> {
  if (!Number.isFinite(totalTokens) || totalTokens <= 0) return;
  const { db } = getAdminFirebase();
  const ref = db.collection('aiConfig').doc('global');
  const dk = dayKey(now);

  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const cfg = snap.exists ? snap.data() ?? {} : {};
      const sameDay = cfg.todayDate === dk;
      tx.set(
        ref,
        {
          enabled: typeof cfg.enabled === 'boolean' ? cfg.enabled : true,
          todayDate: dk,
          todayTokens: sameDay
            ? FieldValue.increment(totalTokens)
            : totalTokens,
        },
        { merge: true },
      );
    });
  } catch (err) {
    console.error('bumpAggregateTokens failed:', err);
  }
}

/**
 * Increment the aggregate Cloudflare call counter after a successful
 * Worker invocation. Resets on day rollover. Best-effort.
 */
export async function bumpAggregateCloudflareCalls(
  n: number = 1,
  now: Date = new Date(),
): Promise<void> {
  if (!Number.isFinite(n) || n <= 0) return;
  const { db } = getAdminFirebase();
  const ref = db.collection('aiConfig').doc('global');
  const dk = dayKey(now);

  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const cfg = snap.exists ? snap.data() ?? {} : {};
      const sameDay = cfg.todayDate === dk;
      tx.set(
        ref,
        {
          enabled: typeof cfg.enabled === 'boolean' ? cfg.enabled : true,
          todayDate: dk,
          todayCloudflareCalls: sameDay
            ? FieldValue.increment(n)
            : n,
        },
        { merge: true },
      );
    });
  } catch (err) {
    console.error('bumpAggregateCloudflareCalls failed:', err);
  }
}

/**
 * SHA-256-of-(IP + IP_HASH_SALT) truncated to 16 hex chars.
 *
 * Doc-ID-safe (lowercase alphanumeric), one-way, sufficiently distinct
 * for the per-IP cap. If `IP_HASH_SALT` is missing (e.g., local dev),
 * we return the empty string so the per-IP check is skipped — the
 * per-user caps still gate.
 */
export async function hashIp(ip: string): Promise<string> {
  if (ip.length === 0) return '';
  const salt = process.env.IP_HASH_SALT ?? '';
  if (salt.length === 0) return '';
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(`${ip}|${salt}`).digest('hex').slice(0, 16);
}
