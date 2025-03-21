/**
 * Secure API Integration Demo Page
 *
 * This page provides a complete demonstration of the token-based security system
 * for API access. It serves both as a functional demo and as educational content
 * for developers to understand the security architecture.
 *
 * The page includes:
 * 1. An interactive demo component to test the token flow
 * 2. Explanatory content describing how the security system works
 * 3. Visual representation of the data flow between components
 *
 * This implementation follows security best practices by keeping secrets on the server
 * while allowing secure client communication through short-lived JWT tokens.
 */

import React from 'react';
import { GetServerSideProps } from 'next';
import { SecureDataFetcher } from '@/components/SecureDataFetcher';

/**
 * API Demo Page Component
 *
 * Main component for the secure API demonstration page. Provides both the
 * interactive demo and explanatory content about the security architecture.
 */
const ApiDemoPage = () => {
  return (
    <div className="container mx-auto py-10 px-4">
      {/* Page header with title and description */}
      <header className="mb-8 text-center">
        <h1 className="text-3xl font-bold mb-4">Secure API Integration Demo</h1>
        <p className="max-w-2xl mx-auto text-gray-600">
          This demo shows how to securely communicate between the Next.js
          frontend and the backend using token-based authentication. The secure
          token flow prevents unauthorized access to your API endpoints.
        </p>
      </header>

      {/* Interactive demo component */}
      <div className="border-t border-gray-200 pt-8">
        <SecureDataFetcher />
      </div>

      {/* Explanatory section detailing the security architecture */}
      <div className="mt-12 max-w-3xl mx-auto bg-gray-50 p-6 rounded-lg">
        <h2 className="text-xl font-semibold mb-4">How It Works</h2>
        <ol className="list-decimal pl-5 space-y-2">
          <li>
            <strong>Token Request</strong>: The frontend calls{' '}
            <code>/api/web-token</code>, which internally uses a secure shared
            secret to request a token from <code>/api/get-token</code>.
          </li>
          <li>
            <strong>Token Generation</strong>: The server verifies the shared
            secret and generates a JWT token with a short expiration time (15
            minutes).
          </li>
          <li>
            <strong>Secure API Call</strong>: The frontend uses the token in the
            Authorization header to call the protected{' '}
            <code>/api/secure-data</code> endpoint.
          </li>
          <li>
            <strong>Token Verification</strong>: The secure endpoint verifies
            the token&apos;s signature and expiration before providing access to
            the protected data.
          </li>
        </ol>
      </div>
    </div>
  );
};

/**
 * Server-side props function
 *
 * While this demo doesn't require server-side data, this function could be extended
 * to perform server-side validation or preparation as needed. For example, checking
 * user authentication status or prefetching data.
 */
export const getServerSideProps: GetServerSideProps = async () => {
  // You could do server-side validation or preparation here
  return {
    props: {},
  };
};

export default ApiDemoPage;
