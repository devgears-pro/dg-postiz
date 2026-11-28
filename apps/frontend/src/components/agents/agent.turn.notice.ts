import type { MessagesProps } from '@copilotkit/react-ui';

export type AgentTurnMessage = MessagesProps['messages'][number];

export type AgentTurnNotice = 'empty' | 'limit' | null;

const lastUserIndex = (messages: AgentTurnMessage[]): number => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') {
      return index;
    }
  }
  return -1;
};

const hasOutput = (message: AgentTurnMessage): boolean =>
  message.role === 'assistant' &&
  (Boolean(message.content?.trim()) || Boolean(message.toolCalls?.length));

export function turnNotice(
  messages: AgentTurnMessage[],
  maxSteps: number
): AgentTurnNotice {
  const lastUser = lastUserIndex(messages);
  if (lastUser < 0) {
    return null;
  }

  const turn = messages.slice(lastUser + 1);
  const producedOutput = turn.filter(hasOutput);
  if (maxSteps > 0 && producedOutput.length >= maxSteps) {
    return 'limit';
  }
  if (
    !producedOutput.some(
      (message) =>
        message.role === 'assistant' && Boolean(message.content?.trim())
    )
  ) {
    return 'empty';
  }
  return null;
}
