import { ForbiddenException } from '@nestjs/common';
import type { Organization } from '@prisma/client';
import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import type { AgentConfigService } from '@gitroom/nestjs-libraries/chat/agent.config.service';
import type { AgentConnectionsService } from '@gitroom/nestjs-libraries/chat/agent.connections';
import type { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import type { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { MediaController } from './media.controller';

const organization = { id: 'org-1' } as Organization;

const buildController = (imageGenerate: boolean, hasKey = true) =>
  new MediaController(
    {} as MediaService,
    {} as SubscriptionService,
    {
      resolve: async () => ({
        config: { capabilities: { imageGenerate } },
      }),
    } as unknown as AgentConfigService,
    {
      hasProviderCredential: () => hasKey,
    } as unknown as AgentConnectionsService
  );

describe('MediaController image generation', () => {
  it('[TC-2-18-3] reports image generation disabled for the organization', async () => {
    const controller = buildController(false);

    const result = await controller.imageGeneration(organization);

    expect(result).toEqual({ enabled: false });
  });

  it('[TC-2-18-4] rejects image generation when the capability is disabled', async () => {
    const controller = buildController(false);

    await expect(
      controller.generateImage(organization, {} as Request, 'a cat')
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
