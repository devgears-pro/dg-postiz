import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { readFile } from 'fs/promises';
import { resolve, sep } from 'path';
import {
  CommunicationChannelsService,
  IncomingSessionPolicy,
} from '@gitroom/nestjs-libraries/chat/communication.channels.service';
import {
  formatTelegramHtml,
  formatTelegramSystemNotice,
  splitTelegramMessage,
} from '@gitroom/nestjs-libraries/chat/telegram.assistant.format';
import {
  parseTelegramIdleMinutes,
  shouldResetIdleSession,
} from '@gitroom/nestjs-libraries/chat/telegram.assistant.session';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { uploadStreamToStorage } from '@gitroom/nestjs-libraries/upload/custom.upload.validation';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';

const PHOTO_ERROR =
  'Could not read the image. Send a JPEG or PNG up to 10 MB.';

const IDLE_NOTICE = formatTelegramSystemNotice(
  'New session started after inactivity.\nPrevious chats: /chats'
);

export type TelegramPhotoSize = {
  file_id: string;
  file_size?: number;
  width: number;
  height: number;
};

export type TelegramUser = {
  id: number;
  username?: string;
  first_name?: string;
};

export type TelegramChat = {
  id: number;
  type: string;
};

export type TelegramMessage = {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
};

export type TelegramCallbackQuery = {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
};

type InlineButton = {
  text: string;
  url?: string;
  callback_data?: string;
};

export type TelegramChannelsPort = Pick<
  CommunicationChannelsService,
  | 'getAuthorizedLink'
  | 'createExternalConnectToken'
  | 'confirmWebToken'
  | 'listThreadsForExternalUser'
  | 'selectThreadForExternalUser'
  | 'startNewThreadForExternalUser'
  | 'handleIncomingMessage'
  | 'touchExternalUserActivity'
>;

export type TelegramMediaPort = Pick<MediaService, 'saveFile'>;

@Injectable()
export class TelegramAssistantService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly _logger = new Logger(TelegramAssistantService.name);
  private readonly _sessionIdleMinutes = parseTelegramIdleMinutes(
    process.env.TELEGRAM_ASSISTANT_SESSION_IDLE_MINUTES
  );
  private _pollingActive = false;
  private _pollingOffset = 0;

  constructor(
    @Inject(CommunicationChannelsService)
    private _channelsService: TelegramChannelsPort,
    @Inject(MediaService)
    private _mediaService: TelegramMediaPort
  ) {}

  onModuleInit() {
    if (this._getToken()) {
      void this._registerCommands();
    }
    if (
      process.env.TELEGRAM_ASSISTANT_POLLING === 'true' &&
      this._getToken()
    ) {
      this._pollingActive = true;
      void this._startPolling();
      return;
    }
    if (
      this._getToken() &&
      process.env.TELEGRAM_ASSISTANT_WEBHOOK_SECRET
    ) {
      void this._registerWebhook();
    }
  }

  onModuleDestroy() {
    this._pollingActive = false;
  }

  private async _startPolling() {
    await this._callTelegram('deleteWebhook', {}).catch(() => null);
    await this._pollLoop();
  }

  private async _registerCommands() {
    await this._callTelegram('setMyCommands', {
      commands: [
        { command: 'new', description: 'Start a new chat' },
        { command: 'chats', description: 'Choose a chat' },
        { command: 'start', description: 'Connect or start' },
      ],
    }).catch(() => null);
  }

  private async _registerWebhook() {
    const secret = process.env.TELEGRAM_ASSISTANT_WEBHOOK_SECRET;
    if (!secret) {
      return;
    }
    if (process.env.NODE_ENV !== 'production' || process.env.NOT_SECURED) {
      this._logger.log(
        'Telegram assistant webhook registration is skipped outside production'
      );
      return;
    }
    if (!/^[A-Za-z0-9_-]{1,256}$/.test(secret)) {
      this._logger.warn(
        'Telegram assistant webhook secret contains unsupported characters'
      );
      return;
    }
    const publicUrl = this._frontendUrl();
    if (!publicUrl.startsWith('https://')) {
      this._logger.warn(
        'Telegram assistant webhook requires an HTTPS public URL'
      );
      return;
    }
    const result = await this._callTelegram('setWebhook', {
      url: `${publicUrl}/api/communication-channels/telegram/webhook`,
      secret_token: secret,
      allowed_updates: ['message', 'callback_query'],
    }).catch((error) => {
      this._logger.warn(`Telegram webhook registration failed: ${error}`);
      return null;
    });
    if (result) {
      this._logger.log('Telegram assistant webhook registered');
    }
  }

  private _getToken(): string | undefined {
    return process.env.TELEGRAM_ASSISTANT_TOKEN;
  }

  private _getApiBase(): string {
    return (
      process.env.TELEGRAM_ASSISTANT_API_BASE || 'https://api.telegram.org'
    ).replace(/\/+$/, '');
  }

  private _frontendUrl(): string {
    return (
      process.env.FRONTEND_URL ||
      process.env.MAIN_URL ||
      'http://localhost:4200'
    ).replace(/\/+$/, '');
  }

  private async _callTelegram<T = unknown>(
    method: string,
    body: Record<string, unknown>,
    timeoutMs = 25_000
  ): Promise<T | null> {
    const token = this._getToken();
    if (!token) return null;
    try {
      const response = await fetch(
        `${this._getApiBase()}/bot${token}/${method}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        }
      );
      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        this._logger.warn(
          `Telegram API ${method} failed (${response.status}): ${errorText}`
        );
        return null;
      }
      const json = (await response.json()) as { ok: boolean; result?: T };
      return json.ok ? (json.result ?? null) : null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this._logger.warn(`Telegram API ${method} error: ${message}`);
      return null;
    }
  }

  private async _sendMessage(
    chatId: string | number,
    text: string,
    options?: {
      parseMode?: 'HTML';
      replyMarkup?: { inline_keyboard: InlineButton[][] };
    }
  ) {
    const chunks = splitTelegramMessage(text, 4096);
    for (let i = 0; i < chunks.length; i++) {
      const isLast = i === chunks.length - 1;
      const body: Record<string, unknown> = {
        chat_id: chatId,
        text: chunks[i],
      };
      if (options?.parseMode) {
        body.parse_mode = options.parseMode;
      }
      if (isLast && options?.replyMarkup) {
        body.reply_markup = options.replyMarkup;
      }
      const sent = await this._callTelegram('sendMessage', body);
      if (!sent && options?.parseMode) {
        await this._callTelegram('sendMessage', {
          chat_id: chatId,
          text: chunks[i].replace(/<[^>]+>/g, ''),
          ...(isLast && options?.replyMarkup
            ? { reply_markup: options.replyMarkup }
            : {}),
        });
      }
    }
  }

  private _resolveLocalUploadPath(mediaPath: string): string | null {
    let candidate = mediaPath;
    if (/^https?:\/\//i.test(mediaPath)) {
      try {
        const parsed = new URL(mediaPath);
        const isPrivateHost =
          parsed.hostname === 'localhost' ||
          parsed.hostname === '127.0.0.1' ||
          parsed.hostname === '::1' ||
          parsed.hostname === '0.0.0.0';
        const frontendHost = (() => {
          try {
            return new URL(this._frontendUrl()).hostname;
          } catch {
            return '';
          }
        })();
        if (
          (isPrivateHost || parsed.hostname === frontendHost) &&
          parsed.pathname.includes('/uploads/')
        ) {
          candidate = parsed.pathname.slice(
            parsed.pathname.indexOf('/uploads/')
          );
        } else {
          return null;
        }
      } catch {
        return null;
      }
    }

    const uploadRoot = resolve(process.env.UPLOAD_DIRECTORY || './uploads');
    const relativePath = candidate.replace(/^\/+/, '').replace(/^uploads\//, '');
    const fullPath = resolve(uploadRoot, relativePath);
    if (!fullPath.startsWith(uploadRoot + sep)) {
      this._logger.warn(`Blocked invalid Telegram photo path: ${mediaPath}`);
      return null;
    }
    return fullPath;
  }

  private _photoMimeType(filePath: string): { mime: string; filename: string } {
    const lower = filePath.toLowerCase();
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
      return { mime: 'image/jpeg', filename: 'generated.jpg' };
    }
    if (lower.endsWith('.webp')) {
      return { mime: 'image/webp', filename: 'generated.webp' };
    }
    if (lower.endsWith('.gif')) {
      return { mime: 'image/gif', filename: 'generated.gif' };
    }
    return { mime: 'image/png', filename: 'generated.png' };
  }

  private async _sendPhoto(
    chatId: string | number,
    mediaPath: string,
    caption?: string
  ) {
    const token = this._getToken();
    if (!token) return;
    const localPath = this._resolveLocalUploadPath(mediaPath);
    if (!localPath && /^https?:\/\//i.test(mediaPath)) {
      await this._callTelegram('sendPhoto', {
        chat_id: chatId,
        photo: mediaPath,
        ...(caption ? { caption: caption.slice(0, 1024) } : {}),
      });
      return;
    }
    if (!localPath) {
      return;
    }
    try {
      const buffer = await readFile(localPath);
      if (buffer.length > 10 * 1024 * 1024) {
        this._logger.warn(
          `Skipped Telegram sendPhoto for oversized file (${buffer.length} bytes)`
        );
        return;
      }
      const { mime, filename } = this._photoMimeType(localPath);
      const form = new FormData();
      form.append('chat_id', String(chatId));
      form.append('photo', new Blob([buffer], { type: mime }), filename);
      if (caption) {
        form.append('caption', caption.slice(0, 1024));
      }
      const photoResponse = await fetch(
        `${this._getApiBase()}/bot${token}/sendPhoto`,
        {
          method: 'POST',
          body: form,
          signal: AbortSignal.timeout(20_000),
        }
      );
      if (!photoResponse.ok) {
        const errText = await photoResponse.text().catch(() => '');
        this._logger.warn(
          `Telegram sendPhoto failed (${photoResponse.status}): ${errText}`
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this._logger.warn(`Failed to send Telegram photo: ${message}`);
    }
  }

  private async _downloadTelegramPhoto(
    fileId: string,
    organizationId: string,
    declaredSize?: number
  ): Promise<{ id: string; path: string } | null> {
    const token = this._getToken();
    if (!token) return null;
    const fileInfo = await this._callTelegram<{
      file_id: string;
      file_path?: string;
      file_size?: number;
    }>('getFile', { file_id: fileId });
    if (!fileInfo?.file_path) {
      return null;
    }
    const downloadResponse = await fetch(
      `${this._getApiBase()}/file/bot${token}/${fileInfo.file_path}`,
      { signal: AbortSignal.timeout(20_000) }
    );
    if (!downloadResponse.ok || !downloadResponse.body) {
      return null;
    }
    const storage = UploadFactory.createStorage();
    const uploaded = await uploadStreamToStorage(
      storage,
      downloadResponse.body as unknown as ReadableStream,
      declaredSize ?? fileInfo.file_size ?? 0
    );
    const fileName = uploaded.path.split('/').pop() || 'telegram-photo.jpg';
    const saved = await this._mediaService.saveFile(
      organizationId,
      fileName,
      uploaded.path,
      fileName
    );
    return { id: saved.id, path: saved.path };
  }

  private async _pollLoop() {
    while (this._pollingActive) {
      try {
        const updates = await this._callTelegram<TelegramUpdate[]>(
          'getUpdates',
          {
            offset: this._pollingOffset,
            timeout: 20,
          },
          30_000
        );
        if (Array.isArray(updates)) {
          for (const update of updates) {
            try {
              await this.processUpdate(update);
              this._pollingOffset = Math.max(
                this._pollingOffset,
                update.update_id + 1
              );
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              this._logger.warn(
                `Failed to process update ${update.update_id}: ${message}`
              );
              this._pollingOffset = Math.max(
                this._pollingOffset,
                update.update_id + 1
              );
            }
          }
        } else {
          await new Promise((r) => setTimeout(r, 3000));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this._logger.warn(`Telegram polling error: ${message}`);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }

  async processUpdate(update: TelegramUpdate): Promise<void> {
    if (!update || typeof update.update_id !== 'number') {
      return;
    }
    const processingKey = `comm:tg:upd:${update.update_id}:processing`;
    const doneKey = `comm:tg:upd:${update.update_id}:done`;

    if (await ioRedis.get(doneKey)) {
      return;
    }

    const acquired = await ioRedis.set(
      processingKey,
      '1',
      'EX',
      600,
      'NX'
    );
    if (!acquired) {
      throw new ServiceUnavailableException(
        'The update is already being processed'
      );
    }

    try {
      if (update.callback_query) {
        await this._handleCallback(update.callback_query);
      } else if (update.message) {
        await this._handleMessage(update.message);
      }
      await ioRedis.set(doneKey, '1', 'EX', 86400);
    } finally {
      await ioRedis.del(processingKey).catch((): undefined => undefined);
    }
  }

  private async _handleCallback(query: TelegramCallbackQuery) {
    const chat = query.message?.chat;
    if (!chat || chat.type !== 'private') {
      return;
    }
    const data = query.data || '';
    if (data.startsWith('tg_t:')) {
      const threadId = data.slice('tg_t:'.length);
      const selected = await this._channelsService.selectThreadForExternalUser(
        'telegram',
        String(query.from.id),
        threadId
      );
      await this._callTelegram('answerCallbackQuery', {
        callback_query_id: query.id,
        text: selected.ok ? 'Chat switched' : 'Could not switch chat',
      });
      await this._sendMessage(
        chat.id,
        selected.ok
          ? `Switched to chat: ${selected.title || 'Chat'}`
          : 'Access denied or chat not found.'
      );
      return;
    }

    await this._callTelegram('answerCallbackQuery', {
      callback_query_id: query.id,
    });
  }

  private async _sendConnectPrompt(
    chatId: number,
    externalUser: TelegramUser,
    promptText = 'Connect your Postiz account to chat with the assistant here.'
  ) {
    const token = await this._channelsService.createExternalConnectToken(
      'telegram',
      {
        externalUserId: String(externalUser.id),
        externalChatId: String(chatId),
        externalUsername: externalUser.username ?? null,
      }
    );
    const connectUrl = `${this._frontendUrl()}/settings?tab=communication-channels&tg_token=${token}`;
    await this._sendMessage(chatId, promptText, {
      replyMarkup: {
        inline_keyboard: [[{ text: 'Connect to Postiz', url: connectUrl }]],
      },
    });
  }

  private _sessionPolicy(): IncomingSessionPolicy {
    return {
      shouldReset: (lastActiveAt, now) =>
        shouldResetIdleSession(
          lastActiveAt,
          now,
          this._sessionIdleMinutes * 60_000
        ),
      onIdleReset: async (linkedChatId) => {
        await this._sendMessage(linkedChatId, IDLE_NOTICE, {
          parseMode: 'HTML',
        });
      },
    };
  }

  private async _handleMessage(message: TelegramMessage) {
    if (!message.chat || message.chat.type !== 'private' || !message.from) {
      return;
    }

    const externalUserId = String(message.from.id);
    const chatId = message.chat.id;
    const rawText = (message.text || message.caption || '').trim();

    if (rawText === '/start' || rawText.startsWith('/start ')) {
      const startToken = rawText.slice('/start'.length).trim();
      if (startToken) {
        const linked = await this._channelsService.confirmWebToken(
          'telegram',
          startToken,
          {
            externalUserId,
            externalChatId: String(chatId),
            externalUsername: message.from.username ?? null,
          }
        );
        if (linked) {
          await this._channelsService.touchExternalUserActivity(
            'telegram',
            externalUserId
          );
          await this._sendMessage(
            chatId,
            'Telegram is connected to your Postiz workspace. Send a message to start chatting with the assistant.'
          );
        } else {
          await this._sendConnectPrompt(
            chatId,
            message.from,
            'This connection link is invalid or expired. Use the button below to connect.'
          );
        }
        return;
      }
      const auth = await this._channelsService.getAuthorizedLink(
        'telegram',
        externalUserId
      );
      if (auth.status === 'ok') {
        await this._channelsService.touchExternalUserActivity(
          'telegram',
          externalUserId
        );
        await this._sendMessage(
          chatId,
          'Telegram is already connected. Send a message to chat with the assistant.'
        );
        return;
      }
      if (auth.status === 'unauthorized') {
        await this._sendMessage(
          chatId,
          'Access to this Postiz organization is no longer active.'
        );
        return;
      }
      await this._sendConnectPrompt(chatId, message.from);
      return;
    }

    if (rawText === '/new') {
      const auth = await this._channelsService.getAuthorizedLink(
        'telegram',
        externalUserId
      );
      if (auth.status === 'unlinked') {
        await this._sendConnectPrompt(chatId, message.from);
        return;
      }
      if (auth.status === 'unauthorized') {
        await this._sendMessage(
          chatId,
          'Access to this Postiz organization is no longer active.'
        );
        return;
      }
      await this._channelsService.startNewThreadForExternalUser(
        'telegram',
        externalUserId
      );
      await this._sendMessage(
        chatId,
        'Started a new chat. Send your next message.'
      );
      return;
    }

    if (rawText === '/chats') {
      const auth = await this._channelsService.getAuthorizedLink(
        'telegram',
        externalUserId
      );
      if (auth.status === 'unlinked') {
        await this._sendConnectPrompt(chatId, message.from);
        return;
      }
      if (auth.status === 'unauthorized') {
        await this._sendMessage(
          chatId,
          'Access to this Postiz organization is no longer active.'
        );
        return;
      }
      await this._channelsService.touchExternalUserActivity(
        'telegram',
        externalUserId
      );
      const threads = await this._channelsService.listThreadsForExternalUser(
        'telegram',
        externalUserId
      );
      if (threads.length === 0) {
        await this._sendMessage(chatId, 'No chats yet. Send a message to start one.');
        return;
      }
      const keyboard = threads
        .filter((t) => Buffer.byteLength(`tg_t:${t.id}`, 'utf8') <= 64)
        .map((t) => [
          {
            text: (t.title || '').trim().slice(0, 60) || 'Untitled chat',
            callback_data: `tg_t:${t.id}`,
          },
        ]);
      if (keyboard.length === 0) {
        await this._sendMessage(chatId, 'No chats available to switch.');
        return;
      }
      await this._sendMessage(chatId, 'Select a chat:', {
        replyMarkup: {
          inline_keyboard: keyboard,
        },
      });
      return;
    }

    const auth = await this._channelsService.getAuthorizedLink(
      'telegram',
      externalUserId
    );
    if (auth.status === 'unlinked') {
      await this._sendConnectPrompt(chatId, message.from);
      return;
    }
    if (auth.status === 'unauthorized') {
      await this._sendMessage(
        chatId,
        'Access to this Postiz organization is no longer active.'
      );
      return;
    }

    let promptText = rawText;
    if (Array.isArray(message.photo) && message.photo.length > 0) {
      const bestPhoto = message.photo[message.photo.length - 1];
      try {
        const savedMedia = await this._downloadTelegramPhoto(
          bestPhoto.file_id,
          auth.link.organizationId,
          bestPhoto.file_size
        );
        if (!savedMedia) {
          await this._channelsService.touchExternalUserActivity(
            'telegram',
            externalUserId
          );
          await this._sendMessage(chatId, PHOTO_ERROR);
          return;
        }
        const mediaBlock = `[--Media--]\nImage: ${savedMedia.path} (media ${savedMedia.id})\n[--Media--]`;
        promptText = promptText
          ? `${mediaBlock}\n\n${promptText}`
          : `${mediaBlock}\n\nDescribe this image`;
      } catch (error) {
        this._logger.warn(`Failed to read Telegram photo: ${error}`);
        await this._channelsService.touchExternalUserActivity(
          'telegram',
          externalUserId
        );
        await this._sendMessage(chatId, PHOTO_ERROR);
        return;
      }
    }

    if (!promptText) {
      return;
    }

    await this._callTelegram('sendChatAction', {
      chat_id: chatId,
      action: 'typing',
    });
    const typingTimer = setInterval(() => {
      void this._callTelegram('sendChatAction', {
        chat_id: chatId,
        action: 'typing',
      }).catch(() => null);
    }, 4000);

    let result: Awaited<
      ReturnType<CommunicationChannelsService['handleIncomingMessage']>
    >;
    try {
      result = await this._channelsService.handleIncomingMessage(
        'telegram',
        externalUserId,
        promptText,
        this._sessionPolicy()
      );
    } catch (error) {
      this._logger.warn(`Assistant reply failed: ${error}`);
      await this._sendMessage(
        chatId,
        'Busy right now. Please wait a moment and try again.'
      );
      return;
    } finally {
      clearInterval(typingTimer);
    }
    if (result.status === 'unlinked') {
      await this._sendConnectPrompt(chatId, message.from);
      return;
    }
    if (result.status === 'unauthorized') {
      await this._sendMessage(
        chatId,
        'Access to this Postiz organization is no longer active.'
      );
      return;
    }

    for (const img of result.generatedImages) {
      await this._sendPhoto(chatId, img.path);
    }

    if (result.text) {
      await this._sendMessage(chatId, formatTelegramHtml(result.text), {
        parseMode: 'HTML',
      });
    }
  }
}
