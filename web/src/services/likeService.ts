import { queryFetch } from '@/utils/client/reactQueryConfig';
import { isLikesPublic } from '@/utils/client/authConfig';
import { SiteConfig } from '@/types/siteConfig';

/**
 * TODO: REFACTORING NEEDED FOR TESTABILITY
 * 
 * This service has a complex dependency chain that makes it difficult to test in isolation:
 * likeService → queryFetch → tokenManager → browser navigation APIs
 * 
 * Challenges for testing:
 * 1. Deep authentication dependency chain with browser APIs (window.location)
 * 2. Dual authentication modes (public vs authenticated sites)
 * 3. Overloaded function signatures complicate mocking
 * 4. Intertwined error handling for auth vs network errors
 * 
 * Recommended refactoring for testability:
 * 
 * 1. DEPENDENCY INJECTION:
 *    - Extract dependencies into an interface (fetchFn, authHandler, etc.)
 *    - Make dependencies injectable in constructor or function parameters
 *    - Example: LikeService class with injected HttpClient and AuthHandler
 * 
 * 2. SPLIT COMPLEX FUNCTIONS:
 *    - Separate the overloaded checkUserLikes into distinct functions
 *    - checkUserLikesById(uuid: string): Promise<string[]>
 *    - checkUserLikesByAnswers(answerIds: string[], uuid: string): Promise<Record<string, boolean>>
 * 
 * 3. EXTRACT AUTHENTICATION LOGIC:
 *    - Create separate auth handler that can be easily mocked
 *    - Move site config logic to dedicated service
 *    - Handle browser dependencies in separate navigation handler
 * 
 * 4. PURE ERROR HANDLING:
 *    - Separate error transformation from HTTP logic
 *    - Make error handling predictable and testable
 * 
 * 5. EXAMPLE REFACTORED INTERFACE:
 *    interface LikeServiceDependencies {
 *      httpClient: HttpClient;
 *      authHandler: AuthHandler;
 *      configService: ConfigService;
 *    }
 * 
 * Current testing challenges:
 * - Cannot easily mock queryFetch due to tokenManager complexity
 * - Browser navigation errors in JSDOM environment
 * - Authentication state management across test cases
 * - Complex error handling paths difficult to isolate
 * 
 * Priority: Medium - Service works well in production, but testing would help catch regressions
 */

// Overloaded function signatures for backward compatibility
export async function checkUserLikes(uuid: string): Promise<string[]>;
export async function checkUserLikes(
  answerIds: string[],
  uuid: string,
): Promise<Record<string, boolean>>;
export async function checkUserLikes(
  answerIds: string[],
  uuid: string,
  siteConfig: SiteConfig | null,
): Promise<Record<string, boolean>>;

// Implementation supporting both signatures
export async function checkUserLikes(
  uuidOrAnswerIds: string | string[],
  uuid?: string,
  siteConfig?: SiteConfig | null,
): Promise<Record<string, boolean> | string[]> {
  // Determine if we should use authenticated requests
  const useLikesAuth = !isLikesPublic(siteConfig || null);

  // Choose the appropriate fetch function based on auth requirements
  const fetchFn = useLikesAuth ? queryFetch : fetch;

  try {
    // First signature: checkUserLikes(uuid)
    if (typeof uuidOrAnswerIds === 'string' && !uuid) {
      try {
        // Fetch all liked answer IDs for this user
        const response = await fetchFn(`/api/like?uuid=${uuidOrAnswerIds}`);

        if (!response.ok) {
          // For 401 Unauthorized in public mode, return empty array
          // In auth mode, let the error propagate as authentication is required
          if (response.status === 401 && !useLikesAuth) {
            console.log(
              'User is not authenticated on public site, returning empty likes array',
            );
            return [];
          }

          const errorData = await response.json().catch(() => ({}));
          console.error('Error in checkUserLikes GET:', errorData);
          throw new Error(errorData.message || 'Failed to check likes');
        }

        const data = await response.json();
        return data || [];
      } catch (error) {
        // Only handle auth errors gracefully if we're NOT requiring auth
        if (
          !useLikesAuth &&
          error instanceof Error &&
          (error.message.includes('401') ||
            error.message.includes('token') ||
            error.message.includes('auth'))
        ) {
          console.log(
            'Authentication error on public site, returning empty array',
          );
          return [];
        }
        throw error;
      }
    }

    // Second signature: checkUserLikes(answerIds, uuid)
    if (Array.isArray(uuidOrAnswerIds) && typeof uuid === 'string') {
      try {
        const response = await fetchFn('/api/like?action=check', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            answerIds: uuidOrAnswerIds,
            uuid,
          }),
        });

        if (!response.ok) {
          // For 401 Unauthorized in public mode, return all false
          // In auth mode, let the error propagate as authentication is required
          if (response.status === 401 && !useLikesAuth) {
            console.log(
              'User is not authenticated on public site, returning all false likes',
            );
            const emptyStatuses: Record<string, boolean> = {};
            uuidOrAnswerIds.forEach((id) => {
              emptyStatuses[id] = false;
            });
            return emptyStatuses;
          }

          const errorData = await response.json().catch(() => ({}));
          console.error('Error in checkUserLikes POST:', errorData);
          throw new Error(
            errorData.message ||
              errorData.error ||
              'An error occurred while checking likes.',
          );
        }

        const data = await response.json();
        return data;
      } catch (error) {
        // Only handle auth errors gracefully if we're NOT requiring auth
        if (
          !useLikesAuth &&
          error instanceof Error &&
          (error.message.includes('401') ||
            error.message.includes('token') ||
            error.message.includes('auth'))
        ) {
          console.log(
            'Authentication error on public site, returning all false',
          );
          const emptyStatuses: Record<string, boolean> = {};
          uuidOrAnswerIds.forEach((id) => {
            emptyStatuses[id] = false;
          });
          return emptyStatuses;
        }
        throw error;
      }
    }

    // Invalid usage
    console.error('Invalid parameters to checkUserLikes');
    return [];
  } catch (error) {
    // Catch and log any unexpected errors
    console.error('Error checking likes:', error);

    // Only handle auth errors gracefully if we're NOT requiring auth
    if (
      !useLikesAuth &&
      ((error instanceof Error && error.message.includes('token')) ||
        (error instanceof Error && error.message.includes('auth')))
    ) {
      console.warn(
        'Authentication related error on public site, returning empty result',
      );
      if (Array.isArray(uuidOrAnswerIds)) {
        const emptyStatuses: Record<string, boolean> = {};
        uuidOrAnswerIds.forEach((id) => {
          emptyStatuses[id] = false;
        });
        return emptyStatuses;
      }
      return [];
    }

    throw error; // Re-throw non-auth errors or auth errors when auth is required
  }
}

export const getLikeCounts = async (
  answerIds: string[],
  siteConfig?: SiteConfig | null,
): Promise<Record<string, number>> => {
  // Determine if we should use authenticated requests
  const useLikesAuth = !isLikesPublic(siteConfig || null);

  // Choose the appropriate fetch function based on auth requirements
  const fetchFn = useLikesAuth ? queryFetch : fetch;

  try {
    const response = await fetchFn('/api/like?action=counts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ answerIds }),
    });

    if (!response.ok) {
      // For 401 Unauthorized in public mode, return empty counts
      // In auth mode, let the error propagate as authentication is required
      if (response.status === 401 && !useLikesAuth) {
        console.log(
          'User is not authenticated on public site, returning empty like counts',
        );
        const emptyCounts: Record<string, number> = {};
        answerIds.forEach((id) => {
          emptyCounts[id] = 0;
        });
        return emptyCounts;
      }

      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.error || 'An error occurred while fetching like counts.',
      );
    }

    return await response.json();
  } catch (error) {
    console.error('Error fetching like counts:', error);

    // Only handle auth errors gracefully if we're NOT requiring auth
    if (
      !useLikesAuth &&
      error instanceof Error &&
      (error.message.includes('token') ||
        error.message.includes('auth') ||
        error.message.includes('401'))
    ) {
      console.warn('Authentication error on public site, returning zeros');
      const emptyCounts: Record<string, number> = {};
      answerIds.forEach((id) => {
        emptyCounts[id] = 0;
      });
      return emptyCounts;
    }

    throw error;
  }
};

export const updateLike = async (
  answerId: string,
  uuid: string,
  like: boolean,
  siteConfig?: SiteConfig | null,
): Promise<void> => {
  // Determine if we should use authenticated requests
  const useLikesAuth = !isLikesPublic(siteConfig || null);

  // Choose the appropriate fetch function based on auth requirements
  const fetchFn = useLikesAuth ? queryFetch : fetch;

  try {
    const response = await fetchFn('/api/like', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ answerId, uuid, like }),
    });

    if (!response.ok) {
      // Handle authentication errors based on site configuration
      if (response.status === 401) {
        if (useLikesAuth) {
          // For sites that require auth, make it clear auth is required
          console.warn('Authentication required to like answers on this site');
          throw new Error('Authentication required to like answers');
        } else {
          // For public sites, should be a different error (since we're using fetch, not queryFetch)
          console.warn('Unexpected auth error on public site');
        }
      }

      const errorData = await response.json().catch(() => ({}));
      console.error('Error in updateLike:', errorData);
      throw new Error(
        errorData.message ||
          errorData.error ||
          'An error occurred while updating like status.',
      );
    }
  } catch (error) {
    console.error('Error updating like status:', error);
    throw error;
  }
};
