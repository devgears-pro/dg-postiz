import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { readFile } from 'fs/promises';
import { resolve, sep } from 'path';
import { CommunicationChannelsService } from '@gitroom/nestjs-libraries/chat/communication.channels.service';
import {
  formatTelegramHtml,
  splitTelegramMessage,
} from '@gitroom/nestjs-libraries/chat/telegram.assistant.format';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { uploadStreamToStorage } from '@gitroom/nestjs-libraries/upload/custom.upload.validation';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';

const PHOTO_ERROR =
  'Could not read the image. Send a JPEG or PNG up to 10 MB.';

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

@Injectable()
export class TelegramAssistantService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly _logger = new Logger(TelegramAssistantService.name);
  private _pollingActive = false;
  private _pollingOffset = 0;

  constructor(
    private _channelsService: CommunicationChannelsService,
    private _mediaService: MediaService
  ) {}

  onModuleInit() {
    if (
      process.env.TELEGRAM_ASSISTANT_POLLING === 'true' &&
      this._getToken()
    ) {
      this._pollingActive = true;
      void this._startPolling();
    }
  }

  onModuleDestroy() {
    this._pollingActive = false;
  }

  private async _startPolling() {
    await this._callTelegram('deleteWebhook', {}).catch(() => null);
    await this._pollLoop();
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
    body: Record<string, unknown>
  ): Promise<T | null> {
    const token = this._getToken();
    if (!token) return null;
    const response = await fetch(
      `${this._getApiBase()}/bot${token}/${method}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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

  private async _sendPhoto(
    chatId: string | number,
    mediaPath: string,
    caption?: string
  ) {
    const token = this._getToken();
    if (!token) return;
    if (/^https?:\/\//i.test(mediaPath)) {
      await this._callTelegram('sendPhoto', {
        chat_id: chatId,
        photo: mediaPath,
        ...(caption ? { caption: caption.slice(0, 1024) } : {}),
      });
      return;
    }

    const uploadRoot = resolve(process.env.UPLOAD_DIRECTORY || './uploads');
    const relativePath = mediaPath.replace(/^\/+/, '').replace(/^uploads\//, '');
    const fullPath = resolve(uploadRoot, relativePath);
    if (!fullPath.startsWith(uploadRoot + sep)) {
      this._logger.warn(`Blocked invalid Telegram photo path: ${mediaPath}`);
      return;
    }
    try {
      const buffer = await readFile(fullPath);
      const form = new FormData();
      form.append('chat_id', String(chatId));
      form.append(
        'photo',
        new Blob([buffer], { type: 'image/png' }),
        'generated.png'
      );
      if (caption) {
        form.append('caption', caption.slice(0, 1024));
      }
      const photoResponse = await fetch(
        `${this._getApiBase()}/bot${token}/sendPhoto`,
        {
          method: 'POST',
          body: form,
        }
      );
      if (!photoResponse.ok) {
        const errText = await photoResponse.text().catch(() => '');
        this._logger.warn(
          `Telegram sendPhoto failed (${photoResponse.status}): ${errText}`
        );
      }
    } catch (error) {
      this._logger.warn(`Failed to send Telegram photo ${fullPath}: ${error}`);
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
      `${this._getApiBase()}/file/bot${token}/${fileInfo.file_path}`
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
          }
        );
        if (Array.isArray(updates)) {
          for (const update of updates) {
            this._pollingOffset = Math.max(
              this._pollingOffset,
              update.update_id + 1
            );
            try {
              await this.processUpdate(update);
            } catch (err) {
              this._logger.warn(`Failed to process update ${update.update_id}: ${err}`);
            }
          }
        } else {
          await new Promise((r) => setTimeout(r, 3000));
        }
      } catch (error) {
        this._logger.warn(`Telegram polling error: ${error}`);
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
      const threads = await this._channelsService.listThreadsForExternalUser(
        'telegram',
        externalUserId
      );
      if (threads.length === 0) {
        await this._sendMessage(chatId, 'No chats yet. Send a message to start one.');
        return;
      }
      await this._sendMessage(chatId, 'Select a chat:', {
        replyMarkup: {
          inline_keyboard: threads.map((t) => [
            { text: t.title.slice(0, 60), callback_data: `tg_t:${t.id}` },
          ]),
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
          await this._sendMessage(chatId, PHOTO_ERROR);
          return;
        }
        const mediaBlock = `[--Media--]\nImage: ${savedMedia.path} (media ${savedMedia.id})\n[--Media--]`;
        promptText = promptText
          ? `${mediaBlock}\n\n${promptText}`
          : `${mediaBlock}\n\nDescribe this image`;
      } catch (error) {
        this._logger.warn(`Failed to read Telegram photo: ${error}`);
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

    let result: Awaited<
      ReturnType<CommunicationChannelsService['handleIncomingMessage']>
    >;
    try {
      result = await this._channelsService.handleIncomingMessage(
        'telegram',
        externalUserId,
        promptText
      );
    } catch (error) {
      this._logger.warn(`Assistant reply failed: ${error}`);
      await this._sendMessage(
        chatId,
        'Busy right now. Please wait a moment and try again.'
      );
      return;
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
