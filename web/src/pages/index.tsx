// It includes features like real-time chat, collection selection, private sessions,
// and media type filtering. The component manages chat state, handles user input,
// and communicates with a backend API for chat responses.

// Special features:
// - GETHUMAN links: For the 'ananda-public' site ID, links in the format [text](GETHUMAN)
//   are automatically converted to links to the Ananda contact page (https://www.ananda.org/contact-us/)

// React and Next.js imports
import React, { useRef, useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/router";

// Component imports
import Layout from "@/components/layout";
import Popup from "@/components/popup";
import LikePrompt from "@/components/LikePrompt";
import { ChatInput } from "@/components/ChatInput";
import MessageItem from "@/components/MessageItem";
import FeedbackModal from "@/components/FeedbackModal";
import ChatHistorySidebar from "@/components/ChatHistorySidebar";

// Hook imports
import usePopup from "@/hooks/usePopup";
import { useRandomQueries } from "@/hooks/useRandomQueries";
import { useChat } from "@/hooks/useChat";
import { useMultipleCollections } from "@/hooks/useMultipleCollections";

// Utility imports
import { logEvent } from "@/utils/client/analytics";
import { getCollectionQueries } from "@/utils/client/collectionQueries";
import { handleVote as handleVoteUtil } from "@/utils/client/voteHandler";
import { SiteConfig } from "@/types/siteConfig";
import {
  getCollectionsConfig,
  getEnableMediaTypeSelection,
  getEnableAuthorSelection,
  getEnabledMediaTypes,
} from "@/utils/client/siteConfig";
import { Document } from "langchain/document";

// Third-party library imports
import Cookies from "js-cookie";
import { toast } from "react-toastify";

import { ExtendedAIMessage } from "@/types/ExtendedAIMessage";
import { StreamingResponseData } from "@/types/StreamingResponseData";
import { RelatedQuestion } from "@/types/RelatedQuestion";
import { SudoProvider, useSudo } from "@/contexts/SudoContext";
import { fetchWithAuth } from "@/utils/client/tokenManager";
import { getOrCreateUUID } from "@/utils/client/uuid";
import { loadConversationByConvId } from "@/utils/client/conversationLoader";
import { getGreeting } from "@/utils/client/siteConfig";
import { SidebarFunctions, SidebarRefetch } from "@/components/ChatHistorySidebar";

// Main component for the chat interface
export default function Home({ siteConfig }: { siteConfig: SiteConfig | null }) {
  const router = useRouter();

  // State variables for various features and UI elements
  const [isMaintenanceMode] = useState<boolean>(false);
  const [viewOnlyMode, setViewOnlyMode] = useState<boolean>(false);
  const [collection, setCollection] = useState(() => {
    const collections = getCollectionsConfig(siteConfig);
    return Object.keys(collections)[0] || "";
  });
  const [collectionChanged, setCollectionChanged] = useState<boolean>(false);
  const [query, setQuery] = useState<string>("");
  const [likeStatuses, setLikeStatuses] = useState<Record<string, boolean>>({});
  const [temporarySession, setTemporarySession] = useState<boolean>(false);
  const [mediaTypes, setMediaTypes] = useState<{
    text: boolean;
    audio: boolean;
    youtube: boolean;
  }>({ text: true, audio: true, youtube: true });

  // Chat state management using custom hook
  const {
    messageState,
    setMessageState,
    loading,
    setLoading,
    error: chatError,
    setError,
  } = useChat(collection, temporarySession, mediaTypes, siteConfig);
  const { messages } = messageState as {
    messages: ExtendedAIMessage[];
  };

  // Track current conversation ID for follow-up messages
  const [currentConvId, setCurrentConvId] = useState<string | null>(null);
  const currentConvIdRef = useRef<string | null>(null);

  // Keep ref in sync with state
  useEffect(() => {
    currentConvIdRef.current = currentConvId;
  }, [currentConvId]);

  // Local ref to track latest path since we sometimes manipulate history without
  // involving Next.js router (pushState). This prevents stale router.asPath
  // values from confusing handleUrlBasedLoading.
  const pathRef = useRef<string>(typeof window !== "undefined" ? window.location.pathname : "/");

  // Track previous path to detect actual navigations to root ("/")
  const previousPathRef = useRef<string>(pathRef.current);

  // Track the current question being processed (for adding to sidebar)
  // We keep both a state variable (for potential future UI use) and a ref so we
  // always have synchronous access to the latest question text when the convId
  // arrives earlier than React state updates.
  const [, _setCurrentQuestion] = useState<string>("");
  const currentQuestionRef = useRef<string>("");

  // Helper to update both ref + state
  const setCurrentQuestion = (q: string) => {
    currentQuestionRef.current = q;
    _setCurrentQuestion(q);
  };

  // References to sidebar functions for adding/updating conversations
  const sidebarFunctionsRef = useRef<SidebarFunctions | null>(null);
  const sidebarRefetchRef = useRef<SidebarRefetch>(() => {});

  const handleSidebarFunctions = useCallback((functions: SidebarFunctions, refetch: SidebarRefetch) => {
    sidebarFunctionsRef.current = functions;
    sidebarRefetchRef.current = refetch;
  }, []);

  // (Removed pushedConvIdRef – no longer needed now that we update URL via
  // window.history.replaceState without triggering navigation.)

  // UI state variables
  const [showLikePrompt] = useState<boolean>(false);
  const [linkCopied, setLinkCopied] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(false);

  // Refs for DOM elements and scroll management
  const lastMessageRef = useRef<HTMLDivElement>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const bottomOfListRef = useRef<HTMLDivElement>(null);
  const scrollButtonContainerRef = useRef<HTMLDivElement>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [showScrollDownButton, setShowScrollDownButton] = useState(false);
  const [scrollClickState, setScrollClickState] = useState(0); // 0: initial, 1: scrolled to content

  // Function to handle media type selection
  const handleMediaTypeChange = (type: "text" | "audio" | "youtube") => {
    if (getEnableMediaTypeSelection(siteConfig)) {
      const enabledTypes = getEnabledMediaTypes(siteConfig);
      if (enabledTypes.includes(type)) {
        setMediaTypes((prev) => {
          const newValue = !prev[type];
          logEvent(`select_media_type_${type}`, "Engagement", newValue ? "on" : "off");
          return { ...prev, [type]: newValue };
        });
      }
    }
  };

  // Helper function to load conversation content without URL updates
  const loadConversationDirectly = useCallback(
    async (convId: string) => {
      try {
        setLoading(true);
        setError(null);

        const loadedConversation = await loadConversationByConvId(convId);

        // Update the message state with the loaded conversation
        setMessageState({
          messages: [
            {
              message: getGreeting(siteConfig),
              type: "apiMessage",
            },
            ...loadedConversation.messages,
          ],
          history: loadedConversation.history,
        });

        // Set the current conversation ID for follow-up messages
        setCurrentConvId(convId);

        // Log analytics event
        logEvent("chat_history_conversation_loaded", "Chat History", convId, loadedConversation.messages.length);
      } catch (error) {
        console.error("Error loading conversation:", error);

        // Set the conversation ID even on error to prevent infinite retry loops
        setCurrentConvId(convId);

        // Check if this is a Firestore index error and provide appropriate message
        const errorMessage = error instanceof Error ? error.message : "Failed to load conversation";

        if (errorMessage.includes("query requires an index") || errorMessage.includes("index is currently building")) {
          setError(
            "Database index required for conversation loading. The system administrator has been notified. Please try again later or contact support if this persists."
          );
        } else {
          setError(errorMessage);
        }
      } finally {
        setLoading(false);
      }
    },
    [siteConfig, setLoading, setError, setMessageState, setCurrentConvId]
  );

  // Function to load a conversation from chat history
  const handleLoadConversation = async (convId: string) => {
    // Load the conversation content
    await loadConversationDirectly(convId);

    // Update URL without triggering a full Next.js navigation to prevent flash.
    window.history.pushState(null, "", `/chat/${convId}`);
    pathRef.current = `/chat/${convId}`;

    // Close sidebar after loading
    setSidebarOpen(false);
  };

  // Function to handle URL-based conversation loading
  const handleUrlBasedLoading = useCallback(async () => {
    const path = pathRef.current;

    // Don't interfere with ongoing streaming/loading operations
    if (loading) {
      return;
    }

    // Handle root path (/) – reset only when navigating FROM another path
    if (path === "/") {
      if (previousPathRef.current !== "/" && !loading && messageState.messages.length <= 1) {
        currentConvIdRef.current = null;
        setCurrentConvId(null);
        setCurrentQuestion("");
        setMessageState({
          messages: [
            {
              message: getGreeting(siteConfig),
              type: "apiMessage",
            },
          ],
          history: [],
        });
        setError(null);
        setViewOnlyMode(false);
        // Reload sidebar to clear any stale state
        sidebarRefetchRef.current();
      }
      return;
    }

    // Handle /chat/[convId] URLs
    if (path.startsWith("/chat/")) {
      const convId = path.split("/chat/")[1];
      // Prevent infinite loop by checking if we've already loaded this conversation OR if there's an existing error
      // If there's already an error for this conversation, don't retry to prevent infinite reload loops
      if (convId && convId !== currentConvIdRef.current && !chatError) {
        // Load conversation without updating URL (since URL is already correct)
        await loadConversationDirectly(convId);
      }
      return;
    }
  }, [
    pathRef.current,
    currentConvId,
    loading,
    chatError,
    siteConfig,
    loadConversationDirectly,
    setCurrentConvId,
    setMessageState,
    setError,
    setViewOnlyMode,
    messageState.messages.length,
  ]);

  // URL detection effect
  useEffect(() => {
    if (router.isReady) {
      handleUrlBasedLoading();
    }
  }, [router.isReady, handleUrlBasedLoading]);

  // Update previous path after each path change
  useEffect(() => {
    previousPathRef.current = pathRef.current;
  }, [pathRef.current]);

  // Handle browser back/forward navigation
  useEffect(() => {
    const handlePopState = () => {
      const currentPath = window.location.pathname;
      pathRef.current = currentPath; // keep ref in sync

      if (currentPath === "/") {
        // Stop any ongoing streaming before resetting
        if (loading) {
          handleStop();
        }

        // Back to home: reset chat
        setMessageState({
          messages: [
            {
              message: getGreeting(siteConfig),
              type: "apiMessage",
            },
          ],
          history: [],
        });
        setCurrentConvId(null);
        setViewOnlyMode(false);
        setQuery("");
        setError(null);
        setLoading(false);
        logEvent("navigation_back_to_home", "Navigation", "fresh_chat_reset");
      } else if (currentPath.startsWith("/chat/")) {
        // Navigate to a specific conversation via browser history
        handleUrlBasedLoading();
      }
    };

    // Listen for browser back/forward button
    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [siteConfig, setMessageState, setError, setLoading, handleUrlBasedLoading]);

  // Custom hook for displaying popup messages
  const { showPopup, closePopup, popupMessage } = usePopup(
    "1.02",
    siteConfig?.allowTemporarySessions
      ? "Others can see questions you ask and answers given. " +
          "Please click 'Start Temporary Session' below the text entry box if you would prefer we not log or publish your session."
      : ""
  );

  // Function to handle collection change
  const handleCollectionChange = (newCollection: string) => {
    if (getEnableAuthorSelection(siteConfig) && newCollection !== collection) {
      setCollectionChanged(true);
      setCollection(newCollection);
      Cookies.set("selectedCollection", newCollection, { expires: 365 });
      logEvent("change_collection", "UI", newCollection);
    }
  };

  // Function to start a new chat conversation
  const handleNewChat = () => {
    // Stop any ongoing streaming before resetting
    if (loading) {
      handleStop();
    }

    // Push a new history entry for '/' without triggering a Next.js navigation.
    window.history.pushState(null, "", "/");
    pathRef.current = "/";
    // Immediately reset local chat state so UI clears without waiting for
    // handleUrlBasedLoading. This guarantees the New-Chat button and the
    // "Ask" nav item always start from a blank conversation.
    setCurrentConvId(null);
    setCurrentQuestion("");
    setMessageState({
      messages: [
        {
          message: getGreeting(siteConfig),
          type: "apiMessage",
        },
      ],
      history: [],
    });
    setError(null);
    setViewOnlyMode(false);

    // Focus on the input field if not on mobile
    if (window.innerWidth >= 768 && textAreaRef.current) {
      textAreaRef.current.focus();
    }

    // Log analytics event
    logEvent("new_chat_started", "Chat", "header_button");
  };

  // State for managing collection queries
  const [collectionQueries, setCollectionQueries] = useState({});
  const [isLoadingQueries, setIsLoadingQueries] = useState(true);

  // State for managing API request cancellation
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  // Function to stop ongoing API request
  const handleStop = useCallback(() => {
    if (abortController) {
      abortController.abort();
      setLoading(false);
      setAbortController(null);
    }
  }, [abortController, setLoading, setAbortController]);

  const [, setSourceDocs] = useState<Document[] | null>(null);
  const [, setLastRelatedQuestionsUpdate] = useState<string | null>(null);

  const [, setMessageContainerBottom] = useState(0);
  const [, setViewportHeight] = useState(0);

  // Add a state variable to track the docId separately
  const [savedDocId, setSavedDocId] = useState<string | null>(null);
  const accumulatedResponseRef = useRef("");

  const fetchRelatedQuestions = useCallback(async (docId: string) => {
    try {
      const response = await fetchWithAuth("/api/relatedQuestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docId }),
      });

      if (!response.ok) {
        throw new Error("Failed to fetch related questions");
      }

      const data = await response.json();
      return data.relatedQuestions as RelatedQuestion[];
    } catch (error) {
      console.error("Error fetching related questions:", error);
      return null;
    }
  }, []);

  const [sourceCount, setSourceCount] = useState<number>(siteConfig?.defaultNumSources || 4);

  // Add state for timing information
  const [timingMetrics, setTimingMetrics] = useState<{
    ttfb?: number;
    total?: number;
    tokensPerSecond?: number;
    totalTokens?: number;
  } | null>(null);

  // Check if user is sudo (only relevant on no-login sites)
  const { isSudoUser } = useSudo();

  const updateMessageState = useCallback(
    (newResponse: string, newSourceDocs: Document[] | null) => {
      setMessageState((prevState) => {
        const updatedMessages = [...prevState.messages];
        const lastMessage = updatedMessages[updatedMessages.length - 1];

        if (lastMessage.type === "apiMessage") {
          // Preserve the docId if it exists when updating the message
          const existingDocId = lastMessage.docId;
          updatedMessages[updatedMessages.length - 1] = {
            ...lastMessage,
            message: newResponse,
            sourceDocs: newSourceDocs ? [...newSourceDocs] : lastMessage.sourceDocs || [],
            // Keep the docId if it was already set
            ...(existingDocId && { docId: existingDocId }),
          };
        } else {
          console.warn("Expected last message to be apiMessage but found:", lastMessage.type);
        }

        // Update the last assistant message in the history
        const updatedHistory = [...prevState.history];
        if (updatedHistory.length > 0) {
          // Last item should be an assistant message (role === 'assistant')
          const lastIndex = updatedHistory.length - 1;
          if (updatedHistory[lastIndex].role === "assistant") {
            updatedHistory[lastIndex] = {
              role: "assistant",
              content: newResponse,
            };
          }
        }

        return {
          ...prevState,
          messages: updatedMessages,
          history: updatedHistory,
        };
      });

      // Force a check for viewport overflow
      setTimeout(() => {
        const messageList = messageListRef.current;
        if (!messageList) return;

        // Get container position relative to viewport
        const containerRect = messageList.getBoundingClientRect();

        // Get current viewport height
        const vh = window.innerHeight;
        setViewportHeight(vh);

        // Store the bottom position of the message container
        setMessageContainerBottom(containerRect.bottom);

        // Determine if the message container overflows the viewport
        const overflowsViewport = containerRect.bottom > vh;

        // Show button when the bottom of the container extends beyond viewport
        if (overflowsViewport) {
          // Check if we are already effectively at the bottom of the scrollable content
          // Only show if NOT near the bottom unless the user clicked once already (state 1)
          const { scrollTop, scrollHeight, clientHeight } = messageList;
          const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
          const isNearContentBottom = scrollHeight > clientHeight && distanceFromBottom <= 20;

          if (!isNearContentBottom || scrollClickState === 1) {
            setShowScrollDownButton(true);
          } else {
            // Content overflows, but we are scrolled to the bottom of it,
            // and haven't clicked the button yet (state 0). Hide it for now.
            // Clicking will make it reappear via handleScrollDownClick.
            // Scrolling up will make it reappear via handleScroll.
            setShowScrollDownButton(false);
          }
        } else {
          // Hide button if content doesn't overflow viewport
          setShowScrollDownButton(false);
          setScrollClickState(0); // Reset click state if content fits
        }
      }, 50);
    },
    [setMessageState, loading]
  );

  const handleStreamingResponse = useCallback(
    (data: StreamingResponseData) => {
      if (data.siteId && siteConfig?.siteId && data.siteId !== siteConfig.siteId) {
        console.error(`ERROR: Backend is using incorrect site ID: ${data.siteId}. Expected: ${siteConfig.siteId}`);
      }

      if (data.log) {
        // eslint-disable-next-line no-console
        console.log("[BACKEND]", data.log);
      }

      // Capture timing information
      if (data.timing) {
        setTimingMetrics(data.timing);
      }

      if (data.token) {
        accumulatedResponseRef.current += data.token;
        updateMessageState(accumulatedResponseRef.current, null);

        // Any new content should reset the scroll state
        // This ensures clicking the button after new content arrives
        // will always scroll to content bottom first
        setScrollClickState(0);

        // Force scroll button to show when streaming content
        if (!showScrollDownButton) {
          setShowScrollDownButton(true);
        }
      }

      if (data.sourceDocs) {
        try {
          // DEBUG: Add extensive logging for sources debugging
          const receiveTimestamp = Date.now();
          console.log(
            `🔍 FRONTEND SOURCES DEBUG: Received sourceDocs at ${receiveTimestamp}, type:`,
            typeof data.sourceDocs,
            "isArray:",
            Array.isArray(data.sourceDocs)
          );

          setTimeout(() => {
            const processTimestamp = Date.now();
            const timeDiff = processTimestamp - receiveTimestamp;
            console.log(`🔍 FRONTEND SOURCES DEBUG: Processing sourceDocs after ${timeDiff}ms delay`);

            const immutableSourceDocs = Array.isArray(data.sourceDocs) ? [...data.sourceDocs] : [];

            console.log(`🔍 FRONTEND SOURCES DEBUG: Processed ${immutableSourceDocs.length} sources`);

            if (immutableSourceDocs.length < sourceCount) {
              console.error(
                `❌ FRONTEND SOURCES ERROR: Received ${immutableSourceDocs.length} sources, but ${sourceCount} were requested.`
              );
            }

            // DEBUG: Check if sources are properly structured
            if (immutableSourceDocs.length > 0) {
              const firstSource = immutableSourceDocs[0];
              console.log(`🔍 FRONTEND SOURCES DEBUG: First source structure:`, {
                hasPageContent: !!firstSource.pageContent,
                hasMetadata: !!firstSource.metadata,
                metadataKeys: firstSource.metadata ? Object.keys(firstSource.metadata) : "none",
              });
            }

            setSourceDocs(immutableSourceDocs);
            updateMessageState(accumulatedResponseRef.current, immutableSourceDocs);

            console.log(
              `✅ FRONTEND SOURCES DEBUG: Successfully updated state with ${immutableSourceDocs.length} sources`
            );
          }, 0);
        } catch (error) {
          console.error("❌ FRONTEND SOURCES ERROR: Error handling sourceDocs:", error);
          console.error("❌ FRONTEND SOURCES ERROR: Raw data.sourceDocs:", data.sourceDocs);
          // Fallback to empty array if parsing fails
          setSourceDocs([]);
          updateMessageState(accumulatedResponseRef.current, []);
        }
      }

      if (data.docId) {
        // Save the docId with the message immediately (buttons won't show until loading=false)
        setMessageState((prevState) => {
          const updatedMessages = [...prevState.messages];
          // Make sure we're getting the API message (it should be the last one)
          const lastMessage = updatedMessages[updatedMessages.length - 1];

          if (lastMessage.type === "apiMessage") {
            // Update the API message with the docId
            updatedMessages[updatedMessages.length - 1] = {
              ...lastMessage,
              docId: data.docId,
            };
          } else if (prevState.messages.length >= 2) {
            // If the last message isn't an API message, find the most recent API message
            for (let i = updatedMessages.length - 1; i >= 0; i--) {
              if (updatedMessages[i].type === "apiMessage") {
                updatedMessages[i] = {
                  ...updatedMessages[i],
                  docId: data.docId,
                };
                break;
              }
            }
          } else {
            console.warn(`No API message found to attach docId to`);
          }

          return {
            ...prevState,
            messages: updatedMessages,
          };
        });

        // Save the docId in a separate state variable for later reference
        // This ensures we have it even if the message object wasn't ready when it arrived
        setSavedDocId(data.docId);
      }

      // Handle convId separately from docId (convId comes earlier in the stream)
      if (data.convId) {
        const isNewConversation = !currentConvIdRef.current;
        currentConvIdRef.current = data.convId;
        setCurrentConvId(data.convId);

        // For new conversations, update URL and sidebar
        if (isNewConversation) {
          // Use pushState so the browser back button will return to '/'.
          window.history.pushState(null, "", `/chat/${data.convId}`);
          pathRef.current = `/chat/${data.convId}`;

          // Add new conversation to sidebar (only for first question in conversation)
          // Only attempt if sidebar is enabled (requireLogin sites) and functions are available

          let questionForSidebar = currentQuestionRef.current;
          // Fallback: if for some reason currentQuestionRef is empty (e.g. Fast Refresh in dev)
          if (!questionForSidebar) {
            const lastUserMsg = [...messages].reverse().find((m) => m.type === "userMessage") as
              | ExtendedAIMessage
              | undefined;
            if (lastUserMsg?.message) {
              questionForSidebar = lastUserMsg.message;
            }
          }

          if (siteConfig?.requireLogin && sidebarFunctionsRef.current && questionForSidebar) {
            // Create a temporary title from the question
            const questionWords = questionForSidebar.trim().split(/\s+/);
            const tempTitle =
              questionWords.length <= 5 ? questionForSidebar : questionWords.slice(0, 4).join(" ") + "...";

            sidebarFunctionsRef.current.addNewConversation(data.convId, tempTitle, questionForSidebar);

            // Clear the current question now that we've used it
            setCurrentQuestion("");
          }
        }
        // Note: For follow-up questions, URL stays the same since convId is consistent
      }

      // Handle AI-generated title updates
      if (data.title && data.convId && sidebarFunctionsRef.current) {
        sidebarFunctionsRef.current.updateConversationTitle(data.convId, data.title);
      }

      if (data.done) {
        // Check for docId one more time right when done is received.
        // Immediately set loading to false so the buttons appear right away
        setLoading(false);

        // Reset accumulated response when done
        accumulatedResponseRef.current = "";

        // SOURCES DEBUGGING: Check if sources are missing after streaming completes
        setTimeout(() => {
          // Check the current state of sources for the last message
          setMessageState((prevState) => {
            const lastMessage = prevState.messages[prevState.messages.length - 1];

            if (lastMessage && lastMessage.type === "apiMessage") {
              const hasSourceDocs = lastMessage.sourceDocs && lastMessage.sourceDocs.length > 0;
              const expectedSourceCount = sourceCount;

              if (!hasSourceDocs) {
                console.error(`🚨 FRONTEND SOURCES BUG DETECTED: No sources found after streaming completed!`);
                console.error(`🚨 Expected ${expectedSourceCount} sources but found 0`);
                console.error(`🚨 Message docId: ${lastMessage.docId || "none"}`);

                // Send signal to backend about missing sources
                if (lastMessage.docId) {
                  reportMissingSourcesToBacked(lastMessage.docId, expectedSourceCount);
                }
              } else if (lastMessage.sourceDocs && lastMessage.sourceDocs.length < expectedSourceCount) {
                console.warn(`⚠️ FRONTEND SOURCES WARNING: Fewer sources than expected after streaming completed`);
                console.warn(`⚠️ Expected ${expectedSourceCount} sources but found ${lastMessage.sourceDocs.length}`);
                console.warn(`⚠️ Message docId: ${lastMessage.docId || "none"}`);

                // Send signal to backend about partial sources
                if (lastMessage.docId) {
                  reportPartialSourcesToBacked(lastMessage.docId, expectedSourceCount, lastMessage.sourceDocs.length);
                }
              } else if (lastMessage.sourceDocs) {
                console.log(
                  `✅ FRONTEND SOURCES VALIDATION: Found ${lastMessage.sourceDocs.length} sources as expected`
                );
              }
            }

            return prevState; // No state change, just validation
          });
        }, 200); // Small delay to ensure all SSE messages have been processed

        // Force a state update to ensure UI re-renders immediately with buttons and correct docId
        setMessageState((prevState) => {
          // Check all messages to find the API message we need to update
          let apiMessageIndex = prevState.messages.length - 1;
          let apiMessage = prevState.messages[apiMessageIndex];

          // If the last message isn't an API message, look for the most recent one
          if (apiMessage.type !== "apiMessage" && prevState.messages.length >= 2) {
            for (let i = prevState.messages.length - 1; i >= 0; i--) {
              if (prevState.messages[i].type === "apiMessage") {
                apiMessageIndex = i;
                apiMessage = prevState.messages[i];
                break;
              }
            }
          }

          // If we have a saved docId but the API message doesn't have one, update it
          if (apiMessage.type === "apiMessage" && !apiMessage.docId && savedDocId) {
            // Create a new messages array with the updated API message
            const updatedMessages = [...prevState.messages];
            updatedMessages[apiMessageIndex] = {
              ...apiMessage,
              docId: savedDocId,
            };

            return {
              ...prevState,
              messages: updatedMessages,
            };
          }

          return { ...prevState };
        });

        // Start fetching related questions in the background
        if (savedDocId) {
          fetchRelatedQuestions(savedDocId).then((relatedQuestions) => {
            const completionTimestamp = new Date().toISOString().substr(11, 12);
            console.log(`[${completionTimestamp}] Completed fetching related questions for docId: ${savedDocId}`);
            if (relatedQuestions) {
              setMessageState((prevState) => ({
                ...prevState,
                messages: prevState.messages.map((msg) =>
                  msg.docId === savedDocId ? { ...msg, relatedQuestions } : msg
                ),
              }));
              setLastRelatedQuestionsUpdate(savedDocId ?? null);
            }
          });
        }
      }

      if (data.error) {
        console.error(`Stream ERROR:`, data.error);
        setError(data.error);
      }
    },
    [
      updateMessageState,
      sourceCount,
      setLoading,
      setError,
      fetchRelatedQuestions,
      setSavedDocId,
      setMessageState,
      setSourceDocs,
      setScrollClickState,
      setShowScrollDownButton,
      setTimingMetrics,
      setLastRelatedQuestionsUpdate,
      siteConfig?.siteId,
    ]
  );

  // Helper function to report missing sources to backend
  const reportMissingSourcesToBacked = useCallback(async (docId: string, expectedCount: number) => {
    try {
      console.log(`📡 FRONTEND SOURCES DEBUG: Reporting missing sources to backend for docId: ${docId}`);

      const response = await fetchWithAuth("/api/debug/missing-sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          docId,
          expectedCount,
          actualCount: 0,
          timestamp: new Date().toISOString(),
          userAgent: navigator.userAgent,
          type: "missing_sources",
        }),
      });

      if (!response.ok) {
        console.warn(`Failed to report missing sources: ${response.status}`);
      } else {
        console.log(`✅ FRONTEND SOURCES DEBUG: Successfully reported missing sources to backend`);
      }
    } catch (error) {
      console.error("Error reporting missing sources to backend:", error);
    }
  }, []);

  // Helper function to report partial sources to backend
  const reportPartialSourcesToBacked = useCallback(
    async (docId: string, expectedCount: number, actualCount: number) => {
      try {
        console.log(`📡 FRONTEND SOURCES DEBUG: Reporting partial sources to backend for docId: ${docId}`);

        const response = await fetchWithAuth("/api/debug/missing-sources", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            docId,
            expectedCount,
            actualCount,
            timestamp: new Date().toISOString(),
            userAgent: navigator.userAgent,
            type: "partial_sources",
          }),
        });

        if (!response.ok) {
          console.warn(`Failed to report partial sources: ${response.status}`);
        } else {
          console.log(`✅ FRONTEND SOURCES DEBUG: Successfully reported partial sources to backend`);
        }
      } catch (error) {
        console.error("Error reporting partial sources to backend:", error);
      }
    },
    []
  );

  // Main function to handle chat submission
  const handleSubmit = async (e: React.FormEvent, submittedQuery: string) => {
    e.preventDefault();
    if (submittedQuery.trim() === "") return;

    // Store the current question for sidebar updates
    setCurrentQuestion(submittedQuery);

    // Reset timing metrics when starting a new query
    setTimingMetrics(null);

    if (submittedQuery.length > 4000) {
      setError("Input must be 4000 characters or less");
      return;
    }

    if (loading) {
      handleStop();
      return;
    }

    setIsNearBottom(true);
    setLoading(true);
    setError(null);

    // Reset accumulated response at the start of each new query
    accumulatedResponseRef.current = "";

    // Add user message to the state
    setMessageState((prevState) => ({
      ...prevState,
      messages: [
        ...prevState.messages,
        { type: "userMessage", message: submittedQuery } as ExtendedAIMessage,
        // Add an empty API message immediately so it's ready for the docId
        {
          type: "apiMessage",
          message: "",
          sourceDocs: [],
        } as ExtendedAIMessage,
      ],
      history: [...prevState.history, { role: "user", content: submittedQuery }, { role: "assistant", content: "" }],
    }));

    // Clear the input
    setQuery("");

    // Focus on the input field if not on mobile
    if (window.innerWidth >= 768 && textAreaRef.current) {
      textAreaRef.current.focus();
    }

    try {
      const newAbortController = new AbortController();
      setAbortController(newAbortController);

      const response = await fetchWithAuth("/api/chat/v1", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question: submittedQuery,
          history: messageState.history,
          collection,
          temporarySession,
          mediaTypes,
          sourceCount: sourceCount,
          uuid: getOrCreateUUID(),
          convId: currentConvIdRef.current, // Pass current conversation ID for follow-ups
        }),
        signal: newAbortController.signal,
      });

      if (!response.ok) {
        setLoading(false);
        const errorData = await response.json();
        setError(errorData.error || response.statusText);
        return;
      }

      const data = response.body;
      if (!data) {
        setLoading(false);
        setError("No data returned from the server");
        return;
      }

      const reader = data.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const jsonData = JSON.parse(line.slice(5)) as StreamingResponseData;
              handleStreamingResponse(jsonData);
            } catch (parseError) {
              console.error("Error parsing JSON:", parseError);
            }
          }
        }
      }

      setLoading(false);
    } catch (error) {
      console.error("Error in handleSubmit:", error);
      setError(error instanceof Error ? error.message : "An error occurred while streaming the response.");
      setLoading(false);
    }
  };

  // Function to handle 'Enter' key press in the input field
  const handleEnter = (e: React.KeyboardEvent<HTMLTextAreaElement>, submittedQuery: string) => {
    if (e.key === "Enter" && !e.shiftKey) {
      if (!loading) {
        e.preventDefault();
        setIsNearBottom(true);
        handleSubmit(new Event("submit") as unknown as React.FormEvent, submittedQuery);

        // Focus on the input field if not on mobile
        if (window.innerWidth >= 768 && textAreaRef.current) {
          textAreaRef.current.focus();
        }
      }
    }
  };

  // Function to handle input change in the chat input field
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setQuery(e.target.value);
  };

  // Effect to fetch collection queries on component mount
  useEffect(() => {
    let isMounted = true;
    async function fetchQueries() {
      if (siteConfig) {
        setIsLoadingQueries(true);
        const queries = await getCollectionQueries(siteConfig.siteId, siteConfig.collectionConfig);
        if (isMounted) {
          setCollectionQueries(queries);
          setIsLoadingQueries(false);
        }
      }
    }
    fetchQueries();
    return () => {
      isMounted = false;
    };
  }, [siteConfig]);

  // Memoized queries for the current collection
  const queriesForCollection = useMemo(() => {
    if (!collectionQueries[collection as keyof typeof collectionQueries]) {
      // If the current collection is not found, use the first available collection
      const firstAvailableCollection = Object.keys(collectionQueries)[0];
      if (firstAvailableCollection) {
        return collectionQueries[firstAvailableCollection as keyof typeof collectionQueries];
      }
      return [];
    }

    const queries = collectionQueries[collection as keyof typeof collectionQueries];
    return queries;
  }, [collection, collectionQueries]);

  // Custom hook for managing random queries
  const { randomQueries, shuffleQueries } = useRandomQueries(queriesForCollection, 3);

  // Function to handle like count changes
  const handleLikeCountChange = (answerId: string, newLikeCount: number) => {
    // Update the like status in state
    const newLikeStatus = newLikeCount > 0;
    setLikeStatuses((prev) => ({
      ...prev,
      [answerId]: newLikeStatus,
    }));

    // Log the event
    logEvent("like_answer", "Engagement", answerId);
  };

  // Function to handle temporary session changes
  const handleTemporarySessionChange = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (temporarySession) {
      // If already in a temporary session, reload the page
      logEvent("end_temporary_session", "UI", "");
      window.location.reload();
    } else {
      // Start a temporary session
      setTemporarySession(true);
      logEvent("start_temporary_session", "UI", "");
    }
  };

  // State for managing voting functionality
  const [votes, setVotes] = useState<Record<string, number>>({});
  const [voteError, setVoteError] = useState<string | null>(null);

  // State for the feedback modal
  const [isFeedbackModalOpen, setIsFeedbackModalOpen] = useState<boolean>(false);
  const [currentFeedbackDocId, setCurrentFeedbackDocId] = useState<string | null>(null);
  const [feedbackSubmitError, setFeedbackSubmitError] = useState<string | null>(null);

  // Function to handle voting on answers - MODIFIED
  const handleVote = (docId: string, isUpvote: boolean) => {
    setVoteError(null); // Clear previous errors
    setFeedbackSubmitError(null); // Clear feedback error

    const currentVote = votes[docId] || 0; // Get current vote status

    if (isUpvote) {
      // Upvote logic remains the same: uses handleVoteUtil which handles toggling 1 <-> 0
      handleVoteUtil(docId, isUpvote, votes, setVotes, setVoteError);
    } else {
      // Downvote logic:
      if (currentVote === -1) {
        // If already downvoted, clicking again should clear the vote (set to 0)
        // Use handleVoteUtil, passing isUpvote=false correctly triggers the toggle logic 0 <-> -1
        handleVoteUtil(docId, isUpvote, votes, setVotes, setVoteError);
        logEvent("clear_downvote", "Engagement", docId);
      } else {
        // If not currently downvoted (-1), open the feedback modal
        setCurrentFeedbackDocId(docId);
        setIsFeedbackModalOpen(true);
      }
    }
  };

  // Function to submit feedback - NEW
  const submitFeedback = async (docId: string, reason: string, comment: string) => {
    setFeedbackSubmitError(null); // Clear previous errors before trying
    try {
      const response = await fetchWithAuth("/api/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docId, vote: -1, reason, comment }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Failed to submit feedback (${response.status})`);
      }

      // If successful:
      setVotes((prev) => ({ ...prev, [docId]: -1 })); // Update UI to show downvote
      setIsFeedbackModalOpen(false); // Close modal
      setCurrentFeedbackDocId(null);
      logEvent("submit_feedback", "Engagement", reason); // Log feedback event

      // Show a success toast
      toast.success("Feedback submitted. Thank you!");
    } catch (error) {
      console.error("Error submitting feedback:", error);
      const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
      setFeedbackSubmitError(errorMessage); // Show error in the modal
      // Keep the modal open for the user to see the error
    }
  };

  // Function to cancel feedback - NEW
  const cancelFeedback = () => {
    setIsFeedbackModalOpen(false);
    setCurrentFeedbackDocId(null);
    setFeedbackSubmitError(null); // Clear any errors shown in modal
    logEvent("cancel_feedback", "Engagement", "");
  };

  // Function to handle copying answer links
  const handleCopyLink = (answerId: string) => {
    const url = `${window.location.origin}/share/${answerId}`;
    navigator.clipboard.writeText(url).then(() => {
      setLinkCopied(answerId);
      setTimeout(() => setLinkCopied(null), 2000);
      logEvent("copy_link", "Engagement", `Answer ID: ${answerId}`);
    });
  };

  // Effect to set initial collection and focus input on component mount
  useEffect(() => {
    // Retrieve and set the collection from the cookie
    // TODO: This is a hack for jairam site test
    const savedCollection =
      Cookies.get("selectedCollection") || (process.env.SITE_ID === "jairam" ? "whole_library" : "master_swami");
    setCollection(savedCollection);

    if (!isLoadingQueries && window.innerWidth > 768) {
      textAreaRef.current?.focus();
    }
  }, [isLoadingQueries]);

  // Custom hook to check if multiple collections are available
  const hasMultipleCollections = useMultipleCollections(siteConfig || undefined);

  // Function to handle clicking on suggested queries
  const handleClick = (clickedQuery: string) => {
    setQuery(clickedQuery);
    setIsNearBottom(true);
    handleSubmit(new Event("submit") as unknown as React.FormEvent, clickedQuery);

    // Focus on the input field if not on mobile
    if (window.innerWidth >= 768 && textAreaRef.current) {
      textAreaRef.current.focus();
    }
  };

  // Function to format timing metrics for display
  const formatTimingMetrics = useCallback(() => {
    if (!timingMetrics) return null;

    const { ttfb, tokensPerSecond, totalTokens } = timingMetrics;

    if (ttfb === undefined || tokensPerSecond === undefined) return null;

    const ttfbSecs = (ttfb / 1000).toFixed(2);
    return `${ttfbSecs} secs to first character, then ${tokensPerSecond} chars/sec streamed (${totalTokens} total)`;
  }, [timingMetrics]);

  // Get whether related questions should be shown (defaults to true)
  const showRelatedQuestions = siteConfig?.showRelatedQuestions ?? true;

  // Function to handle scroll behavior and button visibility
  useEffect(() => {
    const messageList = messageListRef.current;
    if (!messageList) return;

    // Function to check scroll position and update button visibility
    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = messageList;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      const hasScrollbar = scrollHeight > clientHeight;

      // Check if we've scrolled up away from the bottom
      if (hasScrollbar && distanceFromBottom > 20) {
        // Only show if content is actually overflowing the viewport
        const containerRect = messageList.getBoundingClientRect();
        const vh = window.innerHeight;
        if (containerRect.bottom > vh) {
          setShowScrollDownButton(true);
        }
      }
      // REMOVED: Logic that unconditionally hid the button when near the bottom
    };

    // New: Window scroll handler to show button if user scrolls up from page bottom
    const handleWindowScroll = () => {
      const threshold = 20;
      const atPageBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - threshold;
      const messageList = messageListRef.current;
      if (!messageList) return;
      const containerRect = messageList.getBoundingClientRect();
      const vh = window.innerHeight;
      const overflowsViewport = containerRect.bottom > vh;
      if (overflowsViewport && !atPageBottom) {
        setShowScrollDownButton(true);
      } else if (atPageBottom && scrollClickState === 0) {
        setShowScrollDownButton(false);
      }
    };

    // Add scroll listeners
    messageList.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("scroll", handleWindowScroll, { passive: true });

    // Check initial scroll position
    handleScroll();
    handleWindowScroll();

    return () => {
      messageList.removeEventListener("scroll", handleScroll);
      window.removeEventListener("scroll", handleWindowScroll);
    };
  }, [loading, scrollClickState]);

  // Function to scroll to bottom when button clicked
  const handleScrollDownClick = () => {
    if (scrollClickState === 0) {
      // First click: Scroll to bottom of content but keep button visible
      bottomOfListRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "end",
      });
      setScrollClickState(1);
      // Explicitly ensure the button stays visible after the first click
      setShowScrollDownButton(true);

      // Focus on the input field if not on mobile
      if (window.innerWidth >= 768 && textAreaRef.current) {
        textAreaRef.current.focus();
      }
    } else {
      // Second click: Scroll to very bottom of page and hide button
      window.scrollTo({
        top: document.body.scrollHeight,
        behavior: "smooth",
      });
      setShowScrollDownButton(false);
      setScrollClickState(0);

      // Focus on the input field if not on mobile
      if (window.innerWidth >= 768 && textAreaRef.current) {
        textAreaRef.current.focus();
      }
    }
  };

  // Render maintenance mode message if active
  if (isMaintenanceMode) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <h1 className="text-2xl font-bold mb-4">Site is currently under maintenance</h1>
        <p>Please check back later.</p>
      </div>
    );
  }

  // Main component render
  return (
    <SudoProvider disableChecks={!!siteConfig && !!siteConfig.requireLogin}>
      <Layout siteConfig={siteConfig} useWideLayout={siteConfig?.requireLogin} onNewChat={handleNewChat}>
        {showPopup && popupMessage && <Popup message={popupMessage} onClose={closePopup} siteConfig={siteConfig} />}
        <LikePrompt show={showLikePrompt} siteConfig={siteConfig} />
        <div className="flex h-full">
          {/* Chat History Sidebar - Only show on sites that require login */}
          {siteConfig?.requireLogin && (
            <ChatHistorySidebar
              isOpen={sidebarOpen}
              onClose={() => {
                logEvent("chat_history_sidebar_close", "Chat History", "close_button");
                setSidebarOpen(false);
              }}
              onLoadConversation={handleLoadConversation}
              currentConvId={currentConvId}
              onGetSidebarFunctions={(functions) => {
                handleSidebarFunctions(functions, () => {
                  // This refetch function is called when the sidebar needs to be reloaded
                  // after a state change that might affect its data, e.g., clearing chat history
                  // or changing collections.
                  // For now, we'll just log the event, as the actual re-fetching logic
                  // would involve fetching chat history from the backend.
                  logEvent("chat_history_sidebar_refetch", "Chat History", "sidebar_refetch");
                });
              }}
            />
          )}

          {/* Main Content Area */}
          <div className="flex flex-col flex-1 min-w-0 lg:ml-0">
            <div className="mx-auto w-full max-w-4xl px-4">
              {/* Hamburger Menu Button - Only show on sites that require login */}
              {siteConfig?.requireLogin && (
                <div className="lg:hidden flex items-center justify-between p-4 border-b border-gray-200">
                  <button
                    onClick={() => {
                      logEvent("chat_history_sidebar_open", "Chat History", "hamburger_menu");
                      setSidebarOpen(true);
                    }}
                    className="p-2 rounded-md hover:bg-gray-100"
                    aria-label="Open chat history"
                  >
                    <span className="material-icons text-gray-600">menu</span>
                  </button>
                  <h1 className="text-lg font-semibold text-gray-900">Chat</h1>
                  <div className="w-10"></div> {/* Spacer for centering */}
                </div>
              )}
              {/* Temporary session banner */}
              {temporarySession && (
                <div className="flex items-center justify-center mb-3 px-3 py-2 bg-purple-100 border border-purple-300 rounded-lg">
                  <span className="material-icons text-purple-600 text-lg mr-2">lock</span>
                  <span className="text-purple-800 text-sm font-medium">
                    Temporary Session Active (
                    <button onClick={handleTemporarySessionChange} className="underline hover:text-purple-900">
                      end
                    </button>
                    )
                  </span>
                </div>
              )}
              <div className="flex-grow overflow-hidden answers-container">
                <div ref={messageListRef} className="h-full overflow-y-auto">
                  {/* Render chat messages */}
                  {messages.map((message, index) => (
                    <MessageItem
                      key={`chatMessage-${index}`}
                      messageKey={`chatMessage-${index}`}
                      message={message}
                      previousMessage={index > 0 ? messages[index - 1] : undefined}
                      index={index}
                      isLastMessage={index === messages.length - 1}
                      loading={loading}
                      temporarySession={temporarySession}
                      collectionChanged={collectionChanged}
                      hasMultipleCollections={hasMultipleCollections}
                      likeStatuses={likeStatuses}
                      linkCopied={linkCopied}
                      votes={votes}
                      siteConfig={siteConfig}
                      handleLikeCountChange={handleLikeCountChange}
                      handleCopyLink={handleCopyLink}
                      handleVote={handleVote}
                      lastMessageRef={lastMessageRef}
                      voteError={voteError}
                      allowAllAnswersPage={siteConfig?.allowAllAnswersPage ?? false}
                      showRelatedQuestions={showRelatedQuestions}
                    />
                  ))}
                  {/* Display timing metrics for sudo users */}
                  {isSudoUser && timingMetrics && !loading && messages.length > 0 && (
                    <div className="text-xs text-gray-500 p-2 bg-gray-50 rounded m-2">{formatTimingMetrics()}</div>
                  )}
                  <div ref={bottomOfListRef} style={{ height: "1px" }} />
                </div>

                {/* Container to anchor the scroll button at the right edge of the content */}
                <div ref={scrollButtonContainerRef} className="relative w-full">
                  {/* Animated Scroll Down Button */}
                  <div
                    className={`fixed z-50 right-5 bottom-5 transition-all duration-300 ease-out transform 
                  ${showScrollDownButton ? "translate-y-0 opacity-100 pointer-events-auto" : "translate-y-8 opacity-0 pointer-events-none"}`}
                    style={{ willChange: "transform, opacity" }}
                  >
                    <button
                      onClick={handleScrollDownClick}
                      aria-label="Scroll to bottom"
                      className="bg-white text-gray-600 rounded-full shadow-sm hover:shadow-md p-2 border border-gray-200 focus:outline-none"
                    >
                      <span className="material-icons text-xl">expand_more</span>
                    </button>
                  </div>
                </div>
              </div>
              <div className="mt-4 px-2 md:px-0">
                {/* Render chat input component */}
                {isLoadingQueries ? null : (
                  <ChatInput
                    loading={loading}
                    disabled={viewOnlyMode}
                    handleSubmit={handleSubmit}
                    handleEnter={handleEnter}
                    handleClick={handleClick}
                    handleCollectionChange={handleCollectionChange}
                    handleTemporarySessionChange={handleTemporarySessionChange}
                    collection={collection}
                    temporarySession={temporarySession}
                    error={chatError}
                    setError={setError}
                    randomQueries={randomQueries}
                    shuffleQueries={shuffleQueries}
                    textAreaRef={textAreaRef}
                    mediaTypes={mediaTypes}
                    handleMediaTypeChange={handleMediaTypeChange}
                    siteConfig={siteConfig}
                    input={query}
                    handleInputChange={handleInputChange}
                    setQuery={setQuery}
                    setShouldAutoScroll={setIsNearBottom}
                    handleStop={handleStop}
                    isNearBottom={isNearBottom}
                    setIsNearBottom={setIsNearBottom}
                    isLoadingQueries={isLoadingQueries}
                    sourceCount={sourceCount}
                    setSourceCount={setSourceCount}
                  />
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Render the Feedback Modal */}
        <FeedbackModal
          isOpen={isFeedbackModalOpen}
          docId={currentFeedbackDocId}
          onConfirm={submitFeedback}
          onCancel={cancelFeedback}
          error={feedbackSubmitError} // Pass feedback-specific error
        />

        {/* Display general like/vote errors (e.g., from upvoting) */}
        {voteError &&
          !isFeedbackModalOpen && ( // Don't show if feedback modal is open showing its own error
            <div className="fixed bottom-4 right-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded shadow-md z-50">
              <strong className="font-bold">Error: </strong>
              <span className="block sm:inline">{voteError}</span>
            </div>
          )}
      </Layout>
    </SudoProvider>
  );
}
