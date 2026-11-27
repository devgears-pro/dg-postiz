import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IDLE_MINUTES,
  parseTelegramIdleMinutes,
  shouldResetIdleSession,
} from './telegram.assistant.session';

const MINUTE_MS = 60_000;

describe('telegram assistant idle session', () => {
  it('returns false without a previous activity timestamp', () => {
    const now = new Date('2026-01-01T12:00:00.000Z');

    const reset = shouldResetIdleSession(null, now, 60 * MINUTE_MS);

    expect(reset).toBe(false);
  });

  it('ignores a non-positive idle window', () => {
    const now = new Date('2026-01-01T12:00:00.000Z');
    const lastActiveAt = new Date(now.getTime() - 60 * MINUTE_MS);

    const reset = shouldResetIdleSession(lastActiveAt, now, 0);

    expect(reset).toBe(false);
  });

  it('falls back to the default idle minutes when the value is missing', () => {
    const minutes = parseTelegramIdleMinutes(undefined);

    expect(minutes).toBe(DEFAULT_IDLE_MINUTES);
    expect(minutes).toBe(60);
  });

  it('parses a custom positive idle minutes value', () => {
    const minutes = parseTelegramIdleMinutes(' 15 ');

    expect(minutes).toBe(15);
  });

  it('falls back to the default idle minutes for an invalid value', () => {
    const minutes = parseTelegramIdleMinutes('15m');

    expect(minutes).toBe(DEFAULT_IDLE_MINUTES);
  });

  it('falls back to the default idle minutes for zero', () => {
    const minutes = parseTelegramIdleMinutes('0');

    expect(minutes).toBe(DEFAULT_IDLE_MINUTES);
  });

  it('accepts the maximum idle minutes cap', () => {
    const minutes = parseTelegramIdleMinutes('10080');

    expect(minutes).toBe(10080);
  });

  it('falls back to the default idle minutes above the cap', () => {
    const minutes = parseTelegramIdleMinutes('10081');

    expect(minutes).toBe(DEFAULT_IDLE_MINUTES);
  });
});
