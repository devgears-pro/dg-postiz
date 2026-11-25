import { describe, expect, it, vi } from 'vitest';
import { RequestContext } from '@mastra/core/di';
import { SpanType } from '@mastra/core/observability';
import type { ObservabilityInstance } from '@mastra/core/observability';
import { Observability, TestExporter } from '@mastra/observability';
import type { SystemAgentDefaults } from '@gitroom/helpers/agent/agent.config.schema';
import type { ResolvedAgentBundle } from './agent.config.service';
import {
  AgentObservabilityService,
  REQUEST_CONTEXT_KEYS,
  inferenceInputProcessor,
  resolveAgentVersion,
  withTenantTags,
} from './agent.observability';
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
    const exporter = new TestExporter();
    const { registry, instance } = buildCapture(exporter);
    const messages = [{ role: 'user', content: 'How do I schedule a post?' }];
    const answer = { text: 'Open the calendar and pick a date.', toolCalls: [] };

    const span = instance.startSpan({
      name: 'agent run',
      type: SpanType.AGENT_RUN,
      input: messages,
      requestContext: buildRequestContext(),
    });
    span.update({ output: answer });
    span.end();
    await registry.flush();

    const [exported] = exporter.getSpansByType(SpanType.AGENT_RUN);
    const envWithLangfuse = {
      LANGFUSE_BASE_URL: 'https://langfuse.example.test',
      LANGFUSE_PUBLIC_KEY: 'pk-lf-test',
      LANGFUSE_SECRET_KEY: 'sk-lf-test',
    };
    const loadedDefaults = await loadAgentDefaults(envWithLangfuse, {
      toolCatalog: [],
    });

    expect(exported.input).toEqual(messages);
    expect(exported.output).toEqual(answer);
    expect(loadedDefaults.langfuse.captureContent).toBe(true);
  });

  it('[TC-2-8-1] records error status and failure details in trace spans', async () => {
    const exporter = new TestExporter();
    const { registry, instance } = buildCapture(exporter);
    const span = instance.startSpan({
      name: 'agent run',
      type: SpanType.AGENT_RUN,
      requestContext: buildRequestContext(),
    });

    span.error({ error: new Error('The model provider timed out') });
    await registry.flush();

    const [exported] = exporter.getSpansByType(SpanType.AGENT_RUN);
    expect(exported.errorInfo?.message).toBe('The model provider timed out');
    expect(exported.endTime).toBeDefined();
  });

  it('[TC-2-9-1] redacts sensitive tokens and credentials from trace output', async () => {
    const exporter = new TestExporter();
    const { registry, instance } = buildCapture(exporter, {
      sensitiveDataFilter: true,
    });
    const span = instance.startSpan({
      name: 'agent run',
      type: SpanType.AGENT_RUN,
      requestContext: buildRequestContext(),
      metadata: { token: 'sk-live-secret-value' },
    });

    span.end();
    await registry.flush();

    const [exported] = exporter.getSpansByType(SpanType.AGENT_RUN);
    expect(exported.metadata.token).not.toBe('sk-live-secret-value');
    expect(String(exported.metadata.token)).toContain('REDACTED');
  });

  it('[TC-2-9-2] continues operation without blocking when telemetry export fails', async () => {
    const failingExporter = {
      name: 'failing-exporter',
      exportTracingEvent: async (): Promise<void> => {
        throw new Error('Langfuse is unreachable');
      },
    };
    const registry = new Observability({
      configs: {
        test: {
          serviceName: 'postiz-agent',
          exporters: [failingExporter],
          requestContextKeys: REQUEST_CONTEXT_KEYS,
        },
      },
      configSelector: () => 'test',
    });
    const instance = registry.getInstance('test');
    if (!instance) throw new Error('The test observability instance is missing');

    const span = instance.startSpan({
      name: 'agent run',
      type: SpanType.AGENT_RUN,
      requestContext: buildRequestContext(),
    });
    span.end();

    await expect(registry.flush()).resolves.toBeUndefined();
    await expect(registry.shutdown()).resolves.toBeUndefined();
  });
});

type CaptureOptions = {
  sensitiveDataFilter?: boolean;
  excludeSpanTypes?: SpanType[];
};

const buildCapture = (
  exporter: TestExporter,
  options: CaptureOptions = {}
): { registry: Observability; instance: ObservabilityInstance } => {
  const registry = new Observability({
    configs: {
      test: {
        serviceName: 'postiz-agent',
        exporters: [exporter],
        requestContextKeys: REQUEST_CONTEXT_KEYS,
        spanOutputProcessors: [inferenceInputProcessor],
        ...(options.excludeSpanTypes
          ? { excludeSpanTypes: options.excludeSpanTypes }
          : {}),
      },
    },
    configSelector: () => 'test',
    sensitiveDataFilter: options.sensitiveDataFilter ?? false,
  });

  const instance = registry.getInstance('test');
  if (!instance) throw new Error('The test observability instance is missing');
  return { registry, instance };
};

const buildRequestContext = (): RequestContext => {
  const requestContext = new RequestContext();
  requestContext.setRaw('organizationId', 'org-test-123');
  requestContext.setRaw('userId', 'user-test-1');
  requestContext.setRaw('sessionId', 'org-test-123:thread-test-1');
  requestContext.setRaw('threadId', 'thread-test-1');
  requestContext.setRaw('version', 'v2.26.0-dg-abc12345');
  return requestContext;
};

describe('agent trace attributes', () => {
  it('[TC-2-7-1] associates organizationId and threadId with telemetry traces', async () => {
    vi.stubEnv('LANGFUSE_PUBLIC_KEY', 'pk-lf-test');
    vi.stubEnv('LANGFUSE_SECRET_KEY', 'sk-lf-test');
    const exporter = new TestExporter();
    const { registry, instance } = buildCapture(exporter);
    const requestContext = buildRequestContext();

    const span = instance.startSpan({
      name: 'agent run',
      type: SpanType.AGENT_RUN,
      requestContext,
    });
    span.end();
    await registry.flush();

    const [exported] = exporter.getSpansByType(SpanType.AGENT_RUN);
    const resourceOnly = withTenantTags({
      isRootSpan: true,
      metadata: { resourceId: 'org-test-123' },
      tags: [] as string[],
    });
    expect(exported.metadata.organizationId).toBe('org-test-123');
    expect(exported.metadata.threadId).toBe('thread-test-1');
    expect(withTenantTags(exported).tags).toEqual([
      'postiz',
      'org:org-test-123',
    ]);
    expect(resourceOnly.metadata.organizationId).toBe('org-test-123');

    const service = new AgentObservabilityService();
    service.createRegistry(
      buildDefaults({ enabled: true, captureContent: true })
    );
    expect(
      service.prepare(buildBundle({ enabled: true, captureContent: true }))
    ).toBe('system');
    expect(
      service.prepare(buildBundle({ enabled: false, captureContent: true }))
    ).toBe('disabled');

    vi.unstubAllEnvs();
  });

  it('[TC-2-10-1] associates the authenticated user with telemetry traces', async () => {
    const exporter = new TestExporter();
    const { registry, instance } = buildCapture(exporter);
    const requestContext = buildRequestContext();

    const span = instance.startSpan({
      name: 'agent run',
      type: SpanType.AGENT_RUN,
      requestContext,
    });
    span.end();
    await registry.flush();

    const [exported] = exporter.getSpansByType(SpanType.AGENT_RUN);
    expect(exported.metadata.userId).toBe('user-test-1');
  });

  it('[TC-2-12-1] copies the step input into the model inference span', async () => {
    const exporter = new TestExporter();
    const { registry, instance } = buildCapture(exporter);
    const requestContext = buildRequestContext();
    const messages = {
      messages: [{ role: 'user', content: 'How do I schedule a post?' }],
    };

    const step = instance.startSpan({
      name: 'model step',
      type: SpanType.MODEL_STEP,
      input: messages,
      requestContext,
    });
    const inference = instance.startSpan({
      name: 'inference',
      type: SpanType.MODEL_INFERENCE,
      parent: step,
    });
    inference.end();
    step.end();
    await registry.flush();

    const [exported] = exporter.getSpansByType(SpanType.MODEL_INFERENCE);
    expect(exported.input).toEqual(messages);
  });

  it('[TC-2-13-1] records the build version in release and version', async () => {
    vi.stubEnv('NEXT_PUBLIC_VERSION', 'v2.26.0-dg-abc12345');
    const exporter = new TestExporter();
    const { registry, instance } = buildCapture(exporter);
    const requestContext = buildRequestContext();

    const span = instance.startSpan({
      name: 'agent run',
      type: SpanType.AGENT_RUN,
      requestContext,
    });
    span.end();
    await registry.flush();

    const [exported] = exporter.getSpansByType(SpanType.AGENT_RUN);
    expect(resolveAgentVersion()).toBe('v2.26.0-dg-abc12345');
    expect(exported.metadata.version).toBe('v2.26.0-dg-abc12345');

    vi.unstubAllEnvs();
    expect(resolveAgentVersion()).toBeUndefined();
  });

  it('[TC-2-14-1] drops streaming chunks from exported observations', async () => {
    const exporter = new TestExporter();
    const { registry, instance } = buildCapture(exporter, {
      excludeSpanTypes: [SpanType.MODEL_CHUNK],
    });
    const requestContext = buildRequestContext();

    const root = instance.startSpan({
      name: 'agent run',
      type: SpanType.AGENT_RUN,
      requestContext,
    });
    const chunk = instance.startSpan({
      name: 'model_chunk',
      type: SpanType.MODEL_CHUNK,
      parent: root,
    });
    chunk.end();
    root.end();
    await registry.flush();

    expect(exporter.getSpansByType(SpanType.MODEL_CHUNK)).toHaveLength(0);
    expect(exporter.getSpansByType(SpanType.AGENT_RUN)).toHaveLength(1);
  });

  it('[TC-2-15-1] does not create observations when tracing is disabled', () => {
    vi.stubEnv('LANGFUSE_PUBLIC_KEY', 'pk-lf-test');
    vi.stubEnv('LANGFUSE_SECRET_KEY', 'sk-lf-test');
    const service = new AgentObservabilityService();
    const registry = service.createRegistry(
      buildDefaults({ enabled: false, captureContent: true })
    );
    const instance = registry.getInstance('disabled');
    if (!instance) throw new Error('The disabled instance is missing');

    const span = instance.startSpan({
      name: 'agent run',
      type: SpanType.AGENT_RUN,
      requestContext: buildRequestContext(),
    });

    expect(span.isValid).toBe(false);

    vi.unstubAllEnvs();
  });
});
