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

### WordPress Plugin

- **Secure API Client** (`secure-api-client.php`): Handles token-based authentication for WordPress
- **Secure API Test Page**: Admin interface for testing the secure API connection

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

### Setup Instructions

1. **Vercel Project**:

   - Ensure SECURE_TOKEN and SECURE_TOKEN_HASH are set in your environment variables
   - No additional environment variables needed

2. **WordPress Plugin**:
   - Add `define('CHATBOT_BACKEND_SECURE_TOKEN', 'your-secure-token-value');` to `wp-config.php`
   - The value should match the SECURE_TOKEN in your Vercel project
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

## Testing

- Use the WordPress admin "Secure API Test" page to test the WordPress integration
- Visit the `/api-demo` page to test the web frontend integration

## JWT Authentication Implementation

This project implements JWT authentication for secure API access. This document outlines the key components
and patterns used.

### Core Components

#### Server-Side

- **JWT Middleware**: `/utils/server/jwtUtils.ts` provides the `withJwtAuth` HOC to secure API endpoints.
- **Secured Endpoints**: All API endpoints in `/pages/api/` are protected with JWT authentication.

#### Client-Side

- **React Query Configuration**: `/utils/client/reactQueryConfig.ts` includes JWT handling for all API requests.
- **Auth Hooks**:
  - `useAnswers`: Fetches paginated answers with authentication
  - `useLike`: Manages liking answers
  - `useVote`: Handles voting on messages

### How It Works

1. **Authentication Flow**:

   - JWTs are issued upon login/authentication
   - Tokens are stored securely and included with each API request
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

```typescript
// Example of securing an API route
import { withJwtAuth } from '@/utils/server/jwtUtils';

// Your handler function
async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Your implementation here
}

// Export with JWT auth middleware
export default withJwtAuth(handler);
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
