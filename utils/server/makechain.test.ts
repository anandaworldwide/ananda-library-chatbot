import {
  convertChatHistory,
  ChatHistory,
  ChatMessage,
} from '@/utils/shared/chatHistory';

describe('convertChatHistory', () => {
  it('should correctly convert chat history with role-based messages', () => {
    const inputHistory = [
      {
        role: 'user',
        content: 'Tell me six words about meditation',
      },
      {
        role: 'assistant',
        content:
          "I'm tuned to answer questions related to the Ananda Libraries...",
      },
      {
        role: 'user',
        content: 'Give me five bullet points on that.',
      },
      {
        role: 'assistant',
        content:
          'Certainly! Here are five key points based on the context provided:',
      },
    ] as ChatMessage[];

    const expected =
      'Human: Tell me six words about meditation\n' +
      "Assistant: I'm tuned to answer questions related to the Ananda Libraries...\n" +
      'Human: Give me five bullet points on that.\n' +
      'Assistant: Certainly! Here are five key points based on the context provided:';

    const result = convertChatHistory(inputHistory);
    expect(result).toEqual(expected);
  });

  it('should handle empty history', () => {
    const result = convertChatHistory([]);
    expect(result).toEqual('');
  });

  it('should handle undefined history', () => {
    const result = convertChatHistory(undefined);
    expect(result).toEqual('');
  });
});
