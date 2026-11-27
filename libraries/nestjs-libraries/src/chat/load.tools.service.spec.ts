import type { ModuleRef } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@gitroom/nestjs-libraries/chat/mastra.store', async () => {
  const { InMemoryStore } = await import('@mastra/core/storage');
  return { pStore: new InMemoryStore() };
});

import { LoadToolsService } from './load.tools.service';

describe('LoadToolsService agent', () => {
  it('[TC-14-2-2] registers the current-time processor', async () => {
    const service = new LoadToolsService({} as ModuleRef);

    const agent = await service.agent();
    const ids = await agent.getConfiguredProcessorIds();

    expect(ids.inputProcessorIds).toContain('agent-time');
  });
});
