import { Agent } from '@mastra/core/agent';
import { InMemoryStore } from '@mastra/core/storage';
import {
  MastraLanguageModelV2Mock,
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

const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };

const textResponse = (text: string) => ({
  content: [{ type: 'text' as const, text }],
  finishReason: 'stop' as const,
  usage,
  warnings: [],
  request: {},
  response: undefined,
  stream: new ReadableStream(),
});

const toolCallResponse = {
  content: [
    {
      type: 'tool-call' as const,
      toolCallId: 'call-1',
      toolName: 'echo',
      input: '{"value":"hello"}',
    },
  ],
  finishReason: 'tool-calls' as const,
  usage,
  warnings: [],
  request: {},
  response: undefined,
  stream: new ReadableStream(),
};

const echoTool = createTool({
  id: 'echo',
  description: 'Echo the input',
  inputSchema: z.object({ value: z.string() }),
  execute: async ({ value }) => ({ echoed: value }),
});

const createMemory = () =>
  new Memory({
    storage: new InMemoryStore(),
    options: {
      generateTitle: false,
      ...AGENT_MEMORY_OPTIONS,
    },
  });

describe('assistant answer history', () => {
  it('keeps the assistant answer after a tool call', async () => {
    let call = 0;
    const responses = [
      toolCallResponse,
      textResponse('first-final-answer'),
      textResponse('second-answer'),
    ];
    const model = new MastraLanguageModelV2Mock({
      provider: 'test',
      modelId: 'test',
      doGenerate: async () => responses[call++],
    });
    const agent = new Agent({
      id: 'postiz-answer-history-test',
      name: 'postiz-answer-history-test',
      instructions: 'Base instructions',
      model,
      tools: { echo: echoTool },
      defaultOptions: { maxSteps: 5 },
      memory: createMemory(),
    });

    await agent.generate('first user', {
      memory: { thread: 'thread-1', resource: 'org-1' },
    });

    await agent.generate('second user', {
      memory: { thread: 'thread-1', resource: 'org-1' },
    });

    const prompts = model.doGenerateCalls.map((item) => item.prompt);
    const secondTurn = JSON.stringify(prompts[2]);

    expect(secondTurn).toContain('first user');
    expect(secondTurn).toContain('first-final-answer');
    expect(secondTurn).toContain('second user');
  });
});
