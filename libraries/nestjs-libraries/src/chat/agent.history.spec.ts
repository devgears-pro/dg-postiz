import { Agent, MessageList, type MastraDBMessage } from '@mastra/core/agent';
import { InMemoryStore } from '@mastra/core/storage';
import { MastraLanguageModelV2Mock } from '@mastra/core/test-utils/llm-mock';
import { Memory } from '@mastra/memory';
import { RequestContext } from '@mastra/core/di';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@gitroom/nestjs-libraries/chat/mastra.store', async () => {
  const { InMemoryStore } = await import('@mastra/core/storage');
  return { pStore: new InMemoryStore() };
});

import { AGENT_MEMORY_OPTIONS } from './load.tools.service';
import { AgentHistoryProcessor } from './agent.history.processor';

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

  it('keeps the stored assistant text when the input repeats the same message id', async () => {
    const store = new InMemoryStore();
    const memoryStore = await store.getStore('memory');
    if (!memoryStore) throw new Error('memory store is unavailable');
    const threadId = 'thread-dedup';
    const resourceId = 'org-1';
    await memoryStore.saveThread({
      thread: {
        id: threadId,
        resourceId,
        title: '',
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const toolPart = {
      type: 'tool-invocation' as const,
      toolInvocation: {
        state: 'result' as const,
        toolCallId: 'call-1',
        toolName: 'echo',
        args: { value: 'hello' },
        result: { echoed: 'hello' },
      },
    };
    const stored: MastraDBMessage = {
      id: 'msg-1',
      role: 'assistant',
      createdAt: new Date('2026-11-27T18:00:00Z'),
      threadId,
      resourceId,
      type: 'v2',
      content: {
        format: 2,
        parts: [toolPart, { type: 'text', text: 'final answer' }],
      },
    };
    await memoryStore.saveMessages({ messages: [stored] });
    const history = new AgentHistoryProcessor(memoryStore);
    const list = new MessageList();
    list.add(
      {
        ...stored,
        createdAt: new Date('2026-11-27T19:00:00Z'),
        content: { format: 2, parts: [toolPart] },
      },
      'input'
    );
    const requestContext = new RequestContext();
    requestContext.set('MastraMemory', {
      thread: { id: threadId },
      resourceId,
    });

    await history.processInput({ messageList: list, requestContext });

    const result = list.get.all.db().find((message) => message.id === 'msg-1');
    const prompt = JSON.stringify(result);

    expect(prompt).toContain('final answer');
    expect(result?.createdAt).toEqual(stored.createdAt);
  });
});
