import { describe, expect, it } from 'vitest';
import { shouldPollTitles } from './agent.titles';

describe('agent thread title polling', () => {
  const now = 1_000_000;
  const openUntil = now + 30_000;

  it('polls while a conversation has no title', () => {
    expect(
      shouldPollTitles(
        [
          { id: 'thread-1', title: 'Planning' },
          { id: 'thread-2', title: '' },
        ],
        openUntil,
        now
      )
    ).toBe(true);
  });

  it('stops when every conversation has a title', () => {
    expect(
      shouldPollTitles([{ id: 'thread-1', title: 'Planning' }], openUntil, now)
    ).toBe(false);
  });

  it('[TC-2-21-3] stops polling when the window expires', () => {
    expect(
      shouldPollTitles([{ id: 'thread-1', title: '' }], openUntil, openUntil)
    ).toBe(false);
  });
});
