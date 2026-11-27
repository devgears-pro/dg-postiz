import type { ProcessInputStepArgs, Processor } from '@mastra/core/processors';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);

export class AgentTimeProcessor implements Processor {
  readonly id = 'agent-time';

  async processInputStep({
    stepNumber,
    sendSignal,
  }: ProcessInputStepArgs): Promise<void> {
    if (stepNumber !== 0) return;

    const currentTime = dayjs.utc().format('YYYY-MM-DD HH:mm:ss');

    await sendSignal?.({
      id: 'agent-time',
      type: 'reactive',
      contents: `Current time (UTC): ${currentTime}. Use it to resolve relative dates and scheduling times.`,
      attributes: { type: 'current-time' },
      transient: true,
    });
  }
}
