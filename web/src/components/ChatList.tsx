import React from "react";
import { formatSmartTimestamp } from "@/utils/client/dateUtils";

interface ChatItem {
  id: string;
  question: string;
  likeCount?: number;
  timestamp?: { _seconds: number; _nanoseconds: number } | Date | number | any;
}

interface ChatListProps {
  chats: ChatItem[];
  showTimestamps?: boolean;
  showLikeCounts?: boolean;
  emptyMessage?: string;
  className?: string;
}

export const ChatList: React.FC<ChatListProps> = ({
  chats,
  showTimestamps = false,
  showLikeCounts = true,
  emptyMessage = "No chats yet",
  className = "",
}) => {
  if (chats.length === 0) {
    return <div className="text-sm text-gray-600">{emptyMessage}</div>;
  }

  return (
    <ul className={`list-disc pl-5 text-sm space-y-1 ${className}`}>
      {chats.map((chat) => (
        <li key={chat.id} className="mb-1">
          <a href={`/answers/${chat.id}`} className="text-blue-600 underline hover:text-blue-800">
            {chat.question}
          </a>

          {(showLikeCounts || showTimestamps) && (
            <span className="ml-2 text-gray-500">
              {showLikeCounts && `(${chat.likeCount || 0} likes)`}
              {showTimestamps && chat.timestamp && (
                <span className="ml-2">• {formatSmartTimestamp(chat.timestamp)}</span>
              )}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
};

export default ChatList;
