import { Injectable } from '@nestjs/common';
import { Agent } from '@mastra/core/agent';

export type VisionImage = {
  bytes: Buffer;
  mediaType: string;
};

export type VisionOptions = {
  generation?: { temperature?: number; maxOutputTokens?: number };
  requestContext?: unknown;
};

@Injectable()
export class AgentVisionService {
  async answer(
    model: unknown,
    image: VisionImage,
    question: string,
    options: VisionOptions = {}
  ): Promise<string> {
    const agent = new Agent({
      id: 'image-inspector',
      name: 'image-inspector',
      instructions:
        'You look at one image and answer the question about it. Use only what the image shows. If the image does not contain the answer, say so.',
      model: model as never,
    });

    const generation = options.generation;
    const modelSettings = {
      ...(generation?.temperature !== undefined
        ? { temperature: generation.temperature }
        : {}),
      ...(generation?.maxOutputTokens !== undefined
        ? { maxOutputTokens: generation.maxOutputTokens }
        : {}),
    };

    const result = await agent.generate(
      [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              image: image.bytes.toString('base64'),
              mediaType: image.mediaType,
            },
            { type: 'text', text: question },
          ],
        },
      ] as never,
      {
        ...(options.requestContext
          ? { requestContext: options.requestContext }
          : {}),
        ...(Object.keys(modelSettings).length ? { modelSettings } : {}),
      } as never
    );

    return result.text;
  }
}
