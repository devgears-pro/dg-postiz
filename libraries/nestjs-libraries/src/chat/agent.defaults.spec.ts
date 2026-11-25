import { describe, expect, it } from 'vitest';
import { resolveAgentConfig } from '@gitroom/helpers/agent/agent.config.schema';
import { loadAgentDefaults } from './agent.defaults';

describe('agent image capabilities', () => {
  it('[TC-2-17-1] defaults to reading images and disabling generation', async () => {
    const defaults = await loadAgentDefaults({}, { toolCatalog: [] });

    expect(defaults.capabilities).toEqual({
      imageRead: true,
      imageGenerate: false,
    });
  });

  it('[TC-2-17-2] reads the capability defaults from env', async () => {
    const defaults = await loadAgentDefaults(
      {
        POSTIZ_AI_IMAGE_READ: 'false',
        POSTIZ_AI_IMAGE_GENERATE: 'true',
        POSTIZ_AI_IMAGE_MODEL: 'gpt-image-1',
      },
      { toolCatalog: [] }
    );

    expect(defaults.capabilities).toEqual({
      imageRead: false,
      imageGenerate: true,
    });
    expect(defaults.imageModel).toBe('gpt-image-1');
  });

  it('[TC-2-17-3] merges capability overrides only when the organization has a provider', async () => {
    const defaults = await loadAgentDefaults({}, { toolCatalog: [] });

    const withProvider = resolveAgentConfig(
      defaults,
      {
        provider: { baseUrl: 'https://org.example.test/v1' },
        capabilities: { imageGenerate: true },
      },
      'org-test',
      1
    );
    expect(withProvider.capabilities).toEqual({
      imageRead: true,
      imageGenerate: true,
    });

    const withoutProvider = resolveAgentConfig(
      defaults,
      { capabilities: { imageGenerate: true } },
      'org-test',
      1
    );
    expect(withoutProvider.capabilities).toEqual(defaults.capabilities);
  });
});
