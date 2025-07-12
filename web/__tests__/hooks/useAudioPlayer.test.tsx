import React from 'react';
import { renderHook, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';

// Mock HTMLAudioElement
class MockAudioElement implements Partial<HTMLAudioElement> {
  private _currentTime = 0;
  private _duration = 0;
  private _src = '';
  private eventListeners: Record<string, EventListener[]> = {};

  get currentTime() {
    return this._currentTime;
  }

  set currentTime(value: number) {
    this._currentTime = value;
    setTimeout(() => this.dispatchEvent('timeupdate'), 0);
  }

  get duration() {
    return this._duration;
  }

  get src() {
    return this._src;
  }

  set src(value: string) {
    this._src = value;
  }

  play = jest.fn().mockResolvedValue(undefined);
  pause = jest.fn();
  load = jest.fn();

  addEventListener = jest.fn((event: string, listener: EventListener) => {
    if (!this.eventListeners[event]) {
      this.eventListeners[event] = [];
    }
    this.eventListeners[event].push(listener);
  });

  removeEventListener = jest.fn((event: string, listener: EventListener) => {
    if (this.eventListeners[event]) {
      const index = this.eventListeners[event].indexOf(listener);
      if (index > -1) {
        this.eventListeners[event].splice(index, 1);
      }
    }
  });

  // Helper methods for testing
  mockLoadedMetadata(duration: number) {
    this._duration = duration;
    this.dispatchEvent('loadedmetadata');
  }

  mockCanPlayThrough() {
    this.dispatchEvent('canplaythrough');
  }

  mockTimeUpdate(currentTime: number) {
    this._currentTime = currentTime;
    this.dispatchEvent('timeupdate');
  }

  mockEnded() {
    this.dispatchEvent('ended');
  }

  mockPlayError() {
    this.play = jest.fn().mockRejectedValue(new Error('Playback failed'));
  }

  dispatchEvent(eventType: string) {
    const listeners = this.eventListeners[eventType] || [];
    listeners.forEach(listener => {
      listener.call(this, new Event(eventType));
    });
  }
}

// Global mock instance
let mockAudio: MockAudioElement;

describe('useAudioPlayer', () => {
  beforeEach(() => {
    // Reset console.error mock
    jest.spyOn(console, 'error').mockImplementation(() => {});
    
    // Create new mock instance for each test
    mockAudio = new MockAudioElement();
    
    // Mock HTMLAudioElement constructor
    global.HTMLAudioElement = jest.fn(() => mockAudio) as any;
    
    // Mock useRef to return our mock audio element for the audioRef
    const originalUseRef = React.useRef;
    jest.spyOn(React, 'useRef').mockImplementation((initialValue) => {
      // Return mock audio for the audioRef (which starts as null)
      if (initialValue === null) {
        return { current: mockAudio };
      }
      // Use original useRef for other refs
      return originalUseRef(initialValue);
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  describe('Initial State', () => {
    it('should initialize with correct default values', () => {
      const { result } = renderHook(() =>
        useAudioPlayer({ src: null, startTime: 0 })
      );

      expect(result.current.isPlaying).toBe(false);
      expect(result.current.currentTime).toBe(0);
      expect(result.current.duration).toBe(0);
      expect(result.current.isLoaded).toBe(false);
      expect(result.current.error).toBeNull();
      expect(result.current.isSeeking).toBe(false);
      expect(result.current.audioRef.current).toBe(mockAudio);
    });

    it('should initialize with custom startTime', () => {
      const startTime = 30;
      const { result } = renderHook(() =>
        useAudioPlayer({ src: null, startTime })
      );

      expect(result.current.currentTime).toBe(startTime);
    });
  });

  describe('Audio Loading', () => {
    it('should load audio and set up event listeners when src is provided', () => {
      const src = 'https://example.com/audio.mp3';
      renderHook(() => useAudioPlayer({ src, startTime: 0 }));

      expect(mockAudio.src).toBe(src);
      expect(mockAudio.load).toHaveBeenCalled();
      expect(mockAudio.addEventListener).toHaveBeenCalledWith('loadedmetadata', expect.any(Function));
      expect(mockAudio.addEventListener).toHaveBeenCalledWith('canplaythrough', expect.any(Function));
      expect(mockAudio.addEventListener).toHaveBeenCalledWith('timeupdate', expect.any(Function));
      expect(mockAudio.addEventListener).toHaveBeenCalledWith('ended', expect.any(Function));
    });

    it('should reset isLoaded when src changes', () => {
      const { result, rerender } = renderHook(
        ({ src }) => useAudioPlayer({ src, startTime: 0 }),
        { initialProps: { src: 'https://example.com/audio1.mp3' } }
      );

      // Simulate audio loaded
      act(() => {
        mockAudio.mockLoadedMetadata(120);
      });

      expect(result.current.isLoaded).toBe(true);

      // Change src
      rerender({ src: 'https://example.com/audio2.mp3' });

      expect(result.current.isLoaded).toBe(false);
      expect(mockAudio.load).toHaveBeenCalledTimes(2);
    });

    it('should not load audio when src is null', () => {
      renderHook(() => useAudioPlayer({ src: null, startTime: 0 }));

      expect(mockAudio.load).not.toHaveBeenCalled();
    });
  });

  describe('Audio Events', () => {
    it('should handle loadedmetadata event correctly', () => {
      const startTime = 15;
      const { result } = renderHook(() =>
        useAudioPlayer({ src: 'https://example.com/audio.mp3', startTime })
      );

      act(() => {
        mockAudio.mockLoadedMetadata(180);
      });

      expect(result.current.duration).toBe(180);
      expect(result.current.isLoaded).toBe(true);
      expect(mockAudio.currentTime).toBe(startTime);
    });

    it('should handle canplaythrough event correctly', () => {
      const { result } = renderHook(() =>
        useAudioPlayer({ src: 'https://example.com/audio.mp3', startTime: 0 })
      );

      act(() => {
        mockAudio.mockCanPlayThrough();
      });

      expect(result.current.isLoaded).toBe(true);
    });

    it('should handle timeupdate event correctly', () => {
      const { result } = renderHook(() =>
        useAudioPlayer({ src: 'https://example.com/audio.mp3', startTime: 0 })
      );

      act(() => {
        mockAudio.mockTimeUpdate(45);
      });

      expect(result.current.currentTime).toBe(45);
    });

    it('should handle ended event correctly', () => {
      const startTime = 10;
      const { result } = renderHook(() =>
        useAudioPlayer({ src: 'https://example.com/audio.mp3', startTime })
      );

      // Start playing
      act(() => {
        result.current.togglePlayPause();
      });

      expect(result.current.isPlaying).toBe(true);

      // Simulate audio ended
      act(() => {
        mockAudio.mockEnded();
      });

      expect(result.current.isPlaying).toBe(false);
      expect(mockAudio.currentTime).toBe(startTime);
    });
  });

  describe('togglePlayPause Function', () => {
    it('should start playing when audio is paused', () => {
      const { result } = renderHook(() =>
        useAudioPlayer({ src: 'https://example.com/audio.mp3', startTime: 0 })
      );

      act(() => {
        result.current.togglePlayPause();
      });

      expect(mockAudio.play).toHaveBeenCalled();
      expect(result.current.isPlaying).toBe(true);
      expect(result.current.error).toBeNull();
    });

    it('should pause when audio is playing', () => {
      const { result } = renderHook(() =>
        useAudioPlayer({ src: 'https://example.com/audio.mp3', startTime: 0 })
      );

      // Start playing first
      act(() => {
        result.current.togglePlayPause();
      });

      expect(result.current.isPlaying).toBe(true);

      // Then pause
      act(() => {
        result.current.togglePlayPause();
      });

      expect(mockAudio.pause).toHaveBeenCalled();
      expect(result.current.isPlaying).toBe(false);
    });

    it('should not play when src is null', () => {
      const { result } = renderHook(() =>
        useAudioPlayer({ src: null, startTime: 0 })
      );

      act(() => {
        result.current.togglePlayPause();
      });

      expect(mockAudio.play).not.toHaveBeenCalled();
      expect(result.current.isPlaying).toBe(false);
    });

    it('should handle play errors correctly', async () => {
      const { result } = renderHook(() =>
        useAudioPlayer({ src: 'https://example.com/audio.mp3', startTime: 0 })
      );

      // Mock play to reject
      mockAudio.mockPlayError();

      await act(async () => {
        result.current.togglePlayPause();
        // Wait for promise rejection to be handled
        await new Promise(resolve => setTimeout(resolve, 0));
      });

      expect(result.current.error).toBe('Failed to play audio. Please try again.');
      expect(result.current.isPlaying).toBe(false);
      expect(console.error).toHaveBeenCalledWith('Error playing audio:', expect.any(Error));
    });
  });

  describe('setAudioTime Function', () => {
    it('should set audio time correctly when not playing', () => {
      const { result } = renderHook(() =>
        useAudioPlayer({ src: 'https://example.com/audio.mp3', startTime: 0 })
      );

      act(() => {
        result.current.setAudioTime(60);
      });

      expect(mockAudio.currentTime).toBe(60);
      expect(result.current.currentTime).toBe(60);
      expect(result.current.isSeeking).toBe(false);
    });

    it('should set audio time and resume playing when audio is playing', () => {
      const { result } = renderHook(() =>
        useAudioPlayer({ src: 'https://example.com/audio.mp3', startTime: 0 })
      );

      // Start playing first
      act(() => {
        result.current.togglePlayPause();
      });

      expect(result.current.isPlaying).toBe(true);

      // Set time while playing
      act(() => {
        result.current.setAudioTime(90);
      });

      expect(mockAudio.currentTime).toBe(90);
      expect(result.current.currentTime).toBe(90);
      expect(mockAudio.play).toHaveBeenCalledTimes(2); // Once for togglePlayPause, once for setAudioTime
    });

    it('should not do anything when audio ref is null', () => {
      // Test the edge case by temporarily overriding the mock
      const originalUseRef = React.useRef;
      jest.spyOn(React, 'useRef').mockImplementation((initialValue) => {
        if (initialValue === null) {
          return { current: null }; // Return null for this test
        }
        return originalUseRef(initialValue);
      });

      const { result } = renderHook(() =>
        useAudioPlayer({ src: 'https://example.com/audio.mp3', startTime: 0 })
      );

      act(() => {
        result.current.setAudioTime(60);
      });

      // Should not throw any errors and currentTime should remain at startTime
      expect(result.current.currentTime).toBe(0);
    });
  });

  describe('Event Listener Cleanup', () => {
    it('should remove event listeners on unmount', () => {
      const { unmount } = renderHook(() =>
        useAudioPlayer({ src: 'https://example.com/audio.mp3', startTime: 0 })
      );

      unmount();

      expect(mockAudio.removeEventListener).toHaveBeenCalledWith('loadedmetadata', expect.any(Function));
      expect(mockAudio.removeEventListener).toHaveBeenCalledWith('canplaythrough', expect.any(Function));
      expect(mockAudio.removeEventListener).toHaveBeenCalledWith('timeupdate', expect.any(Function));
      expect(mockAudio.removeEventListener).toHaveBeenCalledWith('ended', expect.any(Function));
    });

    it('should remove event listeners when startTime changes', () => {
      const { rerender } = renderHook(
        ({ startTime }) => useAudioPlayer({ src: 'https://example.com/audio.mp3', startTime }),
        { initialProps: { startTime: 0 } }
      );

      const initialCallCount = mockAudio.removeEventListener.mock.calls.length;

      rerender({ startTime: 30 });

      expect(mockAudio.removeEventListener).toHaveBeenCalledTimes(initialCallCount + 4);
    });
  });

  describe('Return Values', () => {
    it('should return all expected properties and functions', () => {
      const { result } = renderHook(() =>
        useAudioPlayer({ src: 'https://example.com/audio.mp3', startTime: 0 })
      );

      expect(result.current).toHaveProperty('audioRef');
      expect(result.current).toHaveProperty('isPlaying');
      expect(result.current).toHaveProperty('currentTime');
      expect(result.current).toHaveProperty('duration');
      expect(result.current).toHaveProperty('togglePlayPause');
      expect(result.current).toHaveProperty('setAudioTime');
      expect(result.current).toHaveProperty('isLoaded');
      expect(result.current).toHaveProperty('error');
      expect(result.current).toHaveProperty('isSeeking');

      expect(typeof result.current.togglePlayPause).toBe('function');
      expect(typeof result.current.setAudioTime).toBe('function');
    });
  });
});