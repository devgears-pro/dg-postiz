import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { AgentConfigService } from '@gitroom/nestjs-libraries/chat/agent.config.service';

@Injectable()
export class SkillSaveTool implements AgentToolInterface {
  constructor(private _agentConfigService: AgentConfigService) {}
  name = 'skillSaveTool';

  run() {
    return createTool({
      id: 'skillSaveTool',
      mcp: {
        annotations: {
          title: 'Save Skill',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      description: `
Create or update a specialized skill for the organization.
Use this tool to preserve domain knowledge, brand guidelines, campaign context, audience preferences, or tailored prompt procedures.
Skills saved with this tool are stored in the organization configuration and persist across conversations.
System skills (such as dg-marketing, social, humanizer, write-humans) cannot be modified or overwritten.
"name" must be a lowercase slug (letters, digits, hyphens).
"description" must be a concise summary (up to 1024 characters).
"instructions" must be the Markdown body of the skill (up to 64KB).
"references" is an optional map of relative file paths to content strings.
`,
      inputSchema: z.object({
        name: z
          .string()
          .describe('Unique slug identifier for the skill (e.g. brand-voice, campaign-q1)'),
        description: z
          .string()
          .describe('Short summary of what this skill does and when to activate it'),
        instructions: z
          .string()
          .describe('Detailed Markdown prompt instructions explaining how to execute the skill'),
        references: z
          .record(z.string(), z.string())
          .optional()
          .describe('Optional map of filename paths to content for reference docs'),
      }),
      outputSchema: z.object({
        output: z
          .object({
            success: z.boolean(),
            skill: z.object({
              name: z.string(),
              description: z.string(),
            }),
          })
          .or(z.object({ errors: z.string() })),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const ctx = context as
          | { requestContext?: { get?: (key: string) => unknown } }
          | undefined;
        const orgRaw = ctx?.requestContext?.get?.('organization');
        const organizationId =
          typeof orgRaw === 'string'
            ? (JSON.parse(orgRaw) as { id: string }).id
            : (orgRaw as { id: string } | undefined)?.id;

        try {
          const saved = await this._agentConfigService.saveSkill(
            organizationId,
            inputData
          );
          return {
            output: {
              success: true,
              skill: {
                name: saved.name,
                description: saved.description,
              },
            },
          };
        } catch (err) {
          const message =
            err instanceof Error ? err.message : 'Failed to save skill';
          return { output: { errors: message } };
        }
      },
    });
  }
}
