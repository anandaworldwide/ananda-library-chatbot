/**
 * SecureDataFetcher Component
 *
 * This component demonstrates the complete token-based security flow for API access.
 * It handles:
 * 1. Token acquisition through the proxy endpoint
 * 2. Secure API calls using the obtained token
 * 3. Data display and error handling
 *
 * The component implements a secure pattern where the frontend never has access
 * to the application secrets, only to short-lived JWT tokens that are obtained
 * through a secure server-side proxy.
 */

import React, { useState } from 'react';

/**
 * Interface for the secure data response from the API
 * This matches the structure returned by the /api/secure-data endpoint
 */
interface SecureData {
  message: string;
  client: string;
  timestamp: string;
  data: {
    items: Array<{
      id: number;
      name: string;
    }>;
  };
}

/**
 * A React component that demonstrates the secure token flow for API access
 * This component can be used as a reference implementation for other components
 * that need to access secure API endpoints.
 */
export const SecureDataFetcher = () => {
  // Component state
  const [loading, setLoading] = useState(false); // Track loading state
  const [error, setError] = useState<string | null>(null); // Store error messages
  const [data, setData] = useState<SecureData | null>(null); // Store API response
  const [token, setToken] = useState<string | null>(null); // Store the current token

  /**
   * Fetches a JWT token from the proxy endpoint
   *
   * This function:
   * 1. Makes a request to the token proxy endpoint
   * 2. Handles success by storing the token
   * 3. Handles errors with appropriate error messages
   *
   * The proxy endpoint handles the actual authentication with the backend
   * using server-side secrets that are never exposed to the client.
   *
   * @returns The JWT token string or null if an error occurred
   */
  const fetchToken = async () => {
    setLoading(true);
    setError(null);
    try {
      // Request a token from the proxy endpoint
      const response = await fetch('/api/proxy-token');
      const data = await response.json();

      // Handle unsuccessful responses
      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch token');
      }

      // Store and return the token on success
      setToken(data.token);
      return data.token;
    } catch (err) {
      // Handle and display any errors
      const message = err instanceof Error ? err.message : 'An error occurred';
      setError(`Token error: ${message}`);
      return null;
    } finally {
      setLoading(false);
    }
  };

  /**
   * Fetches data from a secure API endpoint using the JWT token
   *
   * This function:
   * 1. Makes an authenticated request to the secure endpoint
   * 2. Includes the JWT token in the Authorization header
   * 3. Handles the response and any errors
   *
   * @param token The JWT token to use for authentication
   */
  const fetchSecureData = async (token: string) => {
    setLoading(true);
    setError(null);

    try {
      // Make the authenticated request with the token
      const response = await fetch('/api/secure-data', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json();

      // Handle unsuccessful responses
      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch secure data');
      }

      // Store the successful response data
      setData(data);
    } catch (err) {
      // Handle and display any errors
      const message = err instanceof Error ? err.message : 'An error occurred';
      setError(`Data fetch error: ${message}`);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Handles the complete secure data flow:
   * 1. Get a token from the proxy endpoint
   * 2. Use the token to fetch secure data
   *
   * This combined function simplifies the component interface
   * and enforces the correct sequence of operations.
   */
  const handleFetchData = async () => {
    const newToken = await fetchToken();
    if (newToken) {
      await fetchSecureData(newToken);
    }
  };

  // Render the UI with token display, data display, and error handling
  return (
    <div className="p-4 max-w-md mx-auto bg-white rounded shadow">
      <h2 className="text-xl font-bold mb-4">Secure API Access Demo</h2>

      {/* Fetch button with loading state */}
      <button
        onClick={handleFetchData}
        disabled={loading}
        className="bg-blue-500 hover:bg-blue-600 text-white py-2 px-4 rounded mb-4 disabled:opacity-50"
      >
        {loading ? 'Loading...' : 'Fetch Secure Data'}
      </button>

      {/* Display the current token if available */}
      {token && (
        <div className="mb-4">
          <h3 className="text-md font-semibold">Current Token:</h3>
          <div className="bg-gray-100 p-2 rounded text-xs break-all">
            {token}
          </div>
        </div>
      )}

      {/* Display any errors */}
      {error && (
        <div className="mb-4 p-2 bg-red-100 text-red-700 rounded">{error}</div>
      )}

      {/* Display the secure data if available */}
      {data && (
        <div>
          <h3 className="text-md font-semibold mb-2">Secure Data:</h3>
          <div className="bg-gray-100 p-2 rounded">
            <p>
              <span className="font-semibold">Message:</span> {data.message}
            </p>
            <p>
              <span className="font-semibold">Client:</span> {data.client}
            </p>
            <p>
              <span className="font-semibold">Timestamp:</span> {data.timestamp}
            </p>

            <h4 className="font-semibold mt-2">Items:</h4>
            <ul className="list-disc pl-5">
              {data.data.items.map((item) => (
                <li key={item.id}>{item.name}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};
