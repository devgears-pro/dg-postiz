import { ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@gitroom/nestjs-libraries/chat/mastra.store', () => ({
  pStore: {},
}));

vi.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {},
}));

import { CommunicationChannelsController } from './communication.channels.controller';

describe('CommunicationChannelsController', () => {
  const channels = {
    confirmExternalToken: vi.fn(),
    createWebConnectLink: vi.fn(),
    disconnect: vi.fn(),
  };
  let controller: CommunicationChannelsController;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.FRONTEND_URL = 'https://postiz.example';
    process.env.MAIN_URL = 'https://postiz.example';
    channels.confirmExternalToken.mockResolvedValue({
      channel: 'telegram',
      externalUsername: 'alice',
    });
    channels.createWebConnectLink.mockResolvedValue({
      url: 'https://t.me/bot?start=token',
      expiresInSeconds: 600,
    });
    channels.disconnect.mockResolvedValue({ disconnected: true });
    controller = new CommunicationChannelsController(channels as never);
  });

  it('rejects a confirmation from another origin', async () => {
    await expect(
      controller.confirmConnection(
        {} as never,
        {} as never,
        'telegram',
        { token: '0123456789abcdef' },
        'https://attacker.example'
      )
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(channels.confirmExternalToken).not.toHaveBeenCalled();
  });

  it('accepts a confirmation from the configured frontend origin', async () => {
    await expect(
      controller.confirmConnection(
        {} as never,
        {} as never,
        'telegram',
        { token: '0123456789abcdef' },
        'https://postiz.example'
      )
    ).resolves.toEqual({
      connected: true,
      channel: 'telegram',
      externalUsername: 'alice',
    });
  });

  it('accepts clients that do not send an origin header', async () => {
    await expect(
      controller.confirmConnection(
        {} as never,
        {} as never,
        'telegram',
        { token: '0123456789abcdef' },
        undefined
      )
    ).resolves.toEqual({
      connected: true,
      channel: 'telegram',
      externalUsername: 'alice',
    });
  });

  it('rejects a disconnect from another origin', async () => {
    await expect(
      controller.disconnect(
        {} as never,
        {} as never,
        'telegram',
        'https://attacker.example'
      )
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(channels.disconnect).not.toHaveBeenCalled();
  });
});
