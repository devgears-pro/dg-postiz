import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { LangfuseClient } from '@langfuse/client';
import type { SystemAgentDefaults } from '@gitroom/helpers/agent/agent.config.schema';
import { AgentDefaultsService } from './agent.defaults.service';
import { DEFAULT_TITLE_INSTRUCTIONS } from './agent.prompt';

export { DEFAULT_TITLE_INSTRUCTIONS };
export const SYSTEM_PROMPT_NAME = 'postiz-assistant';
export const TITLE_PROMPT_NAME = 'postiz-title';
export const DEFAULT_PROMPT_CACHE_TTL_SECONDS = 60;
const PROMPT_FETCH_TIMEOUT_MS = 2000;

export type ResolvedPrompt = {
  name: string;
  version?: number;
  text: string;
  isFallback: boolean;
};

export type AgentDefaultsReader = {
  get: () => Promise<SystemAgentDefaults>;
};

export type LangfusePromptClientLike = {
  prompt: {
    get: (
      name: string,
      options: {
        type: 'text';
        label?: string;
        cacheTtlSeconds?: number;
        fallback?: string;
        fetchTimeoutMs?: number;
        maxRetries?: number;
      }
    ) => Promise<{
      name?: string;
      version?: number;
      prompt: string;
      isFallback?: boolean;
    }>;
  };
};

export type LangfuseClientFactory = (config: {
  baseUrl: string;
  publicKey: string;
  secretKey: string;
}) => LangfusePromptClientLike;

export const resolvePromptLabel = (
  env: Record<string, string | undefined> = process.env
): string => env.NODE_ENV?.trim() || 'production';

const resolveCacheTtlMs = (
  env: Record<string, string | undefined> = process.env
): number => {
  const raw = env.LANGFUSE_PROMPT_CACHE_TTL_SECONDS?.trim();
  if (!raw) return DEFAULT_PROMPT_CACHE_TTL_SECONDS * 1000;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_PROMPT_CACHE_TTL_SECONDS * 1000;
  }
  return Math.floor(parsed * 1000);
};

type CacheEntry = {
  value: ResolvedPrompt;
  expiresAt: number;
};

@Injectable()
export class LangfusePromptService implements OnModuleInit {
  private readonly _logger = new Logger(LangfusePromptService.name);
  private readonly _cache = new Map<string, CacheEntry>();
  private readonly _inFlight = new Map<string, Promise<ResolvedPrompt>>();
  private _client?: { key: string; instance: LangfusePromptClientLike };

  constructor(
    @Inject(AgentDefaultsService)
    private readonly _defaults: AgentDefaultsReader,
    @Optional()
    private readonly _clientFactory?: LangfuseClientFactory
  ) {}

  onModuleInit(): void {
    void this.prewarm().catch((error) => {
      this._logger.warn(`Prompt pre-warm failed: ${error}`);
    });
  }

  async prewarm(): Promise<void> {
    await Promise.allSettled([this.getSystemPrompt(), this.getTitlePrompt()]);
  }

  async getSystemPrompt(): Promise<ResolvedPrompt> {
    const defaults = await this._defaults.get();
    return this._resolvePrompt(SYSTEM_PROMPT_NAME, defaults.prompt, defaults);
  }

  async getTitlePrompt(): Promise<ResolvedPrompt> {
    const defaults = await this._defaults.get();
    return this._resolvePrompt(
      TITLE_PROMPT_NAME,
      DEFAULT_TITLE_INSTRUCTIONS,
      defaults
    );
  }

  private async _resolvePrompt(
    name: string,
    fallbackText: string,
    defaults: SystemAgentDefaults
  ): Promise<ResolvedPrompt> {
    const { enabled, baseUrl, publicKeyEnv, secretKeyEnv } = defaults.langfuse;
    const publicKey = process.env[publicKeyEnv]?.trim();
    const secretKey = process.env[secretKeyEnv]?.trim();

    if (!enabled || !baseUrl || !publicKey || !secretKey) {
      return {
        name,
        text: fallbackText,
        isFallback: true,
      };
    }

    const label = resolvePromptLabel();
    const ttlMs = resolveCacheTtlMs();
    const cacheKey = `${baseUrl}|${label}|${name}`;
    const cached = this._cache.get(cacheKey);

    if (cached) {
      if (Date.now() >= cached.expiresAt) {
        void this._fetchAndCache(
          cacheKey,
          name,
          label,
          fallbackText,
          ttlMs,
          { baseUrl, publicKey, secretKey }
        );
      }
      return cached.value;
    }

    return this._fetchAndCache(
      cacheKey,
      name,
      label,
      fallbackText,
      ttlMs,
      { baseUrl, publicKey, secretKey }
    );
  }

  private _fetchAndCache(
    cacheKey: string,
    name: string,
    label: string,
    fallbackText: string,
    ttlMs: number,
    config: { baseUrl: string; publicKey: string; secretKey: string }
  ): Promise<ResolvedPrompt> {
    const existing = this._inFlight.get(cacheKey);
    if (existing) return existing;

    const promise = (async (): Promise<ResolvedPrompt> => {
      try {
        const client = this._getClient(config);
        const result = await client.prompt.get(name, {
          type: 'text',
          label,
          cacheTtlSeconds: 0,
          fallback: fallbackText,
          fetchTimeoutMs: PROMPT_FETCH_TIMEOUT_MS,
          maxRetries: 1,
        });

        if (result.isFallback || !result.prompt?.trim()) {
          const existingCache = this._cache.get(cacheKey);
          if (existingCache) {
            existingCache.expiresAt = Date.now() + ttlMs;
          }
          return {
            name,
            text: fallbackText,
            isFallback: true,
          };
        }

        const resolved: ResolvedPrompt = {
          name: result.name || name,
          version: result.version,
          text: result.prompt,
          isFallback: false,
        };

        this._cache.set(cacheKey, {
          value: resolved,
          expiresAt: Date.now() + ttlMs,
        });

        return resolved;
      } catch (error) {
        const existingCache = this._cache.get(cacheKey);
        if (existingCache) {
          existingCache.expiresAt = Date.now() + ttlMs;
        }
        const message = error instanceof Error ? error.message : String(error);
        this._logger.warn(
          `Failed to load Langfuse prompt "${name}" (label="${label}"): ${message}`
        );
        return {
          name,
          text: fallbackText,
          isFallback: true,
        };
      } finally {
        this._inFlight.delete(cacheKey);
      }
    })();

    this._inFlight.set(cacheKey, promise);
    return promise;
  }

  private _getClient(config: {
    baseUrl: string;
    publicKey: string;
    secretKey: string;
  }): LangfusePromptClientLike {
    const key = `${config.baseUrl}|${config.publicKey}|${config.secretKey}`;
    if (this._client?.key === key) {
      return this._client.instance;
    }

    const instance = this._clientFactory
      ? this._clientFactory(config)
      : (new LangfuseClient({
          baseUrl: config.baseUrl,
          publicKey: config.publicKey,
          secretKey: config.secretKey,
        }) as unknown as LangfusePromptClientLike);

    this._client = { key, instance };
    return instance;
  }
}
