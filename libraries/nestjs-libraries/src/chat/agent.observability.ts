import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Observability } from '@mastra/observability';
import type { ObservabilityInstanceConfig } from '@mastra/observability';
import { LangfuseExporter } from '@mastra/langfuse';
import { SamplingStrategyType, SpanType } from '@mastra/core/observability';
import type {
  AnyExportedSpan,
  AnySpan,
  ObservabilityExporter,
  SpanOutputProcessor,
} from '@mastra/core/observability';
import type { SystemAgentDefaults } from '@gitroom/helpers/agent/agent.config.schema';
import type { ResolvedAgentBundle } from '@gitroom/nestjs-libraries/chat/agent.config.service';

const SERVICE_NAME = 'postiz-agent';
const TRACE_TAG = 'postiz';
const ORGANIZATION_TAG_PREFIX = 'org:';

export const REQUEST_CONTEXT_KEYS = [
  'organizationId',
  'userId',
  'sessionId',
  'threadId',
  'version',
  'defaultsVersion',
];

export const resolveAgentVersion = (): string | undefined =>
  process.env.NEXT_PUBLIC_VERSION?.trim() || undefined;

const hideContentProcessor: SpanOutputProcessor = {
  name: 'postiz-hide-agent-content',
  process: (span?: AnySpan) => {
    if (!span) return span;
    span.input = undefined;
    span.output = undefined;
    const attributes = span.attributes as Record<string, unknown> | undefined;
    if (attributes) {
      delete attributes.instructions;
      delete attributes.availableTools;
    }
    return span;
  },
  shutdown: async () => undefined,
};

export const inferenceInputProcessor: SpanOutputProcessor = {
  name: 'postiz-inference-input',
  process: (span?: AnySpan) => {
    if (!span) return span;
    if (span.type === SpanType.MODEL_INFERENCE && span.input === undefined) {
      const parentInput = span.parent?.input;
      if (parentInput !== undefined) span.input = parentInput;
    }
    return span;
  },
  shutdown: async () => undefined,
};

export const withTenantTags = (span: AnyExportedSpan): AnyExportedSpan => {
  const organizationId = span.metadata?.organizationId;
  if (span.isRootSpan && typeof organizationId === 'string' && organizationId) {
    span.tags = [
      ...(span.tags ?? []),
      TRACE_TAG,
      `${ORGANIZATION_TAG_PREFIX}${organizationId}`,
    ];
  }

  return span;
};

const noopExporter = {
  name: 'postiz-disabled',
  exportTracingEvent: async (): Promise<void> => undefined,
  flush: async (): Promise<void> => undefined,
  shutdown: async (): Promise<void> => undefined,
};

export const buildTraceConfig = (
  exporter: ObservabilityExporter,
  captureContent: boolean
): Omit<ObservabilityInstanceConfig, 'name'> => ({
  serviceName: SERVICE_NAME,
  exporters: [exporter],
  requestContextKeys: REQUEST_CONTEXT_KEYS,
  excludeSpanTypes: [SpanType.MODEL_CHUNK],
  spanOutputProcessors: [
    inferenceInputProcessor,
    ...(captureContent ? [] : [hideContentProcessor]),
  ],
});

@Injectable()
export class AgentObservabilityService implements OnApplicationShutdown {
  private _logger = new Logger(AgentObservabilityService.name);
  private _registry?: Observability;

  createRegistry(defaults: SystemAgentDefaults): Observability {
    if (this._registry) return this._registry;

    const configs: Record<string, Omit<ObservabilityInstanceConfig, 'name'>> = {
      disabled: {
        serviceName: SERVICE_NAME,
        sampling: { type: SamplingStrategyType.NEVER },
        exporters: [noopExporter],
        requestContextKeys: REQUEST_CONTEXT_KEYS,
      },
    };

    if (defaults.langfuse.enabled && defaults.langfuse.baseUrl) {
      const publicKey = defaults.langfuse.publicKeyEnv
        ? process.env[defaults.langfuse.publicKeyEnv]
        : undefined;
      const secretKey = defaults.langfuse.secretKeyEnv
        ? process.env[defaults.langfuse.secretKeyEnv]
        : undefined;

      if (publicKey && secretKey) {
        configs.system = buildTraceConfig(
          new LangfuseExporter({
            publicKey,
            secretKey,
            baseUrl: defaults.langfuse.baseUrl,
            release: resolveAgentVersion(),
            environment: process.env.NODE_ENV,
            customSpanFormatter: withTenantTags,
          }),
          defaults.langfuse.captureContent
        );
      }
    }

    this._registry = new Observability({
      configs,
      configSelector: ({ requestContext }) => {
        const rawKey = requestContext?.getRaw('agentObservabilityKey');
        const key = typeof rawKey === 'string' ? rawKey : undefined;
        if (!key || !this._registry?.hasInstance(key)) return 'disabled';
        return key;
      },
      sensitiveDataFilter: true,
    });

    return this._registry;
  }

  prepare(bundle: ResolvedAgentBundle): string {
    const registry = this._registry;
    if (!registry) return 'disabled';

    const langfuse = bundle.config.langfuse;
    if (!langfuse.enabled || !langfuse.baseUrl) return 'disabled';

    return registry.hasInstance('system') ? 'system' : 'disabled';
  }

  async shutdown(): Promise<void> {
    await this._registry?.shutdown().catch((error) => {
      this._logger.warn(`Could not shut down agent observability: ${error}`);
    });
  }

  onApplicationShutdown(): Promise<void> {
    return this.shutdown();
  }
}
