import { copyTextToClipboard } from '@/utils/client/clipboard';

describe('clipboard utils', () => {
  const originalClipboard = { ...global.navigator.clipboard };
  const mockWriteText = jest.fn();
  const mockWrite = jest.fn();

  beforeEach(() => {
    // Mock ClipboardItem
    const ClipboardItemMock = jest.fn().mockImplementation((data) => ({
      types: Object.keys(data),
      getType: jest.fn(),
    })) as jest.Mock & { supports: jest.Mock };
    ClipboardItemMock.supports = jest.fn().mockReturnValue(true);

    // Assign our mock to global - this needs a type assertion since we're not implementing the full interface
    global.ClipboardItem =
      ClipboardItemMock as unknown as typeof global.ClipboardItem;

    // Mock clipboard API
    Object.defineProperty(global.navigator, 'clipboard', {
      value: {
        writeText: mockWriteText,
        write: mockWrite,
      },
      writable: true,
    });
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Restore original clipboard
    Object.defineProperty(global.navigator, 'clipboard', {
      value: originalClipboard,
      writable: true,
    });
    // Clean up ClipboardItem mock
    delete (global as Partial<typeof globalThis>).ClipboardItem;
  });

  it('copies plain text to clipboard', async () => {
    const text = 'Hello, World!';
    await copyTextToClipboard(text);
    expect(mockWriteText).toHaveBeenCalledWith(text);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('copies HTML to clipboard when isHtml is true', async () => {
    const html = '<p>Hello, World!</p>';
    await copyTextToClipboard(html, true);
    expect(mockWrite).toHaveBeenCalledWith([
      expect.objectContaining({
        types: ['text/html'],
      }),
    ]);
    expect(mockWriteText).not.toHaveBeenCalled();
  });

  it('falls back to writeText when write is not available', async () => {
    // Remove write method to simulate older browsers
    Object.defineProperty(global.navigator, 'clipboard', {
      value: {
        writeText: mockWriteText,
      },
      writable: true,
    });

    const html = '<p>Hello, World!</p>';
    await copyTextToClipboard(html, true);
    expect(mockWriteText).toHaveBeenCalledWith(html);
  });

  it('handles errors gracefully', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    mockWriteText.mockRejectedValueOnce(new Error('Clipboard error'));

    await copyTextToClipboard('test');

    expect(consoleSpy).toHaveBeenCalledWith(
      'Copy to clipboard failed',
      expect.any(Error),
    );

    consoleSpy.mockRestore();
  });
});
