'use client';

import React, {
  createContext,
  FC,
  useCallback,
  useMemo,
  useRef,
  useState,
  ReactNode,
} from 'react';
import clsx from 'clsx';
import useCookie from 'react-use-cookie';
import useSWR from 'swr';
import { orderBy } from 'lodash';
import { SVGLine } from '@gitroom/frontend/components/launches/launches.component';
import ImageWithFallback from '@gitroom/react/helpers/image.with.fallback';
import {
  isBrandMark,
  PlatformIcon,
} from '@gitroom/frontend/components/ui/platform.icon.component';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useWaitForClass } from '@gitroom/helpers/utils/use.wait.for.class';
import { MultiMediaComponent } from '@gitroom/frontend/components/media/media.component';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import {
  DocsPickerModal,
  type SelectedDoc,
} from '@gitroom/frontend/components/docs/docs.picker.modal';
import { Integrations } from '@gitroom/frontend/components/launches/calendar.context';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { EventEmitter } from 'events';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useToaster } from '@gitroom/react/toaster/toaster';
import {
  shouldPollTitles,
  ThreadSummary,
  TITLE_POLL_INTERVAL_MS,
  TITLE_POLL_WINDOW_MS,
} from '@gitroom/frontend/components/agents/agent.titles';

export const MediaPortal: FC<{
  media: { path: string; id: string }[];
  docs: SelectedDoc[];
  value: string;
  setDocs: (docs: SelectedDoc[]) => void;
  setMedia: (event: {
    target: {
      name: string;
      value?: {
        id: string;
        path: string;
        alt?: string;
        thumbnail?: string;
        thumbnailTimestamp?: number;
      }[];
    };
  }) => void;
}> = ({ media, docs, setDocs, setMedia, value }) => {
  const waitForClass = useWaitForClass('copilotKitMessages');
  const t = useT();
  const modals = useModals();
  if (!waitForClass) return null;

  const openDocsPicker = () => {
    modals.openModal({
      title: t('docs', 'Docs'),
      askClose: false,
      closeOnEscape: true,
      children: (close) => (
        <DocsPickerModal
          closeModal={close}
          onSelect={(picked) => {
            const next = [...docs];
            for (const doc of picked) {
              if (!next.some((d) => d.path === doc.path)) {
                next.push(doc);
              }
            }
            setDocs(next);
          }}
        />
      ),
    });
  };

  return (
    <div className="pl-[14px] pr-[24px] whitespace-nowrap editor rm-bg max-w-full overflow-x-auto">
      {docs.length > 0 && (
        <div className="flex flex-wrap gap-[6px] mb-[6px]">
          {docs.map((doc) => (
            <span
              key={doc.path}
              className="inline-flex items-center gap-[6px] px-[8px] py-[4px] rounded-[6px] bg-newColColor text-[12px] max-w-[260px]"
            >
              <span className="truncate" title={doc.path}>
                {doc.path}
              </span>
              <button
                type="button"
                aria-label={t('docs_remove_attachment', 'Remove document')}
                onClick={() =>
                  setDocs(docs.filter((item) => item.path !== doc.path))
                }
                className="opacity-70 hover:opacity-100 cursor-pointer shrink-0"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <MultiMediaComponent
        allData={[{ content: value }]}
        text={value}
        label={t('attachments', 'Attachments')}
        description=""
        value={media}
        dummy={false}
        name="image"
        onChange={setMedia}
        onOpen={() => {}}
        onClose={() => {}}
        toolBar={
          <button
            type="button"
            onClick={openDocsPicker}
            className="cursor-pointer h-[30px] mobile:h-[40px] rounded-[6px] mobile:rounded-[8px] justify-center items-center flex bg-newColColor mobile:bg-newSettings px-[8px] text-[10px] font-[600]"
          >
            {t('add_document', 'Add Document')}
          </button>
        }
      />
    </div>
  );
};

export const AgentList: FC<{ onChange: (arr: Integrations[]) => void }> = ({
  onChange,
}) => {
  const fetch = useFetch();
  const t = useT();
  const [selected, setSelected] = useState<Integrations[]>([]);

  const load = useCallback(async () => {
    return (await (await fetch('/integrations/list')).json()).integrations;
  }, [fetch]);

  const [collapseMenu, setCollapseMenu] = useCookie('collapseMenu', '0');

  const { data } = useSWR('integrations', load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    revalidateOnMount: true,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
    fallbackData: [],
  });

  const setIntegration = useCallback(
    (integration: Integrations) => () => {
      if (selected.some((p) => p.id === integration.id)) {
        onChange(selected.filter((p) => p.id !== integration.id));
        setSelected(selected.filter((p) => p.id !== integration.id));
      } else {
        onChange([...selected, integration]);
        setSelected([...selected, integration]);
      }
    },
    [selected, onChange]
  );

  const sortedIntegrations = useMemo(() => {
    return orderBy(
      data || [],
      ['type', 'disabled', 'identifier'],
      ['desc', 'asc', 'asc']
    );
  }, [data]);

  return (
    <div
      className={clsx(
        'trz bg-newBgColorInner flex flex-col gap-[15px] transition-all relative mobile:w-full mobile:order-1',
        collapseMenu === '1' ? 'group sidebar w-[100px]' : 'w-[260px]'
      )}
    >
      <div className="absolute top-0 start-0 w-full h-full p-[20px] mobile:p-[12px] mobile:static mobile:h-auto overflow-auto scrollbar scrollbar-thumb-fifth scrollbar-track-newBgColor">
        <div className="flex items-center mobile:hidden">
          <h2 className="group-[.sidebar]:hidden flex-1 text-[20px] font-[500] mb-[15px]">
            {t('select_channels', 'Select Channels')}
          </h2>
          <div
            onClick={() => setCollapseMenu(collapseMenu === '1' ? '0' : '1')}
            className="-mt-3 group-[.sidebar]:rotate-[180deg] group-[.sidebar]:mx-auto text-btnText bg-btnSimple rounded-[6px] w-[24px] h-[24px] flex items-center justify-center cursor-pointer select-none"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="7"
              height="13"
              viewBox="0 0 7 13"
              fill="none"
            >
              <path
                d="M6 11.5L1 6.5L6 1.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>
        <div
          className={clsx(
            'flex flex-col gap-[15px] mobile:flex-row mobile:gap-[12px] mobile:ps-[12px] mobile:pt-[6px]'
          )}
        >
          {sortedIntegrations.map((integration, index) => (
            <div
              onClick={setIntegration(integration)}
              key={integration.id}
              className={clsx(
                'flex gap-[12px] items-center group/profile justify-center hover:bg-boxHover rounded-e-[8px] hover:opacity-100 cursor-pointer mobile:shrink-0',
                !selected.some((p) => p.id === integration.id) &&
                  !isBrandMark(integration.identifier) &&
                  'opacity-20'
              )}
            >
              {/* a brand mark can't be dimmed with its row: the avatar and the
                  name are instead (see isBrandMark) */}
              <div
                className={clsx(
                  'relative rounded-full flex justify-center items-center gap-[6px]',
                  !isBrandMark(integration.identifier) &&
                    integration.disabled &&
                    'opacity-50'
                )}
              >
                {(integration.inBetweenSteps || integration.refreshNeeded) && (
                  <div className="absolute start-0 top-0 w-[39px] h-[46px] cursor-pointer">
                    <div className="bg-red-500 w-[15px] h-[15px] rounded-full start-0 -top-[5px] absolute z-[200] text-[10px] flex justify-center items-center">
                      !
                    </div>
                    <div className="bg-primary/60 w-[39px] h-[46px] start-0 top-0 absolute rounded-full z-[199]" />
                  </div>
                )}
                <div className="h-full w-[4px] -ms-[12px] rounded-s-[3px] opacity-0 group-hover/profile:opacity-100 transition-opacity">
                  <SVGLine />
                </div>
                <ImageWithFallback
                  fallbackSrc={`/icons/platforms/${integration.identifier}.png`}
                  src={integration.picture}
                  className={clsx(
                    'rounded-[8px]',
                    isBrandMark(integration.identifier) &&
                      (!selected.some((p) => p.id === integration.id)
                        ? 'opacity-20 group-hover/profile:opacity-100'
                        : integration.disabled && 'opacity-50')
                  )}
                  alt={integration.identifier}
                  width={36}
                  height={36}
                />
                {/* a brand mark stays above the reconnect overlay (z-[199]),
                    it hangs a little off the corner to hide less of the
                    picture, and in a faded row it only shows with the hover */}
                <PlatformIcon
                  identifier={integration.identifier}
                  size={18.41}
                  inactive={integration.disabled}
                  className="absolute bottom-[5px] -end-[5px]"
                  iconClassName="z-10 rounded-[8px] border border-fifth"
                  markClassName={clsx(
                    'z-[201] -mb-[5px] -me-[3px] bg-newBgColorInner group-hover/profile:bg-boxHover',
                    !selected.some((p) => p.id === integration.id) &&
                      'hidden group-hover/profile:flex'
                  )}
                />
              </div>
              <div
                className={clsx(
                  'flex-1 whitespace-nowrap text-ellipsis overflow-hidden group-[.sidebar]:hidden mobile:hidden',
                  !selected.some((p) => p.id === integration.id) &&
                    isBrandMark(integration.identifier)
                    ? 'opacity-20 group-hover/profile:opacity-100'
                    : integration.disabled && 'opacity-50'
                )}
              >
                {integration.name}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export const PropertiesContext = createContext<{ properties: Integrations[] }>({
  properties: [],
});
export const Agent: FC<{ children: ReactNode }> = ({ children }) => {
  const [properties, setProperties] = useState<Integrations[]>([]);

  return (
    <PropertiesContext.Provider value={{ properties }}>
      <AgentList onChange={setProperties} />
      <div className="bg-newBgColorInner flex flex-1 min-w-0 mobile:order-3 mobile:min-h-[500px]">
        {children}
      </div>
      <Threads />
    </PropertiesContext.Provider>
  );
};

export const chatResetEmitter = new EventEmitter();

let titlePollingUntil = Date.now() + TITLE_POLL_WINDOW_MS;

export const pollThreadTitles = () => {
  titlePollingUntil = Date.now() + TITLE_POLL_WINDOW_MS;
};

const Threads: FC = () => {
  const fetch = useFetch();
  const router = useRouter();
  const t = useT();
  const toaster = useToaster();
  const threads = useCallback(async (): Promise<{ threads: ThreadSummary[] }> => {
    return (await fetch('/copilot/list')).json();
  }, [fetch]);
  const { id } = useParams<{ id: string }>();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const savingTitle = useRef<string | null>(null);

  const { data, mutate } = useSWR('threads', threads, {
    refreshInterval: (latest) =>
      shouldPollTitles(latest?.threads, titlePollingUntil, Date.now())
        ? TITLE_POLL_INTERVAL_MS
        : 0,
  });

  const startRename = (thread: ThreadSummary) => () => {
    setEditingId(thread.id);
    setDraftTitle(thread.title?.trim() || '');
  };

  const saveTitle = async (thread: ThreadSummary) => {
    if (savingTitle.current === thread.id || editingId !== thread.id) return;
    savingTitle.current = thread.id;
    setEditingId(null);

    const title = draftTitle.trim();
    if (!title || title === thread.title?.trim()) {
      savingTitle.current = null;
      return;
    }

    setBusyId(thread.id);
    try {
      const response = await fetch(`/copilot/${thread.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title }),
      });
      if (!response.ok) throw new Error('rename failed');
      await mutate();
      toaster.show(t('chat_renamed', 'Chat renamed'), 'success');
    } catch {
      setEditingId(thread.id);
      toaster.show(
        t('chat_action_failed', 'Could not update the chat.'),
        'warning'
      );
    } finally {
      if (savingTitle.current === thread.id) {
        savingTitle.current = null;
      }
      setBusyId(null);
    }
  };

  const removeThread = (thread: ThreadSummary) => async () => {
    if (
      !(await deleteDialog(
        t('delete_chat_confirm', 'Delete this chat? This cannot be undone.')
      ))
    ) {
      return;
    }

    const activeNewId = id === 'new' ? data?.threads?.[0]?.id : undefined;

    setBusyId(thread.id);
    try {
      const response = await fetch(`/copilot/${thread.id}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('delete failed');
      await mutate();
      if (thread.id === id) {
        router.replace('/agents/new');
      } else if (thread.id === activeNewId) {
        chatResetEmitter.emit('reset');
      }
      toaster.show(t('chat_deleted', 'Chat deleted'), 'success');
    } catch {
      toaster.show(
        t('chat_action_failed', 'Could not update the chat.'),
        'warning'
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div
      className={clsx(
        'trz bg-newBgColorInner flex flex-col gap-[15px] transition-all relative',
        'w-[260px] mobile:w-full mobile:order-2'
      )}
    >
      <div className="absolute top-0 start-0 w-full h-full p-[20px] mobile:p-[12px] mobile:static mobile:h-auto mobile:flex mobile:gap-[8px] mobile:items-center overflow-auto scrollbar scrollbar-thumb-fifth scrollbar-track-newBgColor">
        <div className="mb-[15px] mobile:mb-0 justify-center flex group-[.sidebar]:pb-[15px] mobile:shrink-0">
          <Link
            href={`/agents`}
            className="text-white whitespace-nowrap flex-1 pt-[12px] pb-[14px] ps-[16px] pe-[20px] group-[.sidebar]:p-0 min-h-[44px] max-h-[44px] rounded-md bg-btnPrimary flex justify-center items-center gap-[5px] outline-none"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="21"
              height="20"
              viewBox="0 0 21 20"
              fill="none"
              className="min-w-[21px] min-h-[20px]"
            >
              <path
                d="M10.5001 4.16699V15.8337M4.66675 10.0003H16.3334"
                stroke="white"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <div className="flex-1 text-start text-[16px] group-[.sidebar]:hidden">
              {t('start_a_new_chat', 'Start a new chat')}
            </div>
          </Link>
        </div>
        <div className="flex flex-col gap-[1px] mobile:flex-row mobile:gap-[4px]">
          {data?.threads?.map((p) => {
            const title = p.title?.trim() || t('new_chat', 'New chat');
            const busy = busyId === p.id;
            return (
              <div
                key={p.id}
                data-testid="thread-row"
                className={clsx(
                  'group/thread flex items-center gap-[4px] hover:bg-newBgColor px-[10px] py-[6px] rounded-[10px] mobile:shrink-0 mobile:max-w-[180px] mobile:border mobile:border-newTableBorder',
                  p.id === id && 'bg-newBgColor'
                )}
              >
                {editingId === p.id ? (
                  <input
                    autoFocus
                    value={draftTitle}
                    maxLength={200}
                    aria-label={t('rename_chat', 'Rename chat')}
                    className="w-full min-w-0 rounded-[6px] border border-newTableBorder bg-newBgColorInner px-[4px] py-[2px] text-[16px] outline-none"
                    onFocus={(event) => event.currentTarget.select()}
                    onChange={(event) => setDraftTitle(event.target.value)}
                    onBlur={() => saveTitle(p)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void saveTitle(p);
                      }
                      if (event.key === 'Escape') {
                        setEditingId(null);
                      }
                    }}
                  />
                ) : (
                  <>
                    <Link
                      className="min-w-0 flex-1 overflow-ellipsis overflow-hidden whitespace-nowrap cursor-pointer"
                      href={`/agents/${p.id}`}
                      title={title}
                    >
                      {title}
                    </Link>
                    <div
                      className={clsx(
                        'flex items-center gap-[2px] shrink-0 transition-opacity',
                        'opacity-0 group-hover/thread:opacity-100 focus-within:opacity-100 mobile:opacity-100',
                        busy && 'opacity-50'
                      )}
                    >
                      <button
                        type="button"
                        disabled={busy}
                        aria-label={t('rename_chat', 'Rename chat')}
                        title={t('rename_chat', 'Rename chat')}
                        className="p-[4px] mobile:p-[8px] opacity-70 hover:opacity-100"
                        onClick={startRename(p)}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="14"
                          height="14"
                          viewBox="0 0 16 16"
                          fill="none"
                        >
                          <path
                            d="M11.5 2.5 13.5 4.5 5 13H3v-2zM10 4l2 2"
                            stroke="currentColor"
                            strokeWidth="1.4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        aria-label={t('delete_chat', 'Delete chat')}
                        title={t('delete_chat', 'Delete chat')}
                        className="p-[4px] mobile:p-[8px] opacity-70 hover:opacity-100 text-red-400"
                        onClick={removeThread(p)}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="14"
                          height="14"
                          viewBox="0 0 16 16"
                          fill="none"
                        >
                          <path
                            d="M3 4h10M6.5 4V2.5h3V4M4.5 4l.5 9.5h6L11.5 4M6.5 6.5v4M9.5 6.5v4"
                            stroke="currentColor"
                            strokeWidth="1.4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
        <div className="pt-[12px] mt-[12px] border-t border-fifth">
          <Link
            href="/settings?tab=communication-channels"
            className="text-[13px] opacity-80 hover:opacity-100 underline"
          >
            {t('communication_channels', 'Communication Channels')}
          </Link>
        </div>
      </div>
    </div>
  );
};
