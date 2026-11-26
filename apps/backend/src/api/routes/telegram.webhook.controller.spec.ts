import { ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@gitroom/nestjs-libraries/chat/mastra.store', () => ({
  pStore: {},
}));

vi.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {},
}));

import {
  TelegramUpdateProcessor,
  TelegramWebhookController,
} from './telegram.webhook.controller';

describe('TelegramWebhookController', () => {
  const processUpdate = vi.fn<TelegramUpdateProcessor['processUpdate']>();
  let controller: TelegramWebhookController;

  beforeEach(() => {
    processUpdate.mockReset();
    process.env.TELEGRAM_ASSISTANT_WEBHOOK_SECRET = 'webhook-secret';
    controller = new TelegramWebhookController({ processUpdate });
  });

  it('rejects an update with an invalid secret', async () => {
    await expect(
      controller.handleWebhook('wrong-secret', { update_id: 1 })
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(processUpdate).not.toHaveBeenCalled();
  });

  it('propagates a processing failure so Telegram can retry', async () => {
    processUpdate.mockRejectedValue(new Error('assistant unavailable'));

    await expect(
      controller.handleWebhook('webhook-secret', { update_id: 2 })
    ).rejects.toThrow('assistant unavailable');
  });
});
