import { describe, expect, it, vi } from 'vitest';
import { DocsListTool } from './docs.list.tool';
import { DocsReadTool } from './docs.read.tool';
import type { DocsService } from '@gitroom/nestjs-libraries/docs/docs.service';
import type { AgentMessagingLike } from '@gitroom/nestjs-libraries/chat/agent.messaging.token';

function makeContext(orgId?: string, threadId?: string) {
  const map = new Map<string, unknown>();
  if (orgId) {
    map.set('organization', { id: orgId });
  }
  if (threadId) {
    map.set('threadId', threadId);
  }
  return {
    threadId,
    resourceId: orgId,
    requestContext: {
      get: (key: string) => map.get(key),
    },
  };
}

describe('DocsListTool and DocsReadTool', () => {
  it('DocsListTool rejects missing organization and returns entries for valid org', async () => {
    const docsService = {
      list: vi.fn().mockResolvedValue([
        {
          id: '/guide.md',
          name: 'guide.md',
          path: '/guide.md',
          parent: '/',
          type: 'file',
          size: 42,
          mimeType: 'text/markdown',
          date: new Date().toISOString(),
        },
      ]),
    } as unknown as DocsService;

    const tool = new DocsListTool(docsService).run();
    const missingOrg = await tool.execute!(
      { path: '/', recursive: true },
      makeContext(undefined) as never
    );
    expect(missingOrg).toEqual({ error: 'Organization context is missing.' });

    const ok = await tool.execute!(
      { path: '/', recursive: true },
      makeContext('org-1') as never
    );
    expect(ok).toEqual({
      items: [
        {
          path: '/guide.md',
          name: 'guide.md',
          type: 'file',
          size: 42,
          mimeType: 'text/markdown',
        },
      ],
    });
  });

  it('DocsReadTool returns paginated text and delivers raster images to active thread', async () => {
    const docsService = {
      readForAgent: vi
        .fn()
        .mockResolvedValueOnce({
          kind: 'text',
          path: '/guide.md',
          mimeType: 'text/markdown',
          totalLength: 12,
          offset: 0,
          hasMore: false,
          content: '# Brand Guide',
        })
        .mockResolvedValueOnce({
          kind: 'image',
          path: '/logo.png',
          mimeType: 'image/png',
          buffer: Buffer.from('png'),
        })
        .mockResolvedValueOnce({
          kind: 'image',
          path: '/logo.png',
          mimeType: 'image/png',
          buffer: Buffer.from('png'),
        }),
    } as unknown as DocsService;

    const sendMessage = vi.fn().mockReturnValue({
      accepted: Promise.resolve({ action: 'deliver' }),
    });
    const messaging: AgentMessagingLike = {
      mastra: vi.fn().mockResolvedValue({
        getAgent: () => ({
          getMemory: () =>
            Promise.resolve({
              getThreadById: () => Promise.resolve({ resourceId: 'org-1' }),
            }),
          sendMessage,
        }),
      }),
    };

    const tool = new DocsReadTool(docsService, messaging).run();

    const textResult = await tool.execute!(
      { path: '/guide.md' },
      makeContext('org-1', 'thread-1') as never
    );
    expect(textResult).toEqual({
      path: '/guide.md',
      mimeType: 'text/markdown',
      totalLength: 12,
      offset: 0,
      hasMore: false,
      content: '# Brand Guide',
    });

    const imageNoThread = await tool.execute!(
      { path: '/logo.png' },
      makeContext('org-1', undefined) as never
    );
    expect(imageNoThread).toEqual({
      error: 'Images from Docs require an active conversation.',
    });

    const imageOk = await tool.execute!(
      { path: '/logo.png' },
      makeContext('org-1', 'thread-1') as never
    );
    expect(imageOk).toEqual({
      path: '/logo.png',
      mimeType: 'image/png',
      addedToContext: true,
    });
    expect(sendMessage).toHaveBeenCalledOnce();
  });

  it('DocsReadTool rejects cross-org thread access', async () => {
    const docsService = {
      readForAgent: vi.fn().mockResolvedValue({
        kind: 'image',
        path: '/logo.png',
        mimeType: 'image/png',
        buffer: Buffer.from('png'),
      }),
    } as unknown as DocsService;

    const messaging: AgentMessagingLike = {
      mastra: vi.fn().mockResolvedValue({
        getAgent: () => ({
          getMemory: () =>
            Promise.resolve({
              getThreadById: () => Promise.resolve({ resourceId: 'other-org' }),
            }),
          sendMessage: vi.fn(),
        }),
      }),
    };

    const tool = new DocsReadTool(docsService, messaging).run();
    const res = await tool.execute!(
      { path: '/logo.png' },
      makeContext('org-1', 'thread-1') as never
    );
    expect(res).toEqual({
      error: 'Images from Docs require an active conversation.',
    });
  });
});
