import { Injectable } from '@nestjs/common';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { readOrganizationAccess } from '@gitroom/nestjs-libraries/chat/agent.access';
import { DocsService } from '@gitroom/nestjs-libraries/docs/docs.service';

@Injectable()
export class DocsListTool implements AgentToolInterface {
  name = 'docsListTool';
  optionalOnSelfHosted = true;

  constructor(private readonly _docsService: DocsService) {}

  run() {
    return createTool({
      id: 'docsListTool',
      description:
        'List folders and documents in the organization Docs library. Use this to find brand guidelines, marketing documents, PDFs, DOCX files, and assets.',
      inputSchema: z.object({
        path: z
          .string()
          .optional()
          .describe('Folder path inside Docs (default "/")'),
        recursive: z
          .boolean()
          .optional()
          .describe('Whether to list nested folders recursively (default true)'),
      }),
      outputSchema: z.object({
        items: z
          .array(
            z.object({
              path: z.string(),
              name: z.string(),
              type: z.enum(['file', 'folder']),
              size: z.number(),
              mimeType: z.string().optional(),
            })
          )
          .optional(),
        error: z.string().optional(),
      }),
      mcp: {
        annotations: {
          title: 'List Docs',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const org = readOrganizationAccess(
          context as { requestContext?: { get?: (key: string) => unknown } }
        );
        if (!org?.id) {
          return { error: 'Organization context is missing.' };
        }
        try {
          const items = await this._docsService.list(
            org.id,
            inputData.path ?? '/',
            inputData.recursive ?? true
          );
          return {
            items: items.map((item) => ({
              path: item.path,
              name: item.name,
              type: item.type,
              size: item.size,
              ...(item.mimeType ? { mimeType: item.mimeType } : {}),
            })),
          };
        } catch (err) {
          return {
            error:
              err instanceof Error
                ? err.message
                : 'Could not list organization documents.',
          };
        }
      },
    });
  }
}
