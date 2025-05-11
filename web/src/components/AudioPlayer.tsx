// This component renders an audio player with play/pause controls, a seek bar,
// and time display. It supports lazy loading and handles audio playback states.

import React, { useEffect, useState, useCallback } from 'react';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { useAudioContext } from '@/contexts/AudioContext';
import { logEvent } from '@/utils/client/analytics';
import { getS3AudioUrl } from '@/utils/client/getS3AudioUrl';

interface AudioPlayerProps {
  src: string;
  startTime: number;
  audioId: string;
  lazyLoad?: boolean;
  isExpanded?: boolean;
  library?: string; // Add library property for path resolution
}

// Loading spinner component for visual feedback during audio loading
const LoadingSpinner = () => (
  <div className="flex justify-center items-center">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
  </div>
);

export function AudioPlayer({
  src,
  startTime,
  audioId,
  lazyLoad = false,
  isExpanded = false,
  library, // Destructure the library prop
}: AudioPlayerProps) {
  const [isLoaded, setIsLoaded] = useState(!lazyLoad);
  const { currentlyPlayingId, setCurrentlyPlayingId } = useAudioContext();
  const [error, setError] = useState<string | null>(null);

  const directAudioUrl = src ? getS3AudioUrl(src, library) : null;

  // Custom hook for managing audio playback
  const {
    audioRef,
    isPlaying,
    currentTime,
    duration,
    togglePlayPause,
    setAudioTime,
    error: audioError,
    isSeeking,
  } = useAudioPlayer({
    src: directAudioUrl, // Use direct S3 URL
    startTime,
  });

  // Load audio when component mounts or when lazyLoad/isExpanded change
  useEffect(() => {
    if ((!lazyLoad || isExpanded) && !isLoaded) {
      if (directAudioUrl) {
        setIsLoaded(true); // If we have a URL, mark as loaded (or attempt to load)
      } else {
        setError('Invalid audio source provided.');
      }
    }
  }, [lazyLoad, isExpanded, isLoaded, directAudioUrl]);

  // Pause this audio if another audio starts playing
  useEffect(() => {
    if (currentlyPlayingId && currentlyPlayingId !== audioId && isPlaying) {
      togglePlayPause();
    }
  }, [currentlyPlayingId, audioId, isPlaying, togglePlayPause]);

  // Format time in HH:MM:SS or MM:SS format
  const formatTime = (time: number) => {
    const hours = Math.floor(time / 3600);
    const minutes = Math.floor((time % 3600) / 60);
    const seconds = Math.floor(time % 60);
    return hours > 0
      ? `${hours}:${minutes.toString().padStart(2, '0')}:${seconds
          .toString()
          .padStart(2, '0')}`
      : `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // Handle play/pause button click
  const handleTogglePlayPause = () => {
    if (!isLoaded && directAudioUrl) {
      // Check directAudioUrl before setting isLoaded
      setIsLoaded(true); // This will trigger the audio element to attempt loading
    } else if (isLoaded && directAudioUrl) {
      // Only toggle if loaded and URL exists
      if (!isPlaying) {
        setCurrentlyPlayingId(audioId);
        logEvent('play_audio', 'Engagement', audioId);
      } else {
        setCurrentlyPlayingId(null);
        logEvent('pause_audio', 'Engagement', audioId);
      }
      togglePlayPause();
    }
  };

  // Handle seek bar change
  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = parseFloat(e.target.value);
    setAudioTime(newTime);
    logEvent('seek_audio', 'Engagement', `${audioId}:${newTime}`);
  };

  // Handle download button click
  const handleDownload = () => {
    if (directAudioUrl) {
      // Use directAudioUrl
      // Pause playback if currently playing
      if (isPlaying) {
        togglePlayPause();
        setCurrentlyPlayingId(null);
      }

      // Open the audio URL in a new tab
      window.open(directAudioUrl, '_blank'); // Use directAudioUrl

      // Log the download attempt
      logEvent('download_audio', 'Engagement', audioId);
    }
  };

  return (
    <div className="audio-player bg-gray-100 rounded-lg w-full md:w-1/2">
      <audio
        ref={audioRef}
        preload="metadata"
        onLoadedMetadata={() => setAudioTime(startTime)}
        onError={() => setError('Failed to load audio. Please try again.')}
      />
      {error && <div className="text-red-500 mb-1 text-sm px-2">{error}</div>}
      {audioError && (
        <div className="text-red-500 mb-1 text-sm px-2">{audioError}</div>
      )}
      <div className="flex items-center justify-between px-2">
        <button
          onClick={handleTogglePlayPause}
          className={`text-blue-500 p-1 rounded-full hover:bg-blue-100 focus:outline-none ${
            !isLoaded || !directAudioUrl ? 'opacity-50 cursor-not-allowed' : '' // Check directAudioUrl
          }`}
          disabled={
            !isLoaded || !!error || !!audioError || isSeeking || !directAudioUrl
          } // Check directAudioUrl
          aria-label={isPlaying ? 'Pause audio' : 'Play audio'}
        >
          <span className="material-icons text-2xl">
            {isPlaying ? 'pause' : 'play_arrow'}
          </span>
        </button>
        <div className="text-xs">
          {formatTime(currentTime)} / {formatTime(duration)}
        </div>
        <button
          onClick={handleDownload}
          className={`text-gray-500 p-1 rounded-full hover:bg-gray-200 focus:outline-none ${
            !directAudioUrl || !!error || !!audioError // Use directAudioUrl
              ? 'opacity-50 cursor-not-allowed'
              : ''
          }`}
          disabled={!directAudioUrl || !!error || !!audioError} // Use directAudioUrl
          aria-label="Download audio"
        >
          <span className="material-icons text-2xl">download</span>
        </button>
      </div>
      <div className="px-2 pb-2">
        <input
          type="range"
          min={0}
          max={duration}
          value={currentTime}
          onChange={handleSeek}
          className="w-full"
          disabled={!isLoaded || !!error || !!audioError || !directAudioUrl} // Check directAudioUrl
        />
      </div>
    </div>
  );
}
