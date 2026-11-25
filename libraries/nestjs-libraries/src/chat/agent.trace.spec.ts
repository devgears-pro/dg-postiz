import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  assertThreadAccess,
  buildSessionId,
  type ThreadLookup,
} from './agent.trace';

const memoryWith = (resourceId: string | null): ThreadLookup => ({
  getThreadById: async () =>
    resourceId === null ? null : { resourceId },
});

describe('agent trace context', () => {
  it('[TC-2-11-1] prefixes the session id with the organization id', () => {
    const organizationId = 'org-1';
    const threadId = 'thread-1';

    const sessionId = buildSessionId(organizationId, threadId);

    expect(sessionId).toBe('org-1:thread-1');
  });

  it('[TC-2-11-2] rejects a conversation of another organization', async () => {
    const foreign = memoryWith('org-2');
    const own = memoryWith('org-1');
    const missing = memoryWith(null);

    const rejection = assertThreadAccess(foreign, 'org-1', 'thread-1');

    await expect(rejection).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      assertThreadAccess(own, 'org-1', 'thread-1')
    ).resolves.toBeUndefined();
    await expect(
      assertThreadAccess(missing, 'org-1', 'thread-1')
    ).resolves.toBeUndefined();
  });
});
