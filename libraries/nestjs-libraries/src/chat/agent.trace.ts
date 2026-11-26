import {
  BadRequestException,
  ForbiddenException,
  Logger,
  NotFoundException,
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

const RUN_METHODS = new Set(['agent/run', 'agent/suggest', 'agent/connect']);

const readValidThreadId = (value: unknown): string => {
  if (typeof value !== 'string' || !THREAD_ID_PATTERN.test(value)) {
    throw new BadRequestException('Invalid conversation id');
  }

  return value;
};

export const readThreadId = (payload: unknown): string | undefined => {
  if (!payload || typeof payload !== 'object') return undefined;

  const threadId = (payload as { threadId?: unknown }).threadId;
  if (threadId === undefined) return undefined;

  return readValidThreadId(threadId);
};

export const readRequestThreadId = (
  method: unknown,
  rawBody: unknown,
  rawParams: unknown
): string | undefined => {
  if (method === 'agent/stop') {
    if (!rawParams || typeof rawParams !== 'object') {
      throw new BadRequestException('Invalid run payload');
    }

    return readValidThreadId((rawParams as { threadId?: unknown }).threadId);
  }

  if (typeof method !== 'string' || !RUN_METHODS.has(method)) return undefined;

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

  const threadId = readThreadId(payload);
  if (!threadId) {
    throw new BadRequestException('Invalid conversation id');
  }

  return threadId;
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

export const loadThreadMemory = async <T>(
  loader: () => Promise<T | undefined>
): Promise<T | undefined> => {
  try {
    return await loader();
  } catch (error) {
    Logger.warn(`Could not load the conversation store: ${error}`);
    throw new ServiceUnavailableException('Could not verify the conversation');
  }
};

export const assertThreadAccess = async (
  memory: ThreadLookup | undefined,
  organizationId: string,
  threadId: string | undefined
): Promise<void> => {
  if (!threadId) return;

  if (!memory) {
    Logger.warn('The conversation store is not available');
    throw new ServiceUnavailableException('Could not verify the conversation');
  }

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

export const assertThreadExists = async (
  memory: ThreadLookup | undefined,
  organizationId: string,
  threadId: string
): Promise<void> => {
  if (!memory) {
    Logger.warn('The conversation store is not available');
    throw new ServiceUnavailableException('Could not verify the conversation');
  }

  let thread: { resourceId?: string } | null;
  try {
    thread = await memory.getThreadById({ threadId });
  } catch (error) {
    Logger.warn(`Could not verify the conversation ${threadId}: ${error}`);
    throw new ServiceUnavailableException('Could not verify the conversation');
  }

  if (!thread) {
    throw new NotFoundException('The conversation does not exist');
  }

  if (thread.resourceId !== organizationId) {
    throw new ForbiddenException(
      'The conversation belongs to another organization'
    );
  }
};
