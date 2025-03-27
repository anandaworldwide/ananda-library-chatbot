# Token-Based Security System

This document outlines the implementation of the token-based security system for the Vercel backend and WordPress plugin
integration.

## Overview

The system uses JSON Web Tokens (JWT) to secure API communication between:

1. The web frontend and backend API
2. The WordPress plugin and backend API

## Key Components

### Vercel Backend

- **Token Issuance Endpoint** (`/api/get-token`): Verifies shared secrets and issues JWT tokens
- **Web Token Endpoint** (`/api/web-token`): Securely generates tokens for web frontend
- **Protected API Endpoint** (`/api/secure-data`): Example endpoint that requires JWT authentication
- **JWT Utilities** (`utils/server/jwtUtils.ts`): Helper functions for token verification

### Web Frontend

- **SecureDataFetcher Component**: React component demonstrating the secure API flow
- **API Demo Page**: Example page that showcases the secure token-based API integration
- **Token Manager** (`utils/client/tokenManager.ts`): Utility for obtaining and managing JWT tokens in the frontend

### WordPress Plugin

- **Secure API Client** (`secure-api-client.php`): Handles token-based authentication for WordPress
- **Secure API Test Page**: Admin interface for testing the secure API connection
- **Site ID Validation**: Prevents accidental connections to wrong backend environments

## Authentication Types

The system supports two types of authentication which can be used independently or together:

1. **JWT Token Authentication**

   - **REQUIRED for ALL frontend-to-backend API calls without exception**
   - This includes login, logout, and all other API endpoints
   - Ensures only our frontend can access our backend APIs
   - JWT tokens are short-lived (15 minutes) and signed with the SECURE_TOKEN

2. **siteAuth Cookie Authentication**
   - Required only for logged-in user features
   - Managed by the login/logout system
   - Not required for public endpoints that still need frontend-to-backend security

### Public JWT-Only Endpoints

Some endpoints require JWT authentication but not siteAuth cookies, such as:

- `/api/audio/[filename]`: Allows audio playback for non-logged-in users
- `/api/contact`: Allows contact form submissions from non-logged-in users
- `/api/answers/[id]`: Allows access to publicly shared answers
- `/api/login`: Handles user authentication (still requires JWT for frontend verification)
- `/api/logout`: Handles user logout (still requires JWT for frontend verification)

These endpoints use the `withJwtOnlyAuth` middleware which:

- Enforces JWT authentication for frontend-to-backend security
- Does not require the siteAuth cookie
- Applies common security checks (CSRF, rate limiting, etc.)

## Best Practices for JWT Implementation

### Frontend Implementation

- **Always use JWT tokens**: All API calls from the frontend to backend must include a valid JWT token in
  the Authorization header
- **Use helper functions**: Prefer using the helper functions (`fetchWithAuth`, `withAuth`, `queryFetch`)
  over manually adding tokens
- **Avoid duplication**: Don't duplicate token fetching and header construction logic across the codebase
- **Consistent approach**: Use the provided utilities in `tokenManager.ts` and `reactQueryConfig.ts`
- **Handle token errors**: Let the helper functions handle token failures and retries

### Correct Usage Examples

```typescript
// Example 1: PREFERRED - Using fetchWithAuth (simplest approach)
import { fetchWithAuth } from '@/utils/client/tokenManager';

async function makeApiCall() {
  const response = await fetchWithAuth('/api/endpoint', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ data: 'example' }),
  });
}

// Example 2: Using withAuth helper for custom fetch scenarios
import { withAuth } from '@/utils/client/tokenManager';

async function makeCustomApiCall() {
  const options = await withAuth({
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  });
  const response = await fetch('/api/endpoint', options);
}

// Example 3: Using queryFetch for React Query
import { queryFetch } from '@/utils/client/reactQueryConfig';

async function makeQueryApiCall() {
  const response = await queryFetch('/api/endpoint', {
    method: 'POST',
    body: JSON.stringify({ data: 'example' }),
  });
}

// Example 4: NOT RECOMMENDED - Manual token handling
import { getToken } from '@/utils/client/tokenManager';

async function manualTokenHandling() {
  // Avoid this approach - it duplicates logic and is error-prone
  const token = await getToken();
  const response = await fetch('/api/endpoint', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}
```

## Configuration

### Environment Variables

The system reuses existing environment variables:

- `SECURE_TOKEN`: Used for JWT signing and web frontend authentication
- `SECURE_TOKEN_HASH`: Used to validate token integrity

No new variables are required, which simplifies security management.

### WordPress Integration

For WordPress integration, you have two options in wp-config.php:

1. Direct secret (less secure):

   ```php
   define('WP_API_SECRET', 'your-secret-here');
   ```

2. Using Vercel token (recommended):

   ```php
   define('CHATBOT_BACKEND_SECURE_TOKEN', 'your-secure-token-value');
   ```

Option 2 is recommended as it automatically derives the WordPress token from the same SECURE_TOKEN used in the Vercel backend.

### Site ID Validation

The system includes site ID validation to prevent accidental connections to the wrong backend environment:

1. **WordPress Plugin Configuration**:

   - Each WordPress installation specifies an expected site ID (defaults to "ananda-public")
   - This is configurable in the plugin settings page
   - The setting is stored in WordPress options as `aichatbot_expected_site_id`

2. **Token Request Process**:

   - The WordPress plugin sends the expected site ID with each token request
   - The backend checks if this ID matches its actual SITE_ID environment variable
   - If there's a mismatch, the backend returns a clear error message

3. **Error Handling**:
   - Site mismatch errors include specific information about which site was expected vs. actual
   - The WordPress admin interface shows a user-friendly error with instructions on how to fix it

This feature prevents common development errors when multiple environments exist (staging, production, etc.)
and helps users quickly identify and fix configuration issues.

### Setup Instructions

1. **Vercel Project**:

   - Ensure SECURE_TOKEN and SECURE_TOKEN_HASH are set in your environment variables
   - Set the SITE_ID environment variable to uniquely identify your site/environment
   - No additional environment variables needed

2. **WordPress Plugin**:
   - Add `define('CHATBOT_BACKEND_SECURE_TOKEN', 'your-secure-token-value');` to `wp-config.php`
   - The value should match the SECURE_TOKEN in your Vercel project
   - Configure the Expected Site ID in the plugin settings to match your target environment
   - Activate the plugin in WordPress admin

## Security Considerations

- Uses the same SECURE_TOKEN already proven secure in your login system
- JWT tokens are set to expire after 15 minutes
- For WordPress integration, a derived token is created using a WordPress-specific salt
- Communication happens over HTTPS

## API Flow

1. Client requests a token from the server with the appropriate secret
2. Server validates the secret and issues a short-lived JWT
3. Client includes the JWT in the Authorization header for API requests
4. Server verifies the JWT before processing protected API requests

### WordPress Authentication Flow

1. WordPress plugin reads the configured `aichatbot_expected_site_id` and `ANANDA_WP_API_SECRET`
2. Plugin sends both values to the `/api/get-token` endpoint on the configured Vercel backend
3. Backend validates:
   - That the site ID matches its own SITE_ID environment variable
   - That the secret matches either the direct SECURE_TOKEN or the WordPress-specific derived token
4. If validation passes, a JWT token is issued; otherwise, an appropriate error is returned
5. The plugin uses the JWT token for subsequent API calls until it expires

### Special Case: Public JWT-Only Endpoints

For public endpoints that need API security but not user login:

1. Client requests a token from `/api/web-token` with the appropriate referer header
2. Server identifies the request is for a public endpoint and issues a JWT without checking siteAuth
3. Client includes the JWT in API requests to the public endpoint
4. Server verifies the JWT using the `withJwtOnlyAuth` middleware

## Testing

- Use the WordPress admin "Secure API Test" page to test the WordPress integration
- Visit the `/api-demo` page to test the web frontend integration

## JWT Authentication Implementation

This project implements JWT authentication for secure API access. This document outlines the key components
and patterns used.

### Core Components

#### Server-Side

- **JWT Middleware**: `/utils/server/jwtUtils.ts` provides the `withJwtAuth` HOC to secure API endpoints.
- **JWT-Only Middleware**: `/utils/server/apiMiddleware.ts` provides the `withJwtOnlyAuth` HOC for public endpoints.
- **Secured Endpoints**: All API endpoints in `/pages/api/` are protected with appropriate JWT authentication.

#### Client-Side

- **Token Manager**: `/utils/client/tokenManager.ts` manages JWT token lifecycle and includes them in requests.
- **React Query Configuration**: `/utils/client/reactQueryConfig.ts` includes JWT handling for all API requests.
- **Auth Hooks**:
  - `useAnswers`: Fetches paginated answers with authentication
  - `useLike`: Manages liking answers
  - `useVote`: Handles voting on messages

### How It Works

1. **Authentication Flow**:

   - JWTs are issued upon login/authentication or for public endpoint access
   - Tokens are stored securely in memory and included with each API request
   - Protected API routes validate tokens before processing requests

2. **Data Fetching Pattern**:

   - React Query handles all data fetching, caching, and error handling
   - The custom `queryFetch` function automatically adds authentication headers
   - Hooks provide a clean API for components

3. **Error Handling**:
   - Auth errors (401/403) are caught and handled appropriately
   - The system provides feedback for authentication failures

### Using the Auth System

#### Securing API Routes

For routes that require both JWT and siteAuth (logged-in users):

```typescript
import { withJwtAuth } from '@/utils/server/jwtUtils';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Your implementation here
}

export default withJwtAuth(handler);
```

For public routes that require JWT but not siteAuth:

```typescript
import { withJwtOnlyAuth } from '@/utils/server/apiMiddleware';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Your implementation here
}

export default withJwtOnlyAuth(handler);
```

#### Using Data Hooks in Components

```typescript
// Example of using hooks in a component
import { useAnswers, useLike } from '@/hooks';

function MyComponent() {
  // Fetch data with authentication
  const { data, isLoading } = useAnswers(1, 'mostRecent');

  // Handle liking
  const likeMutation = useLike();

  const handleLike = (answerId) => {
    likeMutation.mutate({ answerId, like: true });
  };

  // Rest of component...
}
```

### JWT Auth Security Considerations

- JWTs are signed with a secret key to prevent tampering
- Tokens have a limited lifespan to reduce risk from token theft
- API endpoints verify token validity before processing requests
- The system implements rate limiting to prevent abuse
- Public JWT-only endpoints still require valid JWT tokens
