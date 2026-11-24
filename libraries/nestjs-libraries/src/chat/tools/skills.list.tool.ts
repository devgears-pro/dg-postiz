import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { AgentConfigService } from '@gitroom/nestjs-libraries/chat/agent.config.service';

@Injectable()
export class SkillsListTool implements AgentToolInterface {
  constructor(private _agentConfigService: AgentConfigService) {}
  name = 'skillsListTool';

  run() {
    return createTool({
      id: 'skillsListTool',
      mcp: {
        annotations: {
          title: 'List Skills',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      description: `
List all skills available in the organization context (both system-provided and organization-specific).
Returns each skill with its name, description, and source ('system' or 'organization').
Optionally supply "name" to retrieve the full instructions and references for a single skill.
`,
      inputSchema: z.object({
        name: z
          .string()
          .optional()
          .describe('Optional skill name to filter and retrieve full details for a specific skill'),
      }),
      outputSchema: z.object({
        output: z.object({
          skills: z.array(
            z.object({
              name: z.string(),
              description: z.string(),
              source: z.enum(['system', 'organization']),
              instructions: z.string().optional(),
              references: z.record(z.string(), z.string()).optional(),
            })
          ),
        }),
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

        const allSkills = await this._agentConfigService.listSkills(organizationId);
        const filtered = inputData?.name
          ? allSkills.filter((s) => s.name === inputData.name)
          : allSkills;

        return {
          output: {
            skills: filtered.map((s) => ({
              name: s.name,
              description: s.description,
              source: s.source,
              instructions: s.instructions,
              references: s.references,
            })),
          },
        };
      },
    });
  }
}
