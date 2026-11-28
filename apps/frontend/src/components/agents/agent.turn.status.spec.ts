import { describe, expect, it } from 'vitest';
import type { MessagesProps } from '@copilotkit/react-ui';
import { deriveAgentTurnStatus, hasUnansweredTurn } from './agent.turn.status';

type ChatMessage = MessagesProps['messages'][number];

const userMessage: ChatMessage = {
  id: 'user-1',
  role: 'user',
  content: 'Delete the scheduled post',
};

const runningToolMessage: ChatMessage = {
  id: 'assistant-1',
  role: 'assistant',
  toolCalls: [
    {
      id: 'tool-call-1',
      type: 'function',
      function: { name: 'customToolX', arguments: '{}' },
    },
  ],
};

const toolResultMessage: ChatMessage = {
  id: 'tool-result-1',
  role: 'tool',
  toolCallId: 'tool-call-1',
  content: 'done',
};

const writingMessage: ChatMessage = {
  id: 'assistant-2',
  role: 'assistant',
  content: 'The post is deleted.',
};

describe('agent turn status', () => {
  it('[TC-2-32-1] derives generic statuses from message roles and tool results', () => {
    const thinking = deriveAgentTurnStatus([userMessage], true);
    const runningTool = deriveAgentTurnStatus(
      [userMessage, runningToolMessage],
      true
    );
    const waiting = deriveAgentTurnStatus(
      [userMessage, runningToolMessage, toolResultMessage],
      true
    );
    const writing = deriveAgentTurnStatus([userMessage, writingMessage], true);
    const idle = deriveAgentTurnStatus([userMessage, writingMessage], false);

    expect(thinking).toBe('thinking');
    expect(runningTool).toBe('running-tool');
    expect(waiting).toBe('waiting');
    expect(writing).toBe('writing');
    expect(idle).toBe('idle');
  });

  it('[TC-2-32-2] detects a turn that ended without assistant text', () => {
    const unanswered = hasUnansweredTurn([
      userMessage,
      runningToolMessage,
      toolResultMessage,
    ]);
    const answered = hasUnansweredTurn([userMessage, writingMessage]);

    expect(unanswered).toBe(true);
    expect(answered).toBe(false);
  });
});
