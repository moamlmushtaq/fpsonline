// ─────────────────────────────────────────────────────────────────────────────
// HALCYON FRONT — online admin authorization (the game owner's cheat console).
//
// Configured from the environment by index.ts:
//   ADMIN_PASSWORD   the console password. Unset/empty → admin is DISABLED online.
//   ADMIN_ACCOUNTS   optional comma-separated account names. When set, only a
//                    connection signed in as one of them may authenticate (and it
//                    still needs the password).
// The password is compared in constant time (SHA-256 digests of both sides +
// timingSafeEqual, so lengths never leak). Failed attempts are rate-limited per
// connection: after MAX_FAILS the connection is locked out for LOCKOUT_MS (also
// for the correct password). HostCore logs every grant, refusal and cheat.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash, timingSafeEqual } from 'node:crypto';
import type { AdminHooks } from '../shared/host/host-core';

export const ADMIN_MAX_FAILS = 5;
export const ADMIN_LOCKOUT_MS = 60_000;

export interface AdminAuthOptions {
  password?: string | null;
  /** Account names allowed to authenticate (case-insensitive). Empty = any connection with the password. */
  accounts?: readonly string[] | string | null;
  maxFails?: number;
  lockoutMs?: number;
  /** Clock (tests). */
  now?: () => number;
}

export interface AdminAuth extends AdminHooks {
  readonly enabled: boolean;
  readonly accountNames: readonly string[];
}

const digest = (s: string): Buffer => createHash('sha256').update(s, 'utf8').digest();

/** Parses ADMIN_ACCOUNTS ("alice, Bob ,carol") into lower-case names. */
export function parseAdminAccounts(raw: readonly string[] | string | null | undefined): string[] {
  const list = typeof raw === 'string' ? raw.split(',') : (raw ?? []);
  return [...new Set(list.map((n) => n.trim().toLowerCase()).filter((n) => n.length > 0))];
}

export function createAdminAuth(opts: AdminAuthOptions = {}): AdminAuth {
  const password = opts.password ?? '';
  const enabled = password.length > 0;
  const expected = enabled ? digest(password) : null;
  const accounts = parseAdminAccounts(opts.accounts);
  const maxFails = Math.max(1, opts.maxFails ?? ADMIN_MAX_FAILS);
  const lockoutMs = Math.max(0, opts.lockoutMs ?? ADMIN_LOCKOUT_MS);
  const now = opts.now ?? Date.now;
  const attempts = new Map<string, { fails: number; lockedUntil: number }>();

  return {
    enabled,
    accountNames: accounts,
    verify({ connId, password: given, account }) {
      if (!expected) return { ok: false, message: 'disabled' };
      const t = now();
      const a = attempts.get(connId) ?? { fails: 0, lockedUntil: 0 };
      if (a.lockedUntil > t) return { ok: false, message: 'locked' };
      if (a.lockedUntil) {
        // Lockout served: start a fresh window.
        a.fails = 0;
        a.lockedUntil = 0;
      }
      // Always run the compare (no early exit that would reveal the account rule's timing).
      const match = timingSafeEqual(digest(typeof given === 'string' ? given : ''), expected);
      const accountOk = accounts.length === 0 || (!!account && accounts.includes(account.trim().toLowerCase()));
      if (match && accountOk) {
        attempts.delete(connId);
        return { ok: true };
      }
      a.fails++;
      if (a.fails >= maxFails) a.lockedUntil = t + lockoutMs;
      attempts.set(connId, a);
      return { ok: false, message: a.lockedUntil > t ? 'locked' : 'denied' };
    },
    forget(connId) {
      attempts.delete(connId);
    },
  };
}
