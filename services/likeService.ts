import { queryFetch } from '@/utils/client/reactQueryConfig';

// Overloaded function signatures for backward compatibility
export async function checkUserLikes(uuid: string): Promise<string[]>;
export async function checkUserLikes(
  answerIds: string[],
  uuid: string,
): Promise<Record<string, boolean>>;

// Implementation supporting both signatures
export async function checkUserLikes(
  uuidOrAnswerIds: string | string[],
  uuid?: string,
): Promise<Record<string, boolean> | string[]> {
  try {
    // First signature: checkUserLikes(uuid)
    if (typeof uuidOrAnswerIds === 'string' && !uuid) {
      // Fetch all liked answer IDs for this user
      const response = await queryFetch(`/api/like?uuid=${uuidOrAnswerIds}`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('Error in checkUserLikes GET:', errorData);
        throw new Error(errorData.message || 'Failed to check likes');
      }

      const data = await response.json();
      return data || [];
    }

    // Second signature: checkUserLikes(answerIds, uuid)
    if (Array.isArray(uuidOrAnswerIds) && typeof uuid === 'string') {
      const response = await queryFetch('/api/like?action=check', {
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
    }

    // Invalid usage
    console.error('Invalid parameters to checkUserLikes');
    return [];
  } catch (error) {
    console.error('Error checking likes:', error);
    throw error; // Re-throw to allow proper handling by the component
  }
}

export const getLikeCounts = async (
  answerIds: string[],
): Promise<Record<string, number>> => {
  try {
    const response = await queryFetch('/api/like?action=counts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ answerIds }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.error || 'An error occurred while fetching like counts.',
      );
    }

    return await response.json();
  } catch (error) {
    console.error('Error fetching like counts:', error);
    throw error;
  }
};

export const updateLike = async (
  answerId: string,
  uuid: string,
  like: boolean,
): Promise<void> => {
  try {
    const response = await queryFetch('/api/like', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ answerId, uuid, like }),
    });

    if (!response.ok) {
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
