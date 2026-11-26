import { Injectable } from '@nestjs/common';
import { CommunicationChannelLink, Prisma } from '@prisma/client';
import {
  PrismaRepository,
  PrismaTransaction,
} from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

export type CommunicationChannelLinkUpsert = {
  userId: string;
  organizationId: string;
  channel: string;
  externalUserId: string;
  externalChatId: string;
  externalUsername?: string | null;
  activeThreadId?: string | null;
  metadata?: Prisma.InputJsonValue;
};

@Injectable()
export class CommunicationChannelsRepository {
  constructor(
    private _links: PrismaRepository<
      'communicationChannelLink' | 'userOrganization'
    >,
    private _tx: PrismaTransaction
  ) {}

  async findByExternalUser(
    channel: string,
    externalUserId: string
  ): Promise<CommunicationChannelLink | null> {
    return this._links.model.communicationChannelLink.findUnique({
      where: {
        channel_externalUserId: {
          channel,
          externalUserId,
        },
      },
    });
  }

  async findByUserAndOrg(
    userId: string,
    organizationId: string,
    channel: string
  ): Promise<CommunicationChannelLink | null> {
    return this._links.model.communicationChannelLink.findUnique({
      where: {
        userId_organizationId_channel: {
          userId,
          organizationId,
          channel,
        },
      },
    });
  }

  async upsertLink(
    input: CommunicationChannelLinkUpsert
  ): Promise<CommunicationChannelLink> {
    return this._tx.model.$transaction(async (tx) => {
      await tx.communicationChannelLink.deleteMany({
        where: {
          channel: input.channel,
          OR: [
            { externalUserId: input.externalUserId },
            {
              userId: input.userId,
              organizationId: input.organizationId,
            },
          ],
        },
      });
      return tx.communicationChannelLink.create({
        data: {
          userId: input.userId,
          organizationId: input.organizationId,
          channel: input.channel,
          externalUserId: input.externalUserId,
          externalChatId: input.externalChatId,
          externalUsername: input.externalUsername ?? null,
          activeThreadId: input.activeThreadId ?? null,
          metadata: input.metadata,
        },
      });
    });
  }

  async updateActiveThread(
    id: string,
    activeThreadId: string | null
  ): Promise<CommunicationChannelLink> {
    return this._links.model.communicationChannelLink.update({
      where: { id },
      data: { activeThreadId },
    });
  }

  async deleteByUserAndOrg(
    userId: string,
    organizationId: string,
    channel: string
  ): Promise<number> {
    const result = await this._links.model.communicationChannelLink.deleteMany({
      where: { userId, organizationId, channel },
    });
    return result.count;
  }

  async findMembership(userId: string, organizationId: string) {
    return this._links.model.userOrganization.findFirst({
      where: {
        userId,
        organizationId,
        disabled: false,
        organization: { deletedAt: null },
        user: { deletedAt: null, activated: true },
      },
      include: {
        organization: {
          include: {
            subscription: true,
          },
        },
      },
    });
  }
}
