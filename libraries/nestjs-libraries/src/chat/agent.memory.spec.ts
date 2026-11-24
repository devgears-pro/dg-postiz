import { describe, expect, it } from 'vitest';
import { AgentConfigService } from './agent.config.service';
import type {
  AgentConfigOverrides,
  SystemAgentDefaults,
} from '@gitroom/helpers/agent/agent.config.schema';
import {
  AgentConfigRepository,
  type AgentConfigRecord,
} from '../database/prisma/agent-config/agent.config.repository';
import type { AgentDefaultsProvider } from './agent.defaults.token';

const mockDefaults: SystemAgentDefaults = {
  prompt: 'Default system prompt',
  model: 'gpt-5.2',
  titleModel: 'gpt-5.2',
  providerBaseUrl: 'https://api.openai.com/v1',
  builtinTools: ['postsListTool'],
  allowedBuiltinTools: ['postsListTool'],
  skills: {
    'dg-marketing': {
      name: 'dg-marketing',
      description: 'Marketing practice for a business',
      instructions: 'Marketing instructions',
    },
  },
  mcpServers: {},
  generation: {},
  langfuse: {
    enabled: false,
    allowedBaseUrls: [],
    captureContent: false,
  },
  sources: { skills: 'file' },
  defaultsVersion: 'test-version',
};

class MockAgentConfigRepository extends AgentConfigRepository {
  private readonly configStore = new Map<string, AgentConfigRecord>();
  private readonly memoryStore = new Map<string, string[]>();

  constructor() {
    super(undefined as never);
  }

  override async find(orgId: string): Promise<AgentConfigRecord | null> {
    return this.configStore.get(orgId) ?? null;
  }

  override async create(input: {
    organizationId: string;
    overrides: AgentConfigOverrides;
  }): Promise<AgentConfigRecord> {
    const record: AgentConfigRecord = {
      organizationId: input.organizationId,
      schemaVersion: 1,
      revision: 1,
      overrides: input.overrides,
      encryptedSecrets: null,
      secretSummary: null,
      updatedById: null,
    };
    this.configStore.set(input.organizationId, record);
    return record;
  }

  override async update(
    orgId: string,
    revision: number,
    input: { overrides: AgentConfigOverrides }
  ): Promise<AgentConfigRecord | null> {
    const existing = this.configStore.get(orgId);
    const record: AgentConfigRecord = {
      organizationId: orgId,
      schemaVersion: 1,
      revision: (existing?.revision ?? revision) + 1,
      overrides: input.overrides,
      encryptedSecrets: null,
      secretSummary: null,
      updatedById: null,
    };
    this.configStore.set(orgId, record);
    return record;
  }

  override async getMemory(orgId: string): Promise<string[]> {
    return this.memoryStore.get(orgId) ?? [];
  }

  override async updateMemory(
    orgId: string,
    proverbs: string[]
  ): Promise<string[]> {
    this.memoryStore.set(orgId, proverbs);
    return proverbs;
  }

  override async clearMemory(orgId: string): Promise<void> {
    this.memoryStore.set(orgId, []);
  }
}

describe('Agent Working Memory Management', () => {
  const setup = () => {
    const repo = new MockAgentConfigRepository();
    const defaultsProvider: AgentDefaultsProvider = {
      get: async () => mockDefaults,
    };
    const service = new AgentConfigService(repo, defaultsProvider);
    return { repo, service };
  };

  it('returns empty proverbs when no memory exists', async () => {
    const { service } = setup();
    const res = await service.getMemory('org-1');
    expect(res).toEqual({ proverbs: [] });
  });

  it('updates and retrieves working memory facts', async () => {
    const { service } = setup();
    const facts = [
      'Always communicate in Ukrainian',
      'Brand tone: professional and direct',
    ];

    const updated = await service.updateMemory('org-1', facts);
    expect(updated).toEqual({ proverbs: facts });

    const retrieved = await service.getMemory('org-1');
    expect(retrieved).toEqual({ proverbs: facts });
  });

  it('clears working memory', async () => {
    const { service } = setup();
    await service.updateMemory('org-1', ['Rule to delete']);

    const cleared = await service.clearMemory('org-1');
    expect(cleared).toEqual({ proverbs: [] });

    const retrieved = await service.getMemory('org-1');
    expect(retrieved).toEqual({ proverbs: [] });
  });

  it('clears working memory on agent config reset', async () => {
    const { service, repo } = setup();
    const orgId = 'org-1';

    await repo.create({
      organizationId: orgId,
      overrides: { model: 'org-model' },
    });
    await service.updateMemory(orgId, ['Old persona rule: horse greeting']);

    await service.reset(orgId, 'user-1', 1);

    const config = await service.resolve(orgId);
    expect(config.config.model).toBe(mockDefaults.model);

    const memory = await service.getMemory(orgId);
    expect(memory).toEqual({ proverbs: [] });
  });

  it('enforces multi-tenant isolation for memory', async () => {
    const { service } = setup();
    await service.updateMemory('org-a', ['Fact for A']);
    await service.updateMemory('org-b', ['Fact for B']);

    expect(await service.getMemory('org-a')).toEqual({ proverbs: ['Fact for A'] });
    expect(await service.getMemory('org-b')).toEqual({ proverbs: ['Fact for B'] });
  });
});
