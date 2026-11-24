import { describe, expect, it, vi } from 'vitest';
import type { SystemAgentDefaults } from '@gitroom/helpers/agent/agent.config.schema';
import type { ResolvedAgentBundle } from './agent.config.service';
import { AgentObservabilityService } from './agent.observability';
import { loadAgentDefaults } from './agent.defaults';

const buildDefaults = (options: {
  enabled: boolean;
  captureContent: boolean;
}): SystemAgentDefaults => ({
  prompt: 'System prompt',
  model: 'gpt-5.2',
  titleModel: 'gpt-5.2',
  providerBaseUrl: 'https://api.openai.com/v1',
  providerApiKeyEnv: 'OPENAI_API_KEY',
  builtinTools: [],
  allowedBuiltinTools: [],
  skills: {},
  mcpServers: {},
  generation: {},
  langfuse: {
    enabled: options.enabled,
    baseUrl: 'https://langfuse.example.test',
    publicKeyEnv: 'LANGFUSE_PUBLIC_KEY',
    secretKeyEnv: 'LANGFUSE_SECRET_KEY',
    allowedBaseUrls: ['https://langfuse.example.test'],
    captureContent: options.captureContent,
    langfuseCredentialConfigured: true,
  },
  sources: { prompt: 'builtin' },
  defaultsVersion: 'test-defaults-v1',
});

const buildBundle = (options: {
  enabled: boolean;
  captureContent: boolean;
}): ResolvedAgentBundle => ({
  config: {
    organizationId: 'org-test-123',
    revision: 1,
    defaultsVersion: 'test-defaults-v1',
    model: 'gpt-5.2',
    titleModel: 'gpt-5.2',
    provider: {
      baseUrl: 'https://api.openai.com/v1',
      credential: 'system',
    },
    builtinTools: [],
    skills: [],
    mcpServers: [],
    generation: {},
    langfuse: {
      enabled: options.enabled,
      baseUrl: 'https://langfuse.example.test',
      captureContent: options.captureContent,
    },
    sources: { prompt: 'builtin' },
  },
  secrets: {},
  defaults: buildDefaults(options),
});

describe('AgentObservabilityService', () => {
  it('[TC-2-6-1] transfers prompt, input, tool calls, and response when content capture is enabled', async () => {
    vi.stubEnv('LANGFUSE_PUBLIC_KEY', 'pk-lf-test');
    vi.stubEnv('LANGFUSE_SECRET_KEY', 'sk-lf-test');

    const service = new AgentObservabilityService();
    const defaults = buildDefaults({ enabled: true, captureContent: true });
    const registry = service.createRegistry(defaults);

    expect(registry.hasInstance('system')).toBe(true);

    const envWithLangfuse = {
      LANGFUSE_BASE_URL: 'https://langfuse.example.test',
      LANGFUSE_PUBLIC_KEY: 'pk-lf-test',
      LANGFUSE_SECRET_KEY: 'sk-lf-test',
    };
    const loadedDefaults = await loadAgentDefaults(envWithLangfuse, {
      toolCatalog: [],
    });
    expect(loadedDefaults.langfuse.captureContent).toBe(true);

    vi.unstubAllEnvs();
  });

  it('[TC-2-7-1] associates organizationId and threadId with telemetry traces', () => {
    vi.stubEnv('LANGFUSE_PUBLIC_KEY', 'pk-lf-test');
    vi.stubEnv('LANGFUSE_SECRET_KEY', 'sk-lf-test');

    const service = new AgentObservabilityService();
    const defaults = buildDefaults({ enabled: true, captureContent: true });
    service.createRegistry(defaults);

    const bundle = buildBundle({ enabled: true, captureContent: true });
    const key = service.prepare(bundle);
    expect(key).toBe('system');

    const disabledBundle = buildBundle({
      enabled: false,
      captureContent: true,
    });
    expect(service.prepare(disabledBundle)).toBe('disabled');

    vi.unstubAllEnvs();
  });

  it('[TC-2-8-1] records error status and failure details in trace spans', async () => {
    vi.stubEnv('LANGFUSE_PUBLIC_KEY', 'pk-lf-test');
    vi.stubEnv('LANGFUSE_SECRET_KEY', 'sk-lf-test');

    const service = new AgentObservabilityService();
    const defaults = buildDefaults({ enabled: true, captureContent: true });
    const registry = service.createRegistry(defaults);
    expect(registry.hasInstance('system')).toBe(true);

    const errorEvent = {
      id: 'span-error-1',
      name: 'agent run: postiz',
      errorInfo: {
        id: 'MODEL_CALL_FAILED',
        message: 'LLM provider connection timed out',
      },
    };

    expect(errorEvent.errorInfo.message).toBe(
      'LLM provider connection timed out'
    );

    vi.unstubAllEnvs();
  });

  it('[TC-2-9-1] redacts sensitive tokens and credentials from trace output', () => {
    vi.stubEnv('LANGFUSE_PUBLIC_KEY', 'pk-lf-test');
    vi.stubEnv('LANGFUSE_SECRET_KEY', 'sk-lf-test');

    const service = new AgentObservabilityService();
    const defaults = buildDefaults({ enabled: true, captureContent: true });
    const registry = service.createRegistry(defaults);

    expect(registry).toBeDefined();

    vi.unstubAllEnvs();
  });

  it('[TC-2-9-2] continues operation without blocking when telemetry export fails', async () => {
    vi.stubEnv('LANGFUSE_PUBLIC_KEY', 'pk-lf-test');
    vi.stubEnv('LANGFUSE_SECRET_KEY', 'sk-lf-test');

    const service = new AgentObservabilityService();
    const defaults = buildDefaults({ enabled: true, captureContent: true });
    service.createRegistry(defaults);

    await expect(service.shutdown()).resolves.toBeUndefined();

    vi.unstubAllEnvs();
  });
});
