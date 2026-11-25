import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { AgentConfigService } from '@gitroom/nestjs-libraries/chat/agent.config.service';
import { AgentConnectionsService } from '@gitroom/nestjs-libraries/chat/agent.connections';

@Injectable()
export class GenerateImageTool implements AgentToolInterface {
  private storage = UploadFactory.createStorage();

  constructor(
    private _mediaService: MediaService,
    private _subscriptionService: SubscriptionService,
    private _agentConfigService: AgentConfigService,
    private _connections: AgentConnectionsService
  ) {}
  name = 'generateImageTool';

  run() {
    return createTool({
      id: 'generateImageTool',
      description: `Generate image to use in a post,
                    in case the user specified a platform that requires attachment and attachment was not provided,
                    ask if they want to generate a picture of a video.
      `,
      mcp: {
        annotations: {
          title: 'Generate Image',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      inputSchema: z.object({
        prompt: z.string(),
      }),
      // Mastra validates the return against this schema, so it must also
      // allow the graceful { error } shape (same as uploadFromUrlTool)
      outputSchema: z.object({
        id: z.string().optional(),
        path: z.string().optional(),
        error: z.string().optional(),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const org = JSON.parse((context?.requestContext as any)?.get('organization') as string);
        try {
          // Same credit gate as the dashboard's /media/generate-image route -
          // only enforced when billing is enabled (cloud), self-hosted is free
          const total = await this._subscriptionService.checkCredits(org);
          if (process.env.STRIPE_PUBLISHABLE_KEY && total.credits <= 0) {
            return {
              error: 'No AI image credits are available on this account.',
            };
          }

          const bundle = await this._agentConfigService.resolve(org.id);
          if (!bundle.config.capabilities.imageGenerate) {
            return {
              error: 'Image generation is disabled for this organization.',
            };
          }

          const image = await this._mediaService.generateImage(
            inputData.prompt,
            org,
            false,
            {
              client: this._connections.createOpenAIClient(bundle),
              promptModel: bundle.config.model,
              imageModel: bundle.config.imageModel,
            }
          );

          const file = await this.storage.uploadSimple(
            'data:image/png;base64,' + image
          );

          return await this._mediaService.saveFile(
            org.id,
            file.split('/').pop(),
            file
          );
        } catch (err) {
          return {
            error: `Image generation failed: ${
              err instanceof Error ? err.message : String(err)
            }. The user's image credit was not used.`,
          };
        }
      },
    });
  }
}
