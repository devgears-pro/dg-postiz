import {
  BadRequestException,
  Body,
  Logger,
  Controller,
  Delete,
  Get,
  Inject,
  Patch,
  Post,
  Req,
  Res,
  Query,
  Param,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  CopilotRuntime,
  EmptyAdapter,
  OpenAIAdapter,
  copilotRuntimeNodeHttpEndpoint,
} from '@copilotkit/runtime';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { Organization, User } from '@prisma/client';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { MastraAgent } from '@ag-ui/mastra';
import { MastraService } from '@gitroom/nestjs-libraries/chat/mastra.service';
import { Request, Response } from 'express';
import { RequestContext } from '@mastra/core/di';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { AgentRuntimeService } from '@gitroom/nestjs-libraries/chat/agent.runtime';
import { AgentConfigService } from '@gitroom/nestjs-libraries/chat/agent.config.service';
import type { AgentConfigView } from '@gitroom/helpers/agent/agent.config.schema';
import {
  applyTraceIdentity,
  assertThreadAccess,
  assertThreadExists,
  loadThreadMemory,
  readRequestThreadId,
  readThreadId,
} from '@gitroom/nestjs-libraries/chat/agent.trace';

export type ChannelsContext = {
  integrations: string;
  organization: string;
  ui: string;
};

type AgentLimitsView = {
  effective: { generation: AgentConfigView['effective']['generation'] };
};

const HISTORY_PAGE_SIZE = 200;

// the copilot runtime writes its own CORS headers on the response, keep them aligned with main.ts
const copilotCors = () => ({
  origin: [
    process.env.FRONTEND_URL,
    'http://localhost:6274',
    ...(process.env.MAIN_URL ? [process.env.MAIN_URL] : []),
  ],
  credentials: !process.env.NOT_SECURED,
});

@Controller('/copilot')
export class CopilotController {
  constructor(
    private _subscriptionService: SubscriptionService,
    private _mastraService: MastraService,
    private _agentRuntime: AgentRuntimeService,
    @Inject(AgentConfigService)
    private _agentConfig: {
      getView(organizationId: string): Promise<AgentLimitsView>;
    }
  ) {}

  private async threadMemory() {
    const mastra = await this._mastraService.mastra();
    const memory = await loadThreadMemory(() =>
      mastra.getAgent('postiz').getMemory()
    );
    if (!memory) {
      throw new ServiceUnavailableException(
        'Could not verify the conversation'
      );
    }
    return memory;
  }

  private paramThreadId(value: string) {
    const threadId = readThreadId({ threadId: value });
    if (!threadId) {
      throw new BadRequestException('Invalid conversation id');
    }
    return threadId;
  }

  @Post('/chat')
  chatAgent(@Req() req: Request, @Res() res: Response) {
    if (
      process.env.OPENAI_API_KEY === undefined ||
      process.env.OPENAI_API_KEY === ''
    ) {
      Logger.warn('OpenAI API key not set, chat functionality will not work');
      return;
    }

    const copilotRuntimeHandler = copilotRuntimeNodeHttpEndpoint({
      endpoint: '/copilot/chat',
      cors: copilotCors(),
      runtime: new CopilotRuntime(),
      serviceAdapter: new OpenAIAdapter({
        model: 'gpt-6.2-sol',
      }),
    });

    return copilotRuntimeHandler(req, res);
  }

  @Post('/agent')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  async agent(
    @Req() req: Request,
    @Res() res: Response,
    @GetOrgFromRequest() organization: Organization,
    @GetUserFromRequest() user: User
  ) {
    const threadId = readRequestThreadId(
      req?.body?.method,
      req?.body?.body,
      req?.body?.params
    );
    const mastra = await this._mastraService.mastra();

    if (threadId) {
      const memory = await loadThreadMemory(() =>
        mastra.getAgent('postiz').getMemory()
      );
      await assertThreadAccess(memory, organization.id, threadId);
    }

    const method = req?.body?.method;
    const skipPrepare =
      method === 'agent/connect' ||
      method === 'agent/stop' ||
      method === 'info';
    const prepared = skipPrepare
      ? undefined
      : await this._agentRuntime
          .prepare(organization.id, { ui: true })
          .catch((error) => {
            Logger.warn(
              `Could not prepare the agent for ${organization.id}: ${error}`
            );
            throw new ServiceUnavailableException(
              'The agent is not configured correctly for this organization'
            );
          });

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      prepared?.release().catch(() => undefined);
    };
    if (prepared) {
      res.on('finish', release);
      res.on('close', release);
    }

    const requestContext = new RequestContext<ChannelsContext>();
    requestContext.set(
      'integrations',
      req?.body?.body?.forwardedProps?.integrations || []
    );

    requestContext.set('organization', JSON.stringify(organization));
    requestContext.set('ui', 'true');
    applyTraceIdentity(requestContext, {
      organizationId: organization.id,
      userId: user.id,
      threadId,
    });
    prepared?.applyTo(requestContext);

    const agents = MastraAgent.getLocalAgents({
      resourceId: organization.id,
      mastra,
      requestContext: requestContext as unknown as RequestContext,
    });

    const runtime = new CopilotRuntime({
      agents,
    });

    const copilotRuntimeHandler = copilotRuntimeNodeHttpEndpoint({
      endpoint: '/copilot/agent',
      cors: copilotCors(),
      runtime,
      serviceAdapter: new EmptyAdapter(),
    });

    return copilotRuntimeHandler(req, res);
  }

  @Get('/limits')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  async limits(@GetOrgFromRequest() organization: Organization) {
    const view = await this._agentConfig.getView(organization.id);
    return { maxSteps: view.effective.generation.maxSteps };
  }

  @Get('/credits')
  calculateCredits(
    @GetOrgFromRequest() organization: Organization,
    @Query('type')
    type: 'ai_images' | 'ai_videos' | 'clipping_minutes'
  ) {
    return this._subscriptionService.checkCredits(
      organization,
      type || 'ai_images'
    );
  }

  @Get('/:thread/list')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  async getMessagesList(
    @GetOrgFromRequest() organization: Organization,
    @Param('thread') rawThreadId: string
  ): Promise<unknown> {
    const threadId = this.paramThreadId(rawThreadId);
    const memory = await this.threadMemory();
    await assertThreadExists(memory, organization.id, threadId);
    try {
      const page = await memory.recall({
        resourceId: organization.id,
        threadId,
        perPage: HISTORY_PAGE_SIZE,
        orderBy: { field: 'createdAt', direction: 'DESC' },
      });
      const messages = [...page.messages].sort((a, b) => {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return aTime - bTime;
      });
      return { ...page, messages };
    } catch (err) {
      Logger.warn(`Could not recall messages for thread ${threadId}: ${err}`);
      throw new ServiceUnavailableException('Could not load the conversation');
    }
  }

  @Patch('/:thread')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  async renameThread(
    @GetOrgFromRequest() organization: Organization,
    @Param('thread') rawThreadId: string,
    @Body() body: { title?: unknown }
  ) {
    const threadId = this.paramThreadId(rawThreadId);
    const title =
      typeof body?.title === 'string'
        ? body.title.trim().replace(/\s+/g, ' ')
        : '';
    if (!title || title.length > 200) {
      throw new BadRequestException(
        'The conversation title must be between 1 and 200 characters'
      );
    }
    if (
      /[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/.test(
        title
      )
    ) {
      throw new BadRequestException(
        'The conversation title contains unsupported characters'
      );
    }

    const memory = await this.threadMemory();
    await assertThreadExists(memory, organization.id, threadId);
    const updated = await memory.updateThread({ id: threadId, title });
    return { id: updated.id, title: updated.title };
  }

  @Delete('/:thread')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  async deleteThread(
    @GetOrgFromRequest() organization: Organization,
    @Param('thread') rawThreadId: string
  ) {
    const threadId = this.paramThreadId(rawThreadId);
    const memory = await this.threadMemory();
    await assertThreadExists(memory, organization.id, threadId);
    await memory.deleteThread(threadId);
    return { id: threadId };
  }

  @Get('/list')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  async getList(@GetOrgFromRequest() organization: Organization) {
    const memory = await this.threadMemory();
    const list = await memory.listThreads({
      filter: { resourceId: organization.id },
      perPage: 100000,
      page: 0,
      orderBy: { field: 'createdAt', direction: 'DESC' },
    });

    return {
      threads: list.threads.map((p) => ({
        id: p.id,
        title: p.title,
      })),
    };
  }
}
