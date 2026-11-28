'use client';

import React, { createContext, ReactNode, useContext } from 'react';
import type { RenderMessageProps } from '@copilotkit/react-ui';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { AgentTurnNotice, turnNotice } from './agent.turn.notice';
import { AgentTurnStatus, deriveAgentTurnStatus } from './agent.turn.status';

const AgentTurnContext = createContext<{ maxSteps: number }>({ maxSteps: 10 });

export const AgentTurnProvider = ({
  maxSteps,
  children,
}: {
  maxSteps: number;
  children: ReactNode;
}) => (
  <AgentTurnContext.Provider value={{ maxSteps }}>
    {children}
  </AgentTurnContext.Provider>
);

const STATUS_LABELS: Record<
  Exclude<AgentTurnStatus, 'idle'>,
  [key: string, fallback: string]
> = {
  thinking: ['agent_status_thinking', 'Thinking...'],
  'running-tool': ['agent_status_running_tool', 'Running an action...'],
  waiting: ['agent_status_waiting', 'Waiting for the result...'],
  writing: ['agent_status_writing', 'Writing...'],
};

const TurnStatus = ({ status }: { status: AgentTurnStatus }) => {
  const t = useT();
  if (status === 'idle') {
    return null;
  }
  const [key, fallback] = STATUS_LABELS[status];

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="agent-turn-status"
      className="px-[12px] py-[6px] text-[13px] opacity-70"
    >
      {t(key, fallback)}
    </div>
  );
};

const NOTICE_LABELS: Record<
  Exclude<AgentTurnNotice, null>,
  [key: string, fallback: string]
> = {
  empty: [
    'agent_empty_reply',
    'Could not compose a reply. Check the result in Postiz or retry the request.',
  ],
  limit: [
    'agent_turn_limit',
    'The step limit was reached. The answer may be incomplete.',
  ],
};

const TurnNotice = ({ notice }: { notice: Exclude<AgentTurnNotice, null> }) => {
  const t = useT();
  const [key, fallback] = NOTICE_LABELS[notice];

  return (
    <div
      role="status"
      data-testid={
        notice === 'limit'
          ? 'agent-turn-limit-notice'
          : 'agent-empty-reply-notice'
      }
      className="px-[12px] py-[6px] text-[13px] italic opacity-70"
    >
      {t(key, fallback)}
    </div>
  );
};

const renderMessage = (props: RenderMessageProps) => {
  const {
    message,
    messages,
    inProgress,
    index,
    isCurrentMessage,
    AssistantMessage,
    UserMessage,
    ImageRenderer,
    onRegenerate,
    onCopy,
    onThumbsUp,
    onThumbsDown,
    messageFeedback,
    markdownTagRenderers,
  } = props;

  if (message.role === 'user') {
    if (!UserMessage || !ImageRenderer) {
      return null;
    }
    return (
      <UserMessage
        key={index}
        rawData={message}
        message={message}
        ImageRenderer={ImageRenderer}
      />
    );
  }

  if (message.role === 'assistant') {
    if (!AssistantMessage) {
      return null;
    }
    return (
      <AssistantMessage
        key={index}
        subComponent={message.generativeUI?.()}
        rawData={message}
        message={message}
        messages={messages}
        isLoading={inProgress && isCurrentMessage && !message.content}
        isGenerating={
          inProgress && isCurrentMessage && Boolean(message.content)
        }
        isCurrentMessage={isCurrentMessage}
        onRegenerate={() => onRegenerate?.(message.id)}
        onCopy={onCopy}
        onThumbsUp={onThumbsUp}
        onThumbsDown={onThumbsDown}
        feedback={messageFeedback?.[message.id] || null}
        markdownTagRenderers={markdownTagRenderers}
        ImageRenderer={ImageRenderer}
      />
    );
  }

  return null;
};

export const AgentRenderMessage = (props: RenderMessageProps) => {
  const { maxSteps } = useContext(AgentTurnContext);
  const notice =
    props.inProgress || !props.isCurrentMessage
      ? null
      : turnNotice(props.messages, maxSteps);
  const rendered = renderMessage(props);

  if (!props.isCurrentMessage) {
    return rendered;
  }
  const status = deriveAgentTurnStatus(props.messages, props.inProgress);

  return (
    <>
      {rendered}
      {props.inProgress ? (
        <TurnStatus status={status} />
      ) : notice ? (
        <TurnNotice notice={notice} />
      ) : null}
    </>
  );
};
