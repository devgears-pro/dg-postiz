import { MastraAgent } from '@ag-ui/mastra';
import { Mastra } from '@mastra/core/mastra';
import { RequestContext } from '@mastra/core/di';
import { Agent } from '@mastra/core/agent';
import { InMemoryStore } from '@mastra/core/storage';
import {
  MastraLanguageModelV2Mock,
  simulateReadableStream,
} from '@mastra/core/test-utils/llm-mock';
import { createTool } from '@mastra/core/tools';
import { Memory } from '@mastra/memory';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('@gitroom/nestjs-libraries/chat/mastra.store', async () => {
  const { InMemoryStore } = await import('@mastra/core/storage');
  return { pStore: new InMemoryStore() };
});

import { AGENT_MEMORY_OPTIONS } from './load.tools.service';
import { AgentHistoryProcessor } from './agent.history.processor';

const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };

const toolCallStream = [
  { type: 'stream-start' as const, warnings: [] },
  { type: 'tool-input-start' as const, id: 'call-1', toolName: 'echo' },
  {
    type: 'tool-input-delta' as const,
    id: 'call-1',
    delta: '{"value":"hello"}',
  },
  { type: 'tool-input-end' as const, id: 'call-1' },
  {
    type: 'tool-call' as const,
    toolCallId: 'call-1',
    toolName: 'echo',
    input: '{"value":"hello"}',
  },
  { type: 'finish' as const, finishReason: 'tool-calls' as const, usage },
];

const textStream = (text: string) => [
  { type: 'stream-start' as const, warnings: [] },
  { type: 'text-start' as const, id: 'text-1' },
  { type: 'text-delta' as const, id: 'text-1', delta: text },
  { type: 'text-end' as const, id: 'text-1' },
  { type: 'finish' as const, finishReason: 'stop' as const, usage },
];

const echoTool = createTool({
  id: 'echo',
  description: 'Echo the input',
  inputSchema: z.object({ value: z.string() }),
  execute: async ({ value }) => ({ echoed: value }),
});

const drain = (observable: {
  subscribe: (observer: {
    next: () => void;
    error: (error: unknown) => void;
    complete: () => void;
  }) => unknown;
}) =>
  new Promise<void>((resolve, reject) => {
    observable.subscribe({
      next: () => undefined,
      error: reject,
      complete: resolve,
    });
  });

describe('AG-UI assistant history', () => {
  /**
   * @req [REQ-2-27] Незмінний префікс діалогу між ходами
   *
   * ДАНО AG-UI агент з інструментом echo, перший запуск якого на
   * повідомлення "first user" викликає echo({"value":"hello"}) і стрімить
   * відповідь "streamed-final-answer",
   * КОЛИ другий запуск отримує історію ["first user", "streamed-final-answer",
   * "second user"],
   * ТОДІ промпт другого запуску містить "streamed-final-answer" між
   * "first user" і "second user".
   */
  it('[TC-2-27-9] keeps a streamed assistant answer in the next request', async () => {
    let streamCall = 0;
    const streams = [
      toolCallStream,
      textStream('streamed-final-answer'),
      textStream('second-answer'),
    ];
    const model = new MastraLanguageModelV2Mock({
      provider: 'test',
      modelId: 'test',
      doStream: async () => ({
        stream: simulateReadableStream({ chunks: streams[streamCall++] }),
      }),
    });
    const memory = new Memory({
      storage: new InMemoryStore(),
      options: {
        generateTitle: false,
        ...AGENT_MEMORY_OPTIONS,
      },
    });
    const memoryStore = await memory.storage.getStore('memory');
    if (!memoryStore) throw new Error('memory store is unavailable');
    const agent = new Agent({
      id: 'postiz',
      name: 'postiz',
      instructions: 'Base instructions',
      model,
      tools: { echo: echoTool },
      defaultOptions: { maxSteps: 5 },
      inputProcessors: [new AgentHistoryProcessor(memoryStore)],
      memory,
    });
    const adapter = MastraAgent.getLocalAgent({
      mastra: new Mastra({ agents: { postiz: agent } }),
      agentId: 'postiz',
      resourceId: 'org-1',
      requestContext: new RequestContext(),
    });

    await drain(
      adapter.run({
        threadId: 'thread-1',
        runId: 'run-1',
        messages: [{ id: 'm1', role: 'user', content: 'first user' }],
        tools: [],
        context: [],
        state: {},
        forwardedProps: {},
      })
    );
    await drain(
      adapter.run({
        threadId: 'thread-1',
        runId: 'run-2',
        messages: [
          { id: 'm1', role: 'user', content: 'first user' },
          {
            id: 'a1',
            role: 'assistant',
            content: 'streamed-final-answer',
          },
          { id: 'm2', role: 'user', content: 'second user' },
        ],
        tools: [],
        context: [],
        state: {},
        forwardedProps: {},
      })
    );

    const secondTurn = JSON.stringify(model.doStreamCalls[2]?.prompt);

    expect(secondTurn).toContain('first user');
    expect(secondTurn).toContain('streamed-final-answer');
    expect(secondTurn).toContain('second user');
  });
});
