import { RequestContext } from '@mastra/core/di';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@gitroom/nestjs-libraries/chat/load.tools.service', () => ({
  LoadToolsService: class {},
}));

import type { SystemAgentDefaults } from '@gitroom/helpers/agent/agent.config.schema';
import { AgentRuntimeService } from './agent.runtime';
import type {
  AgentConfigService,
  ResolvedAgentBundle,
} from './agent.config.service';
import type { AgentConnectionsService } from './agent.connections';
import type { AgentObservabilityService } from './agent.observability';
import type { LoadToolsService } from './load.tools.service';

const buildDefaults = (): SystemAgentDefaults => ({
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
    enabled: true,
    baseUrl: 'https://langfuse.example.test',
    publicKeyEnv: 'LANGFUSE_PUBLIC_KEY',
    secretKeyEnv: 'LANGFUSE_SECRET_KEY',
    allowedBaseUrls: ['https://langfuse.example.test'],
    captureContent: true,
    langfuseCredentialConfigured: true,
  },
  sources: { prompt: 'builtin' },
  defaultsVersion: 'test-defaults-v1',
});

const buildBundle = (): ResolvedAgentBundle => ({
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
      enabled: true,
      baseUrl: 'https://langfuse.example.test',
      captureContent: true,
    },
    sources: { prompt: 'builtin' },
  },
  secrets: {},
  defaults: buildDefaults(),
});

const buildRuntime = () => {
  const configService = {
    resolve: async () => buildBundle(),
  } as unknown as AgentConfigService;
  const connections = {
    createModel: () => ({}),
    createTitleModel: () => ({}),
    acquireMcp: async () => ({
      tools: {},
      release: async () => undefined,
    }),
  } as unknown as AgentConnectionsService;
  const loadTools = {
    loadTools: async () => ({}),
  } as unknown as LoadToolsService;
  const observability = {
    prepare: () => 'system',
  } as unknown as AgentObservabilityService;

  return new AgentRuntimeService(
    configService,
    connections,
    loadTools,
    observability
  );
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('AgentRuntimeService trace context', () => {
  it('[TC-2-16-1] traces an external MCP run with the organization and client', async () => {
    vi.stubEnv('NEXT_PUBLIC_VERSION', 'v-test-build');
    const runtime = buildRuntime();
    const requestContext = new RequestContext();

    const prepared = await runtime.prepare('org-test-123', {
      ui: false,
      external: true,
    });
    prepared.applyTo(requestContext);

    expect(prepared.observabilityKey).toBe('system');
    expect(requestContext.getRaw('organizationId')).toBe('org-test-123');
    expect(requestContext.getRaw('client')).toBe('mcp');
    expect(requestContext.getRaw('version')).toBe('v-test-build');
  });

  it('[TC-2-16-2] marks a UI run as its own client', async () => {
    const runtime = buildRuntime();
    const requestContext = new RequestContext();

    const prepared = await runtime.prepare('org-test-123', { ui: true });
    prepared.applyTo(requestContext);

    expect(requestContext.getRaw('client')).toBe('ui');
  });
});
