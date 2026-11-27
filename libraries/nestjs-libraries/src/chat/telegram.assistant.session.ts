export const DEFAULT_IDLE_MINUTES = 60;
export const MAX_IDLE_MINUTES = 10080;

export function parseTelegramIdleMinutes(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_IDLE_MINUTES;
  }
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return DEFAULT_IDLE_MINUTES;
  }
  const minutes = Number(trimmed);
  if (
    !Number.isSafeInteger(minutes) ||
    minutes <= 0 ||
    minutes > MAX_IDLE_MINUTES
  ) {
    return DEFAULT_IDLE_MINUTES;
  }
  return minutes;
}

export function shouldResetIdleSession(
  lastActiveAt: Date | null | undefined,
  now: Date,
  idleMs: number
): boolean {
  if (!lastActiveAt || idleMs <= 0) {
    return false;
  }
  return now.getTime() - lastActiveAt.getTime() >= idleMs;
}
