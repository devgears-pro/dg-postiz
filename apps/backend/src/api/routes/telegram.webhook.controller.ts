import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  Logger,
  Post,
} from '@nestjs/common';
import {
  TelegramAssistantService,
  TelegramUpdate,
} from '@gitroom/nestjs-libraries/chat/telegram.assistant.service';
import { verifyTelegramWebhookSecret } from '@gitroom/nestjs-libraries/chat/telegram.assistant.format';

@Controller('/communication-channels/telegram')
export class TelegramWebhookController {
  private readonly _logger = new Logger(TelegramWebhookController.name);

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
    try {
      await this._telegramService.processUpdate(update);
    } catch (error) {
      this._logger.error(`Failed to process Telegram update: ${error}`);
    }
    return { ok: true };
  }
}

