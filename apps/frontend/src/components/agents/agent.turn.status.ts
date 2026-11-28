import type { MessagesProps } from '@copilotkit/react-ui';

export type AgentTurnMessage = MessagesProps['messages'][number];

export type AgentTurnStatus =
  | 'idle'
  | 'thinking'
  | 'running-tool'
  | 'waiting'
  | 'writing';

const hasToolResult = (
  messages: AgentTurnMessage[],
  toolCallId: string
): boolean =>
  messages.some(
    (message) => message.role === 'tool' && message.toolCallId === toolCallId
  );

export function deriveAgentTurnStatus(
  messages: AgentTurnMessage[],
  isLoading: boolean
): AgentTurnStatus {
  if (!isLoading) {
    return 'idle';
  }

  const last = messages[messages.length - 1];
  if (!last) {
    return 'thinking';
  }
  if (last.role === 'assistant') {
    if (last.content?.trim()) {
      return 'writing';
    }
    const pendingToolCall = last.toolCalls?.some(
      (call) => !hasToolResult(messages, call.id)
    );
    return pendingToolCall ? 'running-tool' : 'thinking';
  }
  if (last.role === 'tool') {
    return 'waiting';
  }
  return 'thinking';
}

export function hasUnansweredTurn(messages: AgentTurnMessage[]): boolean {
  let lastUser = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') {
      lastUser = index;
      break;
    }
  }
  if (lastUser < 0) {
    return false;
  }

  return !messages
    .slice(lastUser + 1)
    .some(
      (message) =>
        message.role === 'assistant' && Boolean(message.content?.trim())
    );
}
