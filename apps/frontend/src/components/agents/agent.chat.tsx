'use client';

import React, {
  FC,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  CopilotChat,
  CopilotKitCSSProperties,
  InputProps,
  UserMessageProps,
} from '@copilotkit/react-ui';
import { Input } from '@gitroom/frontend/components/agents/agent.input';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import {
  CopilotKit,
  useCopilotAction,
  useCopilotChatInternal,
} from '@copilotkit/react-core';
import {
  chatResetEmitter,
  MediaPortal,
  pollThreadTitles,
  PropertiesContext,
} from '@gitroom/frontend/components/agents/agent';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { useParams } from 'next/navigation';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { mutate } from 'swr';
import { AddEditModal } from '@gitroom/frontend/components/new-launch/add.edit.modal';
import dayjs from 'dayjs';
import { fromUtc } from '@gitroom/frontend/components/layout/set.timezone';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { ExistingDataContextProvider } from '@gitroom/frontend/components/launches/helpers/use.existing.data';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { hasExtension } from '@gitroom/helpers/utils/has.extension';
import type { SelectedDoc } from '@gitroom/frontend/components/docs/docs.picker.modal';

export const AgentChat: FC = () => {
  const { backendUrl } = useVariables();
  const params = useParams<{ id: string }>();
  const { properties } = useContext(PropertiesContext);
  const t = useT();
  const [historyLoading, setHistoryLoading] = useState(params.id !== 'new');

  return (
    <CopilotKit
      {...(params.id === 'new' ? {} : { threadId: params.id })}
      credentials="include"
      runtimeUrl={backendUrl + '/copilot/agent'}
      useSingleEndpoint={true}
      showDevConsole={false}
      agent="postiz"
      properties={{
        integrations: properties,
      }}
    >
      <Hooks />
      <LoadMessages id={params.id} onLoadingChange={setHistoryLoading} />
      <div
        style={
          {
            '--copilot-kit-primary-color': 'var(--new-btn-text)',
            '--copilot-kit-background-color': 'var(--new-bg-color)',
          } as CopilotKitCSSProperties
        }
        className="trz agent bg-newBgColorInner flex flex-col gap-[15px] transition-all flex-1 min-w-0 w-full items-center relative"
      >
        {historyLoading && (
          <div
            data-testid="chat-history-loading"
            role="status"
            aria-live="polite"
            className="absolute inset-0 z-20 bg-newBgColorInner flex flex-col gap-[18px] p-[24px]"
          >
            <span className="sr-only">{t('loading', 'Loading')}</span>
            <div className="h-[14px] w-[58%] rounded bg-newBgColor animate-pulse" />
            <div className="h-[14px] w-[82%] rounded bg-newBgColor animate-pulse" />
            <div className="h-[14px] w-[46%] rounded bg-newBgColor animate-pulse" />
            <div className="mt-[12px] h-[14px] w-[64%] rounded bg-newBgColor animate-pulse self-end" />
            <div className="h-[14px] w-[38%] rounded bg-newBgColor animate-pulse self-end" />
          </div>
        )}
        <div className="absolute left-0 w-full h-full pb-[20px]">
          <CopilotChat
            className="w-full h-full"
            labels={{
              title: t('your_assistant', 'Your Assistant'),
              initial: t('agent_welcome_message', `Hello, I am your Postiz agent 🙌🏻.
              
I can schedule a post or multiple posts to multiple channels and generate pictures and videos.

You can select the channels you want to use from the left menu.

You can see your previous conversations from the right menu.

You can also use me as an MCP Server, check Settings >> Agents / Dev
`),
              placeholder: t('agent_placeholder', 'Type a message...'),
              error: t(
                'agent_error',
                '❌ An error occurred. Please try again.'
              ),
              stopGenerating: t('agent_stop_generating', 'Stop generating'),
              regenerateResponse: t(
                'agent_regenerate_response',
                'Regenerate response'
              ),
              copyToClipboard: t(
                'agent_copy_to_clipboard',
                'Copy to clipboard'
              ),
              thumbsUp: t('agent_thumbs_up', 'Thumbs up'),
              thumbsDown: t('agent_thumbs_down', 'Thumbs down'),
              copied: t('agent_copied', 'Copied!'),
            }}
            UserMessage={Message}
            Input={NewInput}
          />
        </div>
      </div>
    </CopilotKit>
  );
};

type AgentMessage = NonNullable<
  ReturnType<typeof useCopilotChatInternal>['agent']
>['messages'][number];

const LoadMessages: FC<{
  id: string;
  onLoadingChange: (loading: boolean) => void;
}> = ({ id, onLoadingChange }) => {
  const { agent, messages, setMessages, isAvailable } =
    useCopilotChatInternal();
  const fetch = useFetch();
  const currentId = useRef<string | null>(null);
  const agentRef = useRef(agent);
  const setMessagesRef = useRef(setMessages);
  const availableRef = useRef(isAvailable);
  const appliedId = useRef<string | null>(null);
  const loaded = useRef<{ id: string; messages: AgentMessage[] } | null>(null);

  useEffect(() => {
    agentRef.current = agent;
  }, [agent]);

  useEffect(() => {
    setMessagesRef.current = setMessages;
  }, [setMessages]);

  const applyLoaded = useCallback(() => {
    const pending = loaded.current;
    const target = agentRef.current;
    if (
      !pending ||
      pending.id === 'new' ||
      !target ||
      !availableRef.current ||
      pending.id !== id
    ) {
      return;
    }

    target.threadId = pending.id;
    const alreadyEmpty =
      appliedId.current === pending.id && pending.messages.length === 0;
    if (!alreadyEmpty) {
      setMessagesRef.current([]);
      setMessagesRef.current(pending.messages);
    }
    appliedId.current = pending.id;
    onLoadingChange(false);
  }, [id, onLoadingChange]);

  useEffect(() => {
    availableRef.current = isAvailable;
    if (isAvailable) {
      applyLoaded();
    }
  }, [isAvailable, applyLoaded]);

  const loadMessages = useCallback(
    async (idToSet: string) => {
      const response = await fetch(`/copilot/${idToSet}/list`);
      if (!response.ok) {
        throw new Error('Could not load the conversation');
      }

      const data = await response.json();
      interface RawMessageItem {
        id?: string;
        content: {
          content?: string;
          parts?: Array<{ type: string; text?: string }>;
        };
        role: 'user' | 'assistant' | 'system';
      }
      const list: AgentMessage[] = (
        (data.messages as RawMessageItem[]) || []
      ).map((p) => ({
        id: p.id || makeId(12),
        content:
          p.content.content ||
          (p.content.parts || [])
            .map((part) => (part.type === 'text' ? part.text || '' : ''))
            .join(''),
        role: p.role,
      }));

      if (currentId.current !== idToSet) {
        return;
      }

      loaded.current = { id: idToSet, messages: list };
      applyLoaded();
    },
    [applyLoaded, fetch]
  );

  useEffect(() => {
    if (loaded.current?.id === id) {
      return;
    }

    currentId.current = id;
    appliedId.current = null;
    if (id === 'new') {
      if (agentRef.current) {
        agentRef.current.threadId = makeId(21);
      }
      loaded.current = { id, messages: [] };
      agentRef.current?.setMessages([]);
      onLoadingChange(false);
      return;
    }

    loaded.current = null;
    onLoadingChange(true);
    void loadMessages(id).catch(() => {
      if (currentId.current === id) {
        onLoadingChange(false);
      }
    });
  }, [id, loadMessages, onLoadingChange]);

  useEffect(() => {
    if (id === 'new') return;

    const timer = setTimeout(() => onLoadingChange(false), 10_000);
    return () => clearTimeout(timer);
  }, [id, onLoadingChange]);

  useEffect(() => {
    if (id === 'new') return;
    const refresh = () => {
      if (document.visibilityState === 'visible') {
        void loadMessages(id).catch(() => undefined);
      }
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [id, loadMessages]);

  useEffect(() => {
    const reset = () => {
      if (agentRef.current) {
        agentRef.current.threadId = makeId(21);
      }
      agentRef.current?.setMessages([]);
      currentId.current = 'new';
      appliedId.current = null;
      loaded.current = { id: 'new', messages: [] };
      onLoadingChange(false);
    };

    chatResetEmitter.on('reset', reset);
    return () => {
      chatResetEmitter.off('reset', reset);
    };
  }, [onLoadingChange]);

  // CopilotKit resolves loadAgentState to an empty list for Mastra local agents
  // and can clobber the messages we hold, depending on which request resolves last
  useEffect(() => {
    if (id === 'new' || loaded.current?.id !== id) {
      return;
    }

    const current = agent?.messages ?? [];
    if (current.length && agent?.threadId === id) {
      loaded.current.messages = current;
      return;
    }

    applyLoaded();
  }, [agent, messages, id, applyLoaded]);

  return null;
};

const Message: FC<UserMessageProps> = (props) => {
  const convertContentToImagesAndVideo = useMemo(() => {
    const content = props.message?.content || '';
    const text =
      typeof content === 'string'
        ? content
        : content.map((p) => (p.type === 'text' ? p.text : '')).join('');

    return text
      .replace(/Video: (http.*mp4\n)/g, (match, p1) => {
        return `<video controls class="h-[150px] w-[150px] rounded-[8px] mb-[10px]"><source src="${p1.trim()}" type="video/mp4">Your browser does not support the video tag.</video>`;
      })
      .replace(/Image: (http\S+) \(media [^)]+\)/g, (match, p1) => {
        return `<img src="${p1.trim()}" class="h-[150px] w-[150px] max-w-full border border-newBgColorInner" />`;
      })
      .replace(/Image: (http.*\n)/g, (match, p1) => {
        return `<img src="${p1.trim()}" class="h-[150px] w-[150px] max-w-full border border-newBgColorInner" />`;
      })
      .replace(/\[\-\-Media\-\-\](.*)\[\-\-Media\-\-\]/g, (match, p1) => {
        return `<div class="flex justify-center mt-[20px]">${p1}</div>`;
      })
      .replace(/\[\-\-Docs\-\-\]([\s\S]*?)\[\-\-Docs\-\-\]/g, (_match, p1) => {
        const escaped = String(p1)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
        return `<div class="mt-[8px] text-[12px] opacity-80">${escaped}</div>`;
      })
      .replace(
        /(\[--integrations--\][\s\S]*?\[--integrations--\])/g,
        (match, p1) => {
          return ``;
        }
      )
      .replace(/\[--Media--\]/g, '')
      .replace(/\[--Docs--\]/g, '');
  }, [props.message?.content]);
  return (
    <div
      className="copilotKitMessage copilotKitUserMessage min-w-[300px]"
      dangerouslySetInnerHTML={{ __html: convertContentToImagesAndVideo }}
    />
  );
};
const NewInput: FC<InputProps> = (props) => {
  const [media, setMedia] = useState([] as { path: string; id: string }[]);
  const [docs, setDocs] = useState<SelectedDoc[]>([]);
  const [value, setValue] = useState('');
  const { properties } = useContext(PropertiesContext);
  const fetch = useFetch();
  const toaster = useToaster();
  const t = useT();
  const mediaRef = useRef<{ path: string; id: string }[]>([]);
  const docsRef = useRef<SelectedDoc[]>([]);
  const pendingUpload = useRef<Promise<void>>(Promise.resolve());
  const changeDocs = useCallback((nextDocs: SelectedDoc[]) => {
    docsRef.current = nextDocs;
    setDocs(nextDocs);
  }, []);
  const changeMedia = useCallback(
    (event: {
      target: {
        name: string;
        value?: { id: string; path: string }[];
      };
    }) => {
      mediaRef.current = event.target.value || [];
      setMedia(mediaRef.current);
    },
    []
  );
  const uploadPastedImages = useCallback(
    (files: File[]) => {
      pendingUpload.current = pendingUpload.current
        .then(async () => {
          const uploaded = await Promise.all(
            files.map(async (file) => {
              const body = new FormData();
              body.append('file', file);
              const response = await fetch('/media/upload-simple', {
                method: 'POST',
                body,
              });
              if (!response.ok) {
                const failure = await response.json().catch(() => ({}));
                toaster.show(
                  typeof failure.message === 'string'
                    ? failure.message
                    : t('image_upload_failed', 'Could not upload the image.'),
                  'warning'
                );
                return undefined;
              }
              const saved = await response.json();
              return { id: saved.id as string, path: saved.path as string };
            })
          );
          mediaRef.current = [
            ...mediaRef.current,
            ...(uploaded.filter(Boolean) as { id: string; path: string }[]),
          ];
          setMedia(mediaRef.current);
        })
        .catch(() => {
          toaster.show(
            t('image_upload_failed', 'Could not upload the image.'),
            'warning'
          );
        });
      return pendingUpload.current;
    },
    [fetch, toaster, t]
  );
  return (
    <>
      <MediaPortal
        value={value}
        media={media}
        docs={docs}
        setDocs={changeDocs}
        setMedia={changeMedia}
      />
      <Input
        {...props}
        onChange={setValue}
        onPasteFiles={uploadPastedImages}
        hasAttachments={media.length > 0 || docs.length > 0}
        onSend={async (text) => {
          await pendingUpload.current;
          const attachments = mediaRef.current;
          const attachedDocs = docsRef.current;
          const send = props.onSend(
            text +
              (attachments.length > 0
                ? '\n[--Media--]' +
                  attachments
                    .map((m) =>
                      hasExtension(m.path, 'mp4')
                        ? `Video: ${m.path}`
                        : `Image: ${m.path} (media ${m.id})`
                    )
                    .join('\n') +
                  '\n[--Media--]'
                : '') +
              (attachedDocs.length > 0
                ? '\n[--Docs--]' +
                  attachedDocs.map((d) => `Document: ${d.path}`).join('\n') +
                  '\n[--Docs--]'
                : '') +
              `
${
  properties.length
    ? `[--integrations--]
Use the following social media platforms: ${JSON.stringify(
        properties.map((p) => ({
          id: p.id,
          platform: p.identifier,
          profilePicture: p.picture,
          additionalSettings: p.additionalSettings,
        }))
      )}
[--integrations--]`
    : ``
}`
          );
          void send
            .then(() => {
              pollThreadTitles();
              return mutate('threads');
            })
            .catch(() => undefined);
          setValue('');
          mediaRef.current = [];
          setMedia([]);
          docsRef.current = [];
          setDocs([]);
          return send;
        }}
      />
    </>
  );
};

export const Hooks: FC = () => {
  const modals = useModals();

  useCopilotAction({
    name: 'manualPosting',
    description:
      'This tool should be triggered when the user wants to manually add the generated post',
    parameters: [
      {
        name: 'list',
        type: 'object[]',
        description:
          'list of posts to schedule to different social media (integration ids)',
        attributes: [
          {
            name: 'integrationId',
            type: 'string',
            description: 'The integration id',
          },
          {
            name: 'date',
            type: 'string',
            description: 'UTC date of the scheduled post',
          },
          {
            name: 'settings',
            type: 'object',
            description: 'Settings for the integration [input:settings]',
          },
          {
            name: 'posts',
            type: 'object[]',
            description: 'list of posts / comments (one under another)',
            attributes: [
              {
                name: 'content',
                type: 'string',
                description: 'the content of the post',
              },
              {
                name: 'attachments',
                type: 'object[]',
                description: 'list of attachments',
                attributes: [
                  {
                    name: 'id',
                    type: 'string',
                    description: 'id of the attachment',
                  },
                  {
                    name: 'path',
                    type: 'string',
                    description: 'url of the attachment',
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    renderAndWaitForResponse: ({ args, status, respond }) => {
      if (status === 'executing') {
        return <OpenModal args={args} respond={respond} />;
      }

      return null;
    },
  });
  return null;
};

const OpenModal: FC<{
  respond: (value: unknown) => void;
  args: {
    list: {
      integrationId: string;
      date: string;
      settings?: object;
      posts: { content: string; attachments: { id: string; path: string }[] }[];
    }[];
  };
}> = ({ args, respond }) => {
  const modals = useModals();
  const { properties } = useContext(PropertiesContext);
  const startModal = useCallback(async () => {
    for (const integration of args.list) {
      await new Promise((res) => {
        const group = makeId(10);
        modals.openModal({
          id: 'add-edit-modal',
          closeOnClickOutside: false,
          removeLayout: true,
          closeOnEscape: false,
          withCloseButton: false,
          askClose: true,
          size: '80%',
          title: ``,
          classNames: {
            modal: 'w-[100%] max-w-[1400px] text-textColor',
          },
          children: (
            <ExistingDataContextProvider
              value={{
                group,
                integration: integration.integrationId,
                integrationPicture:
                  properties.find((p) => p.id === integration.integrationId)
                    ?.picture || '',
                settings: integration.settings || {},
                posts: integration.posts.map((p) => ({
                  approvedSubmitForOrder: 'NO',
                  content: p.content,
                  createdAt: new Date().toISOString(),
                  state: 'DRAFT',
                  id: makeId(10),
                  settings: JSON.stringify(integration.settings || {}),
                  group,
                  integrationId: integration.integrationId,
                  integration: properties.find(
                    (p) => p.id === integration.integrationId
                  ),
                  publishDate: dayjs.utc(integration.date).toISOString(),
                  image: p.attachments.map((a) => ({
                    id: a.id,
                    path: a.path,
                  })),
                })),
              }}
            >
              <AddEditModal
                date={fromUtc(integration.date)}
                allIntegrations={properties}
                integrations={properties.filter(
                  (p) => p.id === integration.integrationId
                )}
                onlyValues={integration.posts.map((p) => ({
                  content: p.content,
                  id: makeId(10),
                  settings: integration.settings || {},
                  image: p.attachments.map((a) => ({
                    id: a.id,
                    path: a.path,
                  })),
                }))}
                reopenModal={() => {}}
                mutate={() => res(true)}
              />
            </ExistingDataContextProvider>
          ),
        });
      });
    }

    respond('User scheduled all the posts');
  }, [args, respond, properties, modals]);

  useEffect(() => {
    startModal();
  }, [startModal]);
  return (
    <div onClick={() => respond('continue')}>
      Opening manually ${JSON.stringify(args)}
    </div>
  );
};
