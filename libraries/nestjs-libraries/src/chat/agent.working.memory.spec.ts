import { Agent } from '@mastra/core/agent';
import { InMemoryStore } from '@mastra/core/storage';
import { MastraLanguageModelV2Mock } from '@mastra/core/test-utils/llm-mock';
import { Memory } from '@mastra/memory';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@gitroom/nestjs-libraries/chat/mastra.store', async () => {
  const { InMemoryStore } = await import('@mastra/core/storage');
  return { pStore: new InMemoryStore() };
});

import { AGENT_WORKING_MEMORY } from './load.tools.service';

const createModel = () =>
  new MastraLanguageModelV2Mock({
    provider: 'test',
    modelId: 'test',
    doGenerate: {
      content: [{ type: 'text', text: 'ok' }],
      finishReason: 'stop',
      usage: { inputTokens: 10, outputTokens: 1, totalTokens: 11 },
      warnings: [],
      request: {},
      response: undefined,
      stream: new ReadableStream(),
    },
  });

describe('working memory delivery', () => {
  it('[TC-2-27-5] keeps the system prompt stable when working memory changes', async () => {
    const model = createModel();
    const memory = new Memory({
      storage: new InMemoryStore(),
      options: {
        generateTitle: false,
        workingMemory: AGENT_WORKING_MEMORY,
      },
    });
    const agent = new Agent({
      id: 'postiz-working-memory-test',
      name: 'postiz-working-memory-test',
      instructions: 'Base instructions',
      model,
      memory,
    });

    await agent.generate('first', {
      memory: { thread: 'thread-1', resource: 'org-1' },
    });
    await memory.updateWorkingMemory({
      threadId: 'thread-1',
      resourceId: 'org-1',
      workingMemory: JSON.stringify({ proverbs: ['stored-proverb'] }),
    });
    await agent.generate('later', {
      memory: { thread: 'thread-1', resource: 'org-1' },
    });

    const [first, second] = model.doGenerateCalls.map((call) => call.prompt);
    const systemOf = (prompt: typeof first) =>
      prompt.filter((message) => message.role === 'system');
    const last = second.at(-1);

    expect(systemOf(second)).toEqual(systemOf(first));
    expect(JSON.stringify(last)).toContain('<working-memory');
    expect(JSON.stringify(last)).toContain('stored-proverb');
  });
});
