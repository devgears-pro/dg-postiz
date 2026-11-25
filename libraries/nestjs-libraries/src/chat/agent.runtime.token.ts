import type { ResolvedAgentConfig } from '@gitroom/helpers/agent/agent.config.schema';

export const AGENT_RUNTIME = Symbol('AGENT_RUNTIME');

export type PreparedAgentForRuntime = {
  config: ResolvedAgentConfig;
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
