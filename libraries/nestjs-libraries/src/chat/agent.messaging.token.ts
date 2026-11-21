import type { MastraService } from '@gitroom/nestjs-libraries/chat/mastra.service';

export const AGENT_MESSAGING = Symbol('AGENT_MESSAGING');

export type AgentMessagingLike = Pick<MastraService, 'mastra'>;
