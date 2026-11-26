import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@gitroom/nestjs-libraries/chat/load.tools.service', () => ({
  LoadToolsService: class {},
}));

import type { SystemAgentDefaults } from '@gitroom/helpers/agent/agent.config.schema';
import {
  DEFAULT_TITLE_INSTRUCTIONS,
  LangfusePromptService,
  SYSTEM_PROMPT_NAME,
  TITLE_PROMPT_NAME,
  resolvePromptLabel,
} from './langfuse.prompt.service';

const buildDefaults = (overrides?: Partial<SystemAgentDefaults['langfuse']>): SystemAgentDefaults => ({
  prompt: 'Local fallback system prompt',
  model: 'gpt-5.2',
  titleModel: 'gpt-5.2',
  imageModel: 'chatgpt-image-latest',
  providerBaseUrl: 'https://api.openai.com/v1',
  providerApiKeyEnv: 'OPENAI_API_KEY',
  builtinTools: [],
  allowedBuiltinTools: [],
  skills: {},
  mcpServers: {},
  generation: {},
  capabilities: { imageRead: true, imageGenerate: false },
  langfuse: {
    enabled: true,
    baseUrl: 'https://langfuse.example.test',
    publicKeyEnv: 'LANGFUSE_PUBLIC_KEY',
    secretKeyEnv: 'LANGFUSE_SECRET_KEY',
    allowedBaseUrls: ['https://langfuse.example.test'],
    captureContent: true,
    langfuseCredentialConfigured: true,
    ...overrides,
  },
  sources: { prompt: 'file' },
  defaultsVersion: 'test-v1',
});

describe('LangfusePromptService', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('[TC-12-1-1] fetches system and title prompts using NODE_ENV as label and defaults to production', async () => {
    vi.stubEnv('LANGFUSE_PUBLIC_KEY', 'pk-lf-test');
    vi.stubEnv('LANGFUSE_SECRET_KEY', 'sk-lf-test');
    vi.stubEnv('NODE_ENV', 'staging');

    const getPrompt = vi.fn(async (name: string) => ({
      name,
      version: name === SYSTEM_PROMPT_NAME ? 3 : 2,
      prompt: `Managed ${name}`,
      isFallback: false,
    }));

    const service = new LangfusePromptService(
      { get: async () => buildDefaults() },
      () => ({ prompt: { get: getPrompt } })
    );

    const system = await service.getSystemPrompt();
    const title = await service.getTitlePrompt();

    expect(resolvePromptLabel({})).toBe('production');
    expect(getPrompt).toHaveBeenNthCalledWith(
      1,
      SYSTEM_PROMPT_NAME,
      expect.objectContaining({ label: 'staging', type: 'text' })
    );
    expect(getPrompt).toHaveBeenNthCalledWith(
      2,
      TITLE_PROMPT_NAME,
      expect.objectContaining({ label: 'staging', type: 'text' })
    );
    expect(system).toEqual({
      name: SYSTEM_PROMPT_NAME,
      version: 3,
      text: `Managed ${SYSTEM_PROMPT_NAME}`,
      isFallback: false,
    });
    expect(title).toEqual({
      name: TITLE_PROMPT_NAME,
      version: 2,
      text: `Managed ${TITLE_PROMPT_NAME}`,
      isFallback: false,
    });
  });

  it('[TC-12-3-1] returns cached prompt immediately while refreshing expired entry in background', async () => {
    vi.stubEnv('LANGFUSE_PUBLIC_KEY', 'pk-lf-test');
    vi.stubEnv('LANGFUSE_SECRET_KEY', 'sk-lf-test');
    vi.stubEnv('LANGFUSE_PROMPT_CACHE_TTL_SECONDS', '0');

    let calls = 0;
    let resolveBackground:
      | ((value: {
          name: string;
          version: number;
          prompt: string;
          isFallback: boolean;
        }) => void)
      | undefined;
    const getPrompt = vi.fn((name: string) => {
      calls += 1;
      if (calls === 1) {
        return Promise.resolve({
          name,
          version: 1,
          prompt: 'Cached v1 prompt',
          isFallback: false,
        });
      }
      return new Promise<{
        name: string;
        version: number;
        prompt: string;
        isFallback: boolean;
      }>((resolve) => {
        resolveBackground = resolve;
      });
    });

    const service = new LangfusePromptService(
      { get: async () => buildDefaults() },
      () => ({ prompt: { get: getPrompt } })
    );

    const first = await service.getSystemPrompt();
    expect(first.text).toBe('Cached v1 prompt');

    const second = await Promise.race([
      service.getSystemPrompt(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Prompt fetch blocked on background refresh')), 100)
      ),
    ]);

    expect(second.text).toBe('Cached v1 prompt');
    expect(getPrompt).toHaveBeenCalledTimes(2);
    resolveBackground?.({
      name: SYSTEM_PROMPT_NAME,
      version: 2,
      prompt: 'Refreshed v2 prompt',
      isFallback: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const third = await service.getSystemPrompt();
    expect(third.text).toBe('Refreshed v2 prompt');
  });

  it('[TC-12-3-2] pre-warms prompts on startup without blocking module initialization', async () => {
    vi.stubEnv('LANGFUSE_PUBLIC_KEY', 'pk-lf-test');
    vi.stubEnv('LANGFUSE_SECRET_KEY', 'sk-lf-test');

    let resolveSlow: ((value: unknown) => void) | undefined;
    const getPrompt = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveSlow = resolve;
        })
    );

    const service = new LangfusePromptService(
      { get: async () => buildDefaults() },
      () => ({ prompt: { get: getPrompt } })
    );

    const started = Date.now();
    service.onModuleInit();
    const elapsedMs = Date.now() - started;

    expect(elapsedMs).toBeLessThan(50);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(getPrompt).toHaveBeenCalledTimes(2);
    resolveSlow?.({
      name: SYSTEM_PROMPT_NAME,
      version: 1,
      prompt: 'Warmed',
      isFallback: false,
    });
  });

  it('[TC-12-4-1] falls back to local prompt when Langfuse errors or label is missing', async () => {
    vi.stubEnv('LANGFUSE_PUBLIC_KEY', 'pk-lf-test');
    vi.stubEnv('LANGFUSE_SECRET_KEY', 'sk-lf-test');

    const getPrompt = vi.fn().mockRejectedValue(new Error('404 Label not found'));

    const service = new LangfusePromptService(
      { get: async () => buildDefaults() },
      () => ({ prompt: { get: getPrompt } })
    );

    const system = await service.getSystemPrompt();
    const title = await service.getTitlePrompt();

    expect(system).toEqual({
      name: SYSTEM_PROMPT_NAME,
      text: 'Local fallback system prompt',
      isFallback: true,
    });
    expect(title).toEqual({
      name: TITLE_PROMPT_NAME,
      text: DEFAULT_TITLE_INSTRUCTIONS,
      isFallback: true,
    });
  });
});
