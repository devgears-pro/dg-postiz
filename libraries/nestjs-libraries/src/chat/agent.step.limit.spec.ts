import { Test, type TestingModule } from '@nestjs/testing';
import { MastraLanguageModelV2Mock } from '@mastra/core/test-utils/llm-mock';
import { createTool } from '@mastra/core/tools';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('@gitroom/nestjs-libraries/chat/mastra.store', async () => {
  const { InMemoryStore } = await import('@mastra/core/storage');
  return { pStore: new InMemoryStore() };
});

import { resolveAgentConfig } from '@gitroom/helpers/agent/agent.config.schema';
import { loadAgentDefaults } from './agent.defaults';
import { AGENT_RUNTIME, type AgentRuntimeLike } from './agent.runtime.token';
import { LoadToolsService } from './load.tools.service';

const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };

type GenerateResult = Awaited<
  ReturnType<MastraLanguageModelV2Mock['doGenerate']>
>;

const textResponse = (text: string): GenerateResult => ({
  content: [{ type: 'text' as const, text }],
  finishReason: 'stop' as const,
  usage,
  warnings: [],
  request: {},
  response: undefined,
  stream: new ReadableStream(),
});

const toolCallResponse = (call: number): GenerateResult => ({
  content: [
    {
      type: 'tool-call' as const,
      toolCallId: `call-${call}`,
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
});

const echoTool = createTool({
  id: 'echo',
  description: 'Echo the input',
  inputSchema: z.object({ value: z.string() }),
  execute: async ({ value }) => ({ echoed: value }),
});

let testingModule: TestingModule | undefined;

afterEach(async () => {
  await testingModule?.close();
  testingModule = undefined;
});

const createAgent = async (model: MastraLanguageModelV2Mock) => {
  const defaults = await loadAgentDefaults({}, { toolCatalog: ['echo'] });
  const config = resolveAgentConfig(defaults, {}, 'org-1', 1);
  const runtime: AgentRuntimeLike = {
    ensurePrepared: async () => ({
      config,
      model,
      tools: { echo: echoTool },
      skills: [],
    }),
  };
  testingModule = await Test.createTestingModule({
    providers: [
      LoadToolsService,
      { provide: AGENT_RUNTIME, useValue: runtime },
    ],
  }).compile();

  return testingModule.get(LoadToolsService).agent();
};

describe('assistant step limit', () => {
  it('[TC-2-29-1] finishes a five-tool turn with text', async () => {
    let calls = 0;
    const model = new MastraLanguageModelV2Mock({
      provider: 'test',
      modelId: 'test',
      doGenerate: async () => {
        calls += 1;
        return calls <= 5 ? toolCallResponse(calls) : textResponse('all done');
      },
    });
    const agent = await createAgent(model);

    const result = await agent.generate('schedule the posts', {
      memory: { thread: 'thread-1', resource: 'org-1' },
    });

    expect(result.text).toBe('all done');
    expect(model.doGenerateCalls).toHaveLength(6);
  });
});
