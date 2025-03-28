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
  // Get DOM elements
  const bubble = document.getElementById('aichatbot-bubble');
  const chatWindow = document.getElementById('aichatbot-window');
  const input = document.getElementById('aichatbot-input');
  const sendButton = document.getElementById('aichatbot-send');
  const messages = document.getElementById('aichatbot-messages');

  // Create controls container (to hold both buttons)
  const controlsContainer = document.createElement('div');
  controlsContainer.id = 'aichatbot-controls';
  chatWindow.appendChild(controlsContainer);

  // Add full page chat button
  const fullPageButton = document.createElement('div');
  fullPageButton.id = 'aichatbot-fullpage';
  fullPageButton.innerHTML = `<i class="fas fa-expand-alt"></i> Open full page chat`;

  // Add header with close button to the chat window
  const header = document.createElement('div');
  header.id = 'aichatbot-header';
  header.innerHTML = `
    <h3>Ananda Assist</h3>
    <span id="aichatbot-close"><i class="fas fa-chevron-down"></i></span>
  `;
  chatWindow.insertBefore(header, chatWindow.firstChild);

  // Initialize chat history
  let chatHistory = [];
  let isStreaming = false;
  let currentAbortController = null;

  // Default collection and settings
  const defaultCollection = 'whole_library';
  const privateSession = false;
  const mediaTypes = { text: true, audio: false, youtube: false };
  const sourceCount = 6;

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
  let intercomEnabled = false;

  if (typeof aichatbotData !== 'undefined') {
    intercomEnabled = aichatbotData.enableIntercom === '1';

    // Hide Intercom widget initially if integration is enabled
    if (intercomEnabled && typeof window.Intercom !== 'undefined') {
      // Add a class to the body for CSS targeting when Intercom is active
      document.body.classList.add('intercom-enabled');

      // Hide Intercom widget when page loads
      const style = document.createElement('style');
      style.id = 'aichatbot-intercom-style';
      style.innerHTML = `
        #intercom-container {
          display: none !important;
        }
      `;
      document.head.appendChild(style);
    }
  }

  // Function to show Intercom and hide chatbot
  function showIntercom() {
    if (intercomEnabled && typeof window.Intercom !== 'undefined') {
      // Remove the CSS that hides Intercom
      const intercomStyle = document.getElementById('aichatbot-intercom-style');
      if (intercomStyle) {
        intercomStyle.remove();
      }

      // Hide chatbot window
      chatWindow.style.display = 'none';

      // Show Intercom - use the proper method to both show and open the messenger
      try {
        // First try the boot method which is more reliable
        window.Intercom('boot', {
          app_id: window.intercomSettings?.app_id,
          // Open the messenger immediately
          hide_default_launcher: false,
        });

        // Then explicitly show and open the messenger
        window.Intercom('show');
        window.Intercom('showNewMessage');

        console.log('Intercom triggered successfully');
        return true;
      } catch (e) {
        console.error('Error showing Intercom:', e);
        return false;
      }
    }
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

  // Simple markdown parser function
  function renderMarkdown(text) {
    if (!text) return '';

    // Pre-process: Convert double line breaks to paragraph markers without adding extra newlines
    text = text.replace(/\n\s*\n/g, '<p-break>');

    // Handle Intercom links if integration is enabled - BEFORE other link processing
    if (intercomEnabled) {
      // Look for markdown links with GETHUMAN as the URL: [any text](GETHUMAN)
      text = text.replace(
        /\[(.*?)\]\(GETHUMAN\)/g,
        '<span class="aichatbot-intercom-trigger" style="color:#4a90e2; text-decoration:underline; cursor:pointer;">$1</span>',
      );
    }

    // Handle basic markdown
    return (
      text
        // Headers: # Header 1, ## Header 2, etc.
        .replace(/^### (.*$)/gim, '<h3>$1</h3>')
        .replace(/^## (.*$)/gim, '<h2>$1</h2>')
        .replace(/^# (.*$)/gim, '<h1>$1</h1>')

        // Bold: **text** or __text__
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/__(.*?)__/g, '<strong>$1</strong>')

        // Italic: *text* or _text_
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/_(.*?)_/g, '<em>$1</em>')

        // Links: [title](url)
        .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank">$1</a>')

        // Lists: - item or * item
        .replace(/^\s*-\s*(.*$)/gim, '<ul><li>$1</li></ul>')
        .replace(/^\s*\*\s*(.*$)/gim, '<ul><li>$1</li></ul>')

        // Numbered lists: 1. item
        .replace(/^\s*\d+\.\s*(.*$)/gim, '<ol><li>$1</li></ol>')

        // Blockquotes: > text
        .replace(/^\s*>\s*(.*$)/gim, '<blockquote>$1</blockquote>')

        // Code blocks
        .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')

        // Inline code: `code`
        .replace(/`(.*?)`/g, '<code>$1</code>')

        // Line breaks (but not before or after paragraph breaks)
        .replace(/\n(?!<p-break>|<\/?(ul|ol|li|h|p|bl|code|table))/gm, '<br />')
        .replace(/<br \/>(<p-break>)/g, '$1')
        .replace(/(<p-break>)<br \/>/g, '$1')

        // Merge adjacent list items
        .replace(/<\/ul>\s*<ul>/g, '')
        .replace(/<\/ol>\s*<ol>/g, '')

        // Fix extra breaks in lists
        .replace(/<\/li><br \/><li>/g, '</li><li>')

        // Post-process: Convert paragraph markers to actual paragraphs with moderate margin
        // and ensure no extra BR tags are around paragraph breaks
        .replace(/<br \/>*<p-break>/g, '<p-break>')
        .replace(/<p-break><br \/>*/g, '<p-break>')
        .replace(/<p-break>/g, '</p><p>')

        // Wrap content in paragraph tags if not already wrapped
        .replace(/^(.+?)(?=<p|$)/s, '<p>$1</p>')
    );
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
    currentBotMessage = document.createElement('div');
    currentBotMessage.className = 'aichatbot-bot-message';

    // Add message content directly (no sources info)
    const messageContent = document.createElement('div');
    messageContent.className = 'aichatbot-message-content';
    // Ensure font size is properly applied
    const fontSize =
      typeof aichatbotData !== 'undefined' && aichatbotData.fontSizePx
        ? aichatbotData.fontSizePx + 'px'
        : '16px';
    messageContent.style.cssText = `font-size: ${fontSize} !important; line-height: 1.5;`;
    currentBotMessage.appendChild(messageContent);
    // We'll add the bot message to the DOM only when content starts streaming

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

    // Set streaming flag to true
    isStreaming = true;

    // Update clear history button state
    updateClearHistoryButton();

    try {
      // Create new abort controller
      currentAbortController = new AbortController();

      // Update chat history with user message (empty bot response for now)
      chatHistory.push([message, '']);
      // Save state after adding user message
      saveChatState();
      // Update clear history button visibility
      updateClearHistoryButton();

      // Send to Vercel with streaming support
      const response = await window.aichatbotAuth.fetchWithAuth(
        aichatbotData.vercelUrl,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question: message,
            history: chatHistory
              .map(([userMsg, botMsg]) => [
                { role: 'user', content: userMsg },
                { role: 'assistant', content: botMsg },
              ])
              .flat(), // Convert to role-based format for API compatibility
            collection: defaultCollection,
            privateSession: privateSession,
            mediaTypes: mediaTypes,
            sourceCount: sourceCount,
          }),
          signal: currentAbortController.signal,
        },
      );

      // Don't remove typing indicator yet - keep it until we get actual content

      if (!response.ok) {
        // Try to get the error payload from the response
        let errorPayload = '';
        try {
          const errorData = await response.json();
          errorPayload = errorData.error || JSON.stringify(errorData);
        } catch (error) {
          console.error('Error parsing error response:', error);
          errorPayload = `Status: ${response.status}`;
        }
        throw new Error(`Server error (${errorPayload})`);
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
              } catch (parseError) {
                console.error('Error parsing JSON:', parseError);
              }
            }
          }

          // Scroll to bottom with each update
          messages.scrollTop = messages.scrollHeight;
        }
      } else {
        // Fallback for non-streaming responses
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

      messages.scrollTop = messages.scrollHeight;
    }
  }

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
  });

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
            const botMessage = document.createElement('div');
            botMessage.className = 'aichatbot-bot-message';

            const messageContent = document.createElement('div');
            messageContent.className = 'aichatbot-message-content';
            messageContent.innerHTML = renderMarkdown(botMsg);

            botMessage.appendChild(messageContent);
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
      messageContent.innerHTML = '<p>Hi! Ask me anything.</p>';

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
});
