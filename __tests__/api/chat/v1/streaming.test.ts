/**
 * @jest-environment node
 */

import { StreamingResponseData } from '@/types/StreamingResponseData';

interface StreamEvent {
  token?: string;
  sourceDocs?: { pageContent: string; metadata: Record<string, unknown> }[];
  done?: boolean;
  error?: string;
  model?: string;
}

// Mock TextEncoder/TextDecoder
const mockEncode = jest.fn().mockImplementation((str) => {
  if (!str) return new Uint8Array();
  return new Uint8Array(Buffer.from(str));
});

const mockDecode = jest.fn().mockImplementation((arr) => {
  if (!arr || !arr.length) return '';
  return Buffer.from(arr).toString();
});

global.TextEncoder = jest.fn().mockImplementation(() => ({
  encode: mockEncode,
}));

global.TextDecoder = jest.fn().mockImplementation(() => ({
  decode: mockDecode,
}));

// Mock ReadableStream
interface StreamController {
  enqueue: (chunk: Uint8Array) => void;
  close: () => void;
}

export class MockReadableStream {
  private chunks: Uint8Array[] = [];
  private currentIndex = 0;
  private encoder = new TextEncoder();

  constructor(init: { start: (controller: StreamController) => void }) {
    const controller = {
      enqueue: (chunk: Uint8Array) => {
        this.chunks.push(chunk);
      },
      close: () => {
        // Don't automatically add done event
      },
    };

    init.start(controller);
  }

  getReader() {
    return {
      read: async () => {
        if (this.currentIndex >= this.chunks.length) {
          return { done: true, value: undefined };
        }
        const value = this.chunks[this.currentIndex++];
        return { done: false, value };
      },
      releaseLock: () => {},
    };
  }
}

global.ReadableStream = MockReadableStream as unknown as typeof ReadableStream;

// Helper function to read events from a stream
export async function readEventsFromStream(
  stream: ReadableStream,
): Promise<StreamEvent[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const events: StreamEvent[] = [];

  let done = false;
  while (!done) {
    const { value, done: readerDone } = await reader.read();
    done = readerDone;
    if (value) {
      const text = decoder.decode(value);
      const lines = text.split('\n').filter((line) => line.trim() !== '');
      events.push(
        ...lines
          .filter((line) => line.startsWith('data: '))
          .map((line) => JSON.parse(line.replace('data: ', '')) as StreamEvent),
      );
    }
  }

  return events;
}

describe('Streaming Response Tests', () => {
  let encoder: TextEncoder;

  beforeEach(() => {
    encoder = new TextEncoder();
  });

  test('basic streaming response', async () => {
    const stream = new ReadableStream({
      start(controller) {
        const sendData = (data: StreamingResponseData) => {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
          );
        };

        sendData({ token: 'test' });
        sendData({ done: true });
        controller.close();
      },
    });

    const events = await readEventsFromStream(stream);
    expect(events).toEqual([{ token: 'test' }, { done: true }]);
  });

  test('source docs streaming', async () => {
    const stream = new ReadableStream({
      start(controller) {
        const sendData = (data: StreamingResponseData) => {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
          );
        };

        sendData({ token: 'test' });
        sendData({
          sourceDocs: [
            {
              pageContent: 'Test content',
              metadata: { source: 'test' },
            },
          ],
        });
        sendData({ done: true });
        controller.close();
      },
    });

    const events = await readEventsFromStream(stream);
    expect(events).toEqual([
      { token: 'test' },
      {
        sourceDocs: [
          {
            pageContent: 'Test content',
            metadata: { source: 'test' },
          },
        ],
      },
      { done: true },
    ]);
  });

  test('error handling', async () => {
    const stream = new ReadableStream({
      start(controller) {
        const sendData = (data: StreamingResponseData) => {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
          );
        };

        sendData({ error: 'Test error' });
        controller.close();
      },
    });

    const events = await readEventsFromStream(stream);
    expect(events).toEqual([{ error: 'Test error' }]);
  });

  test('model comparison', async () => {
    const stream = new ReadableStream({
      start(controller) {
        const sendData = (data: StreamingResponseData) => {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
          );
        };

        sendData({ token: 'Model A response', model: 'A' });
        sendData({ token: 'Model B response', model: 'B' });
        sendData({ done: true });
        controller.close();
      },
    });

    const events = await readEventsFromStream(stream);
    expect(events).toEqual([
      { token: 'Model A response', model: 'A' },
      { token: 'Model B response', model: 'B' },
      { done: true },
    ]);
  });
});
