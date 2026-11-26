import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { RequestContext } from '@mastra/core/di';
import { randomBytes, randomUUID } from 'crypto';
import { CommunicationChannelLink } from '@prisma/client';
import { CommunicationChannelsRepository } from '@gitroom/nestjs-libraries/database/prisma/communication-channels/communication.channels.repository';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { pricing } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { MastraService } from '@gitroom/nestjs-libraries/chat/mastra.service';
import { AgentRuntimeService } from '@gitroom/nestjs-libraries/chat/agent.runtime';
import {
  applyTraceIdentity,
  assertThreadAccess,
  assertThreadExists,
  loadThreadMemory,
} from '@gitroom/nestjs-libraries/chat/agent.trace';

const CONNECT_TTL_SECONDS = 600;
const LOCK_TTL_SECONDS = 120;

export type SupportedCommunicationChannel = 'telegram';

type WebConnectPayload = {
  userId: string;
  organizationId: string;
  channel: string;
};

type ExternalConnectPayload = {
  externalUserId: string;
  externalChatId: string;
  externalUsername: string | null;
};

export type GeneratedMediaAttachment = {
  id: string;
  path: string;
};

export type IncomingChannelResult =
  | { status: 'unlinked' }
  | { status: 'unauthorized' }
  | {
      status: 'ok';
      threadId: string;
      text: string;
      generatedImages: GeneratedMediaAttachment[];
    };

export type ChannelStatusResponse = {
  channel: string;
  configured: boolean;
  connected: boolean;
  externalUsername: string | null;
  activeThreadId: string | null;
  botUsername: string | null;
};

function webTokenKey(token: string) {
  return `comm:connect:web:${token}`;
}

function extTokenKey(channel: string, token: string) {
  return `comm:connect:ext:${channel}:${token}`;
}

function userLockKey(channel: string, externalUserId: string) {
  return `comm:lock:${channel}:${externalUserId}`;
}

async function consumeRedisJson<T>(key: string): Promise<T | null> {
  const raw = await ioRedis.getdel(key);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function extractGeneratedImages(steps: unknown): GeneratedMediaAttachment[] {
  if (!Array.isArray(steps)) {
    return [];
  }
  const images: GeneratedMediaAttachment[] = [];
  for (const step of steps) {
    if (!step || typeof step !== 'object') continue;
    const toolResults = (step as { toolResults?: unknown }).toolResults;
    if (!Array.isArray(toolResults)) continue;
    for (const chunk of toolResults) {
      if (!chunk || typeof chunk !== 'object') continue;
      const payload = (chunk as { payload?: unknown }).payload;
      if (!payload || typeof payload !== 'object') continue;
      const typed = payload as {
        toolName?: unknown;
        result?: unknown;
      };
      if (typed.toolName !== 'generateImageTool') continue;
      if (!typed.result || typeof typed.result !== 'object') continue;
      const res = typed.result as { id?: unknown; path?: unknown };
      if (typeof res.id === 'string' && typeof res.path === 'string') {
        images.push({ id: res.id, path: res.path });
      }
    }
  }
  return images;
}

@Injectable()
export class CommunicationChannelsService {
  constructor(
    private _repository: CommunicationChannelsRepository,
    private _subscriptionService: SubscriptionService,
    private _mastraService: MastraService,
    private _agentRuntime: AgentRuntimeService
  ) {}

  isChannelConfigured(channel: string): boolean {
    if (channel === 'telegram') {
      return Boolean(
        process.env.TELEGRAM_ASSISTANT_TOKEN &&
          process.env.TELEGRAM_ASSISTANT_BOT_NAME &&
          (process.env.TELEGRAM_ASSISTANT_WEBHOOK_SECRET ||
            process.env.TELEGRAM_ASSISTANT_POLLING === 'true')
      );
    }
    return false;
  }

  getBotUsername(channel: string): string | null {
    if (channel === 'telegram') {
      return process.env.TELEGRAM_ASSISTANT_BOT_NAME?.replace(/^@/, '') || null;
    }
    return null;
  }

  async hasAiAccess(organizationId: string): Promise<boolean> {
    if (!process.env.STRIPE_PUBLISHABLE_KEY) {
      return true;
    }
    const subscription =
      await this._subscriptionService.getSubscriptionByOrganizationId(
        organizationId
      );
    const tier = subscription?.subscriptionTier || 'FREE';
    return Boolean(pricing[tier]?.ai);
  }

  async assertUserCanConnect(userId: string, organizationId: string) {
    const membership = await this._repository.findMembership(
      userId,
      organizationId
    );
    if (!membership) {
      throw new ForbiddenException('Organization membership is not active');
    }
    const allowed = await this.hasAiAccess(organizationId);
    if (!allowed) {
      throw new ForbiddenException('AI assistant is not enabled for this plan');
    }
    return membership;
  }

  async getStatus(
    userId: string,
    organizationId: string,
    channel: string
  ): Promise<ChannelStatusResponse> {
    const link = await this._repository.findByUserAndOrg(
      userId,
      organizationId,
      channel
    );
    return {
      channel,
      configured: this.isChannelConfigured(channel),
      connected: Boolean(link),
      externalUsername: link?.externalUsername ?? null,
      activeThreadId: link?.activeThreadId ?? null,
      botUsername: this.getBotUsername(channel),
    };
  }

  async createWebConnectLink(
    userId: string,
    organizationId: string,
    channel: string
  ): Promise<{ url: string; expiresInSeconds: number }> {
    if (channel !== 'telegram') {
      throw new BadRequestException('Unsupported communication channel');
    }
    const botUsername = this.getBotUsername(channel);
    if (!botUsername || !this.isChannelConfigured(channel)) {
      throw new BadRequestException('Telegram assistant bot is not configured');
    }
    await this.assertUserCanConnect(userId, organizationId);
    const token = randomBytes(16).toString('hex');
    const payload: WebConnectPayload = { userId, organizationId, channel };
    await ioRedis.set(
      webTokenKey(token),
      JSON.stringify(payload),
      'EX',
      CONNECT_TTL_SECONDS
    );
    return {
      url: `https://t.me/${botUsername}?start=${token}`,
      expiresInSeconds: CONNECT_TTL_SECONDS,
    };
  }

  async createExternalConnectToken(
    channel: string,
    external: ExternalConnectPayload
  ): Promise<string> {
    const token = randomBytes(16).toString('hex');
    await ioRedis.set(
      extTokenKey(channel, token),
      JSON.stringify(external),
      'EX',
      CONNECT_TTL_SECONDS
    );
    return token;
  }

  async getExternalConnectPreview(
    channel: string,
    token: string
  ): Promise<{ username: string | null } | null> {
    if (!token || !/^[a-f0-9]{16,64}$/i.test(token)) {
      return null;
    }
    const raw = await ioRedis.get(extTokenKey(channel, token));
    if (!raw) {
      return null;
    }
    try {
      const external = JSON.parse(raw) as ExternalConnectPayload;
      return { username: external.externalUsername ?? null };
    } catch {
      return null;
    }
  }

  async confirmExternalToken(
    userId: string,
    organizationId: string,
    channel: string,
    token: string
  ): Promise<CommunicationChannelLink> {
    if (!token || !/^[a-f0-9]{16,64}$/i.test(token)) {
      throw new BadRequestException('Invalid connection token');
    }
    await this.assertUserCanConnect(userId, organizationId);
    const external = await consumeRedisJson<ExternalConnectPayload>(
      extTokenKey(channel, token)
    );
    if (!external) {
      throw new BadRequestException('Connection link expired or already used');
    }
    return this._repository.upsertLink({
      userId,
      organizationId,
      channel,
      externalUserId: external.externalUserId,
      externalChatId: external.externalChatId,
      externalUsername: external.externalUsername,
    });
  }

  async confirmWebToken(
    channel: string,
    token: string,
    external: ExternalConnectPayload
  ): Promise<CommunicationChannelLink | null> {
    if (!token || !/^[a-f0-9]{16,64}$/i.test(token)) {
      return null;
    }
    const payload = await consumeRedisJson<WebConnectPayload>(
      webTokenKey(token)
    );
    if (!payload || payload.channel !== channel) {
      return null;
    }
    const membership = await this._repository.findMembership(
      payload.userId,
      payload.organizationId
    );
    if (!membership || !(await this.hasAiAccess(payload.organizationId))) {
      return null;
    }
    return this._repository.upsertLink({
      userId: payload.userId,
      organizationId: payload.organizationId,
      channel,
      externalUserId: external.externalUserId,
      externalChatId: external.externalChatId,
      externalUsername: external.externalUsername,
    });
  }

  async disconnect(
    userId: string,
    organizationId: string,
    channel: string
  ): Promise<{ disconnected: boolean }> {
    const deleted = await this._repository.deleteByUserAndOrg(
      userId,
      organizationId,
      channel
    );
    return { disconnected: deleted > 0 };
  }

  async getAuthorizedLink(
    channel: string,
    externalUserId: string
  ): Promise<
    | { status: 'unlinked' }
    | { status: 'unauthorized' }
    | { status: 'ok'; link: CommunicationChannelLink }
  > {
    const link = await this._repository.findByExternalUser(
      channel,
      externalUserId
    );
    if (!link) {
      return { status: 'unlinked' };
    }
    const membership = await this._repository.findMembership(
      link.userId,
      link.organizationId
    );
    if (!membership || !(await this.hasAiAccess(link.organizationId))) {
      return { status: 'unauthorized' };
    }
    return { status: 'ok', link };
  }

  async listThreadsForExternalUser(
    channel: string,
    externalUserId: string
  ): Promise<Array<{ id: string; title: string }>> {
    const auth = await this.getAuthorizedLink(channel, externalUserId);
    if (auth.status !== 'ok') {
      return [];
    }
    const mastra = await this._mastraService.mastra();
    const memory = await loadThreadMemory(() =>
      mastra.getAgent('postiz').getMemory()
    );
    if (!memory) {
      throw new ServiceUnavailableException('Conversation memory unavailable');
    }
    const list = await memory.listThreads({
      filter: { resourceId: auth.link.organizationId },
      perPage: 10,
      page: 0,
      orderBy: { field: 'createdAt', direction: 'DESC' },
    });
    return list.threads.map((t) => ({
      id: t.id,
      title: t.title || 'Untitled chat',
    }));
  }

  async selectThreadForExternalUser(
    channel: string,
    externalUserId: string,
    threadId: string
  ): Promise<{ ok: boolean; title?: string }> {
    const auth = await this.getAuthorizedLink(channel, externalUserId);
    if (auth.status !== 'ok') {
      return { ok: false };
    }
    const mastra = await this._mastraService.mastra();
    const memory = await loadThreadMemory(() =>
      mastra.getAgent('postiz').getMemory()
    );
    if (!memory) {
      return { ok: false };
    }
    try {
      await assertThreadAccess(memory, auth.link.organizationId, threadId);
      await assertThreadExists(memory, auth.link.organizationId, threadId);
      const thread = await memory.getThreadById({ threadId });
      await this._repository.updateActiveThread(auth.link.id, threadId);
      return { ok: true, title: thread?.title || 'Chat' };
    } catch (error) {
      if (
        error instanceof ForbiddenException ||
        error instanceof NotFoundException
      ) {
        return { ok: false };
      }
      throw error;
    }
  }

  async startNewThreadForExternalUser(
    channel: string,
    externalUserId: string
  ): Promise<boolean> {
    const auth = await this.getAuthorizedLink(channel, externalUserId);
    if (auth.status !== 'ok') {
      return false;
    }
    await this._repository.updateActiveThread(auth.link.id, null);
    return true;
  }

  async handleIncomingMessage(
    channel: string,
    externalUserId: string,
    messageText: string
  ): Promise<IncomingChannelResult> {
    const auth = await this.getAuthorizedLink(channel, externalUserId);
    if (auth.status !== 'ok') {
      return { status: auth.status };
    }

    const lockKey = userLockKey(channel, externalUserId);
    const lockToken = randomUUID();
    const acquired = await ioRedis.set(
      lockKey,
      lockToken,
      'EX',
      LOCK_TTL_SECONDS,
      'NX'
    );
    if (!acquired) {
      throw new ServiceUnavailableException('Another message is being processed');
    }

    let prepared: Awaited<ReturnType<AgentRuntimeService['prepare']>> | null =
      null;
    try {
      const mastra = await this._mastraService.mastra();
      const agent = mastra.getAgent('postiz');
      const memory = await loadThreadMemory(() => agent.getMemory());

      let threadId = auth.link.activeThreadId;
      if (threadId) {
        if (!memory) {
          throw new ServiceUnavailableException(
            'Conversation memory unavailable'
          );
        }
        try {
          await assertThreadAccess(memory, auth.link.organizationId, threadId);
          await assertThreadExists(memory, auth.link.organizationId, threadId);
        } catch {
          threadId = null;
        }
      }

      if (!threadId) {
        threadId = randomUUID();
        await this._repository.updateActiveThread(auth.link.id, threadId);
      }

      prepared = await this._agentRuntime.prepare(auth.link.organizationId, {
        ui: false,
        external: true,
      });

      const requestContext = new RequestContext();
      requestContext.setRaw('ui', 'false');
      requestContext.setRaw('client', channel);
      requestContext.setRaw(
        'organization',
        JSON.stringify({ id: auth.link.organizationId })
      );
      applyTraceIdentity(requestContext, {
        organizationId: auth.link.organizationId,
        threadId,
        userId: auth.link.userId,
      });
      prepared.applyTo(requestContext);

      const stream = await agent.stream(messageText, {
        memory: {
          thread: threadId,
          resource: auth.link.organizationId,
        },
        requestContext,
      });

      const [text, steps] = await Promise.all([stream.text, stream.steps]);
      const generatedImages = extractGeneratedImages(steps);
      return {
        status: 'ok',
        threadId,
        text: text || '',
        generatedImages,
      };
    } finally {
      if (prepared) {
        await prepared.release();
      }
      const currentLock = await ioRedis.get(lockKey);
      if (currentLock === lockToken) {
        await ioRedis.del(lockKey);
      }
    }
  }
}
