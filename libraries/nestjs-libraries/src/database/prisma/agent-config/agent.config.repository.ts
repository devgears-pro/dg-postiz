import { ConflictException, Injectable } from '@nestjs/common';
import { OrganizationAgentConfig } from '@prisma/client';
import { AgentConfigOverrides } from '@gitroom/helpers/agent/agent.config.schema';
import type { AgentSecretSummary } from '@gitroom/nestjs-libraries/chat/agent.secrets';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

export type AgentConfigRecord = {
  organizationId: string;
  schemaVersion: number;
  revision: number;
  overrides: AgentConfigOverrides;
  encryptedSecrets: string | null;
  secretSummary: AgentSecretSummary | null;
  updatedById: string | null;
};

export type AgentConfigWrite = {
  organizationId: string;
  overrides: AgentConfigOverrides;
  encryptedSecrets: string | null;
  secretSummary: AgentSecretSummary;
  updatedById: string | null;
};

const toRecord = (
  row: OrganizationAgentConfig | null
): AgentConfigRecord | null => {
  if (!row) return null;
  return {
    organizationId: row.organizationId,
    schemaVersion: row.schemaVersion,
    revision: row.revision,
    overrides: row.overrides as AgentConfigOverrides,
    encryptedSecrets: row.encryptedSecrets,
    secretSummary: row.secretSummary as AgentSecretSummary | null,
    updatedById: row.updatedById,
  };
};

const conflict = () =>
  new ConflictException(
    'The agent configuration changed since it was loaded. Reload it and try again.'
  );

@Injectable()
export class AgentConfigRepository {
  constructor(
    private _config: PrismaRepository<
      'organizationAgentConfig' | 'mastra_resources'
    >
  ) {}

  async find(organizationId: string): Promise<AgentConfigRecord | null> {
    const row = await this._config.model.organizationAgentConfig.findUnique({
      where: { organizationId },
    });
    return toRecord(row);
  }

  async create(input: AgentConfigWrite): Promise<AgentConfigRecord> {
    try {
      const row = await this._config.model.organizationAgentConfig.create({
        data: {
          organizationId: input.organizationId,
          schemaVersion: 1,
          revision: 1,
          overrides: input.overrides,
          encryptedSecrets: input.encryptedSecrets,
          secretSummary: input.secretSummary,
          updatedById: input.updatedById,
        },
      });
      return toRecord(row)!;
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002') {
        throw conflict();
      }
      throw error;
    }
  }

  async update(
    organizationId: string,
    expectedRevision: number,
    input: Omit<AgentConfigWrite, 'organizationId'>
  ): Promise<AgentConfigRecord | null> {
    const result = await this._config.model.organizationAgentConfig.updateMany({
      where: { organizationId, revision: expectedRevision },
      data: {
        overrides: input.overrides,
        encryptedSecrets: input.encryptedSecrets,
        secretSummary: input.secretSummary,
        updatedById: input.updatedById,
        revision: { increment: 1 },
      },
    });

    if (result.count === 0) {
      throw conflict();
    }

    return this.find(organizationId);
  }

  async getMemory(organizationId: string): Promise<string[]> {
    const record = await this._config.model.mastra_resources.findUnique({
      where: { id: organizationId },
      select: { workingMemory: true },
    });
    if (!record?.workingMemory) return [];
    try {
      const parsed = JSON.parse(record.workingMemory);
      return Array.isArray(parsed?.proverbs) ? parsed.proverbs : [];
    } catch {
      return [];
    }
  }

  async updateMemory(
    organizationId: string,
    proverbs: string[]
  ): Promise<string[]> {
    const workingMemory = JSON.stringify({ proverbs });
    const now = new Date();
    await this._config.model.mastra_resources.upsert({
      where: { id: organizationId },
      create: {
        id: organizationId,
        workingMemory,
        createdAt: now,
        updatedAt: now,
      },
      update: {
        workingMemory,
        updatedAt: now,
      },
    });
    return proverbs;
  }

  async clearMemory(organizationId: string): Promise<void> {
    const now = new Date();
    await this._config.model.mastra_resources.upsert({
      where: { id: organizationId },
      create: {
        id: organizationId,
        workingMemory: JSON.stringify({ proverbs: [] }),
        createdAt: now,
        updatedAt: now,
      },
      update: {
        workingMemory: JSON.stringify({ proverbs: [] }),
        updatedAt: now,
      },
    });
  }
}
