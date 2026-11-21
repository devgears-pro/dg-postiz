import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InspectImageTool } from './inspect.image.tool';

const media = (overrides: Record<string, unknown> = {}) => ({
  id: 'media-1',
  path: '/2026/11/21/picture.png',
  ...overrides,
});

const setup = (row: unknown, answer = 'A calendar with two scheduled posts.') => {
  const mediaService = { getMediaStatus: vi.fn().mockResolvedValue(row) };
  const vision = { answer: vi.fn().mockResolvedValue(answer) };
  const runtime = {
    ensurePrepared: vi
      .fn()
      .mockResolvedValue({ model: {}, config: { generation: {} } }),
  };
  const tool = new InspectImageTool(
    mediaService as never,
    vision as never,
    runtime as never
  );
  return { tool, mediaService, vision, runtime };
};

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

  it('reads media through the organization scope', async () => {
    const { tool, mediaService } = setup(media());
    await mkdir(join(directory, '2026/11/21'), { recursive: true });
    await writeFile(join(directory, '2026/11/21/picture.png'), 'image-bytes');

    await tool.inspect('organization-1', 'media-1', 'Describe it', {});

    expect(mediaService.getMediaStatus).toHaveBeenCalledWith(
      'organization-1',
      'media-1'
    );
  });

  it('returns an error for media outside the organization', async () => {
    const { tool, vision } = setup(null);
    const action = tool.run() as never as {
      execute: (
        input: { mediaId: string; question: string },
        context: unknown
      ) => Promise<{ error: string }>;
    };

    const result = await action.execute(
      { mediaId: 'media-1', question: 'Describe it' },
      {
        requestContext: {
          get: (key: string) =>
            key === 'organization'
              ? JSON.stringify({ id: 'organization-1' })
              : undefined,
        },
      }
    );

    expect(result).toEqual({
      error: "This media item is not in the organization's media library.",
    });
    expect(vision.answer).not.toHaveBeenCalled();
  });

  it('rejects a video without calling the model', async () => {
    const { tool, vision } = setup(media({ path: '/2026/11/21/clip.mp4' }));

    await expect(
      tool.inspect('organization-1', 'media-1', 'Describe it', {})
    ).rejects.toThrow('inspectImage reads images only');
    expect(vision.answer).not.toHaveBeenCalled();
  });

  it('answers from the bytes of a supported image', async () => {
    const { tool, vision } = setup(media());
    await mkdir(join(directory, '2026/11/21'), { recursive: true });
    await writeFile(join(directory, '2026/11/21/picture.png'), 'image-bytes');

    const result = await tool.inspect(
      'organization-1',
      'media-1',
      'What is on the image?',
      { model: true },
      { temperature: 0.2 }
    );

    expect(result).toEqual({
      mediaId: 'media-1',
      path: '/2026/11/21/picture.png',
      answer: 'A calendar with two scheduled posts.',
    });
    expect(vision.answer).toHaveBeenCalledWith(
      { model: true },
      { bytes: Buffer.from('image-bytes'), mediaType: 'image/png' },
      'What is on the image?',
      {
        generation: { temperature: 0.2 },
        requestContext: undefined,
      }
    );
  });
});
