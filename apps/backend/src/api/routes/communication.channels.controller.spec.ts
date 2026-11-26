import { ForbiddenException } from '@nestjs/common';
import { CommunicationChannelLink, Organization, User } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@gitroom/nestjs-libraries/chat/mastra.store', () => ({
  pStore: {},
}));

vi.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {},
}));

import {
  CommunicationChannelsController,
  CommunicationChannelsPort,
} from './communication.channels.controller';

const USER: Pick<User, 'id'> = { id: 'user-1' };
const ORGANIZATION: Pick<Organization, 'id'> = { id: 'org-1' };
const LINK: CommunicationChannelLink = {
  id: 'link-1',
  userId: 'user-1',
  organizationId: 'org-1',
  channel: 'telegram',
  externalUserId: '1',
  externalChatId: '1',
  externalUsername: 'alice',
  activeThreadId: null,
  metadata: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

describe('CommunicationChannelsController', () => {
  const channels = {
    getStatus: vi.fn<CommunicationChannelsPort['getStatus']>(),
    createWebConnectLink: vi.fn<
      CommunicationChannelsPort['createWebConnectLink']
    >(),
    getExternalConnectPreview: vi.fn<
      CommunicationChannelsPort['getExternalConnectPreview']
    >(),
    confirmExternalToken: vi.fn<
      CommunicationChannelsPort['confirmExternalToken']
    >(),
    disconnect: vi.fn<CommunicationChannelsPort['disconnect']>(),
  } satisfies CommunicationChannelsPort;
  let controller: CommunicationChannelsController;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.FRONTEND_URL = 'https://postiz.example';
    process.env.MAIN_URL = 'https://postiz.example';
    channels.confirmExternalToken.mockResolvedValue(LINK);
    channels.createWebConnectLink.mockResolvedValue({
      url: 'https://t.me/bot?start=token',
      expiresInSeconds: 600,
    });
    channels.disconnect.mockResolvedValue({ disconnected: true });
    controller = new CommunicationChannelsController(channels);
  });

  it('rejects a confirmation from another origin', async () => {
    await expect(
      controller.confirmConnection(
        USER,
        ORGANIZATION,
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
        USER,
        ORGANIZATION,
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
        USER,
        ORGANIZATION,
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
        USER,
        ORGANIZATION,
        'telegram',
        'https://attacker.example'
      )
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(channels.disconnect).not.toHaveBeenCalled();
  });
});
