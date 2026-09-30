// http-util: client IP resolution behind proxies and the sliding-window limiter.

import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { clientIp, RateLimiter } from '../../src/server/http-util';

function req(headers: Record<string, string>, remote = '10.0.0.9'): IncomingMessage {
  return { headers, socket: { remoteAddress: remote } } as unknown as IncomingMessage;
}

describe('clientIp', () => {
  it('uses the socket address unless proxies are trusted', () => {
    expect(clientIp(req({ 'x-forwarded-for': '1.2.3.4' }, '::ffff:127.0.0.1'), { trust: false })).toBe('127.0.0.1');
  });

  it('platform mode prefers edge client-IP headers, then the left-most X-Forwarded-For', () => {
    expect(clientIp(req({ 'fly-client-ip': '5.6.7.8', 'x-forwarded-for': '1.1.1.1' }), { trust: true })).toBe('5.6.7.8');
    expect(clientIp(req({ 'cf-connecting-ip': '2001:db8::1', 'x-forwarded-for': '9.9.9.9, 172.64.0.1' }), { trust: true })).toBe('2001:db8::1');
    expect(clientIp(req({ 'x-forwarded-for': '9.9.9.9, 172.64.0.1' }), { trust: true })).toBe('9.9.9.9');
    // Garbage headers are ignored.
    expect(clientIp(req({ 'true-client-ip': 'not-an-ip', 'x-forwarded-for': 'junk, 8.8.4.4' }), { trust: true })).toBe('8.8.4.4');
    expect(clientIp(req({}), { trust: true })).toBe('10.0.0.9');
  });

  it('strict mode counts trusted hops from the right (spoofed entries ignored)', () => {
    const r = req({ 'x-forwarded-for': '6.6.6.6, 1.2.3.4, 172.64.0.1', 'cf-connecting-ip': '6.6.6.6' });
    expect(clientIp(r, { trust: true, hops: 1 })).toBe('172.64.0.1');
    expect(clientIp(r, { trust: true, hops: 2 })).toBe('1.2.3.4');
    expect(clientIp(r, { trust: true, hops: 9 })).toBe('6.6.6.6');
  });
});

describe('RateLimiter', () => {
  it('allows `limit` hits per window per key and reports the wait', () => {
    const clock = { t: 0 };
    const rl = new RateLimiter(3, 1000, () => clock.t);
    expect([rl.hit('a'), rl.hit('a'), rl.hit('a')]).toEqual([0, 0, 0]);
    expect(rl.hit('a')).toBe(1000);
    expect(rl.hit('b')).toBe(0);
    clock.t = 400;
    expect(rl.hit('a')).toBe(600);
    clock.t = 1000;
    expect(rl.hit('a')).toBe(0);
    clock.t = 5000;
    rl.prune();
    expect(rl.size).toBe(0);
  });

  it('bounds memory under key churn', () => {
    const rl = new RateLimiter(1, 60_000, () => 0, 100);
    for (let i = 0; i < 1000; i++) rl.hit(`k${i}`);
    expect(rl.size).toBeLessThanOrEqual(101);
  });
});
