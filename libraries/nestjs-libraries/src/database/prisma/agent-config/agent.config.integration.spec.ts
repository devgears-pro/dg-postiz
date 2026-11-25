import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, expect, it, vi } from 'vitest';
import type { SystemAgentDefaults } from '@gitroom/helpers/agent/agent.config.schema';
import { AgentConfigService } from '../../../chat/agent.config.service';
import { PrismaRepository, PrismaService } from '../prisma.service';
import { AgentConfigRepository } from './agent.config.repository';

const databaseUrl = process.env.DATABASE_URL;
const database = databaseUrl && URL.canParse(databaseUrl) ? new URL(databaseUrl) : undefined;
if (database?.protocol !== 'postgresql:' || database.hostname !== 'postgres' || database.pathname !== '/postiz_test') {
  throw new Error('Run the credential storage test against the Postiz Compose test database');
}

const DEFAULTS: SystemAgentDefaults = {
  prompt: 'Integration test prompt',
  model: 'test-model',
  titleModel: 'test-title-model',
  imageModel: 'chatgpt-image-latest',
  providerBaseUrl: 'https://default.example.test/v1',
  providerApiKeyEnv: 'OPENAI_API_KEY',
  builtinTools: [],
  allowedBuiltinTools: [],
  skills: {},
  mcpServers: {},
  generation: {},
  capabilities: { imageRead: true, imageGenerate: false },
  langfuse: { enabled: false, allowedBaseUrls: [], captureContent: false },
  sources: { prompt: 'builtin' },
  defaultsVersion: 'integration-test',
};
const PROVIDER_KEY = 'test-provider-key-not-for-use';
const organizationId = randomUUID();
const prisma = new PrismaService();
const repository = new AgentConfigRepository(new PrismaRepository(prisma));
const service = new AgentConfigService(repository, { get: async () => DEFAULTS });

afterAll(async () => {
  try {
    await prisma.organization.deleteMany({ where: { id: organizationId } });
  } finally {
    await prisma.$disconnect();
    vi.unstubAllEnvs();
  }
});

it('[TC-2-5-1] stores the provider key encrypted in PostgreSQL', async () => {
  vi.stubEnv('POSTIZ_AI_ENCRYPTION_KEY', randomBytes(32).toString('base64'));
  await prisma.organization.create({
    data: { id: organizationId, name: 'Credential storage test' },
  });

  await service.save(organizationId, null, {
    expectedRevision: 0,
    overrides: { provider: { baseUrl: 'https://org.example.test/v1' } },
    secrets: { providerApiKey: PROVIDER_KEY },
  });
  const row = await prisma.organizationAgentConfig.findUniqueOrThrow({
    where: { organizationId },
  });

  expect(row.encryptedSecrets).toBeTruthy();
  expect(JSON.stringify(row)).not.toContain(PROVIDER_KEY);
  await expect(service.resolve(organizationId)).resolves.toMatchObject({
    secrets: { providerApiKey: PROVIDER_KEY },
  });
});
