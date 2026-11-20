import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptAgentSecrets, encryptAgentSecrets } from './agent.secrets';

describe('agent credentials', () => {
  it('only decrypts credentials for the organization that saved them', () => {
    const key = randomBytes(32);
    const credentials = { providerApiKey: 'fixture-provider-key' };
    const stored = encryptAgentSecrets('first-organization', credentials, key);

    expect(stored).not.toContain(credentials.providerApiKey);
    expect(decryptAgentSecrets('first-organization', stored, key)).toEqual(credentials);
    expect(() => decryptAgentSecrets('second-organization', stored, key)).toThrow();
  });
});
