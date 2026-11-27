import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  useCopilotChatInternal,
  useCopilotContext,
} from '@copilotkit/react-core';
import AutoResizingTextarea from '@gitroom/frontend/components/agents/agent.textarea';
import { useChatContext, InputProps } from '@copilotkit/react-ui';
const MAX_NEWLINES = 6;

export const Input = ({
  inProgress,
  onSend,
  isVisible = false,
  onStop,
  onUpload,
  hideStopButton = false,
  onChange,
  onPasteFiles,
  hasAttachments = false,
}: InputProps & {
  onChange: (value: string) => void;
  onPasteFiles?: (files: File[]) => void;
  hasAttachments?: boolean;
}) => {
  const context = useChatContext();
  const copilotContext = useCopilotContext();
  const { interrupt, isAvailable: isReady, messages } =
    useCopilotChatInternal();
  const showPoweredBy = !copilotContext.copilotApiConfig?.publicApiKey;

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isComposing, setIsComposing] = useState(false);
  const [settledText, setSettledText] = useState<string | null>(null);
  const lastMessage = messages[messages.length - 1];
  const lastAssistantText = useMemo(() => {
    if (lastMessage?.role !== 'assistant') return '';
    const content: unknown = lastMessage.content;
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content
      .map((part: { type?: string; text?: string }) =>
        part.type === 'text' ? part.text ?? '' : ''
      )
      .join('');
  }, [lastMessage]);

  useEffect(() => {
    if (!inProgress || !lastAssistantText) return;
    const timer = setTimeout(() => setSettledText(lastAssistantText), 500);
    return () => clearTimeout(timer);
  }, [inProgress, lastAssistantText]);

  const handleDivClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;

    // If the user clicked a button or inside a button, don't focus the textarea
    if (target.closest('button')) return;

    // If the user clicked the textarea, do nothing (it's already focused)
    if (target.tagName === 'TEXTAREA') return;

    // Otherwise, focus the textarea
    textareaRef.current?.focus();
  };

  const [text, setText] = useState('');
  const textSettled =
    Boolean(lastAssistantText) && settledText === lastAssistantText;
  const send = () => {
    if ((inProgress && !textSettled) || !isReady) return;
    onSend(text);
    setText('');

    textareaRef.current?.focus();
  };

  const isInProgress = inProgress && !textSettled;
  const buttonIcon =
    isInProgress && !hideStopButton
      ? context.icons.stopIcon
      : context.icons.sendIcon;

  const canSend = useMemo(() => {
    return (
      isReady &&
      !isInProgress &&
      (text.trim().length > 0 || hasAttachments) &&
      !interrupt
    );
  }, [interrupt, isInProgress, isReady, text, hasAttachments]);

  const canStop = useMemo(() => {
    return isReady && isInProgress && !hideStopButton;
  }, [isReady, isInProgress, hideStopButton]);

  const sendDisabled = !canSend && !canStop;

  return (
    <div
      className={`copilotKitInputContainer ${
        showPoweredBy ? 'poweredByContainer' : ''
      }`}
    >
      <div className="copilotKitInput" onClick={handleDivClick}>
        <AutoResizingTextarea
          ref={textareaRef}
          placeholder={context.labels.placeholder}
          autoFocus={false}
          maxRows={MAX_NEWLINES}
          value={text}
          onChange={(event) => {
            onChange(event.target.value);
            setText(event.target.value);
          }}
          onCompositionStart={() => setIsComposing(true)}
          onCompositionEnd={() => setIsComposing(false)}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData?.files || []).filter(
              (file) => file.type.startsWith('image/')
            );
            if (!files.length || !onPasteFiles) {
              return;
            }
            event.preventDefault();
            onPasteFiles(files);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !isComposing) {
              event.preventDefault();
              if (canSend) {
                send();
              }
            }
          }}
        />
        <div className="copilotKitInputControls">
          {onUpload && (
            <button onClick={onUpload} className="copilotKitInputControlButton">
              {context.icons.uploadIcon}
            </button>
          )}

          <div style={{ flexGrow: 1 }} />
          <button
            disabled={sendDisabled}
            onClick={isInProgress && !hideStopButton ? onStop : send}
            data-copilotkit-in-progress={isInProgress}
            data-test-id={
              isInProgress
                ? 'copilot-chat-request-in-progress'
                : 'copilot-chat-ready'
            }
            className="copilotKitInputControlButton"
          >
            {buttonIcon}
          </button>
        </div>
      </div>
    </div>
  );
};
