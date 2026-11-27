import type { ModuleRef } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@gitroom/nestjs-libraries/chat/mastra.store', async () => {
  const { InMemoryStore } = await import('@mastra/core/storage');
  return { pStore: new InMemoryStore() };
});

import { LoadToolsService, resolveTitleModel } from './load.tools.service';

describe('LoadToolsService agent', () => {
  it('registers the current-time processor', async () => {
    const service = new LoadToolsService({} as ModuleRef);

    const agent = await service.agent();
    const ids = await agent.getConfiguredProcessorIds();

    expect(ids.inputProcessorIds).toContain('agent-time');
    expect(ids.inputProcessorIds).toContain('message-history');
  });

  it('delivers working memory as a state signal', async () => {
    const service = new LoadToolsService({} as ModuleRef);

    const agent = await service.agent();
    const memory = await agent.getMemory();
    const config = memory?.getMergedThreadConfig();

    expect(config?.workingMemory?.useStateSignals).toBe(true);
  });

  it('[TC-2-21-4] resolves the title model from context, environment and fallback', () => {
    const prepared = { modelId: 'prepared-model' };

    const fromContext = resolveTitleModel(
      { get: () => prepared },
      { POSTIZ_AI_TITLE_MODEL: 'dg-small' }
    );
    const fromTitleEnv = resolveTitleModel(undefined, {
      POSTIZ_AI_TITLE_MODEL: 'dg-small',
      POSTIZ_AI_MODEL: 'dg-multimodal',
    });
    const fromMainEnv = resolveTitleModel(undefined, {
      POSTIZ_AI_MODEL: 'dg-multimodal',
    });
    const fromFallback = resolveTitleModel(undefined, {});

    expect(fromContext).toBe(prepared);
    expect((fromTitleEnv as { modelId?: string }).modelId).toBe('dg-small');
    expect((fromMainEnv as { modelId?: string }).modelId).toBe('dg-multimodal');
    expect((fromFallback as { modelId?: string }).modelId).toBe('gpt-5.2');
  });
});
