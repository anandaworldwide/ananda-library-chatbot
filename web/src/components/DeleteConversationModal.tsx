import React, { useEffect } from "react";

interface DeleteConversationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  conversationTitle: string;
  isLoading?: boolean;
}

export default function DeleteConversationModal({
  isOpen,
  onClose,
  onConfirm,
  conversationTitle,
  isLoading = false,
}: DeleteConversationModalProps) {
  // Handle escape key
  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape" && isOpen && !isLoading) {
        onClose();
      }
    }

    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
      return () => document.removeEventListener("keydown", handleEscape);
    }
  }, [isOpen, isLoading, onClose]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !isLoading) {
      onClose();
    }
  };

  const handleConfirm = async () => {
    try {
      await onConfirm();
      onClose();
    } catch (error) {
      // Error handling is done by parent component
      console.error("Delete confirmation error:", error);
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
      onClick={handleBackdropClick}
    >
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full" role="dialog" aria-labelledby="delete-title">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-center">
            <span className="material-icons text-red-500 mr-3">warning</span>
            <h3 id="delete-title" className="text-lg font-semibold text-gray-900">
              Delete Conversation
            </h3>
          </div>
        </div>

        {/* Content */}
        <div className="px-6 py-4">
          <p className="text-gray-700 mb-4">
            Are you sure you want to delete this conversation? This action cannot be undone.
          </p>

          <div className="bg-gray-50 rounded-md p-3 border-l-4 border-red-400">
            <p className="text-sm font-medium text-gray-900 mb-1">Conversation to delete:</p>
            <p className="text-sm text-gray-700 italic">"{conversationTitle}"</p>
          </div>

          <div className="mt-4 text-sm text-gray-600">
            <p className="flex items-start">
              <span className="material-icons text-sm mr-2 mt-0.5 text-gray-400">info</span>
              This will permanently delete all questions and answers in this conversation.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex justify-end space-x-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isLoading}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
          >
            {isLoading && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>}
            Delete Conversation
          </button>
        </div>
      </div>
    </div>
  );
}
