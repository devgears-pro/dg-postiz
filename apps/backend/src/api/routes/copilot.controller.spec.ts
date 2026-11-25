import { ForbiddenException } from '@nestjs/common';
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

vi.mock(
  '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service',
  () => ({ SubscriptionService: class {} })
);

import { CopilotController } from './copilot.controller';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { MastraService } from '@gitroom/nestjs-libraries/chat/mastra.service';
import { AgentRuntimeService } from '@gitroom/nestjs-libraries/chat/agent.runtime';

const buildController = (resourceId: string) => {
  const getThreadById = vi.fn(async () => ({ resourceId }));
  const prepare = vi.fn(async () => ({
    applyTo: vi.fn(),
    release: async () => undefined,
  }));
  const mastra = {
    getAgent: () => ({
      getMemory: async () => ({ getThreadById }),
    }),
  };
  const controller = new CopilotController(
    {} as SubscriptionService,
    { mastra: async () => mastra } as unknown as MastraService,
    { prepare } as unknown as AgentRuntimeService
  );

  return { controller, prepare, getThreadById };
};

const runRequest = (threadId: string) =>
  ({
    body: { method: 'agent/run', body: { threadId } },
  } as Request);

const response = () => ({ on: vi.fn() } as unknown as Response);

const organization = { id: 'org-1' } as Organization;
const user = { id: 'user-1' } as User;

describe('CopilotController telemetry context', () => {
  it('[TC-2-10-2] passes the authenticated user into the request context', async () => {
    const { controller } = buildController('org-1');
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
});
