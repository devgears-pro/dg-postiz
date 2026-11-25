import {
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { RequestContext } from '@mastra/core/di';
import { describe, expect, it } from 'vitest';
import {
  applyTraceIdentity,
  assertThreadAccess,
  buildSessionId,
  readRunThreadId,
  readThreadId,
  type ThreadLookup,
} from './agent.trace';

const memoryWith = (resourceId: string | null): ThreadLookup => ({
  getThreadById: async () => (resourceId === null ? null : { resourceId }),
});

const failingMemory: ThreadLookup = {
  getThreadById: async () => {
    throw new Error('The database is unavailable');
  },
};

describe('agent trace context', () => {
  it('[TC-2-11-1] prefixes the session id with the organization id', () => {
    const first = buildSessionId('org-1', 'thread-1');
    const second = buildSessionId('org-2', 'thread-1');
    const requestContext = new RequestContext();

    applyTraceIdentity(requestContext, {
      organizationId: 'org-1',
      userId: 'user-1',
      threadId: 'thread-1',
    });

    expect(first).toBe('org-1:thread-1');
    expect(first).not.toBe(second);
    expect(requestContext.getRaw('sessionId')).toBe('org-1:thread-1');
    expect(requestContext.getRaw('userId')).toBe('user-1');
    expect(requestContext.getRaw('threadId')).toBe('thread-1');
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
    await expect(
      assertThreadAccess(failingMemory, 'org-1', 'thread-1')
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('[TC-2-11-3] rejects an invalid conversation id', () => {
    const valid = () => readThreadId({ threadId: 'thread-1' });
    const withColon = () => readThreadId({ threadId: 'org-1:thread-1' });
    const tooLong = () => readThreadId({ threadId: 'a'.repeat(129) });
    const stopRequest = () => readRunThreadId('agent/stop', undefined);
    const stringBody = () =>
      readRunThreadId('agent/run', JSON.stringify({ threadId: 'thread-1' }));
    const missingBody = () => readRunThreadId('agent/run', undefined);

    expect(valid()).toBe('thread-1');
    expect(withColon).toThrow(BadRequestException);
    expect(tooLong).toThrow(BadRequestException);
    expect(stopRequest()).toBeUndefined();
    expect(stringBody()).toBe('thread-1');
    expect(missingBody).toThrow(BadRequestException);
  });
});
