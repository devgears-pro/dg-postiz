'use client';

import React from 'react';
import type { RenderMessageProps } from '@copilotkit/react-ui';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { AgentTurnNotice, turnNotice } from './agent.turn.notice';

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

export const AgentRenderMessage = (
  props: RenderMessageProps & { maxSteps: number }
) => {
  const notice =
    props.inProgress || !props.isCurrentMessage
      ? null
      : turnNotice(props.messages, props.maxSteps);
  const rendered = renderMessage(props);

  if (!props.isCurrentMessage) {
    return rendered;
  }

  return (
    <>
      {rendered}
      {notice ? <TurnNotice notice={notice} /> : null}
    </>
  );
};
