import type { ResolvedAgentConfig } from '@gitroom/helpers/agent/agent.config.schema';
import type { ResolvedPrompt } from '@gitroom/nestjs-libraries/chat/langfuse.prompt.service';

export const AGENT_RUNTIME = Symbol('AGENT_RUNTIME');

export type PreparedAgentForRuntime = {
  config: ResolvedAgentConfig;
  prompt?: ResolvedPrompt;
  titlePrompt?: ResolvedPrompt;
  model: unknown;
  tools: Record<string, unknown>;
  skills: unknown[];
};

export interface AgentRequestContext {
  getRaw(key: string): unknown;
  setRaw(key: string, value: unknown): void;
}

export type AgentRuntimeLike = {
  ensurePrepared(
    requestContext: AgentRequestContext
  ): Promise<PreparedAgentForRuntime>;
};
