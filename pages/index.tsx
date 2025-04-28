// It includes features like real-time chat, collection selection, private sessions,
// and media type filtering. The component manages chat state, handles user input,
// and communicates with a backend API for chat responses.

// Special features:
// - GETHUMAN links: For the 'ananda-public' site ID, links in the format [text](GETHUMAN)
//   are automatically converted to links to the Ananda contact page (https://www.ananda.org/contact-us/)

// React and Next.js imports
import { useRef, useState, useEffect, useMemo, useCallback } from 'react';

// Component imports
import Layout from '@/components/layout';
import Popup from '@/components/popup';
import LikePrompt from '@/components/LikePrompt';
import { ChatInput } from '@/components/ChatInput';
import MessageItem from '@/components/MessageItem';
import FeedbackModal from '@/components/FeedbackModal';

// Hook imports
import usePopup from '@/hooks/usePopup';
import { useRandomQueries } from '@/hooks/useRandomQueries';
import { useChat } from '@/hooks/useChat';
import { useMultipleCollections } from '@/hooks/useMultipleCollections';

// Utility imports
import { logEvent } from '@/utils/client/analytics';
import { getCollectionQueries } from '@/utils/client/collectionQueries';
import { handleVote as handleVoteUtil } from '@/utils/client/voteHandler';
import { SiteConfig } from '@/types/siteConfig';
import {
  getCollectionsConfig,
  getEnableMediaTypeSelection,
  getEnableAuthorSelection,
  getEnabledMediaTypes,
} from '@/utils/client/siteConfig';
import { Document } from 'langchain/document';

// Third-party library imports
import Cookies from 'js-cookie';
import { toast } from 'react-toastify';

import { ExtendedAIMessage } from '@/types/ExtendedAIMessage';
import { StreamingResponseData } from '@/types/StreamingResponseData';
import { RelatedQuestion } from '@/types/RelatedQuestion';
import { SudoProvider, useSudo } from '@/contexts/SudoContext';
import { fetchWithAuth } from '@/utils/client/tokenManager';

// Main component for the chat interface
export default function Home({
  siteConfig,
}: {
  siteConfig: SiteConfig | null;
}) {
  // State variables for various features and UI elements
  const [isMaintenanceMode] = useState<boolean>(false);
  const [collection, setCollection] = useState(() => {
    const collections = getCollectionsConfig(siteConfig);
    return Object.keys(collections)[0] || '';
  });
  const [collectionChanged, setCollectionChanged] = useState<boolean>(false);
  const [query, setQuery] = useState<string>('');
  const [likeStatuses, setLikeStatuses] = useState<Record<string, boolean>>({});
  const [privateSession, setPrivateSession] = useState<boolean>(false);
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
  } = useChat(collection, privateSession, mediaTypes, siteConfig);
  const { messages } = messageState as {
    messages: ExtendedAIMessage[];
  };

  // UI state variables
  const [showLikePrompt] = useState<boolean>(false);
  const [linkCopied, setLinkCopied] = useState<string | null>(null);

  // Refs for DOM elements and scroll management
  const lastMessageRef = useRef<HTMLDivElement>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const bottomOfListRef = useRef<HTMLDivElement>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [isAutoScrolling, setIsAutoScrolling] = useState(false);
  const userHasScrolledUpRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Function to scroll to the bottom of the chat
  const scrollToBottom = useCallback(() => {
    if (
      bottomOfListRef.current &&
      isNearBottom &&
      !userHasScrolledUpRef.current
    ) {
      setIsAutoScrolling(true);
      bottomOfListRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'end',
      });
      // Reset isAutoScrolling after animation completes
      setTimeout(() => setIsAutoScrolling(false), 1000);
    }
  }, [isNearBottom]);

  // Effect for handling scroll behavior and user interactions
  useEffect(() => {
    const handleScroll = () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }

      if (isAutoScrolling) {
        setIsAutoScrolling(false);
      }

      const messageList = messageListRef.current;
      if (messageList) {
        const { scrollTop, scrollHeight, clientHeight } = messageList;

        // Detect if user has scrolled up
        if (scrollTop < lastScrollTopRef.current) {
          userHasScrolledUpRef.current = true;
        }

        // Update last scroll position
        lastScrollTopRef.current = scrollTop;

        // Check if near bottom
        const scrollPosition = scrollHeight - scrollTop - clientHeight;
        const newIsNearBottom = scrollPosition < scrollHeight * 0.1; // 10% from bottom
        setIsNearBottom(newIsNearBottom);

        // Reset userHasScrolledUp if we're at the very bottom
        if (scrollPosition === 0) {
          userHasScrolledUpRef.current = false;
        }
      }

      scrollTimeoutRef.current = setTimeout(() => {
        // This timeout is just to debounce rapid scroll events
      }, 100);
    };

    const messageList = messageListRef.current;
    if (messageList) {
      messageList.addEventListener('scroll', handleScroll);
    }

    return () => {
      if (messageList) {
        messageList.removeEventListener('scroll', handleScroll);
      }
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, [isAutoScrolling]);

  // Effect for auto-scrolling when new messages are added
  useEffect(() => {
    if (loading && isNearBottom && !userHasScrolledUpRef.current) {
      scrollToBottom();
    }
  }, [messages, loading, isNearBottom, scrollToBottom]);

  // Function to handle media type selection
  const handleMediaTypeChange = (type: 'text' | 'audio' | 'youtube') => {
    if (getEnableMediaTypeSelection(siteConfig)) {
      const enabledTypes = getEnabledMediaTypes(siteConfig);
      if (enabledTypes.includes(type)) {
        setMediaTypes((prev) => {
          const newValue = !prev[type];
          logEvent(
            `select_media_type_${type}`,
            'Engagement',
            newValue ? 'on' : 'off',
          );
          return { ...prev, [type]: newValue };
        });
      }
    }
  };

  // Custom hook for displaying popup messages
  const { showPopup, closePopup, popupMessage } = usePopup(
    '1.02',
    siteConfig?.allowPrivateSessions
      ? 'Others can see questions you ask and answers given. ' +
          "Please click 'Start Private Session' below the text entry box if you would prefer we not log or publish your session."
      : '',
  );

  // Function to handle collection change
  const handleCollectionChange = (newCollection: string) => {
    if (getEnableAuthorSelection(siteConfig) && newCollection !== collection) {
      setCollectionChanged(true);
      setCollection(newCollection);
      Cookies.set('selectedCollection', newCollection, { expires: 365 });
      logEvent('change_collection', 'UI', newCollection);
    }
  };

  // State for managing collection queries
  const [collectionQueries, setCollectionQueries] = useState({});
  const [isLoadingQueries, setIsLoadingQueries] = useState(true);

  // State for managing API request cancellation
  const [abortController, setAbortController] =
    useState<AbortController | null>(null);

  // Function to stop ongoing API request
  const handleStop = useCallback(() => {
    if (abortController) {
      abortController.abort();
      setLoading(false);
      setAbortController(null);
    }
  }, [abortController, setLoading, setAbortController]);

  const [, setSourceDocs] = useState<Document[] | null>(null);
  const [lastRelatedQuestionsUpdate, setLastRelatedQuestionsUpdate] = useState<
    string | null
  >(null);

  // Add a state variable to track the docId separately
  const [savedDocId, setSavedDocId] = useState<string | null>(null);
  const accumulatedResponseRef = useRef('');

  const fetchRelatedQuestions = useCallback(async (docId: string) => {
    try {
      const response = await fetchWithAuth('/api/relatedQuestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docId }),
      });

      if (!response.ok) {
        throw new Error('Failed to fetch related questions');
      }

      const data = await response.json();
      return data.relatedQuestions as RelatedQuestion[];
    } catch (error) {
      console.error('Error fetching related questions:', error);
      return null;
    }
  }, []);

  const [sourceCount, setSourceCount] = useState<number>(
    siteConfig?.defaultNumSources || 4,
  );

  // Add state for timing information
  const [timingMetrics, setTimingMetrics] = useState<{
    ttfb?: number;
    total?: number;
    tokensPerSecond?: number;
    totalTokens?: number;
  } | null>(null);

  // Check if user is sudo
  const { isSudoUser } = useSudo();

  const updateMessageState = useCallback(
    (newResponse: string, newSourceDocs: Document[] | null) => {
      setMessageState((prevState) => {
        const updatedMessages = [...prevState.messages];
        const lastMessage = updatedMessages[updatedMessages.length - 1];

        if (lastMessage.type === 'apiMessage') {
          // Preserve the docId if it exists when updating the message
          const existingDocId = lastMessage.docId;
          updatedMessages[updatedMessages.length - 1] = {
            ...lastMessage,
            message: newResponse,
            sourceDocs: newSourceDocs
              ? [...newSourceDocs]
              : lastMessage.sourceDocs || [],
            // Keep the docId if it was already set
            ...(existingDocId && { docId: existingDocId }),
          };
        } else {
          console.warn(
            'Expected last message to be apiMessage but found:',
            lastMessage.type,
          );
        }

        // Update the last assistant message in the history
        const updatedHistory = [...prevState.history];
        if (updatedHistory.length > 0) {
          // Last item should be an assistant message (role === 'assistant')
          const lastIndex = updatedHistory.length - 1;
          if (updatedHistory[lastIndex].role === 'assistant') {
            updatedHistory[lastIndex] = {
              role: 'assistant',
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

      scrollToBottom();
    },
    [setMessageState, scrollToBottom],
  );

  const handleStreamingResponse = useCallback(
    (data: StreamingResponseData) => {
      // Log every message that comes through with a timestamp
      const timestamp = new Date().toISOString().substr(11, 12); // HH:MM:SS.mmm format

      if (
        data.siteId &&
        siteConfig?.siteId &&
        data.siteId !== siteConfig.siteId
      ) {
        console.error(
          `ERROR: Backend is using incorrect site ID: ${data.siteId}. Expected: ${siteConfig.siteId}`,
        );
      }

      // Capture timing information
      if (data.timing) {
        console.log(`[${timestamp}] Timing info:`, data.timing);
        setTimingMetrics(data.timing);
      }

      if (data.token) {
        accumulatedResponseRef.current += data.token;
        updateMessageState(accumulatedResponseRef.current, null);
      }

      if (data.sourceDocs) {
        try {
          setTimeout(() => {
            const immutableSourceDocs = Array.isArray(data.sourceDocs)
              ? [...data.sourceDocs]
              : [];

            if (immutableSourceDocs.length < sourceCount) {
              console.error(
                `ERROR: Received ${immutableSourceDocs.length} sources, but ${sourceCount} were requested.`,
              );
            }

            setSourceDocs(immutableSourceDocs);
            updateMessageState(
              accumulatedResponseRef.current,
              immutableSourceDocs,
            );
          }, 100);
        } catch (error) {
          console.error('Error handling sourceDocs:', error);
          // Fallback to empty array if parsing fails
          setSourceDocs([]);
          updateMessageState(accumulatedResponseRef.current, []);
        }
      }

      if (data.done) {
        // Check for docId one more time right when done is received.
        // Immediately set loading to false so the buttons appear right away
        setLoading(false);

        // Reset accumulated response when done
        accumulatedResponseRef.current = '';

        // Force a state update to ensure UI re-renders immediately with buttons and correct docId
        setMessageState((prevState) => {
          // Check all messages to find the API message we need to update
          let apiMessageIndex = prevState.messages.length - 1;
          let apiMessage = prevState.messages[apiMessageIndex];

          // If the last message isn't an API message, look for the most recent one
          if (
            apiMessage.type !== 'apiMessage' &&
            prevState.messages.length >= 2
          ) {
            for (let i = prevState.messages.length - 1; i >= 0; i--) {
              if (prevState.messages[i].type === 'apiMessage') {
                apiMessageIndex = i;
                apiMessage = prevState.messages[i];
                break;
              }
            }
          }

          // If we have a saved docId but the API message doesn't have one, update it
          if (
            apiMessage.type === 'apiMessage' &&
            !apiMessage.docId &&
            savedDocId
          ) {
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
      }

      if (data.error) {
        console.error(`Stream ERROR:`, data.error);
        setError(data.error);
      }

      if (data.docId) {
        // Save the docId in a separate state variable for later reference
        // This ensures we have it even if the message object wasn't ready when it arrived
        setSavedDocId(data.docId);

        // Store the docId with the message immediately (buttons won't show until loading=false)
        setMessageState((prevState) => {
          const updatedMessages = [...prevState.messages];
          // Make sure we're getting the API message (it should be the last one)
          const lastMessage = updatedMessages[updatedMessages.length - 1];

          if (lastMessage.type === 'apiMessage') {
            // Update the API message with the docId
            updatedMessages[updatedMessages.length - 1] = {
              ...lastMessage,
              docId: data.docId,
            };
          } else if (prevState.messages.length >= 2) {
            // If the last message isn't an API message, find the most recent API message
            for (let i = updatedMessages.length - 1; i >= 0; i--) {
              if (updatedMessages[i].type === 'apiMessage') {
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

        // Start fetching related questions in the background

        fetchRelatedQuestions(data.docId).then((relatedQuestions) => {
          const completionTimestamp = new Date().toISOString().substr(11, 12);
          console.log(
            `[${completionTimestamp}] Completed fetching related questions for docId: ${data.docId}`,
          );
          if (relatedQuestions) {
            setMessageState((prevState) => ({
              ...prevState,
              messages: prevState.messages.map((msg) =>
                msg.docId === data.docId ? { ...msg, relatedQuestions } : msg,
              ),
            }));
            setLastRelatedQuestionsUpdate(data.docId ?? null);
          }
        });
      }
    },
    [
      updateMessageState,
      sourceCount,
      setLoading,
      setError,
      setMessageState,
      fetchRelatedQuestions,
      siteConfig?.siteId,
      savedDocId,
      setSavedDocId,
    ],
  );

  // Effect to scroll to bottom after related questions are added
  useEffect(() => {
    if (lastRelatedQuestionsUpdate) {
      scrollToBottom();
      setLastRelatedQuestionsUpdate(null);
    }
  }, [lastRelatedQuestionsUpdate, scrollToBottom]);

  // Main function to handle chat submission
  const handleSubmit = async (e: React.FormEvent, submittedQuery: string) => {
    e.preventDefault();
    if (submittedQuery.trim() === '') return;

    // Reset timing metrics when starting a new query
    setTimingMetrics(null);

    if (submittedQuery.length > 4000) {
      setError('Input must be 4000 characters or less');
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
    accumulatedResponseRef.current = '';

    // Add user message to the state
    setMessageState((prevState) => ({
      ...prevState,
      messages: [
        ...prevState.messages,
        { type: 'userMessage', message: submittedQuery } as ExtendedAIMessage,
        // Add an empty API message immediately so it's ready for the docId
        {
          type: 'apiMessage',
          message: '',
          sourceDocs: [],
        } as ExtendedAIMessage,
      ],
      history: [
        ...prevState.history,
        { role: 'user', content: submittedQuery },
        { role: 'assistant', content: '' },
      ],
    }));

    // Clear the input
    setQuery('');

    // Scroll to bottom after adding user message
    setTimeout(scrollToBottom, 0);

    try {
      const newAbortController = new AbortController();
      setAbortController(newAbortController);

      const response = await fetchWithAuth('/api/chat/v1', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          question: submittedQuery,
          history: messageState.history,
          collection,
          privateSession,
          mediaTypes,
          sourceCount: sourceCount,
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
        setError('No data returned from the server');
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
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const jsonData = JSON.parse(
                line.slice(5),
              ) as StreamingResponseData;
              handleStreamingResponse(jsonData);
            } catch (parseError) {
              console.error('Error parsing JSON:', parseError);
            }
          }
        }
      }

      setLoading(false);
    } catch (error) {
      console.error('Error in handleSubmit:', error);
      setError(
        error instanceof Error
          ? error.message
          : 'An error occurred while streaming the response.',
      );
      setLoading(false);
    }
  };

  // Function to handle 'Enter' key press in the input field
  const handleEnter = (
    e: React.KeyboardEvent<HTMLTextAreaElement>,
    submittedQuery: string,
  ) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      if (!loading) {
        e.preventDefault();
        setIsNearBottom(true);
        handleSubmit(
          new Event('submit') as unknown as React.FormEvent,
          submittedQuery,
        );
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
        const queries = await getCollectionQueries(
          siteConfig.siteId,
          siteConfig.collectionConfig,
        );
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
        return collectionQueries[
          firstAvailableCollection as keyof typeof collectionQueries
        ];
      }
      return [];
    }

    const queries =
      collectionQueries[collection as keyof typeof collectionQueries];
    return queries;
  }, [collection, collectionQueries]);

  // Custom hook for managing random queries
  const { randomQueries, shuffleQueries } = useRandomQueries(
    queriesForCollection,
    3,
  );

  // Function to handle like count changes
  const handleLikeCountChange = (answerId: string, newLikeCount: number) => {
    // Update the like status in state
    const newLikeStatus = newLikeCount > 0;
    setLikeStatuses((prev) => ({
      ...prev,
      [answerId]: newLikeStatus,
    }));

    // Log the event
    logEvent('like_answer', 'Engagement', answerId);
  };

  // Function to handle private session changes
  const handlePrivateSessionChange = (
    event: React.MouseEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault();
    if (privateSession) {
      // If already in a private session, reload the page
      logEvent('end_private_session', 'UI', '');
      window.location.reload();
    } else {
      // Start a private session
      setPrivateSession(true);
      logEvent('start_private_session', 'UI', '');
    }
  };

  // State for managing voting functionality
  const [votes, setVotes] = useState<Record<string, number>>({});
  const [voteError, setVoteError] = useState<string | null>(null);

  // State for the feedback modal
  const [isFeedbackModalOpen, setIsFeedbackModalOpen] =
    useState<boolean>(false);
  const [currentFeedbackDocId, setCurrentFeedbackDocId] = useState<
    string | null
  >(null);
  const [feedbackSubmitError, setFeedbackSubmitError] = useState<string | null>(
    null,
  );

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
        logEvent('clear_downvote', 'Engagement', docId);
      } else {
        // If not currently downvoted (-1), open the feedback modal
        setCurrentFeedbackDocId(docId);
        setIsFeedbackModalOpen(true);
      }
    }
  };

  // Function to submit feedback - NEW
  const submitFeedback = async (
    docId: string,
    reason: string,
    comment: string,
  ) => {
    setFeedbackSubmitError(null); // Clear previous errors before trying
    try {
      const response = await fetchWithAuth('/api/vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docId, vote: -1, reason, comment }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.error || `Failed to submit feedback (${response.status})`,
        );
      }

      // If successful:
      setVotes((prev) => ({ ...prev, [docId]: -1 })); // Update UI to show downvote
      setIsFeedbackModalOpen(false); // Close modal
      setCurrentFeedbackDocId(null);
      logEvent('submit_feedback', 'Engagement', reason); // Log feedback event

      // Show a success toast
      toast.success('Feedback submitted. Thank you!');
    } catch (error) {
      console.error('Error submitting feedback:', error);
      const errorMessage =
        error instanceof Error ? error.message : 'An unknown error occurred.';
      setFeedbackSubmitError(errorMessage); // Show error in the modal
      // Keep the modal open for the user to see the error
    }
  };

  // Function to cancel feedback - NEW
  const cancelFeedback = () => {
    setIsFeedbackModalOpen(false);
    setCurrentFeedbackDocId(null);
    setFeedbackSubmitError(null); // Clear any errors shown in modal
    logEvent('cancel_feedback', 'Engagement', '');
  };

  // Function to handle copying answer links
  const handleCopyLink = (answerId: string) => {
    const url = `${window.location.origin}/answers/${answerId}`;
    navigator.clipboard.writeText(url).then(() => {
      setLinkCopied(answerId);
      setTimeout(() => setLinkCopied(null), 2000);
      logEvent('copy_link', 'Engagement', `Answer ID: ${answerId}`);
    });
  };

  // Effect to set initial collection and focus input on component mount
  useEffect(() => {
    // Retrieve and set the collection from the cookie
    // TODO: This is a hack for jairam site test
    const savedCollection =
      Cookies.get('selectedCollection') ||
      (process.env.SITE_ID === 'jairam' ? 'whole_library' : 'master_swami');
    setCollection(savedCollection);

    if (!isLoadingQueries && window.innerWidth > 768) {
      textAreaRef.current?.focus();
    }
  }, [isLoadingQueries]);

  // Custom hook to check if multiple collections are available
  const hasMultipleCollections = useMultipleCollections(
    siteConfig || undefined,
  );

  // Function to handle clicking on suggested queries
  const handleClick = (clickedQuery: string) => {
    setQuery(clickedQuery);
    setIsNearBottom(true);
    handleSubmit(
      new Event('submit') as unknown as React.FormEvent,
      clickedQuery,
    );
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

  // Render maintenance mode message if active
  if (isMaintenanceMode) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <h1 className="text-2xl font-bold mb-4">
          Site is currently under maintenance
        </h1>
        <p>Please check back later.</p>
      </div>
    );
  }

  // Main component render
  return (
    <SudoProvider>
      <Layout siteConfig={siteConfig}>
        {/* Banner for Web Subdirectory */}
        <div className="bg-yellow-200 text-yellow-800 text-center p-2 text-sm font-semibold">
          Note: You are viewing the site from the /web subdirectory.
        </div>
        {/* End Banner */}

        {showPopup && popupMessage && (
          <Popup
            message={popupMessage}
            onClose={closePopup}
            siteConfig={siteConfig}
          />
        )}
        <LikePrompt show={showLikePrompt} siteConfig={siteConfig} />
        <div className="flex flex-col h-full">
          {/* Private session banner */}
          {privateSession && (
            <div className="bg-purple-100 text-purple-800 text-center py-2 flex items-center justify-center">
              <span className="material-icons text-2xl mr-2">lock</span>
              You are in a Private Session (
              <button
                onClick={handlePrivateSessionChange}
                className="underline hover:text-purple-900"
              >
                end private session
              </button>
              )
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
                  privateSession={privateSession}
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
              {isSudoUser &&
                timingMetrics &&
                !loading &&
                messages.length > 0 && (
                  <div className="text-xs text-gray-500 p-2 bg-gray-50 rounded m-2">
                    {formatTimingMetrics()}
                  </div>
                )}
              <div ref={bottomOfListRef} style={{ height: '1px' }} />
            </div>
          </div>
          <div className="mt-4 px-2 md:px-0">
            {/* Render chat input component */}
            {isLoadingQueries ? null : (
              <ChatInput
                loading={loading}
                handleSubmit={handleSubmit}
                handleEnter={handleEnter}
                handleClick={handleClick}
                handleCollectionChange={handleCollectionChange}
                handlePrivateSessionChange={handlePrivateSessionChange}
                collection={collection}
                privateSession={privateSession}
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
          {/* Private session banner (bottom) */}
          {privateSession && (
            <div className="bg-purple-100 text-purple-800 text-center py-2 flex items-center justify-center">
              <span className="material-icons text-2xl mr-2">lock</span>
              You are in a Private Session (
              <button
                onClick={handlePrivateSessionChange}
                className="underline hover:text-purple-900"
              >
                end private session
              </button>
              )
            </div>
          )}
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
