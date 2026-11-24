import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import type {
  AgentConfigOverrides,
  SystemAgentDefaults,
} from '@gitroom/helpers/agent/agent.config.schema';
import { AgentConfigService } from '../agent.config.service';
import {
  AgentConfigRepository,
  type AgentConfigRecord,
} from '../../database/prisma/agent-config/agent.config.repository';
import type { AgentDefaultsProvider } from '../agent.defaults.token';
import { SkillSaveTool } from './skill.save.tool';
import { SkillRemoveTool } from './skill.remove.tool';
import { SkillsListTool } from './skills.list.tool';

const mockDefaults: SystemAgentDefaults = {
  prompt: 'System prompt',
  model: 'gpt-4o',
  titleModel: 'gpt-4o-mini',
  providerBaseUrl: 'https://api.openai.com/v1',
  providerApiKeyEnv: 'OPENAI_API_KEY',
  builtinTools: ['skillSaveTool', 'skillRemoveTool', 'skillsListTool'],
  allowedBuiltinTools: ['skillSaveTool', 'skillRemoveTool', 'skillsListTool'],
  skills: {
    'dg-marketing': {
      name: 'dg-marketing',
      description: 'Marketing practice for a business',
      instructions: 'Marketing instructions',
    },
    humanizer: {
      name: 'humanizer',
      description: 'Rewrite text naturally',
      instructions: 'Humanizer instructions',
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
  private readonly store = new Map<string, AgentConfigRecord>();

  constructor() {
    super(undefined as never);
  }

  override async find(orgId: string): Promise<AgentConfigRecord | null> {
    return this.store.get(orgId) ?? null;
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
    this.store.set(input.organizationId, record);
    return record;
  }

  override async update(
    orgId: string,
    revision: number,
    input: { overrides: AgentConfigOverrides }
  ): Promise<AgentConfigRecord | null> {
    const existing = this.store.get(orgId);
    const record: AgentConfigRecord = {
      organizationId: orgId,
      schemaVersion: 1,
      revision: (existing?.revision ?? revision) + 1,
      overrides: input.overrides,
      encryptedSecrets: null,
      secretSummary: null,
      updatedById: null,
    };
    this.store.set(orgId, record);
    return record;
  }
}

describe('Agent Skills Management', () => {
  const setup = () => {
    const repo = new MockAgentConfigRepository();
    const defaultsProvider: AgentDefaultsProvider = {
      get: async () => mockDefaults,
    };
    const service = new AgentConfigService(repo, defaultsProvider);
    const saveTool = new SkillSaveTool(service);
    const removeTool = new SkillRemoveTool(service);
    const listTool = new SkillsListTool(service);

    const makeContext = (orgId: string) => ({
      requestContext: {
        get: (key: string) =>
          key === 'organization' ? JSON.stringify({ id: orgId }) : undefined,
      },
    });

    return { repo, service, saveTool, removeTool, listTool, makeContext };
  };

  it('saves and updates a new organization skill', async () => {
    const { service } = setup();
    const orgId = 'org-1';

    const saved = await service.saveSkill(orgId, {
      name: 'brand-context',
      description: 'Brand identity and guidelines',
      instructions: 'Always use active voice and Ukrainian language.',
    });

    expect(saved.name).toBe('brand-context');

    const list = await service.listSkills(orgId);
    const brandSkill = list.find((s) => s.name === 'brand-context');
    expect(brandSkill).toBeDefined();
    expect(brandSkill?.source).toBe('organization');
    expect(brandSkill?.instructions).toBe('Always use active voice and Ukrainian language.');

    // Update existing skill
    await service.saveSkill(orgId, {
      name: 'brand-context',
      description: 'Brand identity v2',
      instructions: 'Updated instructions for brand voice.',
    });

    const updatedList = await service.listSkills(orgId);
    const updatedSkill = updatedList.find((s) => s.name === 'brand-context');
    expect(updatedSkill?.description).toBe('Brand identity v2');
    expect(updatedSkill?.instructions).toBe('Updated instructions for brand voice.');
  });

  it('rejects saving a skill that collides with a system skill', async () => {
    const { service } = setup();
    const orgId = 'org-1';

    await expect(
      service.saveSkill(orgId, {
        name: 'dg-marketing',
        description: 'Attempt to override system marketing',
        instructions: 'Override instructions',
      })
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects removing a system skill', async () => {
    const { service } = setup();
    const orgId = 'org-1';

    await expect(service.removeSkill(orgId, 'humanizer')).rejects.toThrow(BadRequestException);
  });

  it('removes an organization skill', async () => {
    const { service } = setup();
    const orgId = 'org-1';

    await service.saveSkill(orgId, {
      name: 'campaign-q1',
      description: 'Spring campaign guidelines',
      instructions: 'Spring campaign content rules.',
    });

    let list = await service.listSkills(orgId);
    expect(list.some((s) => s.name === 'campaign-q1')).toBe(true);

    await service.removeSkill(orgId, 'campaign-q1');

    list = await service.listSkills(orgId);
    expect(list.some((s) => s.name === 'campaign-q1')).toBe(false);
  });

  it('lists both system and organization skills with correct source', async () => {
    const { service } = setup();
    const orgId = 'org-1';

    await service.saveSkill(orgId, {
      name: 'custom-tones',
      description: 'Custom tones for organization',
      instructions: 'Custom tone guidelines',
    });

    const list = await service.listSkills(orgId);
    expect(list.length).toBe(3); // 2 system + 1 org

    const dgMarketing = list.find((s) => s.name === 'dg-marketing');
    expect(dgMarketing?.source).toBe('system');

    const custom = list.find((s) => s.name === 'custom-tones');
    expect(custom?.source).toBe('organization');
  });

  it('enforces multi-tenant isolation between organizations', async () => {
    const { service } = setup();
    const orgA = 'org-a';
    const orgB = 'org-b';

    await service.saveSkill(orgA, {
      name: 'secret-playbook',
      description: 'Playbook of Org A',
      instructions: 'Org A confidential instructions',
    });

    const listA = await service.listSkills(orgA);
    const listB = await service.listSkills(orgB);

    expect(listA.some((s) => s.name === 'secret-playbook')).toBe(true);
    expect(listB.some((s) => s.name === 'secret-playbook')).toBe(false);
  });

  describe('Tools execution', () => {
    it('skillSaveTool executes successfully and reports errors on system collisions', async () => {
      const { saveTool, makeContext } = setup();
      const context = makeContext('org-1');

      const tool = saveTool.run();
      const successRes = await tool.execute(
        {
          name: 'client-voice',
          description: 'Client tone of voice',
          instructions: 'Speak clearly and concisely.',
        },
        context
      );

      expect(successRes).toEqual({
        output: {
          success: true,
          skill: {
            name: 'client-voice',
            description: 'Client tone of voice',
          },
        },
      });

      const errRes = await tool.execute(
        {
          name: 'dg-marketing',
          description: 'Collision',
          instructions: 'Should fail',
        },
        context
      );

      expect(errRes.output).toHaveProperty('errors');
    });

    it('skillRemoveTool executes successfully and reports errors for system skills', async () => {
      const { saveTool, removeTool, makeContext } = setup();
      const context = makeContext('org-1');

      await saveTool.run().execute(
        {
          name: 'temp-skill',
          description: 'Temp',
          instructions: 'Temp instructions',
        },
        context
      );

      const remove = removeTool.run();
      const okRes = await remove.execute({ name: 'temp-skill' }, context);
      expect(okRes).toEqual({
        output: {
          success: true,
          removed: 'temp-skill',
        },
      });

      const errRes = await remove.execute({ name: 'humanizer' }, context);
      expect(errRes.output).toHaveProperty('errors');
    });

    it('skillsListTool returns all skills and supports filtering by name', async () => {
      const { saveTool, listTool, makeContext } = setup();
      const context = makeContext('org-1');

      await saveTool.run().execute(
        {
          name: 'my-custom-skill',
          description: 'Custom description',
          instructions: 'Full custom instructions',
        },
        context
      );

      const list = listTool.run();
      const allRes = await list.execute({}, context);
      expect(allRes.output.skills.length).toBe(3);

      const filteredRes = await list.execute({ name: 'my-custom-skill' }, context);
      expect(filteredRes.output.skills.length).toBe(1);
      expect(filteredRes.output.skills[0].name).toBe('my-custom-skill');
      expect(filteredRes.output.skills[0].instructions).toBe('Full custom instructions');
    });
  });
});
