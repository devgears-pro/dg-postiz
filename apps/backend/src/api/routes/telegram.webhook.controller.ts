import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  Post,
} from '@nestjs/common';
import {
  TelegramAssistantService,
  TelegramUpdate,
} from '@gitroom/nestjs-libraries/chat/telegram.assistant.service';
import { verifyTelegramWebhookSecret } from '@gitroom/nestjs-libraries/chat/telegram.assistant.format';

@Controller('/communication-channels/telegram')
export class TelegramWebhookController {
  constructor(private _telegramService: TelegramAssistantService) {}

  @Post('/webhook')
  @HttpCode(200)
  async handleWebhook(
    @Headers('x-telegram-bot-api-secret-token') secretHeader: string | undefined,
    @Body() update: TelegramUpdate
  ) {
    const expectedSecret = process.env.TELEGRAM_ASSISTANT_WEBHOOK_SECRET;
    if (!verifyTelegramWebhookSecret(expectedSecret, secretHeader)) {
      throw new ForbiddenException('Invalid webhook secret');
    }
    await this._telegramService.processUpdate(update);
    return { ok: true };
  }
}

