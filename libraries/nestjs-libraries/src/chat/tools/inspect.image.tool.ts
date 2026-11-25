import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { createTool } from '@mastra/core/tools';
import { extname, resolve, sep } from 'path';
import { readFile, stat } from 'fs/promises';
import { z } from 'zod';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { AgentConfigService } from '@gitroom/nestjs-libraries/chat/agent.config.service';
import {
  AGENT_MESSAGING,
  type AgentMessagingLike,
} from '@gitroom/nestjs-libraries/chat/agent.messaging.token';
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

type Target = {
  threadId: string;
  resourceId: string;
};

@Injectable()
export class InspectImageTool implements AgentToolInterface {
  name = 'inspectImage';
  optionalOnSelfHosted = true;

  constructor(
    private _mediaService: MediaService,
    private _agentConfigService: AgentConfigService,
    @Inject(AGENT_MESSAGING) private _messaging: AgentMessagingLike
  ) {}

  run() {
    return createTool({
      id: 'inspectImage',
      description: `Add one image from the media library to the conversation so you can see it.
Call it when the picture itself matters: describe it, draft a post from it, read its text.
Attachments are listed as "Image: <path> (media <id>)"; pass that id.
The image arrives as a user message; answer after it appears. Do not inspect images that are only attached to a post.`,
      inputSchema: z.object({
        mediaId: z
          .string()
          .describe('The media id of the image, taken from the "media <id>" marker'),
      }),
      outputSchema: z.object({
        mediaId: z.string().optional(),
        added: z.boolean().optional(),
        error: z.string().optional(),
      }),
      mcp: {
        annotations: {
          title: 'Inspect Image',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        try {
          const ctx = context as
            | {
                threadId?: string;
                resourceId?: string;
                requestContext?: { get?: (key: string) => unknown };
              }
            | undefined;
          const orgRaw = ctx?.requestContext?.get?.('organization');
          const organization =
            typeof orgRaw === 'string'
              ? (JSON.parse(orgRaw) as { id: string })
              : (orgRaw as { id: string } | undefined);
          if (!organization?.id) {
            throw new InspectionError('Organization context is missing.');
          }
          const bundle = await this._agentConfigService.resolve(
            organization.id
          );
          if (!bundle.config.capabilities.imageRead) {
            return {
              added: false,
              error: 'Image reading is disabled for this organization.',
            };
          }
          const threadId =
            ctx?.threadId ??
            (ctx?.requestContext?.get?.('threadId') as string | undefined);
          if (!threadId) {
            throw new InspectionError(
              'The image cannot be added without an active conversation.'
            );
          }

          return await this.inspect(organization.id, inputData.mediaId, {
            threadId,
            resourceId: ctx?.resourceId ?? organization.id,
          });
        } catch (error) {
          Logger.warn(
            `inspectImage ${inputData.mediaId}: ${
              error instanceof Error ? error.message : error
            }`
          );
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

  async inspect(organizationId: string, mediaId: string, target: Target) {
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
        'Only images can be inspected: jpg, png, webp or gif. This media item is a video or a different format.'
      );
    }

    const bytes = await this.readImage(media.path);
    await this.addToContext(media.id, mediaType, bytes, target);

    return { mediaId: media.id, added: true };
  }

  private async addToContext(
    mediaId: string,
    mediaType: string,
    bytes: Buffer,
    target: Target
  ) {
    const mastra = await this._messaging.mastra();
    const agent = mastra.getAgent('postiz');
    const memory = await agent.getMemory();
    const thread = await memory?.getThreadById({ threadId: target.threadId });
    if (!thread || thread.resourceId !== target.resourceId) {
      throw new InspectionError(
        'The image cannot be added without an active conversation.'
      );
    }

    const decision = await agent.sendMessage(
      {
        contents: [
          {
            type: 'file',
            data: bytes.toString('base64'),
            mediaType,
          },
          {
            type: 'text',
            text: `Image from the media library, media id: ${mediaId}.`,
          },
        ],
      },
      {
        resourceId: target.resourceId,
        threadId: target.threadId,
        ifIdle: { behavior: 'discard' },
      }
    ).accepted;

    if (decision.action !== 'deliver') {
      throw new InspectionError(
        'The image could not be added to the conversation.'
      );
    }
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
      ? `${process.env.FRONTEND_URL.replace(/\/+$/, '')}/uploads`
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
