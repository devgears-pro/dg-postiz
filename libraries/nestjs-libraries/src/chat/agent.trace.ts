import {
  BadRequestException,
  ForbiddenException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

export type ThreadLookup = {
  getThreadById(args: {
    threadId: string;
  }): Promise<{ resourceId?: string } | null>;
};

export type TraceIdentity = {
  organizationId: string;
  userId?: string;
  threadId?: string;
};

const THREAD_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export const readThreadId = (payload: unknown): string | undefined => {
  if (!payload || typeof payload !== 'object') return undefined;

  const threadId = (payload as { threadId?: unknown }).threadId;
  if (threadId === undefined) return undefined;

  if (typeof threadId !== 'string' || !THREAD_ID_PATTERN.test(threadId)) {
    throw new BadRequestException('Invalid conversation id');
  }

  return threadId;
};

export const readRunThreadId = (
  method: unknown,
  rawBody: unknown
): string | undefined => {
  if (method !== 'agent/run') return undefined;

  let payload: unknown = rawBody;
  if (typeof rawBody === 'string') {
    try {
      payload = JSON.parse(rawBody);
    } catch {
      throw new BadRequestException('Invalid run payload');
    }
  }

  if (!payload || typeof payload !== 'object') {
    throw new BadRequestException('Invalid run payload');
  }

  return readThreadId(payload);
};

export const buildSessionId = (
  organizationId: string,
  threadId: string
): string => `${organizationId}:${threadId}`;

export const applyTraceIdentity = (
  requestContext: {
    setRaw(key: string, value: unknown): void;
  },
  identity: TraceIdentity
): void => {
  const { organizationId, userId, threadId } = identity;

  if (threadId) {
    requestContext.setRaw('threadId', threadId);
    requestContext.setRaw(
      'sessionId',
      buildSessionId(organizationId, threadId)
    );
  }

  if (userId) requestContext.setRaw('userId', userId);
};

export const assertThreadAccess = async (
  memory: ThreadLookup | undefined,
  organizationId: string,
  threadId: string | undefined
): Promise<void> => {
  if (!threadId || !memory) return;

  let thread: { resourceId?: string } | null;
  try {
    thread = await memory.getThreadById({ threadId });
  } catch (error) {
    Logger.warn(`Could not verify the conversation ${threadId}: ${error}`);
    throw new ServiceUnavailableException('Could not verify the conversation');
  }

  if (thread && thread.resourceId !== organizationId) {
    throw new ForbiddenException(
      'The conversation belongs to another organization'
    );
  }
};
