import { ForbiddenException } from '@nestjs/common';

export type ThreadLookup = {
  getThreadById(args: {
    threadId: string;
  }): Promise<{ resourceId?: string } | null>;
};

export const buildSessionId = (
  organizationId: string,
  threadId: string
): string => `${organizationId}:${threadId}`;

export const assertThreadAccess = async (
  memory: ThreadLookup | undefined,
  organizationId: string,
  threadId: string | undefined
): Promise<void> => {
  if (!threadId || !memory) return;

  const thread = await memory.getThreadById({ threadId });
  if (thread && thread.resourceId !== organizationId) {
    throw new ForbiddenException(
      'The conversation belongs to another organization'
    );
  }
};
