import type { MessagesProps } from '@copilotkit/react-ui';

type AgentTurnMessage = MessagesProps['messages'][number];

export type AgentTurnNotice = 'empty' | 'limit' | null;

const lastUserIndex = (messages: AgentTurnMessage[]): number => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') {
      return index;
    }
  }
  return -1;
};

const turnSteps = (messages: AgentTurnMessage[]): number =>
  messages.reduce((steps, message) => {
    if (message.role !== 'assistant') {
      return steps;
    }
    if (message.content?.trim()) {
      return steps + 1;
    }
    return steps + (message.toolCalls?.length ?? 0);
  }, 0);

export function turnNotice(
  messages: AgentTurnMessage[],
  maxSteps: number
): AgentTurnNotice {
  const lastUser = lastUserIndex(messages);
  if (lastUser < 0) {
    return null;
  }

  const turn = messages.slice(lastUser + 1);
  if (maxSteps > 0 && turnSteps(turn) >= maxSteps) {
    return 'limit';
  }
  const hasText = turn.some(
    (message) => message.role === 'assistant' && Boolean(message.content?.trim())
  );
  return hasText ? null : 'empty';
}
