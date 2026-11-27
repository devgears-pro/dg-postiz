import type { MessageList } from '@mastra/core/agent';
import type { ProcessInputArgs, Processor } from '@mastra/core/processors';
import type { MemoryStorage } from '@mastra/core/storage';

type MemoryContext = {
  thread?: { id?: string };
  resourceId?: string;
};

export class AgentHistoryProcessor implements Processor<'message-history'> {
  readonly id = 'message-history';

  constructor(private readonly storage: MemoryStorage) {}

  async processInput({
    messageList,
    requestContext,
  }: ProcessInputArgs): Promise<MessageList> {
    const memoryContext = requestContext?.get('MastraMemory') as
      | MemoryContext
      | undefined;
    const threadId = memoryContext?.thread?.id;
    if (!threadId) return messageList;

    const { messages } = await this.storage.listMessages({
      threadId,
      resourceId: memoryContext?.resourceId,
      page: 0,
      perPage: false,
      orderBy: { field: 'createdAt', direction: 'DESC' },
    });
    const stored = messages
      .filter((message) => message.role !== 'system')
      .reverse();
    const inputById = new Map(
      messageList
        .get.all.db()
        .map((message) => [message.id, message] as const)
    );

    for (const message of stored) {
      const input = inputById.get(message.id);
      if (input) {
        input.content = message.content;
      } else {
        messageList.add(message, 'memory');
      }
    }

    return messageList;
  }
}
