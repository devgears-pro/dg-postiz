import { Agent } from '@mastra/core/agent';
import { InMemoryStore } from '@mastra/core/storage';
import { MastraLanguageModelV2Mock } from '@mastra/core/test-utils/llm-mock';
import { Memory } from '@mastra/memory';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderAgentInstructions } from './agent.prompt';
import { AgentTimeProcessor } from './agent.time.processor';

const instructions = renderAgentInstructions({
  prompt: 'Base instructions',
  ui: false,
});

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

const createAgent = (model: MastraLanguageModelV2Mock) =>
  new Agent({
    id: 'postiz',
    name: 'postiz',
    instructions,
    inputProcessors: [new AgentTimeProcessor()],
    model,
    memory: new Memory({ storage: new InMemoryStore() }),
  });

const count = (value: string, marker: string) => value.split(marker).length - 1;

describe('AgentTimeProcessor turns', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('[TC-14-4-1] keeps the prompt prefix stable and refreshes time after a pause', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-26T21:34:56Z'));
    const model = createModel();
    const agent = createAgent(model);

    await agent.generate('Schedule a post for tomorrow', {
      memory: { thread: 'thread-1', resource: 'org-1' },
    });
    vi.setSystemTime(new Date('2026-11-26T21:45:56Z'));
    await agent.generate('And one next week', {
      memory: { thread: 'thread-1', resource: 'org-1' },
    });

    const [first, second] = model.doGenerateCalls.map((call) => call.prompt);
    const promptText = (prompt: unknown) =>
      JSON.stringify(prompt).replaceAll('\\"', '"');
    const firstTurn = promptText(first);
    const secondTurn = promptText(second);
    const marker = '<system-reminder type="current-time">';

    expect(first[0]).toEqual(second[0]);
    expect(JSON.stringify(first[0])).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(count(firstTurn, marker)).toBe(1);
    expect(count(secondTurn, marker)).toBe(1);
    expect(firstTurn).toContain('Current time (UTC): 2026-11-26 21:34:56');
    expect(secondTurn).toContain('Current time (UTC): 2026-11-26 21:45:56');
    expect(secondTurn).not.toContain('2026-11-26 21:34:56');
    expect(second.slice(0, first.length - 1)).toEqual(first.slice(0, -1));
  });
});
