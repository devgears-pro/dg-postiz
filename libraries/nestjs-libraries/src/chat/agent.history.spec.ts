import { Agent } from '@mastra/core/agent';
import { InMemoryStore } from '@mastra/core/storage';
import { MastraLanguageModelV2Mock } from '@mastra/core/test-utils/llm-mock';
import { Memory } from '@mastra/memory';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@gitroom/nestjs-libraries/chat/mastra.store', async () => {
  const { InMemoryStore } = await import('@mastra/core/storage');
  return { pStore: new InMemoryStore() };
});

import { AGENT_MEMORY_OPTIONS } from './load.tools.service';

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

describe('agent dialog history', () => {
  /**
   * @req [REQ-2-27] Незмінний префікс діалогу між ходами
   *
   * ДАНО діалог із вісьмома ходами, що дає більше десяти повідомлень
   * КОЛИ користувач надсилає восьме повідомлення
   * ТОДІ перше повідомлення діалогу досі присутнє в запиті,
   * а початок запиту збігається з попереднім ходом
   */
  it('[TC-2-27-8] keeps the full dialog history between turns', async () => {
    const model = createModel();
    const memory = new Memory({
      storage: new InMemoryStore(),
      options: {
        generateTitle: false,
        ...AGENT_MEMORY_OPTIONS,
      },
    });
    const agent = new Agent({
      id: 'postiz-history-test',
      name: 'postiz-history-test',
      instructions: 'Base instructions',
      model,
      memory,
    });

    for (let turn = 0; turn < 8; turn++) {
      await agent.generate(`message ${turn}`, {
        memory: { thread: 'thread-1', resource: 'org-1' },
      });
    }

    const prompts = model.doGenerateCalls.map((call) => call.prompt);
    const first = JSON.stringify(prompts[0]);
    const last = JSON.stringify(prompts[7]);

    expect(last).toContain('message 0');
    expect(last).toContain('message 7');
    expect(prompts[0][0]).toEqual(prompts[7][0]);
    expect(prompts[7].slice(0, prompts[0].length)).toEqual(prompts[0]);
    expect(first).toContain('message 0');
  });
});
