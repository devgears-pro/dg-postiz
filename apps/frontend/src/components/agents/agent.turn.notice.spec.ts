import { describe, expect, it } from 'vitest';
import type { MessagesProps } from '@copilotkit/react-ui';
import { turnNotice } from './agent.turn.notice';

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

describe('agent turn notice', () => {
  it('[TC-2-32-2] reports the limit when the turn exhausts the step budget', () => {
    const limit = turnNotice(
      [
        userMessage,
        ...Array.from({ length: 10 }, (_, index) => ({
          id: `assistant-${index}`,
          role: 'assistant' as const,
          content: `Step ${index}`,
          toolCalls: [
            {
              id: `tool-call-${index}`,
              type: 'function' as const,
              function: { name: 'customToolX', arguments: '{}' },
            },
          ],
        })),
      ],
      10
    );
    const within = turnNotice([userMessage, writingMessage], 10);
    const merged = turnNotice(
      [
        userMessage,
        {
          id: 'assistant-merged',
          role: 'assistant' as const,
          toolCalls: Array.from({ length: 10 }, (_, index) => ({
            id: `tool-call-merged-${index}`,
            type: 'function' as const,
            function: { name: 'customToolX', arguments: '{}' },
          })),
        },
      ],
      10
    );
    const empty = turnNotice(
      [userMessage, runningToolMessage, toolResultMessage],
      10
    );

    expect(limit).toBe('limit');
    expect(merged).toBe('limit');
    expect(within).toBeNull();
    expect(empty).toBe('empty');
  });
});
