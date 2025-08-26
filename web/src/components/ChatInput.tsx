/**
 * ChatInput Component
 *
 * This component renders a chat input interface with various options and controls.
 * It handles user input, submission, and displays suggested queries and media type options.
 *
 * Key features:
 * - Text input area with auto-resizing
 * - Submit button that toggles between send and stop based on loading state
 * - Media type selection (text, audio, YouTube) if enabled
 * - Collection selector for choosing different content sources
 * - Private session toggle
 * - Suggested queries with expand/collapse functionality
 * - Mobile-responsive design with collapsible options
 * - Input validation and sanitization
 * - Analytics event logging for user interactions
 *
 * The component is highly configurable through props and site configuration,
 * allowing for easy customization of features and behavior.
 */

import React, { useState, useEffect } from "react";
import DOMPurify from "dompurify";
import validator from "validator";
import styles from "@/styles/Home.module.css";
import RandomQueries from "@/components/RandomQueries";
import CollectionSelector from "@/components/CollectionSelector";
import { SiteConfig } from "@/types/siteConfig";
import {
  getEnableSuggestedQueries,
  getEnableMediaTypeSelection,
  getEnableAuthorSelection,
  getChatPlaceholder,
  getEnabledMediaTypes,
} from "@/utils/client/siteConfig";
import { logEvent } from "@/utils/client/analytics";
import { getOrCreateUUID } from "@/utils/client/uuid";
import { FirestoreIndexError, useFirestoreIndexError } from "@/components/FirestoreIndexError";

// Define the props interface for the ChatInput component
interface ChatInputProps {
  loading: boolean;
  disabled?: boolean;
  handleSubmit: (e: React.FormEvent, query: string) => void;
  handleStop: () => void;
  handleEnter: (e: React.KeyboardEvent<HTMLTextAreaElement>, query: string) => void;
  handleClick: (query: string) => void;
  handleCollectionChange: (newCollection: string) => void;
  handlePrivateSessionChange: (event: React.MouseEvent<HTMLButtonElement>) => void;
  collection: string;
  privateSession: boolean;
  error: string | null;
  setError: (error: string | null) => void;
  randomQueries: string[];
  shuffleQueries: () => void;
  textAreaRef: React.RefObject<HTMLTextAreaElement>;
  mediaTypes: { text: boolean; audio: boolean; youtube: boolean };
  handleMediaTypeChange: (type: "text" | "audio" | "youtube") => void;
  siteConfig: SiteConfig | null;
  input: string;
  handleInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  setShouldAutoScroll: (should: boolean) => void;
  setQuery: (query: string) => void;
  isNearBottom: boolean;
  setIsNearBottom: React.Dispatch<React.SetStateAction<boolean>>;
  isLoadingQueries: boolean;
  showPrivateSessionOptions?: boolean;
  sourceCount: number;
  setSourceCount: (count: number) => void;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  loading,
  disabled = false,
  handleSubmit,
  handleStop,
  handleEnter,
  handleClick,
  handleCollectionChange,
  handlePrivateSessionChange,
  collection,
  privateSession,
  error,
  setError,
  randomQueries,
  shuffleQueries,
  textAreaRef,
  mediaTypes,
  handleMediaTypeChange,
  siteConfig,
  input,
  handleInputChange,
  setQuery,
  setIsNearBottom,
  isLoadingQueries,
  showPrivateSessionOptions = true,
  sourceCount,
  setSourceCount,
}) => {
  // State variables for managing component behavior
  const [, setLocalQuery] = useState<string>("");
  const [hasInteracted, setHasInteracted] = useState<boolean>(false);
  const [isFirstQuery, setIsFirstQuery] = useState<boolean>(true);
  const [isMobile, setIsMobile] = useState<boolean>(false);
  const [showOptions, setShowOptions] = useState(false);
  const [suggestionsExpanded, setSuggestionsExpanded] = useState(false);
  const [showControlsInfo, setShowControlsInfo] = useState(false);
  //const inputRef = useRef<HTMLTextAreaElement>(null);

  // Analyze error to determine if it's a Firestore index error
  const { isIndexError, isBuilding, errorMessage } = useFirestoreIndexError(error);

  // Effect to set initial suggestions expanded state based on saved preference
  useEffect(() => {
    // Ensure a persistent UUID exists for this user (cookie-based)
    try {
      getOrCreateUUID();
    } catch {}

    const savedPreference = localStorage.getItem("suggestionsExpanded");
    setSuggestionsExpanded(savedPreference === null ? true : savedPreference === "true");
  }, [setSuggestionsExpanded]);

  // Effect to reset input after submission
  useEffect(() => {
    if (!loading && hasInteracted) {
      setLocalQuery("");
      if (textAreaRef.current) {
        // 1. Reset to auto - now textarea temporarily collapses to fit content
        textAreaRef.current.style.height = "auto";
        // 2. Now we can get the true height needed
        textAreaRef.current.style.height = `${textAreaRef.current.scrollHeight}px`;
      }
    }
  }, [loading, hasInteracted, textAreaRef]);

  // Effect to handle mobile responsiveness
  useEffect(() => {
    const handleResize = () => {
      const newIsMobile = window.innerWidth < 768;
      setIsMobile(newIsMobile);
      if (!newIsMobile) {
        setShowOptions(true);
      }
    };

    handleResize(); // Set initial value
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  // Effect to reset input and update first query state
  useEffect(() => {
    if (!loading) {
      setLocalQuery("");
      if (textAreaRef.current) {
        textAreaRef.current.style.height = "auto";
      }
      if (isFirstQuery) {
        setIsFirstQuery(false);
      }
    }
  }, [loading, isFirstQuery, textAreaRef]);

  // Function to focus on the input field
  const focusInput = () => {
    setTimeout(() => {
      if (textAreaRef.current) {
        textAreaRef.current.focus();
      }
    }, 0);
  };

  // Function to sanitize user input
  const sanitizeInput = (input: string) => {
    return DOMPurify.sanitize(input).toString();
  };

  // Function to validate user input
  const validateInput = (input: string) => {
    if (validator.isEmpty(input)) {
      return "Input cannot be empty";
    }
    if (!validator.isLength(input, { min: 1, max: 4000 })) {
      return "Input must be between 1 and 4000 characters";
    }
    return null;
  };

  // Function to handle form submission
  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) {
      handleStop();
      logEvent("stop_query", "Engagement", "");
    } else {
      const sanitizedInput = sanitizeInput(input);

      // Skip validation for empty inputs - let parent handle gracefully
      if (sanitizedInput.trim() === "") {
        handleSubmit(e, sanitizedInput);
        return;
      }

      const validationError = validateInput(sanitizedInput);
      if (validationError) {
        setError(validationError);
        return;
      }
      setIsNearBottom(true);
      handleSubmit(e, sanitizedInput);
      setQuery("");
      focusInput();
      logEvent("submit_query", "Engagement", sanitizedInput);
    }
  };

  // Function to handle Enter key press
  const onEnter = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      if (!loading) {
        e.preventDefault();
        const sanitizedInput = sanitizeInput(input);

        // Skip validation for empty inputs - let parent handle gracefully
        if (sanitizedInput.trim() === "") {
          handleEnter(e, sanitizedInput);
          return;
        }

        const validationError = validateInput(sanitizedInput);
        if (validationError) {
          setError(validationError);
          return;
        }
        logEvent("submit_query_enter", "Engagement", sanitizedInput);
        setHasInteracted(true);
        setIsNearBottom(true);
        handleEnter(e, sanitizedInput);
        setQuery("");
        focusInput();
      }
    }
  };

  // Get configuration options from siteConfig
  const showSuggestedQueries = getEnableSuggestedQueries(siteConfig);
  const showMediaTypeSelection = getEnableMediaTypeSelection(siteConfig);
  const showAuthorSelection = getEnableAuthorSelection(siteConfig);
  const enabledMediaTypes = getEnabledMediaTypes(siteConfig);

  // Function to toggle suggestions visibility
  const toggleSuggestions = (e: React.MouseEvent) => {
    e.preventDefault();
    const newState = !suggestionsExpanded;
    setSuggestionsExpanded(newState);
    localStorage.setItem("suggestionsExpanded", newState.toString());
  };

  // Function to handle clicking on a suggested query
  const onQueryClick = (q: string) => {
    setLocalQuery(q);
    setIsNearBottom(true);
    handleClick(q);
  };

  const placeholderText = getChatPlaceholder(siteConfig) || "Ask a question...";

  // Function to adjust textarea height
  const adjustTextAreaHeight = () => {
    if (textAreaRef.current) {
      // 1. Reset to auto - now textarea temporarily collapses to fit content
      textAreaRef.current.style.height = "auto";
      // 2. Now we can get the true height needed
      textAreaRef.current.style.height = `${textAreaRef.current.scrollHeight}px`;
    }
  };

  // Render the chat input interface
  return (
    <div className={`${styles.center} w-full mt-4 px-2 md:px-0`}>
      <div className="w-full">
        <form onSubmit={onSubmit}>
          {/* Input textarea and submit button */}
          <div className="flex items-center space-x-2 mb-4">
            <textarea
              onKeyDown={onEnter}
              onChange={(e) => {
                handleInputChange(e);
                adjustTextAreaHeight();
              }}
              value={input}
              ref={textAreaRef}
              autoFocus={false}
              rows={1}
              maxLength={4000}
              id="userInput"
              name="userInput"
              placeholder={disabled ? "View-only mode" : hasInteracted ? "" : placeholderText}
              disabled={disabled}
              className={`flex-grow p-2 border border-gray-300 rounded-md resize-none focus:outline-none min-h-[40px] overflow-hidden ${
                disabled ? "bg-gray-100 cursor-not-allowed" : ""
              }`}
              style={{ height: "auto" }}
            />
            <button
              type="submit"
              disabled={disabled}
              className={`p-2 rounded-full flex-shrink-0 w-10 h-10 flex items-center justify-center ${
                disabled ? "bg-gray-400 text-gray-600 cursor-not-allowed" : "bg-blue-500 text-white hover:bg-blue-600"
              }`}
            >
              {loading ? (
                <span className="material-icons text-2xl leading-none">stop</span>
              ) : (
                <span className="material-icons text-xl leading-none">send</span>
              )}
            </button>
          </div>

          {/* Mobile options toggle - only show if there are options available */}
          {isMobile &&
            (showMediaTypeSelection ||
              showAuthorSelection ||
              siteConfig?.showSourceCountSelector ||
              (showPrivateSessionOptions && !privateSession && siteConfig?.allowPrivateSessions)) && (
              <div className="mb-4">
                <button
                  type="button"
                  onClick={() => setShowOptions(!showOptions)}
                  className="text-blue-500 hover:underline mb-2"
                >
                  {showOptions ? "Hide options" : "Show options"}
                </button>
              </div>
            )}

          {/* Options section (media type, collection selector, private session) */}
          {(!isMobile || showOptions) && (
            <div className="flex flex-wrap gap-2 mb-2">
              {showMediaTypeSelection && (
                <>
                  {enabledMediaTypes.includes("text") && (
                    <button
                      type="button"
                      onClick={() => handleMediaTypeChange("text")}
                      className={`px-2 py-1 text-xs sm:text-sm rounded ${
                        mediaTypes.text ? "bg-blue-500 text-white" : "bg-gray-200 text-gray-700"
                      }`}
                    >
                      Writings
                    </button>
                  )}
                  {enabledMediaTypes.includes("audio") && (
                    <button
                      type="button"
                      onClick={() => handleMediaTypeChange("audio")}
                      className={`px-2 py-1 text-xs sm:text-sm rounded ${
                        mediaTypes.audio ? "bg-blue-500 text-white" : "bg-gray-200 text-gray-700"
                      }`}
                    >
                      Audio
                    </button>
                  )}
                  {enabledMediaTypes.includes("youtube") && (
                    <button
                      type="button"
                      onClick={() => handleMediaTypeChange("youtube")}
                      className={`px-2 py-1 text-xs sm:text-sm rounded ${
                        mediaTypes.youtube ? "bg-blue-500 text-white" : "bg-gray-200 text-gray-700"
                      }`}
                    >
                      Video
                    </button>
                  )}
                </>
              )}
              {showAuthorSelection && (
                <div className="flex-grow sm:flex-grow-0 sm:min-w-[160px]">
                  <CollectionSelector onCollectionChange={handleCollectionChange} currentCollection={collection} />
                </div>
              )}
              {siteConfig?.showSourceCountSelector && (
                <div className="flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    id="extraSources"
                    checked={sourceCount === 10}
                    onChange={(e) => {
                      setSourceCount(e.target.checked ? 10 : 4);
                      logEvent("toggle_extra_sources", "Settings", e.target.checked ? "enabled" : "disabled");
                    }}
                    className="mr-1"
                  />
                  <label htmlFor="extraSources" className="text-sm text-gray-700 cursor-pointer">
                    Use extra sources
                  </label>
                </div>
              )}
              {showPrivateSessionOptions && !privateSession && siteConfig?.allowPrivateSessions && (
                <button
                  type="button"
                  onClick={handlePrivateSessionChange}
                  className="px-2 py-1 text-xs sm:text-sm rounded bg-purple-100 text-purple-800 whitespace-nowrap"
                >
                  <span className="material-icons text-sm mr-1 align-middle">lock</span>
                  <span className="align-middle">Start Private Session</span>
                </button>
              )}
              {(showMediaTypeSelection ||
                showAuthorSelection ||
                siteConfig?.showSourceCountSelector ||
                siteConfig?.allowPrivateSessions) && (
                <button
                  type="button"
                  onClick={() => setShowControlsInfo(true)}
                  className="px-2 py-1 text-xs sm:text-sm rounded-full border border-gray-300 w-6 h-6 flex items-center justify-center hover:bg-gray-100 self-center"
                  aria-label="Controls information"
                >
                  <span className="material-icons text-base">info</span>
                </button>
              )}

              {/* Controls Info Popup */}
              {showControlsInfo && (
                <>
                  <div
                    className="fixed inset-0 bg-black/30 backdrop-blur-sm z-[100]"
                    onClick={() => setShowControlsInfo(false)}
                    aria-hidden="true"
                  />
                  <div className="fixed z-[101] top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white p-6 rounded-lg shadow-lg max-w-md w-full mx-4">
                    <div className="flex justify-between items-start mb-4">
                      <h3 className="text-lg font-semibold">Available Controls</h3>
                      <button
                        onClick={() => setShowControlsInfo(false)}
                        className="text-gray-500 hover:text-gray-700"
                        aria-label="Close"
                      >
                        <span className="material-icons">close</span>
                      </button>
                    </div>

                    <div className="space-y-4">
                      {showMediaTypeSelection && (
                        <div>
                          <h4 className="font-medium mb-1">Media Type Selection</h4>
                          <p className="text-sm text-gray-600">
                            Choose which media types (
                            {enabledMediaTypes.map((type) => (type === "youtube" ? "video" : type)).join(", ")}) to
                            include for your query.
                          </p>
                        </div>
                      )}

                      {showAuthorSelection && (
                        <div>
                          <h4 className="font-medium mb-1">Collection Selection</h4>
                          <p className="text-sm text-gray-600">
                            Select specific collections or authors to focus your search.
                          </p>
                        </div>
                      )}

                      {siteConfig?.showSourceCountSelector && (
                        <div>
                          <h4 className="font-medium mb-1">Use Extra Sources</h4>
                          <p className="text-sm text-gray-600">
                            Enable to use more sources (10 instead of 4) for potentially more comprehensive responses.
                            Relevant text passages are retrieved based on similarity to your query and used as context
                            for generating answers.
                          </p>
                        </div>
                      )}

                      {siteConfig?.allowPrivateSessions && (
                        <div>
                          <h4 className="font-medium mb-1">Private Session</h4>
                          <p className="text-sm text-gray-600">
                            Enable private mode to keep your queries confidential and unlisted.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Error display */}
          {error &&
            (isIndexError ? (
              <FirestoreIndexError error={errorMessage} isBuilding={isBuilding} className="mb-4" />
            ) : (
              <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4">
                <strong className="font-bold">An error occurred: </strong>
                <span className="block sm:inline">{error}</span>
              </div>
            ))}
        </form>

        {/* Suggested queries section */}
        {!isLoadingQueries && showSuggestedQueries && randomQueries.length > 0 && (
          <div className="w-full mb-4">
            {suggestionsExpanded && (
              <>
                <RandomQueries
                  queries={randomQueries}
                  onQueryClick={onQueryClick}
                  isLoading={loading}
                  shuffleQueries={shuffleQueries}
                  isMobile={isMobile}
                />
              </>
            )}
            <button type="button" onClick={toggleSuggestions} className="text-blue-500 hover:underline mb-2">
              {suggestionsExpanded ? "Hide suggestions" : "Show suggestions"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
