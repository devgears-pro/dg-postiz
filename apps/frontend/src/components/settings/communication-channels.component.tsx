'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Button } from '@gitroom/react/form/button';

type ChannelStatus = {
  channel: string;
  configured: boolean;
  connected: boolean;
  externalUsername: string | null;
  activeThreadId: string | null;
  botUsername: string | null;
};

export const CommunicationChannelsComponent = () => {
  const fetch = useFetch();
  const toast = useToaster();
  const t = useT();
  const searchParams = useSearchParams();
  const router = useRouter();
  const tgToken = searchParams.get('tg_token');

  const [busy, setBusy] = useState(false);
  const [connectUrl, setConnectUrl] = useState<string | null>(null);

  const loadStatus = useCallback(async (): Promise<ChannelStatus> => {
    const response = await fetch('/communication-channels/telegram/status');
    if (!response.ok) {
      throw new Error('Failed to load Telegram status');
    }
    return response.json();
  }, [fetch]);

  const { data, isLoading, mutate } = useSWR(
    'communication-channels-telegram',
    loadStatus
  );

  const handleConnect = async () => {
    setBusy(true);
    try {
      const response = await fetch(
        '/communication-channels/telegram/connect-link',
        { method: 'POST' }
      );
      const result = (await response.json()) as {
        url?: string;
        message?: string;
      };
      if (!response.ok || !result.url) {
        toast.show(
          result.message ||
            t(
              'telegram_connect_failed',
              'Could not generate Telegram connection link'
            ),
          'warning'
        );
        return;
      }
      setConnectUrl(result.url);
      window.open(result.url, '_blank', 'noopener,noreferrer');
    } catch {
      toast.show(
        t(
          'telegram_connect_failed',
          'Could not generate Telegram connection link'
        ),
        'warning'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmExternalToken = async () => {
    if (!tgToken) return;
    setBusy(true);
    try {
      const response = await fetch('/communication-channels/telegram/confirm', {
        method: 'POST',
        body: JSON.stringify({ token: tgToken }),
      });
      const result = (await response.json()) as {
        connected?: boolean;
        message?: string;
      };
      if (!response.ok || !result.connected) {
        toast.show(
          result.message ||
            t(
              'telegram_confirm_failed',
              'Could not confirm Telegram connection'
            ),
          'warning'
        );
        return;
      }
      toast.show(
        t('telegram_connected_toast', 'Telegram connected to your workspace')
      );
      await mutate();
      router.replace('/settings?tab=communication-channels');
    } catch {
      toast.show(
        t(
          'telegram_confirm_failed',
          'Could not confirm Telegram connection'
        ),
        'warning'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    setBusy(true);
    try {
      const response = await fetch('/communication-channels/telegram', {
        method: 'DELETE',
      });
      if (response.ok) {
        setConnectUrl(null);
        toast.show(
          t('telegram_disconnected_toast', 'Telegram disconnected')
        );
        await mutate();
      }
    } catch {
      toast.show(
        t(
          'telegram_connect_failed',
          'Could not generate Telegram connection link'
        ),
        'warning'
      );
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!connectUrl || data?.connected) return;
    const timer = setInterval(() => {
      void mutate();
    }, 3000);
    return () => clearInterval(timer);
  }, [connectUrl, data?.connected, mutate]);

  return (
    <div className="flex flex-col gap-[16px]">
      <div>
        <h3 className="text-[18px] font-[600]">
          {t('communication_channels', 'Communication Channels')}
        </h3>
        <p className="text-[14px] text-customColor18 mt-[4px]">
          {t(
            'communication_channels_desc',
            'Chat with your Postiz AI assistant from external messengers.'
          )}
        </p>
      </div>

      {tgToken && (
        <div className="p-[16px] rounded-[8px] border border-fifth bg-sixth flex flex-col gap-[10px]">
          <div className="text-[15px] font-[600]">
            {t('telegram_confirm_title', 'Confirm Telegram connection')}
          </div>
          <p className="text-[14px] text-customColor18">
            {t(
              'telegram_confirm_desc',
              'Click below to link your Telegram account to the active Postiz organization.'
            )}
          </p>
          <div>
            <Button onClick={handleConfirmExternalToken} disabled={busy}>
              {t('confirm_connection', 'Confirm connection')}
            </Button>
          </div>
        </div>
      )}

      <div className="p-[16px] rounded-[8px] border border-fifth bg-sixth flex flex-col gap-[12px]">
        <div className="flex items-center justify-between gap-[12px] flex-wrap">
          <div>
            <div className="text-[16px] font-[600]">Telegram</div>
            {data?.botUsername && (
              <div className="text-[13px] text-customColor18">
                @{data.botUsername}
              </div>
            )}
          </div>
          <div className="text-[13px]">
            {isLoading
              ? t('loading', 'Loading...')
              : data?.connected
                ? t('connected', 'Connected')
                : data?.configured
                  ? t('not_connected', 'Not connected')
                  : t('not_configured', 'Not configured')}
          </div>
        </div>

        {data?.connected ? (
          <div className="flex flex-col gap-[10px]">
            <div className="text-[14px]">
              {data.externalUsername
                ? t('telegram_linked_as', 'Linked account: @{{username}}', {
                    username: data.externalUsername,
                  })
                : t('telegram_linked', 'Telegram account is linked.')}
            </div>
            <div className="flex items-center gap-[10px] flex-wrap">
              {data.botUsername && (
                <a
                  href={`https://t.me/${data.botUsername}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[14px] underline"
                >
                  {t('open_in_telegram', 'Open in Telegram')}
                </a>
              )}
              <Button
                onClick={handleDisconnect}
                disabled={busy}
                secondary={true}
              >
                {t('disconnect', 'Disconnect')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-[10px]">
            <p className="text-[14px] text-customColor18">
              {t(
                'telegram_connect_hint',
                'Connect Telegram to start or continue AI assistant chats from your phone.'
              )}
            </p>
            <div className="flex items-center gap-[10px] flex-wrap">
              <Button
                onClick={handleConnect}
                disabled={busy || isLoading || !data?.configured}
              >
                {t('connect_telegram', 'Connect Telegram')}
              </Button>
              {connectUrl && (
                <a
                  href={connectUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[14px] underline"
                >
                  {t('open_in_telegram', 'Open in Telegram')}
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
