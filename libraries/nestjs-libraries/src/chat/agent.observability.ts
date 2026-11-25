import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Observability } from '@mastra/observability';
import type { ObservabilityInstanceConfig } from '@mastra/observability';
import { LangfuseExporter } from '@mastra/langfuse';
import { SamplingStrategyType, SpanType } from '@mastra/core/observability';
import type { AnySpan, SpanOutputProcessor } from '@mastra/core/observability';
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

type TenantSpan = {
  isRootSpan?: boolean;
  metadata?: Record<string, unknown>;
  tags?: string[];
};

export const withTenantTags = <T extends TenantSpan>(span: T): T => {
  const metadata = span.metadata;
  if (!metadata) return span;

  const organizationId = metadata.organizationId ?? metadata.resourceId;
  if (
    metadata.organizationId === undefined &&
    typeof organizationId === 'string'
  ) {
    metadata.organizationId = organizationId;
  }

  if (
    span.isRootSpan &&
    typeof metadata.organizationId === 'string' &&
    metadata.organizationId
  ) {
    span.tags = [
      TRACE_TAG,
      `${ORGANIZATION_TAG_PREFIX}${metadata.organizationId}`,
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

@Injectable()
export class AgentObservabilityService implements OnApplicationShutdown {
  private _logger = new Logger(AgentObservabilityService.name);
  private _registry?: Observability;

  createRegistry(defaults: SystemAgentDefaults): Observability {
    if (this._registry) return this._registry;

    const configs: Record<
      string,
      Omit<ObservabilityInstanceConfig, 'name'>
    > = {
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
        configs.system = {
          serviceName: SERVICE_NAME,
          exporters: [
            new LangfuseExporter({
              publicKey,
              secretKey,
              baseUrl: defaults.langfuse.baseUrl,
              release: resolveAgentVersion(),
              environment: process.env.NODE_ENV,
              customSpanFormatter: withTenantTags,
            }),
          ],
          requestContextKeys: REQUEST_CONTEXT_KEYS,
          excludeSpanTypes: [SpanType.MODEL_CHUNK],
          spanOutputProcessors: [
            inferenceInputProcessor,
            ...(defaults.langfuse.captureContent
              ? []
              : [hideContentProcessor]),
          ],
        };
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
