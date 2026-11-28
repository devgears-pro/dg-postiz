import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Organization, User } from '@prisma/client';
import { RequestContext } from '@mastra/core/di';
import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

const getLocalAgents = vi.hoisted(() =>
  vi.fn((_options: { requestContext?: unknown }) => ({}))
);
const nodeHttpEndpoint = vi.hoisted(() => vi.fn(() => async () => undefined));

vi.mock('@ag-ui/mastra', () => ({
  MastraAgent: { getLocalAgents },
}));

vi.mock('@copilotkit/runtime', () => ({
  CopilotRuntime: class {
    constructor(_options: unknown) {}
  },
  EmptyAdapter: class {},
  OpenAIAdapter: class {},
  copilotRuntimeNodeHttpEndpoint: nodeHttpEndpoint,
}));

vi.mock('@gitroom/nestjs-libraries/chat/mastra.service', () => ({
  MastraService: class {},
}));

vi.mock('@gitroom/nestjs-libraries/chat/agent.runtime', () => ({
  AgentRuntimeService: class {},
}));

vi.mock('@gitroom/nestjs-libraries/chat/agent.config.service', () => ({
  AgentConfigService: class {},
}));

vi.mock(
  '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service',
  () => ({ SubscriptionService: class {} })
);

import { CopilotController } from './copilot.controller';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { MastraService } from '@gitroom/nestjs-libraries/chat/mastra.service';
import { AgentRuntimeService } from '@gitroom/nestjs-libraries/chat/agent.runtime';

const buildController = (resourceId: string | null) => {
  const memory = {
    getThreadById: vi.fn(async () =>
      resourceId === null ? null : { resourceId }
    ),
    listThreads: vi.fn(async () => ({
      threads: [],
      total: 0,
      page: 0,
      perPage: 100000,
      hasMore: false,
    })),
    updateThread: vi.fn(async ({ id, title }) => ({ id, title, resourceId })),
    deleteThread: vi.fn(async () => undefined),
    recall: vi.fn(async () => ({
      messages: [],
      total: 0,
      page: 0,
      perPage: false,
      hasMore: false,
    })),
  };
  const prepare = vi.fn(async () => ({
    applyTo: vi.fn(),
    release: async () => undefined,
  }));
  const getView = vi.fn(async () => ({
    effective: { generation: { maxSteps: 10 } },
  }));
  const mastra = {
    getAgent: () => ({
      getMemory: async () => memory,
    }),
  };
  const controller = new CopilotController(
    {} as SubscriptionService,
    { mastra: async () => mastra } as unknown as MastraService,
    { prepare } as unknown as AgentRuntimeService,
    { getView }
  );

  return { controller, prepare, memory, getView };
};

const runRequest = (threadId: string) =>
  ({
    body: { method: 'agent/run', body: { threadId } },
  } as Request);

const connectRequest = (threadId: string) =>
  ({
    body: { method: 'agent/connect', body: { threadId } },
  } as Request);

const stopRequest = (threadId: string) =>
  ({
    body: { method: 'agent/stop', params: { threadId } },
  } as Request);

const infoRequest = () => ({ body: { method: 'info' } } as Request);

const response = () => ({ on: vi.fn() } as unknown as Response);

const organization = { id: 'org-1' } as Organization;
const user = { id: 'user-1' } as User;

describe('CopilotController telemetry context', () => {
  it('[TC-2-10-2] passes the authenticated user into the request context', async () => {
    const { controller, prepare } = buildController('org-1');
    getLocalAgents.mockClear();

    await controller.agent(
      runRequest('thread-1'),
      response(),
      organization,
      user
    );

    const context = getLocalAgents.mock.calls.at(-1)?.[0]
      ?.requestContext as RequestContext;
    expect(context.getRaw('userId')).toBe('user-1');
    expect(context.getRaw('sessionId')).toBe('org-1:thread-1');
    expect(prepare).toHaveBeenCalledOnce();
  });

  it('[TC-2-11-4] rejects a foreign conversation before starting the agent', async () => {
    const { controller, prepare } = buildController('org-2');

    const request = controller.agent(
      runRequest('thread-1'),
      response(),
      organization,
      user
    );

    await expect(request).rejects.toBeInstanceOf(ForbiddenException);
    expect(prepare).not.toHaveBeenCalled();
  });

  it('[TC-2-26-1] serves info, connect and stop without preparing the agent', async () => {
    const { controller, prepare } = buildController('org-1');
    prepare.mockRejectedValue(new Error('The model is unavailable'));

    await controller.agent(infoRequest(), response(), organization, user);
    await controller.agent(
      connectRequest('thread-1'),
      response(),
      organization,
      user
    );
    await controller.agent(
      stopRequest('thread-1'),
      response(),
      organization,
      user
    );

    expect(prepare).not.toHaveBeenCalled();
  });
});

describe('CopilotController conversation management', () => {
  it('renames a conversation of the organization', async () => {
    const { controller, memory } = buildController('org-1');

    const result = await controller.renameThread(organization, 'thread-1', {
      title: '  Planning  ',
    });

    expect(memory.updateThread).toHaveBeenCalledWith({
      id: 'thread-1',
      title: 'Planning',
    });
    expect(result).toEqual({ id: 'thread-1', title: 'Planning' });
  });

  it('[TC-2-22-2] rejects an empty or too long conversation title', async () => {
    const { controller, memory } = buildController('org-1');

    await expect(
      controller.renameThread(organization, 'thread-1', { title: '   ' })
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.renameThread(organization, 'thread-1', {
        title: 'a'.repeat(201),
      })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(memory.updateThread).not.toHaveBeenCalled();
  });

  it('[TC-2-22-3] rejects renaming a foreign conversation', async () => {
    const { controller, memory } = buildController('org-2');

    await expect(
      controller.renameThread(organization, 'thread-1', { title: 'Planning' })
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(memory.updateThread).not.toHaveBeenCalled();
  });

  it('deletes a conversation of the organization', async () => {
    const { controller, memory } = buildController('org-1');

    const result = await controller.deleteThread(organization, 'thread-1');

    expect(memory.deleteThread).toHaveBeenCalledWith('thread-1');
    expect(result).toEqual({ id: 'thread-1' });
  });

  it('rejects an invalid conversation id before the store call', async () => {
    const { controller, memory } = buildController('org-1');

    await expect(
      controller.renameThread(organization, 'bad:id', { title: 'Planning' })
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.deleteThread(organization, 'bad:id')
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(memory.updateThread).not.toHaveBeenCalled();
    expect(memory.deleteThread).not.toHaveBeenCalled();
  });

  it('[TC-2-23-2] rejects deleting a foreign conversation', async () => {
    const { controller, memory } = buildController('org-2');

    await expect(
      controller.deleteThread(organization, 'thread-1')
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(memory.deleteThread).not.toHaveBeenCalled();
  });

  it('returns the full conversation history in chronological order', async () => {
    const { controller, memory } = buildController('org-1');
    memory.recall.mockResolvedValueOnce({
      messages: [
        { id: 'message-2', createdAt: new Date('2026-01-01T00:00:02Z') },
        { id: 'message-1', createdAt: new Date('2026-01-01T00:00:01Z') },
      ],
      total: 2,
      page: 0,
      perPage: 200,
      hasMore: false,
    });

    const result = await controller.getMessagesList(organization, 'thread-1');

    expect(memory.recall).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceId: 'org-1',
        threadId: 'thread-1',
        perPage: 200,
        orderBy: { field: 'createdAt', direction: 'DESC' },
      })
    );
    expect(result).toEqual(
      expect.objectContaining({
        messages: [
          expect.objectContaining({ id: 'message-1' }),
          expect.objectContaining({ id: 'message-2' }),
        ],
      })
    );
  });

  it('[TC-2-11-5] rejects reading a foreign conversation', async () => {
    const { controller, memory } = buildController('org-2');

    await expect(
      controller.getMessagesList(organization, 'thread-1')
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(memory.recall).not.toHaveBeenCalled();
  });

  it('accepts a conversation title of 200 characters', async () => {
    const { controller, memory } = buildController('org-1');
    const title = 'a'.repeat(200);

    await controller.renameThread(organization, 'thread-1', { title });

    expect(memory.updateThread).toHaveBeenCalledWith({
      id: 'thread-1',
      title,
    });
  });

  it('rejects renaming a missing conversation', async () => {
    const { controller, memory } = buildController(null);

    await expect(
      controller.renameThread(organization, 'thread-1', { title: 'Planning' })
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(memory.updateThread).not.toHaveBeenCalled();
  });

  it('rejects deleting a missing conversation', async () => {
    const { controller, memory } = buildController(null);

    await expect(
      controller.deleteThread(organization, 'thread-1')
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(memory.deleteThread).not.toHaveBeenCalled();
  });

  it('reports a history read failure', async () => {
    const { controller, memory } = buildController('org-1');
    memory.recall.mockRejectedValueOnce(
      new Error('The database is unavailable')
    );

    await expect(
      controller.getMessagesList(organization, 'thread-1')
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('[TC-2-33-2] exposes the effective step limit to the web chat', async () => {
    const { controller, getView } = buildController('org-1');

    const limits = await controller.limits(organization);

    expect(limits).toEqual({ maxSteps: 10 });
    expect(getView).toHaveBeenCalledWith('org-1');
  });
});
