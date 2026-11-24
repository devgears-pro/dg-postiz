import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import {
  canManageSkills,
  readOrganizationAccess,
} from '@gitroom/nestjs-libraries/chat/agent.access';
import { AgentConfigService } from '@gitroom/nestjs-libraries/chat/agent.config.service';

@Injectable()
export class SkillRemoveTool implements AgentToolInterface {
  constructor(private _agentConfigService: AgentConfigService) {}
  name = 'skillRemoveTool';
  optionalOnSelfHosted = true;

  run() {
    return createTool({
      id: 'skillRemoveTool',
      mcp: {
        annotations: {
          title: 'Remove Skill',
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      description: `
Remove an organization-specific skill by name.
System skills cannot be removed.
Only skills created for this organization can be deleted.
`,
      inputSchema: z.object({
        name: z
          .string()
          .describe('The name (slug) of the organization skill to remove'),
      }),
      outputSchema: z.object({
        output: z
          .object({
            success: z.boolean(),
            removed: z.string(),
          })
          .or(z.object({ errors: z.string() })),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organization = readOrganizationAccess(
          context as { requestContext?: { get?: (key: string) => unknown } }
        );

        if (!organization?.id) {
          return { output: { errors: 'Organization context is missing' } };
        }

        if (!canManageSkills(organization)) {
          return {
            output: {
              errors: 'Only organization administrators can manage skills',
            },
          };
        }

        try {
          await this._agentConfigService.removeSkill(
            organization.id,
            inputData.name
          );
          return {
            output: {
              success: true,
              removed: inputData.name,
            },
          };
        } catch (err) {
          const message =
            err instanceof Error ? err.message : 'Failed to remove skill';
          return { output: { errors: message } };
        }
      },
    });
  }
}
