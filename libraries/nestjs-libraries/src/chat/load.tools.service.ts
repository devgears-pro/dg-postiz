import { Injectable } from '@nestjs/common';
import { Agent } from '@mastra/core/agent';
import { openai } from '@ai-sdk/openai';
import { Memory } from '@mastra/memory';
import { pStore } from '@gitroom/nestjs-libraries/chat/mastra.store';
import { array, object, string } from 'zod';
import { ModuleRef } from '@nestjs/core';
import type { RequestContext } from '@mastra/core/di';
import { toolList } from '@gitroom/nestjs-libraries/chat/tools/tool.list';
import {
  AgentToolInterface,
  type ToolReturn,
} from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import {
  AGENT_RUNTIME,
  type AgentRequestContext,
  type AgentRuntimeLike,
} from '@gitroom/nestjs-libraries/chat/agent.runtime.token';
import {
  DEFAULT_TITLE_INSTRUCTIONS,
  renderAgentInstructions,
} from '@gitroom/nestjs-libraries/chat/agent.prompt';
import { AgentTimeProcessor } from '@gitroom/nestjs-libraries/chat/agent.time.processor';
import { AgentHistoryProcessor } from '@gitroom/nestjs-libraries/chat/agent.history.processor';
import { buildPromptTracingOptions } from '@gitroom/nestjs-libraries/chat/agent.observability';
import type { ResolvedPrompt } from '@gitroom/nestjs-libraries/chat/langfuse.prompt.service';

export const AgentState = object({
  proverbs: array(string()).default([]),
});

export const AGENT_WORKING_MEMORY = {
  enabled: true,
  schema: AgentState,
  useStateSignals: true,
};

export const AGENT_MEMORY_OPTIONS = {
  lastMessages: Number.MAX_SAFE_INTEGER,
};

type TitleModelContext = {
  get: (key: string) => unknown;
};

export const resolveTitleModel = (
  requestContext: TitleModelContext | undefined,
  env: NodeJS.ProcessEnv = process.env
) => {
  const prepared = requestContext?.get('agentTitleModel');
  if (prepared) return prepared;

  const configured =
    env.POSTIZ_AI_TITLE_MODEL?.trim() || env.POSTIZ_AI_MODEL?.trim();

  return openai.chat(configured || 'gpt-5.2');
};

@Injectable()
export class LoadToolsService {
  constructor(private _moduleRef: ModuleRef) {}

  async loadTools(mcpOnly = false): Promise<Record<string, ToolReturn>> {
    return (
      await Promise.all<{ name: string; tool: ToolReturn }>(
        toolList
          .map(
            (p) =>
              this._moduleRef.get(p, { strict: false }) as AgentToolInterface
          )
          .filter((p) => !!p.mcpOnly === mcpOnly)
          .filter((p) => !p.available || p.available())
          .map(async (p) => ({
            name: p.name as string,
            tool: await p.run(),
          }))
      )
    ).reduce(
      (all, current) => ({
        ...all,
        [current.name]: current.tool,
      }),
      {} as Record<string, ToolReturn>
    );
  }

  // Tools a self-hosted instance must have to connect through the relay
  // (every install has them, whatever features it configured)
  coreToolNames() {
    return toolList
      .map(
        (p) => this._moduleRef.get(p, { strict: false }) as AgentToolInterface
      )
      .filter((p) => !p.mcpOnly && !p.available && !p.optionalOnSelfHosted)
      .map((p) => p.name);
  }

  // The names the deployment can enable, read without creating any tool.
  catalog() {
    return toolList
      .map(
        (p) =>
          this._moduleRef.get(p, { strict: false }) as AgentToolInterface
      )
      .map((p) => p.name)
      .filter((name): name is string => Boolean(name));
  }

  async agent() {
    const memory = new Memory({
      storage: pStore,
      options: {
        generateTitle: {
          model: (({
            requestContext,
          }: {
            requestContext?: RequestContext<Record<string, unknown>>;
          }) => resolveTitleModel(requestContext)) as never,
          instructions: async ({
            requestContext,
          }: {
            requestContext?: RequestContext<unknown>;
          }) => {
            const titlePrompt = requestContext?.getRaw('agentTitlePrompt') as
              | ResolvedPrompt
              | undefined;
            if (titlePrompt?.text) return titlePrompt.text;
            if (!requestContext) return DEFAULT_TITLE_INSTRUCTIONS;
            const prepared = await this._runtime().ensurePrepared(
              requestContext as unknown as AgentRequestContext
            );
            return prepared.titlePrompt?.text ?? DEFAULT_TITLE_INSTRUCTIONS;
          },
        },
        workingMemory: AGENT_WORKING_MEMORY,
        ...AGENT_MEMORY_OPTIONS,
      },
    });
    const memoryStore = await memory.storage.getStore('memory');
    if (!memoryStore) {
      throw new Error('Mastra memory storage is unavailable');
    }

    return new Agent({
      id: 'postiz',
      name: 'postiz',
      description:
        'Agent that helps schedule and list social media posts for users',
      instructions: async ({ requestContext }) => {
        const prepared = await this._runtime().ensurePrepared(requestContext);
        return renderAgentInstructions({
          prompt: prepared.prompt?.text ?? prepared.config.prompt,
          ui: requestContext.get('ui') === 'true',
          client: String(requestContext.get('client') || ''),
        });
      },
      inputProcessors: [
        new AgentHistoryProcessor(memoryStore),
        new AgentTimeProcessor(),
      ],
      model: async ({ requestContext }) => {
        const prepared = await this._runtime().ensurePrepared(requestContext);
        return prepared.model as never;
      },
      tools: async ({ requestContext }) => {
        const prepared = await this._runtime().ensurePrepared(requestContext);
        return prepared.tools as never;
      },
      skills: async ({ requestContext }) => {
        const prepared = await this._runtime().ensurePrepared(requestContext);
        return prepared.skills as never;
      },
      defaultOptions: async ({ requestContext }) => {
        const prepared = await this._runtime().ensurePrepared(requestContext);
        const settings = prepared.config.generation;
        const maxSteps = settings.maxSteps;
        const tracingOptions = buildPromptTracingOptions(prepared.prompt);
        return {
          ...(maxSteps ? { maxSteps } : {}),
          ...(tracingOptions ? { tracingOptions } : {}),
          ...(settings.temperature !== undefined ||
          settings.maxOutputTokens !== undefined
            ? {
                modelSettings: {
                  ...(settings.temperature !== undefined
                    ? { temperature: settings.temperature }
                    : {}),
                  ...(settings.maxOutputTokens !== undefined
                    ? { maxOutputTokens: settings.maxOutputTokens }
                    : {}),
                },
              }
            : {}),
        } as never;
      },
      memory,
    });
  }

  private _runtime() {
    return this._moduleRef.get<AgentRuntimeLike>(AGENT_RUNTIME);
  }
}
