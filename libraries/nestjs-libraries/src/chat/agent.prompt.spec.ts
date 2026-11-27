import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderAgentInstructions } from './agent.prompt';

const base = {
  prompt: 'Base instructions',
  ui: true,
  client: 'web',
};

describe('renderAgentInstructions', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('[TC-14-1-1] keeps the system prompt identical at different times', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-26T23:59:59Z'));
    const first = renderAgentInstructions(base);
    vi.setSystemTime(new Date('2026-11-28T00:00:01Z'));

    const second = renderAgentInstructions(base);

    expect(second).toBe(first);
    expect(second).toContain('Base instructions');
    expect(second).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});
