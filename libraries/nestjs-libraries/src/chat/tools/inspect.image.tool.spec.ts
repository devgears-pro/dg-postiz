import { mkdir, mkdtemp, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InspectImageTool } from './inspect.image.tool';

const media = (overrides: Record<string, unknown> = {}) => ({
  id: 'media-1',
  path: '/2026/11/21/picture.png',
  ...overrides,
});

const setup = (
  row: unknown,
  decision: Record<string, unknown> = { action: 'deliver', runId: 'run-1' },
  threadResource = 'organization-1'
) => {
  const sendMessage = vi.fn().mockReturnValue({
    accepted: Promise.resolve(decision),
  });
  const getThreadById = vi
    .fn()
    .mockResolvedValue({ id: 'thread-1', resourceId: threadResource });
  const getMemory = vi.fn().mockResolvedValue({ getThreadById });
  const messaging = {
    mastra: vi.fn().mockResolvedValue({
      getAgent: vi.fn().mockReturnValue({ sendMessage, getMemory }),
    }),
  };
  const mediaService = { getMediaStatus: vi.fn().mockResolvedValue(row) };
  const agentConfig = {
    resolve: vi.fn().mockResolvedValue({
      config: { capabilities: { imageRead: true, imageGenerate: false } },
    }),
  };
  const tool = new InspectImageTool(
    mediaService as never,
    agentConfig as never,
    messaging as never
  );
  return { tool, mediaService, sendMessage };
};

const target = { threadId: 'thread-1', resourceId: 'organization-1' };

describe('image inspection', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'inspect-image-'));
    process.env.UPLOAD_DIRECTORY = directory;
    delete process.env.FRONTEND_URL;
  });

  afterEach(() => {
    delete process.env.UPLOAD_DIRECTORY;
  });

  const writeImage = async (name = 'picture.png', bytes = 'image-bytes') => {
    await mkdir(join(directory, '2026/11/21'), { recursive: true });
    await writeFile(join(directory, '2026/11/21', name), bytes);
  };

  it('adds the image once with the organization resource and thread', async () => {
    const { tool, mediaService, sendMessage } = setup(media());
    await writeImage();

    const result = await tool.inspect('organization-1', 'media-1', target);

    expect(result).toEqual({ mediaId: 'media-1', added: true });
    expect(mediaService.getMediaStatus).toHaveBeenCalledWith(
      'organization-1',
      'media-1'
    );
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(
      {
        contents: [
          {
            type: 'file',
            data: Buffer.from('image-bytes').toString('base64'),
            mediaType: 'image/png',
          },
          {
            type: 'text',
            text: 'Image from the media library, media id: media-1.',
          },
        ],
      },
      {
        resourceId: 'organization-1',
        threadId: 'thread-1',
        ifIdle: { behavior: 'discard' },
      }
    );
  });

  it('rejects a video before adding it', async () => {
    const { tool, sendMessage } = setup(media({ path: '/2026/11/21/clip.mp4' }));

    await expect(
      tool.inspect('organization-1', 'media-1', target)
    ).rejects.toThrow('Only images can be inspected');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('rejects a path outside the upload directory', async () => {
    const { tool, sendMessage } = setup(media({ path: '/../../etc/passwd.png' }));

    await expect(
      tool.inspect('organization-1', 'media-1', target)
    ).rejects.toThrow('The media file could not be read');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('rejects an image larger than the limit', async () => {
    const { tool, sendMessage } = setup(media());
    await writeImage();
    await truncate(join(directory, '2026/11/21/picture.png'), 21 * 1024 * 1024);

    await expect(
      tool.inspect('organization-1', 'media-1', target)
    ).rejects.toThrow('larger than 20 MB');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('reports a decision that does not deliver', async () => {
    const { tool } = setup(media(), { action: 'discard' });
    await writeImage();

    await expect(
      tool.inspect('organization-1', 'media-1', target)
    ).rejects.toThrow('could not be added to the conversation');
  });

  it('rejects a thread of another organization', async () => {
    const { tool, sendMessage } = setup(media(), undefined, 'organization-2');
    await writeImage();

    await expect(
      tool.inspect('organization-1', 'media-1', target)
    ).rejects.toThrow('without an active conversation');
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
