import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { readOrganizationAccess } from '@gitroom/nestjs-libraries/chat/agent.access';
import { DocsService } from '@gitroom/nestjs-libraries/docs/docs.service';
import {
  AGENT_MESSAGING,
  type AgentMessagingLike,
} from '@gitroom/nestjs-libraries/chat/agent.messaging.token';

@Injectable()
export class DocsReadTool implements AgentToolInterface {
  name = 'docsReadTool';
  optionalOnSelfHosted = true;

  constructor(
    private readonly _docsService: DocsService,
    @Inject(AGENT_MESSAGING) private readonly _messaging: AgentMessagingLike
  ) {}

  run() {
    return createTool({
      id: 'docsReadTool',
      description:
        'Read a document from the organization Docs library by path. Supports MD, TXT, JSON, CSV, SVG, PDF, DOCX (returns text with pagination) and raster images (adds image to conversation context).',
      inputSchema: z.object({
        path: z
          .string()
          .describe('Document path inside Docs, e.g. /brandbook/guide.md'),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Character offset for reading large text documents'),
      }),
      outputSchema: z.object({
        path: z.string().optional(),
        mimeType: z.string().optional(),
        totalLength: z.number().optional(),
        offset: z.number().optional(),
        hasMore: z.boolean().optional(),
        content: z.string().optional(),
        addedToContext: z.boolean().optional(),
        error: z.string().optional(),
      }),
      mcp: {
        annotations: {
          title: 'Read Document',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const ctx = context as
          | {
              threadId?: string;
              resourceId?: string;
              requestContext?: { get?: (key: string) => unknown };
            }
          | undefined;
        const org = readOrganizationAccess(ctx);
        if (!org?.id) {
          return { error: 'Organization context is missing.' };
        }

        try {
          const result = await this._docsService.readForAgent(
            org.id,
            inputData.path,
            inputData.offset ?? 0
          );
          if (result.kind === 'text') {
            return {
              path: result.path,
              mimeType: result.mimeType,
              totalLength: result.totalLength,
              offset: result.offset,
              hasMore: result.hasMore,
              content: result.content,
            };
          }

          const threadId =
            ctx?.threadId ??
            (ctx?.requestContext?.get?.('threadId') as string | undefined);
          if (!threadId) {
            return {
              error: 'Images from Docs require an active conversation.',
            };
          }
          const mastra = await this._messaging.mastra();
          const agent = mastra.getAgent('postiz');
          const memory = await agent.getMemory();
          const thread = await memory?.getThreadById({ threadId });
          if (!thread || thread.resourceId !== org.id) {
            return {
              error: 'Images from Docs require an active conversation.',
            };
          }

          const decision = await agent.sendMessage(
            {
              contents: [
                {
                  type: 'file',
                  data: result.buffer.toString('base64'),
                  mediaType: result.mimeType,
                },
                {
                  type: 'text',
                  text: `Image from Docs library: ${result.path}.`,
                },
              ],
            },
            {
              resourceId: org.id,
              threadId,
              ifIdle: { behavior: 'discard' },
            }
          ).accepted;

          if (decision.action !== 'deliver') {
            return { error: 'The image could not be added to the conversation.' };
          }
          return {
            path: result.path,
            mimeType: result.mimeType,
            addedToContext: true,
          };
        } catch (err) {
          Logger.warn(
            `docsReadTool ${inputData.path}: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
          return {
            error:
              err instanceof HttpException
                ? err.message
                : 'Could not read the requested document.',
          };
        }
      },
    });
  }
}
