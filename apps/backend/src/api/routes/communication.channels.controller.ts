import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Organization, User } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { CommunicationChannelsService } from '@gitroom/nestjs-libraries/chat/communication.channels.service';

export type CommunicationChannelsPort = Pick<
  CommunicationChannelsService,
  | 'getStatus'
  | 'createWebConnectLink'
  | 'getExternalConnectPreview'
  | 'confirmExternalToken'
  | 'disconnect'
>;

type UserIdentity = Pick<User, 'id'>;
type OrganizationIdentity = Pick<Organization, 'id'>;

@Controller('/communication-channels')
export class CommunicationChannelsController {
  constructor(
    @Inject(CommunicationChannelsService)
    private _channelsService: CommunicationChannelsPort
  ) {}

  private _assertChannel(channel: string) {
    if (channel !== 'telegram') {
      throw new BadRequestException('Unsupported communication channel');
    }
  }

  private _assertSameOrigin(origin: string | undefined) {
    if (!origin) {
      return;
    }
    const allowed = [process.env.FRONTEND_URL, process.env.MAIN_URL]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.replace(/\/+$/, ''));
    if (!allowed.includes(origin.replace(/\/+$/, ''))) {
      throw new ForbiddenException('Invalid origin');
    }
  }

  @Get('/:channel/status')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  async getStatus(
    @GetUserFromRequest() user: UserIdentity,
    @GetOrgFromRequest() organization: OrganizationIdentity,
    @Param('channel') channel: string
  ) {
    this._assertChannel(channel);
    return this._channelsService.getStatus(user.id, organization.id, channel);
  }

  @Post('/:channel/connect-link')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  async createConnectLink(
    @GetUserFromRequest() user: UserIdentity,
    @GetOrgFromRequest() organization: OrganizationIdentity,
    @Param('channel') channel: string,
    @Headers('origin') origin: string | undefined
  ) {
    this._assertChannel(channel);
    this._assertSameOrigin(origin);
    return this._channelsService.createWebConnectLink(
      user.id,
      organization.id,
      channel
    );
  }

  @Get('/:channel/connect-preview')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  async getConnectPreview(
    @Param('channel') channel: string,
    @Query('token') token: string
  ) {
    this._assertChannel(channel);
    const preview = await this._channelsService.getExternalConnectPreview(
      channel,
      token || ''
    );
    if (!preview) {
      throw new BadRequestException('Connection link expired or already used');
    }
    return preview;
  }

  @Post('/:channel/confirm')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  async confirmConnection(
    @GetUserFromRequest() user: UserIdentity,
    @GetOrgFromRequest() organization: OrganizationIdentity,
    @Param('channel') channel: string,
    @Body() body: { token?: string },
    @Headers('origin') origin: string | undefined
  ) {
    this._assertChannel(channel);
    this._assertSameOrigin(origin);
    const link = await this._channelsService.confirmExternalToken(
      user.id,
      organization.id,
      channel,
      body?.token || ''
    );
    return {
      connected: true,
      channel: link.channel,
      externalUsername: link.externalUsername,
    };
  }

  @Delete('/:channel')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  async disconnect(
    @GetUserFromRequest() user: UserIdentity,
    @GetOrgFromRequest() organization: OrganizationIdentity,
    @Param('channel') channel: string,
    @Headers('origin') origin: string | undefined
  ) {
    this._assertChannel(channel);
    this._assertSameOrigin(origin);
    return this._channelsService.disconnect(user.id, organization.id, channel);
  }
}
