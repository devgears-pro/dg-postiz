import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
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

@Controller('/communication-channels')
export class CommunicationChannelsController {
  constructor(private _channelsService: CommunicationChannelsService) {}

  private _assertChannel(channel: string) {
    if (channel !== 'telegram') {
      throw new BadRequestException('Unsupported communication channel');
    }
  }

  @Get('/:channel/status')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  async getStatus(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() organization: Organization,
    @Param('channel') channel: string
  ) {
    this._assertChannel(channel);
    return this._channelsService.getStatus(user.id, organization.id, channel);
  }

  @Post('/:channel/connect-link')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  async createConnectLink(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() organization: Organization,
    @Param('channel') channel: string
  ) {
    this._assertChannel(channel);
    return this._channelsService.createWebConnectLink(
      user.id,
      organization.id,
      channel
    );
  }

  @Post('/:channel/confirm')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  async confirmConnection(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() organization: Organization,
    @Param('channel') channel: string,
    @Body() body: { token?: string }
  ) {
    this._assertChannel(channel);
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
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() organization: Organization,
    @Param('channel') channel: string
  ) {
    this._assertChannel(channel);
    return this._channelsService.disconnect(user.id, organization.id, channel);
  }
}
