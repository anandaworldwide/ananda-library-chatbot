/**
 * Ananda AI Chatbot - Authentication Utilities
 *
 * This script provides JWT token management for the WordPress plugin frontend.
 * It handles:
 * - Token acquisition from the WordPress backend
 * - Token caching and refresh
 * - Helper functions for making authenticated API calls
 *
 * DEVELOPER NOTE:
 * This file includes testing utilities that are only active in development:
 * 1. The 'forceSessionExpired()' method for simulating auth errors
 * 2. A test button that appears when '?test=true' is added to the URL
 * These features help with debugging session expiration handling and should
 * remain in the codebase for future testing purposes.
 */

// Store token and expiration in memory (not localStorage for security)
let tokenData = null;

// Buffer time before expiration to refresh token (30 seconds)
const EXPIRATION_BUFFER = 30 * 1000;

/**
 * Parse a JWT token to extract the expiration time
 *
 * @param {string} token - The JWT token to parse
 * @returns {number} - Token expiration time in milliseconds
 */
function parseJwtExpiration(token) {
  try {
    // Extract payload from JWT (second part between dots)
    const payload = token.split('.')[1];
    // Decode base64
    const decoded = JSON.parse(atob(payload));
    // Get expiration timestamp in milliseconds
    return decoded.exp * 1000;
  } catch (error) {
    console.error('Error parsing JWT token:', error);
    // Default to 15 minutes from now if parsing fails
    return Date.now() + 15 * 60 * 1000;
  }
}

/**
 * Check if the current token is valid and not near expiration
 *
 * @returns {boolean} - True if token is valid and not near expiration
 */
function isTokenValid() {
  if (!tokenData) return false;
  return tokenData.expiresAt > Date.now() + EXPIRATION_BUFFER;
}

/**
 * Fetch a new token from the WordPress backend
 *
 * @returns {Promise<string>} - JWT token
 */
async function fetchNewToken() {
  // Check if aichatbotData exists, if not, handle the error gracefully
  if (typeof aichatbotData === 'undefined' || !aichatbotData.ajaxUrl) {
    console.error(
      'Error: aichatbotData is not defined. WordPress may not have loaded the data correctly.',
    );
    throw new Error('Configuration error: Missing WordPress data');
  }

  // We'll use wp_ajax to get a token from the WordPress backend
  const tokenUrl = aichatbotData.ajaxUrl + '?action=aichatbot_get_token';

  try {
    console.log('Fetching token from WordPress backend: ' + tokenUrl);

    const response = await fetch(tokenUrl, {
      method: 'GET',
      credentials: 'same-origin', // Include cookies for WordPress nonce validation
    });

    console.log('Token response status:', response.status);

    if (!response.ok) {
      throw new Error(`Failed to fetch token: HTTP ${response.status}`);
    }

    // Get the raw text first to check for issues
    const rawText = await response.text();

    // Debug: Log a snippet of the raw text to see what's coming back
    console.log(
      'Raw response text (first 100 chars):',
      rawText.length > 100 ? rawText.substring(0, 100) + '...' : rawText,
    );

    // Check for HTTP Basic Auth error
    if (
      rawText.includes('permission to access this page') ||
      rawText.includes('HTTP authentication') ||
      rawText.includes('Authorization Required')
    ) {
      console.error('HTTP Basic Authentication error detected');
      throw new Error('SESSION_EXPIRED');
    }

    // Check if the response looks like valid JSON
    let data;
    try {
      data = JSON.parse(rawText);
    } catch (jsonError) {
      console.error('Failed to parse JSON response:', jsonError);
      console.error('Raw response:', rawText);
      throw new Error(
        'Invalid JSON in response. Check WordPress PHP errors or warnings that might be included in the output.',
      );
    }

    console.log('Token response data received:', JSON.stringify(data));

    // WordPress's wp_send_json_success wraps the data in a 'data' property
    // and sets 'success' to true
    if (!data.success) {
      // Extract detailed error information if available
      const errorMessage = data.data?.message || 'Unknown error';
      const errorCode = data.data?.code || 'unknown_error';
      const errorDetails = data.data?.details || '';

      console.error(
        `WordPress token API error (${errorCode}): ${errorMessage}`,
        errorDetails ? `\nDetails: ${errorDetails}` : '',
      );

      // Format a user-friendly error message based on error code
      let userMessage = errorMessage;

      if (errorCode === 'site_mismatch') {
        userMessage = `Site mismatch: ${errorMessage}. Check the Expected Site ID in plugin settings.`;
      } else if (errorCode === 'token_fetch_failed') {
        userMessage = `Backend connection failed: ${errorMessage}. Verify API URL and security settings.`;
      } else if (errorCode === 'configuration_error') {
        userMessage = `Configuration error: ${errorMessage}`;
      } else if (errorCode === 'internal_error') {
        userMessage = `Internal error: ${errorMessage}`;
      }

      throw new Error(userMessage);
    }

    // Access the token from the 'data' property where WordPress puts it
    if (!data.data || !data.data.token) {
      console.error(
        'WordPress token API returned invalid data structure:',
        JSON.stringify(data),
      );
      throw new Error('Invalid token response: Missing token in API response');
    }

    const token = data.data.token;

    // Validate token format (should be JWT with 3 parts)
    if (!token || token.split('.').length !== 3) {
      console.error('WordPress token API returned malformed token:', token);
      throw new Error('Invalid token format received from server');
    }

    // Store token with expiration time
    tokenData = {
      token,
      expiresAt: parseJwtExpiration(token),
    };

    console.log('Token successfully retrieved and stored');
    return token;
  } catch (error) {
    // Add more context to the error message
    console.error('Token fetch error:', error);

    // Special handling for session expiration
    if (error.message === 'SESSION_EXPIRED') {
      throw new Error(
        'Your session has expired. Please reload the page to continue.',
      );
    }

    // Provide user-friendly error messages based on common error patterns
    let userFriendlyError = error;

    if (error.message.includes('Failed to fetch')) {
      userFriendlyError = new Error(
        'Network error: Unable to connect to WordPress backend. Check your internet connection.',
      );
    } else if (error.message.includes('HTTP 403')) {
      userFriendlyError = new Error(
        'Access denied: The server rejected the request. Check your WordPress API URL and security settings.',
      );
    } else if (error.message.includes('HTTP 404')) {
      userFriendlyError = new Error(
        'API not found: The token endpoint URL is incorrect or not accessible.',
      );
    } else if (error.message.includes('HTTP 500')) {
      userFriendlyError = new Error(
        'Server error: The WordPress backend encountered an internal error. Check your server logs.',
      );
    } else if (error.message.includes('Invalid JSON')) {
      userFriendlyError = new Error(
        'Invalid response: The server returned malformed data. Check for PHP errors or warnings in your WordPress installation.',
      );
    }

    // Preserve original error but with improved message
    throw userFriendlyError;
  }
}

/**
 * Get a valid token, fetching a new one if necessary
 *
 * @returns {Promise<string>} - Valid JWT token
 */
async function getToken() {
  if (isTokenValid()) {
    return tokenData.token;
  }

  return fetchNewToken();
}

/**
 * Make a fetch request with authorization header
 *
 * @param {string} url - URL to fetch
 * @param {Object} options - Fetch options
 * @returns {Promise<Response>} - Fetch response
 */
async function fetchWithAuth(url, options = {}) {
  const token = await getToken();

  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${token}`,
    },
  });
}

// Export to global scope for WordPress frontend
// Make sure this runs immediately and doesn't depend on DOM content loaded
window.aichatbotAuth = {
  getToken,
  fetchWithAuth,
  // For testing: Force session to expire
  forceSessionExpired: function () {
    // Create and throw the same error that would happen with a real HTTP auth expiration
    throw new Error(
      'Your session has expired. Please reload the page to continue.',
    );
  },
};

// Add a safety check that runs when the page loads
(function () {
  // This runs immediately when the script loads
  if (!window.aichatbotAuth) {
    console.error('Error: aichatbotAuth failed to initialize properly');
  } else {
    console.log('aichatbotAuth initialized successfully');

    // For developers: Add test button if URL has test=true
    if (window.location.search.includes('test=true')) {
      setTimeout(() => {
        const testButton = document.createElement('button');
        testButton.textContent = 'Test Session Expiration';
        testButton.style.position = 'fixed';
        testButton.style.bottom = '120px';
        testButton.style.right = '20px';
        testButton.style.zIndex = '9999';
        testButton.style.padding = '10px';
        testButton.style.backgroundColor = '#ff6b6b';
        testButton.style.color = 'white';
        testButton.style.border = 'none';
        testButton.style.borderRadius = '4px';
        testButton.style.cursor = 'pointer';

        testButton.addEventListener('click', () => {
          try {
            window.aichatbotAuth.forceSessionExpired();
          } catch (error) {
            // In a real scenario, this error would be caught by the chatbot.js error handler
            // So let's simulate that happening
            const messages = document.getElementById('aichatbot-messages');
            if (messages) {
              const errorMessage = document.createElement('div');
              errorMessage.className = 'aichatbot-error-message';
              errorMessage.innerHTML = `
                <strong>Session Expired:</strong> Your authentication has expired.<br>
                <small>Please reload the page to continue using the chatbot.</small><br>
                <button id="aichatbot-reload-button" style="margin-top: 10px; padding: 5px 10px; background-color: #4a90e2; color: white; border: none; border-radius: 4px; cursor: pointer;">Reload Page</button>
              `;
              messages.appendChild(errorMessage);

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
            }
          }
        });

        document.body.appendChild(testButton);
      }, 1000);
    }
  }
})();
