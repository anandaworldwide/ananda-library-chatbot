import React, { useState, useEffect } from 'react';

interface FeedbackModalProps {
  isOpen: boolean;
  docId: string | null;
  onConfirm: (docId: string, reason: string, comment: string) => void;
  onCancel: () => void;
  error?: string | null; // Optional error message prop
}

const feedbackReasons = [
  'Incorrect Information',
  'Off-Topic Response',
  'Bad Links',
  'Vague or Unhelpful',
  'Technical Issue',
  'Poor Style or Tone',
  'Other',
];

const FeedbackModal: React.FC<FeedbackModalProps> = ({
  isOpen,
  docId,
  onConfirm,
  onCancel,
  error,
}) => {
  const [selectedReason, setSelectedReason] = useState<string>('');
  const [commentText, setCommentText] = useState<string>('');

  // Reset state when modal opens or docId changes
  useEffect(() => {
    if (isOpen) {
      setSelectedReason('');
      setCommentText('');
    }
  }, [isOpen, docId]);

  if (!isOpen || !docId) {
    return null;
  }

  const handleSubmit = () => {
    if (selectedReason && docId) {
      onConfirm(docId, selectedReason, commentText);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50"
      onClick={onCancel} // Click away to cancel
    >
      <div
        className="bg-white p-6 rounded-lg shadow-xl w-full max-w-md mx-4"
        onClick={(e) => e.stopPropagation()} // Prevent click inside from closing modal
      >
        <h2 className="text-xl font-semibold mb-4">Why the Downvote?</h2>
        <p className="text-sm text-gray-600 mb-4">
          Please select a reason for your downvote. Your feedback helps us
          improve.
        </p>

        <div className="space-y-2 mb-4">
          {feedbackReasons.map((reason) => (
            <label
              key={reason}
              className="flex items-center space-x-2 cursor-pointer"
            >
              <input
                type="radio"
                name="feedbackReason"
                value={reason}
                checked={selectedReason === reason}
                onChange={(e) => setSelectedReason(e.target.value)}
                className="form-radio h-4 w-4 text-indigo-600"
              />
              <span>{reason}</span>
            </label>
          ))}
        </div>

        <div className="mb-4">
          <label
            htmlFor="feedbackComment"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Optional Comment (max 1000 chars):
          </label>
          <textarea
            id="feedbackComment"
            rows={3}
            maxLength={1000}
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            className="w-full p-2 border border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>

        {/* Display error message if provided */}
        {error && (
          <div className="text-red-500 text-sm mb-3 p-2 bg-red-50 rounded border border-red-200">
            Error: {error}
          </div>
        )}

        <div className="flex justify-end space-x-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!selectedReason} // Disable submit if no reason selected
            className={`px-4 py-2 text-white rounded ${
              !selectedReason
                ? 'bg-indigo-300 cursor-not-allowed'
                : 'bg-indigo-600 hover:bg-indigo-700'
            }`}
          >
            Submit Feedback
          </button>
        </div>
      </div>
    </div>
  );
};

export default FeedbackModal;
