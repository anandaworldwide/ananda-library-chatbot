import { useEffect, useState } from 'react';
import { getOrCreateUUID } from '@/utils/client/uuid';

interface LikeButtonProps {
  answerId: string;
  initialLiked: boolean;
  likeCount: number;
  onLikeCountChange: (answerId: string, newLikeCount: number) => void;
  showLikeCount?: boolean;
}

const LikeButton: React.FC<LikeButtonProps> = ({
  answerId,
  initialLiked,
  likeCount,
  onLikeCountChange,
  showLikeCount = true,
}) => {
  const [isLiked, setIsLiked] = useState(initialLiked);
  const [likes, setLikes] = useState(likeCount);
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    setIsLiked(initialLiked);
  }, [initialLiked]);

  useEffect(() => {
    setLikes(likeCount);
  }, [likeCount]);

  const handleLike = async () => {
    const uuid = getOrCreateUUID();
    const newLikedState = !isLiked;
    setIsLiked(newLikedState);
    setAnimate(true);
    setTimeout(() => setAnimate(false), 300);

    try {
      const response = await fetch('/api/like', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ answerId, uuid, like: newLikedState }),
      });

      if (!response.ok) {
        // If the response is not ok, revert the liked state
        setIsLiked(!newLikedState);
        const errorData = await response.json();
        throw new Error(
          errorData.error ||
            'An error occurred while updating the like status.',
        );
      }

      // Call the onLikeCountChange callback with the updated like count
      onLikeCountChange(answerId, newLikedState ? likes + 1 : likes - 1);
    } catch (error) {
      console.error('LikeButton: Like error:', error);
      setIsLiked(!newLikedState);
      // TODO: Optionally handle the error state in the UI, e.g., with a toast notification
    }

    setLikes((prevLikes) => (newLikedState ? prevLikes + 1 : prevLikes - 1));
  };

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
    </div>
  );
};

export default LikeButton;
