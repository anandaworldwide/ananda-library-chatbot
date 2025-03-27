import { useEffect, useState, useRef } from 'react';
import { getOrCreateUUID } from '@/utils/client/uuid';
import { updateLike } from '@/services/likeService';

interface LikeButtonProps {
  answerId: string;
  initialLiked: boolean;
  likeCount: number;
  onLikeCountChange?: (answerId: string, newLikeCount: number) => void;
  showLikeCount?: boolean;
}

const LikeButton: React.FC<LikeButtonProps> = ({
  answerId,
  initialLiked,
  likeCount,
  onLikeCountChange,
  showLikeCount = true,
}) => {
  // Use a ref to track if this is the first render
  const isFirstRender = useRef(true);

  // Add a ref to track if we're in the middle of a like action to prevent flicker
  const isLikeInProgress = useRef(false);

  // Initialize state from props
  const [isLiked, setIsLiked] = useState<boolean>(initialLiked);
  const [likes, setLikes] = useState<number>(likeCount);
  const [animate, setAnimate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // IMPORTANT: Force reset the local state whenever initialLiked changes
  // BUT ONLY if we're not in the middle of a like action
  useEffect(() => {
    const wasFirstRender = isFirstRender.current;
    if (isFirstRender.current) {
      isFirstRender.current = false;
    }

    // Only update if we're not in the middle of a like action
    if (!isLikeInProgress.current) {
      // Only update if it's not the first render or initialLiked has changed
      if (!wasFirstRender && isLiked !== initialLiked) {
        setIsLiked(initialLiked);
      }
    }
  }, [initialLiked, answerId, isLiked]);

  // Update like count when the prop changes, but only if we're not in the middle of a like action
  useEffect(() => {
    if (!isLikeInProgress.current && likeCount !== likes) {
      setLikes(likeCount);
    }
  }, [likeCount, answerId, likes]);

  const handleLike = async () => {
    // Safety check - don't proceed if no callback is provided
    if (!onLikeCountChange) return;

    // Set flag to prevent external prop changes from conflicting with our action
    isLikeInProgress.current = true;

    const newLikedState = !isLiked;
    const uuid = getOrCreateUUID();

    // Update local state immediately - user needs immediate feedback
    setIsLiked(newLikedState);
    setAnimate(true);
    setTimeout(() => setAnimate(false), 300);

    const newLikeCount = newLikedState ? likes + 1 : Math.max(0, likes - 1);
    setLikes(newLikeCount);

    try {
      // Notify parent about the change - pass the answerId and the new like count
      onLikeCountChange(answerId, newLikeCount);

      // Save to the server
      await updateLike(answerId, uuid, newLikedState);

      // Short delay to let the server update complete
      setTimeout(() => {
        isLikeInProgress.current = false;
      }, 500);
    } catch (error) {
      console.error('LikeButton: Like error:', error);

      // Revert local state
      setIsLiked(!newLikedState);
      setLikes(newLikedState ? likes : likes + 1);

      // Show error
      setError(error instanceof Error ? error.message : 'An error occurred');
      setTimeout(() => setError(null), 3000);

      // Clear in-progress flag
      isLikeInProgress.current = false;
    }
  };

  // If no like change handler is provided, don't render the button
  // This happens when the user is not authenticated on sites requiring login
  if (!onLikeCountChange) {
    return null;
  }

  // Render the button
  return (
    <div className="like-container flex items-center space-x-1">
      <span className="text-sm text-gray-500">Found this helpful?</span>
      <button
        className={`heart-button ${isLiked ? 'liked' : ''} ${
          animate ? 'animate-pulse' : ''
        } flex items-center`}
        onClick={handleLike}
        aria-label={isLiked ? 'Unlike this answer' : 'Like this answer'}
        title="Like this answer to show it was helpful"
      >
        <span className="material-icons text-xl leading-none">
          {isLiked ? 'favorite' : 'favorite_border'}
        </span>
      </button>
      {showLikeCount && likes > 0 && (
        <span className="like-count text-sm">{likes}</span>
      )}
      {error && <span className="text-red-500 text-sm ml-2">{error}</span>}
    </div>
  );
};

export default LikeButton;
