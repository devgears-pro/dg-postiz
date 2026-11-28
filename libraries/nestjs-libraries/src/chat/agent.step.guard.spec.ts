import type { ModuleRef } from '@nestjs/core';
import { MastraLanguageModelV2Mock } from '@mastra/core/test-utils/llm-mock';
import { createTool } from '@mastra/core/tools';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('@gitroom/nestjs-libraries/chat/mastra.store', async () => {
  const { InMemoryStore } = await import('@mastra/core/storage');
  return { pStore: new InMemoryStore() };
});

import { resolveAgentConfig } from '@gitroom/helpers/agent/agent.config.schema';
import { loadAgentDefaults } from './agent.defaults';
import {
  AGENT_RUNTIME,
  type AgentRuntimeLike,
} from './agent.runtime.token';
import { LoadToolsService } from './load.tools.service';

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

const toolCallResponse = (call: number) => ({
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

const createAgent = async (
  model: MastraLanguageModelV2Mock,
  maxSteps?: number
) => {
  const defaults = await loadAgentDefaults({}, { toolCatalog: ['echo'] });
  const config = resolveAgentConfig(
    defaults,
    maxSteps ? { generation: { maxSteps } } : {},
    'org-1',
    1
  );
  const runtime: AgentRuntimeLike = {
    ensurePrepared: async () => ({
      config,
      model,
      tools: { echo: echoTool },
      skills: [],
    }),
  };
  const moduleRef = {
    get: (token: unknown) => (token === AGENT_RUNTIME ? runtime : undefined),
  } as unknown as ModuleRef;

  return new LoadToolsService(moduleRef).agent();
};

describe('assistant step guard', () => {
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

  it('[TC-2-30-1] forces text on the last step without changing tools', async () => {
    let calls = 0;
    const model = new MastraLanguageModelV2Mock({
      provider: 'test',
      modelId: 'test',
      doGenerate: async (options) => {
        if (options.toolChoice?.type === 'none') {
          return textResponse('forced answer');
        }
        calls += 1;
        return toolCallResponse(calls);
      },
    });
    const agent = await createAgent(model, 3);

    const result = await agent.generate('keep calling tools', {
      memory: { thread: 'thread-1', resource: 'org-1' },
    });

    expect(result.text).toBe('forced answer');
    expect(model.doGenerateCalls).toHaveLength(3);
    expect(model.doGenerateCalls[2].toolChoice).toEqual({ type: 'none' });
    expect(model.doGenerateCalls[1].tools).toEqual(
      model.doGenerateCalls[0].tools
    );
  });
});
