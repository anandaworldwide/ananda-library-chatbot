// This component renders an audio player with play/pause controls, a seek bar,
// and time display. It supports lazy loading and handles audio playback states.

import React, { useEffect, useState } from "react";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { useAudioContext } from "@/contexts/AudioContext";
import { logEvent } from "@/utils/client/analytics";
import { getCachedSecureAudioUrl } from "@/utils/client/getSecureAudioUrl";

interface AudioPlayerProps {
  src: string;
  startTime: number;
  audioId: string;
  lazyLoad?: boolean;
  isExpanded?: boolean;
  library?: string; // Add library property for path resolution
  docId?: string;
}

// Loading spinner component for visual feedback during audio loading
export const LoadingSpinner = () => (
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
  library,
  docId,
}: AudioPlayerProps) {
  const [isLoaded, setIsLoaded] = useState(!lazyLoad);
  const [secureAudioUrl, setSecureAudioUrl] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [isLoadingUrl, setIsLoadingUrl] = useState(false);
  const { currentlyPlayingId, setCurrentlyPlayingId } = useAudioContext();
  const [error, setError] = useState<string | null>(null);

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
    src: secureAudioUrl, // Use secure URL instead of direct S3 URL
    startTime,
  });

  // Function to fetch secure audio URL
  const fetchSecureAudioUrl = async () => {
    if (!src) {
      setUrlError("No audio source provided");
      return;
    }

    setIsLoadingUrl(true);
    setUrlError(null);

    try {
      const url = await getCachedSecureAudioUrl(src, library, docId);
      setSecureAudioUrl(url);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to load audio";
      setUrlError(errorMessage);
      console.error("Failed to fetch secure audio URL:", error);
    } finally {
      setIsLoadingUrl(false);
    }
  };

  // Load secure audio URL when component mounts or when conditions change
  useEffect(() => {
    if ((!lazyLoad || isExpanded) && !isLoaded && !secureAudioUrl && !isLoadingUrl) {
      fetchSecureAudioUrl();
      setIsLoaded(true);
    }
  }, [lazyLoad, isExpanded, isLoaded, secureAudioUrl, isLoadingUrl, src, library, docId]);

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
      ? `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
      : `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  // Handle play/pause button click
  const handleTogglePlayPause = async () => {
    // If we don't have a secure URL yet, try to fetch it
    if (!secureAudioUrl && !isLoadingUrl) {
      await fetchSecureAudioUrl();
      return; // Wait for the URL to be fetched before playing
    }

    if (secureAudioUrl && isLoaded) {
      // Only toggle if loaded and URL exists
      if (!isPlaying) {
        setCurrentlyPlayingId(audioId);
        logEvent("play_audio", "Engagement", audioId);
      } else {
        setCurrentlyPlayingId(null);
        logEvent("pause_audio", "Engagement", audioId);
      }
      togglePlayPause();
    }
  };

  // Handle seek bar change
  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = parseFloat(e.target.value);
    setAudioTime(newTime);
    logEvent("seek_audio", "Engagement", `${audioId}:${newTime}`);
  };

  // Handle download button click
  const handleDownload = () => {
    if (secureAudioUrl) {
      // Pause playback if currently playing
      if (isPlaying) {
        togglePlayPause();
        setCurrentlyPlayingId(null);
      }

      // Create a temporary link element for secure download (mobile Safari compatible)
      const link = document.createElement("a");
      link.href = secureAudioUrl;
      link.download = src || "audio.mp3";
      link.target = "_blank"; // Open download in new tab
      link.rel = "noopener noreferrer"; // Security best practice
      link.style.display = "none";

      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // Log the download attempt
      logEvent("download_audio", "Engagement", audioId);
    }
  };

  // Determine if controls should be disabled
  const isDisabled = !secureAudioUrl || !!error || !!audioError || !!urlError || isSeeking || isLoadingUrl;

  return (
    <div className="audio-player bg-gray-100 rounded-lg w-full md:w-1/2">
      <audio
        ref={audioRef}
        preload="metadata"
        onLoadedMetadata={() => setAudioTime(startTime)}
        onError={() => setError("Failed to load audio. Please try again.")}
      />

      {/* Error display */}
      {error && <div className="text-red-500 mb-1 text-sm px-2">{error}</div>}
      {audioError && <div className="text-red-500 mb-1 text-sm px-2">{audioError}</div>}
      {urlError && <div className="text-red-500 mb-1 text-sm px-2">Audio access error: {urlError}</div>}

      {/* Loading indicator */}
      {isLoadingUrl && (
        <div className="text-blue-500 mb-1 text-sm px-2 flex items-center">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500 mr-2"></div>
          Loading audio...
        </div>
      )}

      <div className="flex items-center justify-between px-2">
        <button
          onClick={handleTogglePlayPause}
          className={`text-blue-500 p-1 rounded-full hover:bg-blue-100 focus:outline-none ${
            isDisabled ? "opacity-50 cursor-not-allowed" : ""
          }`}
          disabled={isDisabled}
          aria-label={isPlaying ? "Pause audio" : "Play audio"}
        >
          <span className="material-icons text-2xl">
            {isLoadingUrl ? "hourglass_empty" : isPlaying ? "pause" : "play_arrow"}
          </span>
        </button>
        <div className="text-xs">
          {formatTime(currentTime)} / {formatTime(duration)}
        </div>
        <button
          onClick={handleDownload}
          className={`text-gray-500 p-1 rounded-full hover:bg-gray-200 focus:outline-none ${
            isDisabled ? "opacity-50 cursor-not-allowed" : ""
          }`}
          disabled={isDisabled}
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
          disabled={isDisabled}
        />
      </div>
    </div>
  );
}
