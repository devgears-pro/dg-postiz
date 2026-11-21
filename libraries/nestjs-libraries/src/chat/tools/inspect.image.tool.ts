import { HttpException, Inject, Injectable } from '@nestjs/common';
import { createTool } from '@mastra/core/tools';
import { extname, resolve, sep } from 'path';
import { readFile, stat } from 'fs/promises';
import { z } from 'zod';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { AgentVisionService } from '@gitroom/nestjs-libraries/chat/agent.vision';
import {
  AGENT_RUNTIME,
  type AgentRuntimeLike,
} from '@gitroom/nestjs-libraries/chat/agent.runtime.token';
import { getSsrfSafeDispatcher } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';

const IMAGE_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 10_000;

class InspectionError extends Error {}

@Injectable()
export class InspectImageTool implements AgentToolInterface {
  name = 'inspectImage';
  optionalOnSelfHosted = true;

  constructor(
    private _mediaService: MediaService,
    private _vision: AgentVisionService,
    @Inject(AGENT_RUNTIME) private _runtime: AgentRuntimeLike
  ) {}

  run() {
    return createTool({
      id: 'inspectImage',
      description: `Look at one image from the media library and answer a question about what it shows.
Use it when the task needs the picture's content: describe the image, draft a post from it, read the text on it.
Attachments of the user message are listed as "Image: <path> (media <id>)", pass that id.
Do not inspect images that are only added to a post: use their path as the attachment instead.
Ask about one image per call.`,
      inputSchema: z.object({
        mediaId: z
          .string()
          .describe('The media id of the image, taken from the "media <id>" marker'),
        question: z
          .string()
          .describe('What to find out about the image, in the language of the user'),
      }),
      outputSchema: z.object({
        mediaId: z.string().optional(),
        path: z.string().optional(),
        answer: z.string().optional(),
        error: z.string().optional(),
      }),
      mcp: {
        annotations: {
          title: 'Inspect Image',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        try {
          const organizationId = JSON.parse(
            (context?.requestContext as any)?.get('organization') as string
          ).id;
          const prepared = await this._runtime.ensurePrepared(
            context?.requestContext as any
          );

          return await this.inspect(
            organizationId,
            inputData.mediaId,
            inputData.question,
            prepared.model,
            prepared.config.generation,
            context?.requestContext
          );
        } catch (error) {
          return {
            error:
              error instanceof InspectionError
                ? error.message
                : 'The image could not be inspected right now. Try again later.',
          };
        }
      },
    });
  }

  async inspect(
    organizationId: string,
    mediaId: string,
    question: string,
    model: unknown,
    generation?: { temperature?: number; maxOutputTokens?: number },
    requestContext?: unknown
  ) {
    const media = await this._mediaService
      .getMediaStatus(organizationId, mediaId)
      .catch((error) => {
        if (error instanceof HttpException && error.getStatus() === 404) {
          return null;
        }
        throw error;
      });
    if (!media) {
      throw new InspectionError(
        "This media item is not in the organization's media library."
      );
    }

    const mediaType =
      IMAGE_TYPES[extname(media.path.split('?')[0]).toLowerCase()];
    if (!mediaType) {
      throw new InspectionError(
        'inspectImage reads images only: jpg, png, webp or gif. This media item is a video or a different format.'
      );
    }

    const bytes = await this.readImage(media.path);
    const answer = await this._vision.answer(
      model,
      { bytes, mediaType },
      question,
      { generation, requestContext }
    );

    return { mediaId: media.id, path: media.path, answer };
  }

  private async readImage(path: string): Promise<Buffer> {
    try {
      const localPath = this.localPath(path);
      if (localPath) {
        const info = await stat(localPath);
        if (info.size > MAX_IMAGE_BYTES) {
          throw new InspectionError(
            'The image is larger than 20 MB and cannot be inspected.'
          );
        }
        return await readFile(localPath);
      }

      return await this.download(path);
    } catch (error) {
      if (error instanceof InspectionError) {
        throw error;
      }
      throw new InspectionError('The media file could not be read.');
    }
  }

  private localPath(path: string) {
    const root = process.env.UPLOAD_DIRECTORY;
    if (!root) {
      return undefined;
    }

    const publicPrefix = process.env.FRONTEND_URL
      ? `${process.env.FRONTEND_URL}/uploads`
      : undefined;
    const relative =
      publicPrefix && path.startsWith(publicPrefix)
        ? path.slice(publicPrefix.length)
        : /^https?:\/\//.test(path)
          ? undefined
          : path;

    if (!relative || relative.includes('http')) {
      return undefined;
    }

    const base = resolve(root);
    const filePath = resolve(root + relative);
    return filePath.startsWith(base + sep) ? filePath : undefined;
  }

  private async download(path: string): Promise<Buffer> {
    if (!/^https?:\/\//.test(path)) {
      throw new InspectionError('The media file could not be read.');
    }

    const response = await fetch(path, {
      dispatcher: getSsrfSafeDispatcher(),
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    } as RequestInit);

    if (!response.ok) {
      throw new InspectionError('The media file could not be read.');
    }

    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > MAX_IMAGE_BYTES) {
      throw new InspectionError(
        'The image is larger than 20 MB and cannot be inspected.'
      );
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_IMAGE_BYTES) {
      throw new InspectionError(
        'The image is larger than 20 MB and cannot be inspected.'
      );
    }

    return bytes;
  }
}
