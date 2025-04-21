/**
 * Ananda AI Chatbot - Frontend JavaScript
 *
 * This script handles the frontend functionality of the Ananda AI chatbot WordPress plugin.
 *
 * Key features:
 * - Chat interface with floating bubble and expandable window
 * - Streaming response support for real-time token display
 * - Abort controller for canceling ongoing requests
 * - Source document display for reference materials
 * - Error handling with user-friendly messages
 * - Automatic scrolling to keep latest messages visible
 * - Fallback support for non-streaming API responses
 * - Markdown rendering for bot responses
 * - Session persistence across page navigation
 * - Auto-focus on input field when chat opens
 * - Close on Escape key or clicking outside
 * - Full page chat option for expanded experience
 * - Dynamic Intercom integration via special [any text](GETHUMAN) links
 */

document.addEventListener('DOMContentLoaded', () => {
  // API endpoint paths
  const API_PATHS = {
    CHAT: '/api/chat/v1',
    VOTE: '/api/vote',
    NPS: '/api/submitNpsSurvey',
  };

  // Default base URL
  const DEFAULT_BASE_URL = 'https://chat.ananda.org';

  // Clean the base URL by removing trailing slashes
  function getBaseUrl() {
    const configuredUrl = aichatbotData.vercelUrl || DEFAULT_BASE_URL;
    return configuredUrl.replace(/\/+$/, '');
  }

  // Simple UUID generator (needed by original script and NPS)
  function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(
      /[xy]/g,
      function (c) {
        var r = (Math.random() * 16) | 0,
          v = c == 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      },
    );
  }

  // --- NPS Survey Logic Start ---

  // Helper to get item from localStorage with default value
  function getLocalStorageItem(key, defaultValue) {
    try {
      const item = localStorage.getItem(key);
      // Handle explicit null/undefined storage vs. missing key
      if (item === null) return defaultValue;
      // Attempt to parse if it looks like JSON, otherwise return raw
      try {
        // Be careful with primitive strings that are valid JSON ('"string"')
        if (
          typeof defaultValue !== 'string' ||
          item.startsWith('{') ||
          item.startsWith('[')
        ) {
          return JSON.parse(item);
        }
      } catch (e) {
        /* Ignore parse error, return raw string */
      }
      return item;
    } catch (error) {
      console.error(
        `Error reading localStorage key \u201C${key}\u201D:`,
        error,
      );
      return defaultValue;
    }
  }

  // Helper to set item in localStorage
  function setLocalStorageItem(key, value) {
    try {
      const stringValue =
        typeof value === 'string' ? value : JSON.stringify(value);
      localStorage.setItem(key, stringValue);
    } catch (error) {
      console.error(
        `Error setting localStorage key \u201C${key}\u201D:`,
        error,
      );
    }
  }

  // Initialize NPS state variables from localStorage
  let npsQueryCount = getLocalStorageItem('npsQueryCount', 0);
  let npsLastSurveyTimestamp = getLocalStorageItem(
    'npsLastSurveyTimestamp',
    null,
  );
  let npsLastSurveyQueryCount = getLocalStorageItem(
    'npsLastSurveyQueryCount',
    0,
  );
  let npsUserUuid = getLocalStorageItem('npsUserUuid', null);
  let npsDismissReason = getLocalStorageItem('npsDismissReason', null);

  // Generate and save UUID if it doesn't exist
  if (!npsUserUuid) {
    npsUserUuid = generateUUID(); // Use the globally available function
    setLocalStorageItem('npsUserUuid', npsUserUuid);
  }

  // Function to increment query count and check NPS trigger conditions
  function handleNpsSurveyCheck() {
    npsQueryCount++;
    setLocalStorageItem('npsQueryCount', npsQueryCount);

    // --- Trigger Logic Start ---
    const NPS_QUERY_THRESHOLD = 5;
    const THREE_MONTHS_IN_MS = 3 * 30 * 24 * 60 * 60 * 1000; // Approximate
    const THREE_DAYS_IN_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
    const now = Date.now();

    // Determine the required delay based on the dismiss reason
    let requiredDelay = THREE_MONTHS_IN_MS; // Default to 3 months
    if (npsDismissReason === 'later' || npsDismissReason === 'no_thanks') {
      requiredDelay = THREE_DAYS_IN_MS;
    }

    let shouldShow = false;

    // Condition 1: Initial trigger (no previous survey interaction recorded)
    if (!npsLastSurveyTimestamp && npsQueryCount >= NPS_QUERY_THRESHOLD) {
      shouldShow = true;
    }
    // Condition 2: Recurrence trigger
    else if (npsLastSurveyTimestamp) {
      const timeSinceLastInteraction = now - npsLastSurveyTimestamp;
      const queriesSinceLastSubmission =
        npsQueryCount - npsLastSurveyQueryCount;

      // Check if enough time has passed based on the reason
      if (timeSinceLastInteraction >= requiredDelay) {
        // If it was dismissed ('later' or 'no_thanks'), show immediately after 3 days (ignore query threshold)
        if (npsDismissReason === 'later' || npsDismissReason === 'no_thanks') {
          shouldShow = true;
        }
        // If it was submitted, also check the query threshold
        else if (
          npsDismissReason === 'submitted' &&
          queriesSinceLastSubmission >= NPS_QUERY_THRESHOLD
        ) {
          shouldShow = true;
        }
        // Handle cases where dismissReason might be null/unexpected (treat as submitted/default)
        else if (
          !npsDismissReason &&
          queriesSinceLastSubmission >= NPS_QUERY_THRESHOLD
        ) {
          console.warn(
            'NPS check: dismissReason missing, applying default 3-month/5-query rule.',
          );
          shouldShow = true;
        }
      }
    }

    if (shouldShow) {
      showNpsSurveyModal();
    }
    // --- Trigger Logic End ---
  }
  // --- NPS Survey Logic End ---

  // Initialize variables
  let isStreaming = false;
  let currentAbortController = null;
  let defaultCollection = 'whole_library';
  let privateSession = false;
  let mediaTypes = { text: true, audio: false, youtube: false };
  let sourceCount = 6;
  let intercomEnabled = false;

  // Get DOM elements
  const bubble = document.getElementById('aichatbot-bubble');
  const chatWindow = document.getElementById('aichatbot-window');
  const input = document.getElementById('aichatbot-input');
  const sendButton = document.getElementById('aichatbot-send');
  const messages = document.getElementById('aichatbot-messages');

  // Initialize language hint functionality
  const hint = document.querySelector('.aichatbot-language-hint');
  const modal = document.querySelector('.aichatbot-language-modal');

  if (hint && modal) {
    hint.addEventListener('click', () => {
      modal.style.display = 'flex';
    });

    const closeButton = modal.querySelector('.modal-close');
    if (closeButton) {
      closeButton.addEventListener('click', () => {
        modal.style.display = 'none';
      });
    }

    // Close modal when clicking outside
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.style.display = 'none';
      }
    });
  }

  // Create controls container (to hold both buttons)
  const controlsContainer = document.createElement('div');
  controlsContainer.id = 'aichatbot-controls';
  chatWindow.appendChild(controlsContainer);

  // Add full page chat button
  const fullPageButton = document.createElement('div');
  fullPageButton.id = 'aichatbot-fullpage';
  fullPageButton.innerHTML = `<i class="fas fa-expand-alt"></i>Full page chat`;

  // Initialize chat history
  let chatHistory = [];

  // Add event listeners after all elements are created
  // Close button functionality
  document.getElementById('aichatbot-close').addEventListener('click', () => {
    chatWindow.style.display = 'none';
    document.body.classList.remove('aichatbot-window-open');
    saveChatState();
  });

  // Full page chat button functionality
  fullPageButton.addEventListener('click', () => {
    let fullPageUrl = '/chat';
    if (typeof aichatbotData !== 'undefined' && aichatbotData.fullPageUrl) {
      fullPageUrl = aichatbotData.fullPageUrl;
    }
    window.open(fullPageUrl, '_blank');
  });

  // Bubble click functionality
  bubble.addEventListener('click', (e) => {
    chatWindow.style.display =
      chatWindow.style.display === 'none' ? 'flex' : 'none';

    if (chatWindow.style.display === 'flex') {
      document.body.classList.add('aichatbot-window-open');
      setTimeout(() => input.focus(), 0);
      setTimeout(() => {
        messages.scrollTop = messages.scrollHeight;
      }, 0);
      addWelcomeMessage();
      if (chatHistory.length > 0) {
        input.placeholder = '';
      } else {
        input.placeholder = getRandomPlaceholder();
      }
    } else {
      document.body.classList.remove('aichatbot-window-open');
    }
    saveChatState();
    e.stopPropagation();
  });

  // Send button functionality
  sendButton.addEventListener('click', sendMessage);

  // Enter key functionality
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Add click event delegation for Intercom trigger text
  messages.addEventListener('click', (e) => {
    const trigger = e.target.closest('.aichatbot-intercom-trigger');
    if (trigger) {
      e.preventDefault();
      showIntercom();
    }
  });

  // Now load chat state and initialize UI
  loadChatState();
  addWelcomeMessage();
  updatePlaceholder();
  updateClearHistoryButton();

  // Check if the wand-magic-sparkles icon is available, use fallback if not
  setTimeout(() => {
    const wandIcon = document.querySelector('.fa-wand-magic-sparkles');
    if (wandIcon) {
      // Check if the icon is rendered properly
      const computedStyle = window.getComputedStyle(wandIcon, ':before');
      const contentValue = computedStyle.getPropertyValue('content');

      // If the icon isn't rendering properly (empty or "none"), show the fallback
      if (contentValue === 'none' || contentValue === '') {
        wandIcon.style.display = 'none';
        const fallbackIcon = document.querySelector('.fa-magic');
        if (fallbackIcon) {
          fallbackIcon.style.display = 'inline-block';
        }
      }
    }
  }, 500);

  // Define initial height constant
  const INITIAL_HEIGHT = '40px';

  // Initialize textarea to exact height
  input.style.height = INITIAL_HEIGHT;
  input.style.overflowY = 'hidden';

  // Set up textarea auto-expand functionality
  function autoResizeTextarea() {
    // For empty content, always reset to initial height
    if (!input.value.trim()) {
      resetTextareaHeight();
      return;
    }

    // Reset height to auto to properly calculate the new height
    input.style.height = 'auto';

    // Set the height to scrollHeight to fit all content (up to max-height in CSS)
    input.style.height = `${Math.min(input.scrollHeight, window.innerHeight * 0.4)}px`;

    // If content is longer than max height, keep the scrollbar
    if (input.scrollHeight > window.innerHeight * 0.4) {
      input.style.overflowY = 'auto';
    } else {
      input.style.overflowY = 'hidden';
    }
  }

  // Function to completely reset textarea height
  function resetTextareaHeight() {
    input.style.height = 'auto'; // First reset to auto
    input.style.overflowY = 'hidden';
    input.style.height = INITIAL_HEIGHT; // Then set to initial height

    // Force a reflow to ensure the height is applied
    void input.offsetHeight;
  }

  // Initialize textarea height
  autoResizeTextarea();

  // Auto-resize when typing
  input.addEventListener('input', autoResizeTextarea);

  // Reset height when window is resized
  window.addEventListener('resize', autoResizeTextarea);

  // Handle Intercom integration if enabled
  if (typeof aichatbotData !== 'undefined') {
    intercomEnabled = aichatbotData.enableIntercom === '1';

    // Hide Intercom container initially if integration is enabled
    if (intercomEnabled && typeof window.Intercom !== 'undefined') {
      // Add a class to the body for CSS targeting when Intercom is active
      document.body.classList.add('intercom-enabled');

      // Inject CSS to hide Intercom container when page loads
      const style = document.createElement('style');
      style.id = 'aichatbot-intercom-style';
      style.innerHTML = `#intercom-container { display: none !important; }`;
      document.head.appendChild(style);

      // Add listener for when Intercom messenger is hidden by the user
      window.Intercom('onHide', function () {
        console.log('Intercom messenger hidden (onHide event).');

        // Re-hide the Intercom container/launcher using our CSS rule
        let existingStyle = document.getElementById('aichatbot-intercom-style');
        if (!existingStyle) {
          const style = document.createElement('style');
          style.id = 'aichatbot-intercom-style';
          style.innerHTML = `#intercom-container { display: none !important; }`;
          document.head.appendChild(style);
          console.log('Re-injected CSS to hide Intercom container.');
        } else {
          console.log('Intercom hiding CSS already exists.');
        }

        // Show the chatbot bubble (if it exists)
        const bubble = document.getElementById('aichatbot-bubble');
        if (bubble) {
          bubble.style.display = 'flex'; // Assuming flex is the default visible state
          console.log('Chatbot bubble shown.');
        }
      });
    }
  }

  // Function to show Intercom and hide chatbot
  function showIntercom() {
    if (intercomEnabled && typeof window.Intercom !== 'undefined') {
      // Remove the CSS that hides Intercom
      const intercomStyle = document.getElementById('aichatbot-intercom-style');
      if (intercomStyle) {
        intercomStyle.remove();
        console.log('Removed CSS hiding Intercom container.');
      } else {
        console.log('Intercom hiding CSS not found, proceeding anyway.');
      }

      // Hide chatbot window
      chatWindow.style.display = 'none';
      document.body.classList.remove('aichatbot-window-open'); // Ensure body class is removed
      saveChatState(); // Save closed state

      // Show Intercom - use the proper method to both show and open the messenger
      try {
        // Explicitly show and open the messenger
        window.Intercom('show');
        window.Intercom('showNewMessage'); // Optionally opens composer directly

        console.log('Intercom triggered successfully via show/showNewMessage');
        return true;
      } catch (e) {
        console.error('Error showing Intercom:', e);
        return false;
      }
    }
    // Log if Intercom isn't enabled or ready
    console.log('Intercom not enabled or not ready.');
    return false;
  }

  // Default placeholder questions in case WordPress settings are not available
  let placeholderQuestions = ['Ask me anything about this website'];

  // Override with questions from WordPress if available
  if (
    typeof aichatbotData !== 'undefined' &&
    aichatbotData.placeholderQuestionsText &&
    aichatbotData.placeholderQuestionsText.trim() !== ''
  ) {
    // Split the text into lines and filter out empty lines
    const questions = aichatbotData.placeholderQuestionsText
      .split('\n')
      .map((question) => question.trim())
      .filter((question) => question !== '');

    if (questions.length > 0) {
      placeholderQuestions = questions;
    }
  }

  // Function to get a random placeholder question
  function getRandomPlaceholder() {
    const randomIndex = Math.floor(Math.random() * placeholderQuestions.length);
    return placeholderQuestions[randomIndex];
  }

  // Apply customization settings from WordPress if available
  if (typeof aichatbotData !== 'undefined') {
    // Apply font size setting if provided
    if (aichatbotData.fontSizePx) {
      const fontSize = parseInt(aichatbotData.fontSizePx);
      if (fontSize >= 12 && fontSize <= 24) {
        // CSS is already applied via inline styles, but we can enhance dynamic elements here if needed
      }
    }

    // Apply window dimensions if provided and not on mobile
    if (window.innerWidth > 480) {
      // Only apply custom dimensions on non-mobile
      if (aichatbotData.windowWidthPx) {
        const windowWidth = parseInt(aichatbotData.windowWidthPx);
        if (windowWidth >= 300 && windowWidth <= 600) {
          // CSS is already applied via inline styles
        }
      }

      if (aichatbotData.windowHeightPx) {
        const windowHeight = parseInt(aichatbotData.windowHeightPx);
        if (windowHeight >= 400 && windowHeight <= 800) {
          // CSS is already applied via inline styles
        }
      }
    }
  }

  // Track accumulated response for streaming
  let accumulatedResponse = '';
  let currentBotMessage = null;

  /**
   * Renders markdown text into HTML with support for:
   * - Paragraphs (separated by double newlines)
   * - Unordered lists (using * or - as markers)
   * - Bold text (**text** or __text__)
   * - Italic text (*text* or _text_)
   * - Inline code (`code`)
   * - Links ([text](url))
   * - Special GETHUMAN links for Intercom integration
   *
   * @param {string} text - The markdown text to convert to HTML
   * @returns {string} The rendered HTML
   */
  function renderMarkdown(text) {
    if (!text) return '';

    // Normalize line endings and clean up excessive whitespace:
    // - Convert Windows line endings to Unix
    // - Collapse 3+ newlines into 2 (standard markdown paragraph break)
    text = text
      .trim()
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n');

    // Split text into logical blocks (paragraphs and lists)
    // Double newlines are used as block separators in markdown
    const blocks = text.split('\n\n');
    let html = '';
    let inList = false; // Tracks whether we're currently processing a list

    for (let block of blocks) {
      block = block.trim();

      // Check if this block starts with a list marker (* or -)
      if (block.match(/^[*-]\s/m)) {
        // Start a new list if we're not already in one
        if (!inList) {
          html += '<ul>';
          inList = true;
        }
        // Split the block into individual list items
        const items = block.split('\n');
        for (let item of items) {
          if (item.trim()) {
            // Process each list item:
            // 1. Remove the list marker
            // 2. Process inline markdown (bold, italic, code)
            // 3. Handle special GETHUMAN links
            // 4. Process regular links
            const listContent = item
              .replace(/^[*-]\s+/, '') // Remove list marker
              // Process inline markdown within list items
              .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
              .replace(/__(.*?)__/g, '<strong>$1</strong>')
              .replace(/\*(.*?)\*/g, '<em>$1</em>')
              .replace(/_(.*?)_/g, '<em>$1</em>')
              .replace(/`(.*?)`/g, '<code>$1</code>')
              // Handle links - special case for GETHUMAN
              .replace(
                /\[(.*?)\]\(GETHUMAN\)/g,
                '<span class="aichatbot-intercom-trigger" style="color:#4a90e2; text-decoration:underline; cursor:pointer;">$1</span>',
              )
              // Regular links
              .replace(
                /\[(.*?)\]\((.*?)\)/g,
                '<a href="$2" target="_blank">$1</a>',
              );

            html += `<li>${listContent}</li>`;
          }
        }
      } else {
        // This is a regular paragraph block

        // Close any open list before starting a new paragraph
        if (inList) {
          html += '</ul>';
          inList = false;
        }

        // Process the paragraph block:
        // 1. Handle inline markdown (bold, italic, code)
        // 2. Process special GETHUMAN links
        // 3. Process regular links
        // 4. Convert single newlines to <br /> tags
        let paragraph = block
          // Process inline markdown
          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
          .replace(/__(.*?)__/g, '<strong>$1</strong>')
          .replace(/\*(.*?)\*/g, '<em>$1</em>')
          .replace(/_(.*?)_/g, '<em>$1</em>')
          .replace(/`(.*?)`/g, '<code>$1</code>')
          // Handle links - special case for GETHUMAN
          .replace(
            /\[(.*?)\]\(GETHUMAN\)/g,
            '<span class="aichatbot-intercom-trigger" style="color:#4a90e2; text-decoration:underline; cursor:pointer;">$1</span>',
          )
          // Regular links
          .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank">$1</a>')
          // Handle line breaks within paragraphs
          .replace(/\n/g, '<br />');

        html += `<p>${paragraph}</p>`;
      }
    }

    // Ensure any open list is properly closed
    if (inList) {
      html += '</ul>';
    }

    return html;
  }

  async function sendMessage() {
    const message = input.value.trim();
    if (!message) return;

    // Always clear placeholder immediately on sending a message
    input.placeholder = '';

    // If already streaming, stop it
    if (stopStreaming()) {
      return;
    }

    // --- NPS Survey Logic Start ---
    handleNpsSurveyCheck();
    // --- NPS Survey Logic End ---

    // Reset accumulated response
    accumulatedResponse = '';

    // Show user message
    const userMessage = document.createElement('div');
    userMessage.className = 'aichatbot-user-message';
    userMessage.textContent = message;
    messages.appendChild(userMessage);

    // Clear input and completely reset height
    input.value = '';
    resetTextareaHeight();

    // Create bot message container but don't add to DOM yet
    currentBotMessage = createBotMessage(message);

    // Show typing indicator
    const typingIndicator = document.createElement('div');
    typingIndicator.className = 'aichatbot-typing';
    const typingSpan = document.createElement('span');
    typingSpan.className = 'typing-dots';
    typingSpan.textContent = '.';
    typingIndicator.appendChild(typingSpan);
    messages.appendChild(typingIndicator);
    messages.scrollTop = messages.scrollHeight;

    // Toggle buttons
    sendButton.style.display = 'none';
    stopButton.style.display = 'inline-block';

    isStreaming = true;

    // Update chat history with user message
    chatHistory.push([message, '']);

    try {
      // Get token for API call
      const token = await getToken();
      if (!token) {
        throw new Error('Failed to get authentication token');
      }

      // Create new abort controller for this request
      currentAbortController = new AbortController();

      // Make API call
      const response = await fetch(`${getBaseUrl()}${API_PATHS.CHAT}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          question: message,
          history: chatHistory
            .slice(0, -1)
            .map(([userMsg, botMsg]) => [
              { role: 'user', content: userMsg },
              { role: 'assistant', content: botMsg },
            ])
            .flat(),
          collection: defaultCollection,
          privateSession: privateSession,
          mediaTypes: mediaTypes,
          sourceCount: sourceCount,
        }),
        signal: currentAbortController.signal,
      });

      if (!response.ok) {
        try {
          const errorData = await response.json();
          console.error('API Error:', errorData);
          const errorMessage = errorData.error || JSON.stringify(errorData);
          throw new Error(`${errorMessage}`); // This will show the actual API error
        } catch (e) {
          throw new Error(`Server error (${response.status}): ${e.message}`);
        }
      }

      // Check if the response is a stream
      if (response.headers.get('content-type')?.includes('text/event-stream')) {
        // Handle streaming response
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const messageContent = currentBotMessage.querySelector(
          '.aichatbot-message-content',
        );
        let firstTokenReceived = false;
        let hasContent = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');

          // Check if user is near the bottom BEFORE adding the new chunk
          const wasScrolledToBottom =
            messages.scrollHeight - messages.clientHeight <=
            messages.scrollTop + 10;

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const jsonData = JSON.parse(line.slice(5));

                // Check site ID and source count
                if (jsonData.siteId && jsonData.siteId !== 'ananda-public') {
                  console.error(
                    '[Ananda-AI-Chatbot]: Backend is using incorrect site ID:',
                    jsonData.siteId,
                    'Expected: ananda-public',
                  );
                }
                if (
                  jsonData.sourceDocs &&
                  jsonData.sourceDocs.length < sourceCount
                ) {
                  console.error(
                    '[Ananda-AI-Chatbot]: Received',
                    jsonData.sourceDocs.length,
                    'sources, but',
                    sourceCount,
                    'were requested.',
                  );
                }

                // Handle token updates
                if (jsonData.token) {
                  accumulatedResponse += jsonData.token;

                  // Check if we have actual visible content (not just whitespace)
                  hasContent = accumulatedResponse.trim().length > 0;

                  // Only add bot message to DOM and remove typing indicator if we have actual visible content
                  if (hasContent && !firstTokenReceived) {
                    // Make sure we're not just receiving metadata or whitespace
                    const actualContent =
                      accumulatedResponse.replace(/\s+/g, '').length > 0;
                    if (actualContent) {
                      // Add the bot message to DOM now that we have content
                      messages.appendChild(currentBotMessage);

                      if (messages.contains(typingIndicator)) {
                        messages.removeChild(typingIndicator);
                      }
                      firstTokenReceived = true;
                    }
                  }

                  // Render markdown for the accumulated response
                  messageContent.innerHTML =
                    renderMarkdown(accumulatedResponse);

                  // Update the last history item with the current accumulated response
                  if (chatHistory.length > 0) {
                    chatHistory[chatHistory.length - 1][1] =
                      accumulatedResponse;
                    // Save state periodically as content streams in
                    if (
                      chatHistory[chatHistory.length - 1][1].length % 100 ===
                      0
                    ) {
                      saveChatState();
                    }
                  }
                }

                // Handle completion
                if (jsonData.done) {
                  // Make sure typing indicator is removed when done
                  if (messages.contains(typingIndicator)) {
                    messages.removeChild(typingIndicator);
                  }
                  currentAbortController = null;
                  sendButton.style.display = 'inline-block';
                  stopButton.style.display = 'none';

                  // Set streaming flag to false
                  isStreaming = false;

                  // Save final state when streaming is complete
                  saveChatState();

                  // Update clear history button
                  updateClearHistoryButton();
                }

                // Handle errors
                if (jsonData.error) {
                  if (messages.contains(typingIndicator)) {
                    messages.removeChild(typingIndicator);
                  }
                  throw new Error(jsonData.error);
                }

                // Handle docId
                if (jsonData.docId) {
                  console.log(
                    `Received valid docId from server: ${jsonData.docId}`,
                  );
                  currentBotMessage.setAttribute('data-doc-id', jsonData.docId);
                  // Add vote buttons if not already added
                  if (
                    !currentBotMessage.querySelector('.aichatbot-vote-buttons')
                  ) {
                    addVoteButtons(currentBotMessage, jsonData.docId);
                  }
                }
              } catch (parseError) {
                console.error('Error parsing JSON:', parseError);
              }
            }
          }

          // Scroll to bottom AFTER potentially adding content, ONLY if user WAS at the bottom before
          if (wasScrolledToBottom) {
            messages.scrollTop = messages.scrollHeight;
          }
        }
      } else {
        // Handle non-streaming response
        const data = await response.json();
        const messageContent = currentBotMessage.querySelector(
          '.aichatbot-message-content',
        );

        // Render markdown for the response
        const renderedContent = renderMarkdown(
          data.reply || 'No response received.',
        );
        messageContent.innerHTML = renderedContent;

        // Add the bot message to DOM now that we have content
        messages.appendChild(currentBotMessage);

        // Now that we have content rendered, remove the typing indicator
        if (messages.contains(typingIndicator)) {
          messages.removeChild(typingIndicator);
        }

        // Update chat history with the complete response
        if (chatHistory.length > 0) {
          chatHistory[chatHistory.length - 1][1] = data.reply || '';
          // Save state after receiving complete response
          saveChatState();

          // Update clear history button
          updateClearHistoryButton();
        }

        // Set docId if provided and add vote buttons
        if (data.docId) {
          console.log(`Received valid docId from server: ${data.docId}`);
          currentBotMessage.setAttribute('data-doc-id', data.docId);
          addVoteButtons(currentBotMessage, data.docId);
        } else {
          console.warn(
            'No docId received from server - vote functionality will be disabled for this message',
          );
        }
      }
    } catch (error) {
      // Remove typing indicator if it exists
      if (messages.contains(typingIndicator)) {
        messages.removeChild(typingIndicator);
      }

      // Show error message
      const errorMessage = document.createElement('div');
      errorMessage.className = 'aichatbot-error-message';

      if (error.name === 'AbortError') {
        errorMessage.textContent = 'Request was canceled.';
      } else if (
        error.name === 'TypeError' &&
        error.message.includes('Failed to fetch')
      ) {
        // This typically happens when the server is completely down/unreachable
        errorMessage.textContent =
          'Chatbot server is unavailable. Please try again later.';
      } else if (
        error.message.includes('NetworkError') ||
        error.message.includes('CORS')
      ) {
        errorMessage.textContent =
          'Connection to chatbot server failed. Please try again later.';
      } else if (error.message.includes('Site mismatch')) {
        // Handle site mismatch errors specifically
        errorMessage.innerHTML = `
          <strong>Configuration Error:</strong> ${error.message}<br>
          <small>Please contact the site administrator to update the chatbot settings.</small>
        `;
      } else if (error.message.includes('Invalid token')) {
        // Handle authentication errors
        errorMessage.innerHTML = `
          <strong>Authentication Error:</strong> Unable to connect to the chat backend.<br>
          <small>Please check your internet connection and try again, or contact the site administrator.</small>
        `;
        console.error('Token error details:', error.message);
      } else if (error.message.includes('session has expired')) {
        // Handle session expiration with reload button
        errorMessage.innerHTML = `
          <strong>Session Expired:</strong> Your authentication has expired.<br>
          <small>Please reload the page to continue using the chatbot.</small><br>
          <button id="aichatbot-reload-button" style="margin-top: 10px; padding: 5px 10px; background-color: #4a90e2; color: white; border: none; border-radius: 4px; cursor: pointer;">Reload Page</button>
        `;

        // Add reload functionality after the message is added to DOM
        setTimeout(() => {
          const reloadButton = document.getElementById(
            'aichatbot-reload-button',
          );
          if (reloadButton) {
            reloadButton.addEventListener('click', () => {
              window.location.reload();
            });
          }
        }, 100);
      } else {
        // Format other errors to be more readable
        const cleanErrorMessage = error.message
          .replace(/Server error \((.*)\)/, '$1') // Remove "Server error" wrapper
          .replace(/Error: /, ''); // Remove "Error:" prefix if present

        errorMessage.innerHTML = `
          <strong>Error:</strong> ${cleanErrorMessage}<br>
          <small>If this problem persists, please contact the site administrator.</small>
        `;
      }

      messages.appendChild(errorMessage);

      // Additional error logging for site administrators
      console.error('Chatbot error details:', {
        message: error.message,
        name: error.name,
        stack: error.stack,
        chatHistory: chatHistory.length, // Just the count for privacy
        vercelUrl: aichatbotData.vercelUrl,
      });
    } finally {
      // Reset UI state
      sendButton.style.display = 'inline-block';
      stopButton.style.display = 'none';
      currentAbortController = null;

      // Set streaming flag to false in finally block to ensure it's reset
      isStreaming = false;

      // Update clear history button state
      updateClearHistoryButton();

      // Check if user WAS near the bottom before the final processing
      const wasScrolledToBottomFinal =
        messages.scrollHeight - messages.clientHeight <=
        messages.scrollTop + 10; // 10px tolerance
      // Scroll to bottom AFTER final processing ONLY if user WAS near the bottom before
      if (wasScrolledToBottomFinal) {
        messages.scrollTop = messages.scrollHeight;
      }
    }
  }

  /* @TODO Commenting this out for now. After some testing, if the chat window works well
           on mobile and desktop, we can delete the code altogether. 

  // Handle window resize events for responsive behavior
  window.addEventListener('resize', () => {
    const windowVisible = sessionStorage.getItem('aichatbot_window_visible');
    const isLargeScreen = window.innerWidth >= 768;

    // If window was visible and we're on a small screen, hide it
    if (
      windowVisible === 'true' &&
      !isLargeScreen &&
      chatWindow.style.display === 'flex'
    ) {
      chatWindow.style.display = 'none';
      // Don't update sessionStorage here since we still want to remember it was open
    }
    // If window was visible and we transition to large screen, show it
    else if (
      windowVisible === 'true' &&
      isLargeScreen &&
      chatWindow.style.display === 'none'
    ) {
      chatWindow.style.display = 'flex';
      // Focus the input when we open
      setTimeout(() => input.focus(), 0);
    }
  }); */

  // Save chat state when user leaves the page
  window.addEventListener('beforeunload', saveChatState);

  // Function to update the clear history button visibility
  function updateClearHistoryButton() {
    // Get the controls container
    const controlsContainer = document.getElementById('aichatbot-controls');

    // Clear the controls container
    if (controlsContainer) {
      controlsContainer.innerHTML = '';
    }

    // Create clear history button only if there's chat history
    if (chatHistory.length > 0) {
      const clearButton = document.createElement('div');
      clearButton.id = 'aichatbot-clear-history';
      clearButton.innerHTML =
        '<i class="fas fa-trash-alt"></i> Clear chat history';

      // Disable the button visually and functionally during streaming
      if (isStreaming) {
        clearButton.classList.add('disabled');
        clearButton.style.opacity = '0.5';
        clearButton.style.cursor = 'not-allowed';
      } else {
        clearButton.addEventListener('click', clearChatHistory);
      }

      // Add to the controls container
      controlsContainer.appendChild(clearButton);
    }

    // Always add the full page button to the controls - it should always be visible
    controlsContainer.appendChild(fullPageButton);

    // Add Contact a Human button
    const contactHumanButton = document.createElement('div');
    contactHumanButton.id = 'aichatbot-contact-human';
    contactHumanButton.innerHTML = `<i class="fas fa-user"></i> Contact a human`;
    contactHumanButton.addEventListener('click', showIntercom);

    // Add to the controls container
    controlsContainer.appendChild(contactHumanButton);
  }

  // Function to clear chat history
  function clearChatHistory() {
    // Store current window state
    const wasWindowOpen = chatWindow.style.display === 'flex';

    // Clear history array
    chatHistory = [];

    // Clear the UI
    messages.innerHTML = '';

    // Add welcome message back
    addWelcomeMessage();

    // Restore placeholder text
    updatePlaceholder();

    // Save empty state
    saveChatState();

    // Make sure window remains open - force this to happen AFTER all other operations
    if (wasWindowOpen) {
      // Use setTimeout to ensure this happens after any other operations
      setTimeout(() => {
        chatWindow.style.display = 'flex';
        // Extra safety - explicitly set the session storage value
        sessionStorage.setItem('aichatbot_window_visible', 'true');
        // Set focus back to the input field
        input.focus();
      }, 0);
    }

    // Update button visibility
    updateClearHistoryButton();
  }

  // Load chat history and UI state from sessionStorage
  function loadChatState() {
    try {
      // Load chat history
      const savedHistory = sessionStorage.getItem('aichatbot_history');
      if (savedHistory) {
        chatHistory = JSON.parse(savedHistory);

        // Rebuild chat messages from history
        chatHistory.forEach(([userMsg, botMsg]) => {
          // Add user message
          if (userMsg) {
            const userMessage = document.createElement('div');
            userMessage.className = 'aichatbot-user-message';
            userMessage.textContent = userMsg;
            messages.appendChild(userMessage);
          }

          // Add bot message
          if (botMsg) {
            const botMessage = createBotMessage(botMsg);
            messages.appendChild(botMessage);
          }
        });

        // Scroll to the bottom of the chat after loading history
        setTimeout(() => {
          messages.scrollTop = messages.scrollHeight;
        }, 0);
      }

      // Load UI state (window open/closed)
      const windowVisible = sessionStorage.getItem('aichatbot_window_visible');

      // Check screen width - only auto-open on larger screens
      const isLargeScreen = window.innerWidth >= 768; // Typical tablet/desktop breakpoint

      if (windowVisible === 'true') {
        // If it was visible and screen is large enough, show it
        // Otherwise leave it minimized on mobile
        chatWindow.style.display = isLargeScreen ? 'flex' : 'none';
      } else {
        // Default to hiding chat window if it was previously closed
        chatWindow.style.display = 'none';
      }
    } catch (e) {
      console.error('Error loading chat state:', e);
      // Default to hiding chat window
      chatWindow.style.display = 'none';
    }

    // Focus on input field when chat window is shown
    if (chatWindow.style.display === 'flex') {
      setTimeout(() => input.focus(), 0);
    }

    // Show/hide clear history button based on chat history
    updateClearHistoryButton();
  }

  // Save chat history and UI state to sessionStorage
  function saveChatState() {
    try {
      sessionStorage.setItem('aichatbot_history', JSON.stringify(chatHistory));
      sessionStorage.setItem(
        'aichatbot_window_visible',
        chatWindow.style.display === 'flex',
      );

      // Update placeholder whenever chat history is saved
      if (chatHistory.length > 0) {
        input.placeholder = '';
      }
    } catch (e) {
      console.error('Error saving chat state:', e);
    }
  }

  // Load chat state on page load
  loadChatState();

  // Add initial welcome message if chat is empty
  function addWelcomeMessage() {
    if (chatHistory.length === 0 && messages.children.length === 0) {
      const welcomeMessage = document.createElement('div');
      welcomeMessage.className = 'aichatbot-bot-message';

      const messageContent = document.createElement('div');
      messageContent.className = 'aichatbot-message-content';
      messageContent.innerHTML = "<p>Hi, I'm Vivek. Ask me anything.</p>";

      welcomeMessage.appendChild(messageContent);
      messages.appendChild(welcomeMessage);
    }
  }

  // Call once on page load
  addWelcomeMessage();

  // Set placeholder text for the input field - only when no chat history exists
  function updatePlaceholder() {
    if (chatHistory.length === 0 && messages.children.length === 0) {
      input.placeholder = getRandomPlaceholder();
    }
  }

  // Stop the current streaming response
  function stopStreaming() {
    if (currentAbortController) {
      currentAbortController.abort();
      currentAbortController = null;

      // Reset streaming flag when manually stopped
      isStreaming = false;

      // Update clear history button state
      updateClearHistoryButton();

      return true;
    }
    return false;
  }

  // Add stop button to UI
  const stopButton = document.createElement('button');
  stopButton.id = 'aichatbot-stop';
  stopButton.innerHTML = '<i class="fas fa-stop"></i>';
  stopButton.style.backgroundColor = '#FFF9C4'; // Pale yellow background
  stopButton.style.color = '#555'; // Darker text for better contrast
  stopButton.style.display = 'none';
  stopButton.addEventListener('click', () => {
    stopStreaming();
    stopButton.style.display = 'none';
    sendButton.style.display = 'inline-block';
  });
  sendButton.parentNode.insertBefore(stopButton, sendButton.nextSibling);

  // --- NPS Survey Logic: Modal UI Start ---
  let npsModalElement = null; // Reference to the modal DOM element

  function createNpsModalHtml() {
    if (document.getElementById('nps-survey-modal')) return; // Avoid creating duplicates

    const chatWindowElement = document.getElementById('aichatbot-window');
    if (!chatWindowElement) {
      console.error(
        'Chat window element #aichatbot-window not found. Cannot create NPS modal.',
      );
      return;
    }

    npsModalElement = document.createElement('div');
    npsModalElement.id = 'nps-survey-modal';
    npsModalElement.style.display = 'none'; // Initially hidden
    npsModalElement.style.position = 'absolute'; // Position relative to chat window
    npsModalElement.style.left = '50%';
    npsModalElement.style.top = '50%';
    npsModalElement.style.transform = 'translate(-50%, -50%)';
    npsModalElement.style.zIndex = '10'; // Needs to be above content *within* chat window
    npsModalElement.style.backgroundColor = 'white';
    npsModalElement.style.padding = '25px';
    npsModalElement.style.border = '1px solid #ccc';
    npsModalElement.style.borderRadius = '8px';
    npsModalElement.style.boxShadow = '0 4px 15px rgba(0,0,0,0.2)';
    npsModalElement.style.maxWidth = '450px';
    npsModalElement.style.width = '90%';
    npsModalElement.style.textAlign = 'center';

    npsModalElement.innerHTML = `
      <h3 style="margin-top: 0; margin-bottom: 15px; font-size: 1.1em; color: #333;">Feedback Request</h3>
      <p style="margin-bottom: 15px; font-size: 0.95em; color: #555;">
        On a scale of 0-10, how likely are you to recommend this chatbot to a friend or colleague?
      </p>
      <div id="nps-score-options" style="display: flex; justify-content: center; flex-wrap: wrap; gap: 5px; margin-bottom: 20px;">
        ${[...Array(11).keys()]
          .map(
            (score) =>
              `<button class="nps-score-btn" data-score="${score}" style="border: 1px solid #ccc; background: #f9f9f9; padding: 8px 12px; border-radius: 4px; cursor: pointer; min-width: 40px; transition: background-color 0.2s, border-color 0.2s;">${score}</button>`,
          )
          .join('')}
      </div>
      <p style="margin-top: 5px; margin-bottom: 15px; font-size: 0.8em; color: #999;">0 = Not at all likely, 10 = Extremely likely</p>
      <p style="margin-bottom: 5px; font-size: 0.9em; color: #555; text-align: left;">Optional: What's the main reason for your score?</p>
      <textarea id="nps-feedback" placeholder="Your feedback helps us improve..." style="width: 100%; height: 80px; padding: 10px; border: 1px solid #ccc; border-radius: 4px; font-size: 0.9em; margin-bottom: 20px; box-sizing: border-box;"></textarea>
      <div id="nps-buttons" style="display: flex; justify-content: space-between; gap: 10px;">
        <button id="nps-submit" style="background-color: #4CAF50; color: white; padding: 10px 15px; border: none; border-radius: 4px; cursor: pointer; flex-grow: 1; opacity: 0.5; pointer-events: none;">Submit</button>
        <button id="nps-ask-later" style="background-color: #f0f0f0; color: #333; padding: 10px 15px; border: 1px solid #ccc; border-radius: 4px; cursor: pointer;">Ask Me Later</button>
        <button id="nps-no-thanks" style="background-color: #f0f0f0; color: #333; padding: 10px 15px; border: 1px solid #ccc; border-radius: 4px; cursor: pointer;">No Thanks</button>
      </div>
      <div id="nps-message-area" style="margin-top: 15px; padding: 10px; border-radius: 4px; display: none; font-weight: bold;"></div>
    `;

    // Append inside chat window
    chatWindowElement.appendChild(npsModalElement);

    // Add event listeners (we'll define these functions later)
    setupNpsModalEventListeners();
  }

  function setupNpsModalEventListeners() {
    if (!npsModalElement) return;

    let selectedScore = -1;

    const scoreButtons = npsModalElement.querySelectorAll('.nps-score-btn');
    const submitButton = npsModalElement.querySelector('#nps-submit');
    const askLaterButton = npsModalElement.querySelector('#nps-ask-later');
    const noThanksButton = npsModalElement.querySelector('#nps-no-thanks');
    const feedbackInput = npsModalElement.querySelector('#nps-feedback');

    scoreButtons.forEach((button) => {
      button.addEventListener('click', () => {
        selectedScore = parseInt(button.dataset.score, 10);
        scoreButtons.forEach((btn) => {
          btn.style.backgroundColor = '#f9f9f9';
          btn.style.borderColor = '#ccc';
          btn.style.fontWeight = 'normal';
        });
        button.style.backgroundColor = '#e0e0e0';
        button.style.borderColor = '#aaa';
        button.style.fontWeight = 'bold';
        submitButton.style.opacity = '1';
        submitButton.style.pointerEvents = 'auto';
      });
    });

    submitButton.addEventListener('click', async () => {
      if (selectedScore >= 0) {
        await handleNpsSubmit(selectedScore, feedbackInput.value);
      }
    });

    askLaterButton.addEventListener('click', () => {
      handleNpsDismiss('later');
      hideNpsSurveyModal();
    });

    noThanksButton.addEventListener('click', () => {
      handleNpsDismiss('no_thanks');
      hideNpsSurveyModal();
    });
  }

  function showNpsSurveyModal() {
    if (npsModalElement) {
      // Reset state before showing
      const formContent = npsModalElement.querySelectorAll(
        'h3, p, #nps-score-options, #nps-feedback, #nps-buttons',
      );
      const scoreButtons = npsModalElement.querySelectorAll('.nps-score-btn');
      const submitButton = npsModalElement.querySelector('#nps-submit');
      const feedbackInput = npsModalElement.querySelector('#nps-feedback');
      const messageArea = npsModalElement.querySelector('#nps-message-area');

      // Ensure form content is visible and message area is hidden
      formContent.forEach((el) => (el.style.display = '')); // Reset display
      messageArea.style.display = 'none';
      messageArea.textContent = '';

      scoreButtons.forEach((btn) => {
        btn.style.backgroundColor = '#f9f9f9';
        btn.style.borderColor = '#ccc';
        btn.style.fontWeight = 'normal';
      });
      submitButton.style.opacity = '0.5';
      submitButton.style.pointerEvents = 'none';
      feedbackInput.value = '';

      npsModalElement.style.display = 'block';
    }
  }

  function hideNpsSurveyModal() {
    if (npsModalElement) {
      npsModalElement.style.display = 'none';
    }
  }

  // Placeholder functions for submit/dismiss actions (to be implemented later)
  async function handleNpsSubmit(score, feedback) {
    const timestamp = new Date().toISOString();
    const payload = {
      uuid: npsUserUuid,
      score: score,
      feedback: feedback || '', // Ensure feedback is at least an empty string
      additionalComments: '', // Add if needed later
      timestamp: timestamp,
    };

    const messageArea = npsModalElement?.querySelector('#nps-message-area');
    const formContent = npsModalElement?.querySelectorAll(
      'h3, p, #nps-score-options, #nps-feedback, #nps-buttons',
    );

    // Disable buttons during submission
    const buttons = npsModalElement?.querySelectorAll('button');
    if (buttons) buttons.forEach((btn) => (btn.disabled = true));

    try {
      // Ensure aichatbotData and vercelUrl are available
      if (!window.aichatbotData || !window.aichatbotData.vercelUrl) {
        throw new Error('Chatbot configuration (vercelUrl) is missing.');
      }
      // Construct the full API endpoint URL for NPS
      // Assumes NPS API route is at the same origin as the main chat URL
      let npsApiUrl;
      try {
        const baseUrl = new URL(window.aichatbotData.vercelUrl).origin;
        npsApiUrl = `${baseUrl}${API_PATHS.NPS}`;
      } catch (urlError) {
        console.error(
          'Invalid vercelUrl format:',
          window.aichatbotData.vercelUrl,
        );
        throw new Error('Could not construct API URL from configuration.');
      }

      const response = await window.aichatbotAuth.fetchWithAuth(
        npsApiUrl, // Use the constructed full URL for NPS submission
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({})); // Try to get JSON error
        throw new Error(
          `API Error (${response.status}): ${errorData.message || response.statusText}`,
        );
      }

      // Success: Update state and localStorage
      const now = Date.now();
      npsLastSurveyTimestamp = now;
      npsLastSurveyQueryCount = npsQueryCount; // Record count *at time of submission*
      setLocalStorageItem('npsLastSurveyTimestamp', npsLastSurveyTimestamp);
      setLocalStorageItem('npsLastSurveyQueryCount', npsLastSurveyQueryCount);
      // Set dismiss reason to 'submitted'
      npsDismissReason = 'submitted';
      setLocalStorageItem('npsDismissReason', npsDismissReason);

      // Show success message and hide form
      if (messageArea && formContent) {
        messageArea.textContent = 'Thank you for your feedback!';
        messageArea.style.backgroundColor = '#d4edda'; // Light green
        messageArea.style.color = '#155724'; // Dark green
        messageArea.style.display = 'block';
        formContent.forEach((el) => (el.style.display = 'none'));
        // Automatically hide modal after a delay
        setTimeout(() => {
          hideNpsSurveyModal();
          // Re-enable buttons when hiding
          if (buttons) buttons.forEach((btn) => (btn.disabled = false));
        }, 2500); // Hide after 2.5 seconds
      }
    } catch (error) {
      console.error('Error submitting NPS survey:', error);
      // Show error message
      if (messageArea) {
        // Check for the specific "one survey per month" rate limit error
        if (
          error.message &&
          error.message.includes('You can only submit one survey per month')
        ) {
          messageArea.textContent = 'You can only submit one survey per month.';

          // Treat this rate limit error as a completed survey for tracking purposes
          const now = Date.now();
          npsLastSurveyTimestamp = now;
          npsLastSurveyQueryCount = npsQueryCount;
          setLocalStorageItem('npsLastSurveyTimestamp', npsLastSurveyTimestamp);
          setLocalStorageItem(
            'npsLastSurveyQueryCount',
            npsLastSurveyQueryCount,
          );
          // Also mark as 'submitted' if rate limited
          npsDismissReason = 'submitted';
          setLocalStorageItem('npsDismissReason', npsDismissReason);
        } else {
          messageArea.textContent =
            'Error submitting survey. Please try again later.';
        }
        messageArea.style.backgroundColor = '#f8d7da'; // Light red
        messageArea.style.color = '#721c24'; // Dark red
        messageArea.style.display = 'block';

        // Add acknowledge button
        const acknowledgeButton = document.createElement('button');
        acknowledgeButton.textContent = 'OK';
        acknowledgeButton.style.marginTop = '10px';
        acknowledgeButton.style.padding = '5px 15px';
        acknowledgeButton.style.backgroundColor = '#f0f0f0';
        acknowledgeButton.style.border = '1px solid #ccc';
        acknowledgeButton.style.borderRadius = '4px';
        acknowledgeButton.style.cursor = 'pointer';

        // Add click handler to close modal when button is clicked
        acknowledgeButton.addEventListener('click', () => {
          hideNpsSurveyModal();
        });

        // Append button to message area
        messageArea.appendChild(document.createElement('br'));
        messageArea.appendChild(acknowledgeButton);
      }

      // Re-enable form buttons
      if (buttons) {
        buttons.forEach((btn) => {
          // Keep submit button disabled to prevent multiple submissions
          if (btn.id !== 'nps-submit') {
            btn.disabled = false;
          }
        });
      }
    }
  }

  function handleNpsDismiss(reason) {
    console.log(`NPS Dismissed: Reason=${reason}`);
    if (reason === 'later' || reason === 'no_thanks') {
      // Set timestamp to now for the 3-day cooldown start
      const now = Date.now();
      npsLastSurveyTimestamp = now;
      setLocalStorageItem('npsLastSurveyTimestamp', npsLastSurveyTimestamp);

      // Set the dismiss reason
      npsDismissReason = reason;
      setLocalStorageItem('npsDismissReason', npsDismissReason);

      // IMPORTANT: Do NOT update npsLastSurveyQueryCount here.
      // This ensures the 5-query threshold only applies after a 'submitted' event.
    }
    // Hide modal (already handled by listener calling this).
  }

  // --- NPS Survey Logic: Modal UI End ---

  // --- NPS Survey Logic: Modal Creation Call ---
  createNpsModalHtml();
  // --- NPS Survey Logic: Modal Creation Call End ---

  // Track votes
  let votes = {};

  // Add vote buttons to bot message
  function addVoteButtons(botMessage, messageId) {
    const voteButtons = document.createElement('div');
    voteButtons.className = 'aichatbot-vote-buttons';

    const upvoteButton = document.createElement('button');
    upvoteButton.className = 'aichatbot-vote-button';
    upvoteButton.innerHTML = '<i class="fas fa-thumbs-up"></i>';

    const downvoteButton = document.createElement('button');
    downvoteButton.className = 'aichatbot-vote-button';
    downvoteButton.innerHTML = '<i class="fas fa-thumbs-down"></i>';

    // Add event listeners
    upvoteButton.addEventListener('click', () => handleVote(messageId, true));
    downvoteButton.addEventListener('click', () =>
      handleVote(messageId, false),
    );

    voteButtons.appendChild(upvoteButton);
    voteButtons.appendChild(downvoteButton);
    botMessage.appendChild(voteButtons);

    // Update button states based on current vote
    updateVoteButtonStates(messageId, upvoteButton, downvoteButton);
  }

  // Handle voting
  async function handleVote(messageId, isUpvote) {
    try {
      const currentVote = votes[messageId] || 0;
      let newVote;
      let isUpvoteAction = false; // Flag to track if this is an upvote action

      if (isUpvote) {
        // Toggle between 1 and 0
        newVote = currentVote === 1 ? 0 : 1;
        isUpvoteAction = newVote === 1; // Only animate when voting *up*
      } else {
        if (currentVote === -1) {
          // If already downvoted, clear the vote
          newVote = 0;
        } else {
          // Show feedback modal for downvote
          showFeedbackModal(messageId);
          return; // Exit early, feedback modal handles the rest
        }
      }

      // Find the specific bot message UI element
      const botMessage = document.querySelector(`[data-doc-id="${messageId}"]`);
      const upvoteButton = botMessage?.querySelector(
        '.aichatbot-vote-button:first-child',
      );
      const downvoteButton = botMessage?.querySelector(
        '.aichatbot-vote-button:last-child',
      );

      // Make API call to record vote using the auth helper
      const response = await window.aichatbotAuth.fetchWithAuth(
        `${getBaseUrl()}${API_PATHS.VOTE}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            docId: messageId,
            vote: newVote,
          }),
        },
      );

      if (!response.ok) {
        throw new Error('Failed to record vote');
      }

      // Update local state
      votes[messageId] = newVote;

      // Update UI (button states)
      if (upvoteButton && downvoteButton) {
        updateVoteButtonStates(messageId, upvoteButton, downvoteButton);
      }

      // Trigger animation ONLY on successful upvote (transition to voted state)
      if (isUpvoteAction && upvoteButton) {
        upvoteButton.classList.add('upvote-success-animation');
        // Remove the class after the animation duration (500ms)
        setTimeout(() => {
          upvoteButton.classList.remove('upvote-success-animation');
        }, 500);
      }
    } catch (error) {
      console.error('Error handling vote:', error);
      // Show error message to user
      const errorMessage = document.createElement('div');
      errorMessage.className = 'aichatbot-error-message';
      errorMessage.textContent = 'Failed to record vote. Please try again.';
      messages.appendChild(errorMessage);
      setTimeout(() => {
        if (messages.contains(errorMessage)) {
          messages.removeChild(errorMessage);
        }
      }, 3000);
    }
  }

  // Update vote button states
  function updateVoteButtonStates(messageId, upvoteButton, downvoteButton) {
    const currentVote = votes[messageId] || 0;

    upvoteButton.classList.toggle('voted', currentVote === 1);
    downvoteButton.classList.toggle('downvoted', currentVote === -1);
  }

  // Show feedback modal
  function showFeedbackModal(messageId) {
    // Create modal if it doesn't exist
    let modal = document.querySelector('.aichatbot-feedback-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.className = 'aichatbot-feedback-modal';
      modal.innerHTML = `
        <div class="modal-content">
          <h3>Help us improve</h3>
          <form class="feedback-form">
            <div class="feedback-reason">
              <label>
                <input type="radio" name="reason" value="Incorrect Information">
                Incorrect Information
              </label>
              <label>
                <input type="radio" name="reason" value="Off-Topic Response">
                Off-Topic Response
              </label>
              <label>
                <input type="radio" name="reason" value="Bad Links">
                Bad Links
              </label>
              <label>
                <input type="radio" name="reason" value="Vague or Unhelpful">
                Vague or Unhelpful
              </label>
              <label>
                <input type="radio" name="reason" value="Technical Issue">
                Technical Issue
              </label>
              <label>
                <input type="radio" name="reason" value="Poor Style or Tone">
                Poor Style or Tone
              </label>
              <label>
                <input type="radio" name="reason" value="Other">
                Other
              </label>
            </div>
            <textarea placeholder="Additional comments (optional)"></textarea>
            <div class="error-message"></div>
            <div class="feedback-buttons">
              <button type="button" class="cancel-button">Cancel</button>
              <button type="submit" class="submit-button">Submit</button>
            </div>
          </form>
        </div>
      `;
      const chatWindowElement = document.getElementById('aichatbot-window');
      if (chatWindowElement) {
        chatWindowElement.appendChild(modal);
      } else {
        console.error(
          'Chat window element #aichatbot-window not found. Cannot append feedback modal.',
        );
        return;
      }

      // Add event listeners
      const form = modal.querySelector('.feedback-form');
      const cancelButton = modal.querySelector('.cancel-button');

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await submitFeedback(messageId, modal);
      });

      cancelButton.addEventListener('click', () => {
        modal.style.display = 'none';
      });
    }

    // Reset form
    const form = modal.querySelector('.feedback-form');
    form.reset();
    modal.querySelector('.error-message').style.display = 'none';

    // Show modal
    modal.style.display = 'flex';
  }

  // Submit feedback
  async function submitFeedback(messageId, modal) {
    const form = modal.querySelector('.feedback-form');
    const errorMessage = modal.querySelector('.error-message');
    const selectedReason = form.querySelector('input[name="reason"]:checked');
    const comment = form.querySelector('textarea').value.trim();
    const submitButton = form.querySelector('.submit-button');
    const cancelButton = form.querySelector('.cancel-button');
    const formElements = modal.querySelectorAll(
      '.feedback-reason, textarea, .feedback-buttons',
    );
    const modalTitle = modal.querySelector('h3'); // Get the title element

    // Disable buttons during submission
    submitButton.disabled = true;
    cancelButton.disabled = true;
    errorMessage.style.display = 'none'; // Clear previous error messages
    errorMessage.classList.remove('success'); // Ensure success class is removed initially

    try {
      if (!selectedReason) {
        throw new Error('Please select a reason for your feedback');
      }

      // Make API call to submit feedback using the auth helper
      const response = await window.aichatbotAuth.fetchWithAuth(
        `${getBaseUrl()}${API_PATHS.VOTE}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            docId: messageId,
            vote: -1, // Downvote
            reason: selectedReason.value,
            comment: comment,
          }),
        },
      );

      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => ({ message: 'Failed to submit feedback' }));
        throw new Error(errorData.message || 'Failed to submit feedback');
      }

      // Update local state
      votes[messageId] = -1;

      // Update UI (vote buttons)
      const botMessage = document.querySelector(`[data-doc-id="${messageId}"]`);
      if (botMessage) {
        const upvoteButton = botMessage.querySelector(
          '.aichatbot-vote-button:first-child',
        );
        const downvoteButton = botMessage.querySelector(
          '.aichatbot-vote-button:last-child',
        );
        updateVoteButtonStates(messageId, upvoteButton, downvoteButton);
      }

      // Show success message and hide form
      errorMessage.textContent = 'Thanks for your feedback!';
      errorMessage.classList.add('success');
      errorMessage.style.display = 'block';
      formElements.forEach((el) => (el.style.display = 'none'));
      if (modalTitle) modalTitle.style.display = 'none'; // Hide the title on success

      // Close modal automatically after 2 seconds
      setTimeout(() => {
        modal.style.display = 'none';
        // Reset modal for next use (show form, hide message, re-enable buttons)
        formElements.forEach((el) => (el.style.display = '')); // Use empty string to reset to default display
        errorMessage.style.display = 'none';
        errorMessage.classList.remove('success');
        if (modalTitle) modalTitle.style.display = ''; // Restore the title display
        submitButton.disabled = false;
        cancelButton.disabled = false;
      }, 2000);
    } catch (error) {
      console.error('Error submitting feedback:', error);
      errorMessage.textContent = error.message;
      errorMessage.classList.remove('success'); // Ensure no success style on error
      errorMessage.style.display = 'block';
      // Re-enable buttons on error
      if (modalTitle) modalTitle.style.display = ''; // Ensure title is visible on error too
      submitButton.disabled = false;
      cancelButton.disabled = false;
    }
  }

  // Modify the bot message creation to include vote buttons with the right ID
  function createBotMessage(message) {
    const botMessage = document.createElement('div');
    botMessage.className = 'aichatbot-bot-message';

    // We'll use a message-id attribute for local tracking
    const localMessageId = generateUUID();
    botMessage.setAttribute('data-message-id', localMessageId);

    // But we don't set data-doc-id yet - that will come from the server response
    // botMessage.setAttribute('data-doc-id', ''); // Don't set this yet

    const messageContent = document.createElement('div');
    messageContent.className = 'aichatbot-message-content';
    messageContent.innerHTML = renderMarkdown(message);

    botMessage.appendChild(messageContent);

    // Don't add vote buttons yet - wait for the actual docId from server
    // addVoteButtons(botMessage, messageId);

    return botMessage;
  }

  // Add global keyboard listeners
  document.addEventListener('keydown', (e) => {
    const target = e.target;
    const isInputFocused =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement;

    // Handle '/' key to open chat
    if (e.key === '/' && !isInputFocused) {
      if (chatWindow.style.display === 'none') {
        e.preventDefault(); // Prevent default browser behavior (e.g., quick find)
        bubble.click(); // Simulate clicking the bubble to open
      }
    }

    // Handle 'Escape' key to close chat
    if (e.key === 'Escape') {
      if (chatWindow.style.display === 'flex') {
        // Check if any modal is open within the chat window
        const feedbackModal = chatWindow.querySelector(
          '.aichatbot-feedback-modal',
        );
        const npsModal = chatWindow.querySelector('#nps-survey-modal');
        const languageModal = chatWindow.querySelector(
          '.aichatbot-language-modal',
        );

        // Close modals first if they are open
        if (feedbackModal && feedbackModal.style.display === 'flex') {
          feedbackModal.style.display = 'none';
        } else if (npsModal && npsModal.style.display === 'block') {
          hideNpsSurveyModal(); // Use existing function for NPS modal
        } else if (languageModal && languageModal.style.display === 'flex') {
          languageModal.style.display = 'none';
        } else {
          // If no modals are open, close the chat window
          document.getElementById('aichatbot-close').click(); // Simulate clicking the close button
        }
      }
    }
  });
});
