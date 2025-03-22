/**
 * Ananda AI Chatbot - Authentication Utilities
 *
 * This script provides JWT token management for the WordPress plugin frontend.
 * It handles:
 * - Token acquisition from the WordPress backend
 * - Token caching and refresh
 * - Helper functions for making authenticated API calls
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

    const data = await response.json();
    console.log('Token response data received:', JSON.stringify(data));

    // WordPress's wp_send_json_success wraps the data in a 'data' property
    // and sets 'success' to true
    if (!data.success) {
      console.error(
        'WordPress token API returned an error:',
        data.message || 'Unknown error',
      );
      throw new Error(
        data.message || 'Invalid token response: API reported failure',
      );
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
    console.error('Token fetch error:', error);
    throw error;
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
};

// Add a safety check that runs when the page loads
(function () {
  // This runs immediately when the script loads
  if (!window.aichatbotAuth) {
    console.error('Error: aichatbotAuth failed to initialize properly');
  } else {
    console.log('aichatbotAuth initialized successfully');
  }
})();
