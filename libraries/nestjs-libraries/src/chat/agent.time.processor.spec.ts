import { MessageList } from '@mastra/core/agent/message-list';
import {
  createProcessorSendSignal,
  type ProcessInputStepArgs,
} from '@mastra/core/processors';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentTimeProcessor } from './agent.time.processor';

const processor = new AgentTimeProcessor();

const buildArgs = (
  stepNumber: number,
  sendSignal?: ProcessInputStepArgs['sendSignal']
) => ({ stepNumber, sendSignal } as unknown as ProcessInputStepArgs);

describe('AgentTimeProcessor', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('[TC-14-2-1] adds a transient current-time reminder to the model input', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-26T21:34:56Z'));
    const messageList = new MessageList();
    messageList.add(
      { role: 'user', content: 'Schedule a post for tomorrow' },
      'input'
    );
    const sendSignal = createProcessorSendSignal({ messageList });

    await processor.processInputStep(buildArgs(0, sendSignal));

    const last = messageList.get.all.prompt().at(-1);
    const text = (
      (last?.content as Array<{ type: string; text?: string }>) ?? []
    )
      .map((part) => part.text ?? '')
      .join('');
    const stored = messageList.get.all.db().at(-1);
    const metadata = stored?.content.metadata as
      | { signal?: { transient?: boolean } }
      | undefined;

    expect(text).toContain('<system-reminder type="current-time">');
    expect(text).toMatch(/Current time \(UTC\): 2026-11-26 21:34:56/);
    expect(text.split('<system-reminder type="current-time">')).toHaveLength(2);
    expect(metadata?.signal?.transient).toBe(true);
  });

  it('[TC-14-3-1] sends no additional time signal after the first step', async () => {
    const sendSignal = vi.fn().mockResolvedValue(undefined);

    await processor.processInputStep(buildArgs(1, sendSignal));

    expect(sendSignal).not.toHaveBeenCalled();
  });
});
