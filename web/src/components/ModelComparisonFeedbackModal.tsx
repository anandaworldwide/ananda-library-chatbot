// Modal component for collecting user feedback on model comparison (original vs GPT-4.1)

import React, { useState } from "react";
import styles from "@/styles/Home.module.css";

interface ModelComparisonFeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (preference: string, comment: string, shareConsent: boolean) => void;
  originalModel: string;
  newModel: string;
}

export default function ModelComparisonFeedbackModal({
  isOpen,
  onClose,
  onSubmit,
  originalModel,
  newModel,
}: ModelComparisonFeedbackModalProps) {
  const [preference, setPreference] = useState<string>("");
  const [comment, setComment] = useState<string>("");
  const [shareConsent, setShareConsent] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  if (!isOpen) return null;

  function handleSubmit() {
    if (!preference) {
      alert("Please select which answer you prefer");
      return;
    }

    setIsSubmitting(true);
    onSubmit(preference, comment, shareConsent);

    // Reset form
    setPreference("");
    setComment("");
    setShareConsent(true);
    setIsSubmitting(false);
  }

  function handleClose() {
    setPreference("");
    setComment("");
    setShareConsent(true);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 p-6">
        <h2 className="text-xl font-semibold mb-4">Which answer was better?</h2>

        <div className="space-y-3 mb-4">
          <label className="flex items-center space-x-3 cursor-pointer">
            <input
              type="radio"
              name="preference"
              value="original"
              checked={preference === "original"}
              onChange={(e) => setPreference(e.target.value)}
              className="w-4 h-4 text-blue-600"
            />
            <span className="text-gray-700">Original ({originalModel})</span>
          </label>

          <label className="flex items-center space-x-3 cursor-pointer">
            <input
              type="radio"
              name="preference"
              value="new"
              checked={preference === "new"}
              onChange={(e) => setPreference(e.target.value)}
              className="w-4 h-4 text-blue-600"
            />
            <span className="text-gray-700">New ({newModel})</span>
          </label>

          <label className="flex items-center space-x-3 cursor-pointer">
            <input
              type="radio"
              name="preference"
              value="same"
              checked={preference === "same"}
              onChange={(e) => setPreference(e.target.value)}
              className="w-4 h-4 text-blue-600"
            />
            <span className="text-gray-700">About the same</span>
          </label>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Optional: Tell us why (helps us improve)
          </label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="What made one answer better than the other?"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            rows={3}
          />
        </div>

        <div className="mb-6">
          <label className="flex items-start space-x-3 cursor-pointer">
            <input
              type="checkbox"
              checked={shareConsent}
              onChange={(e) => setShareConsent(e.target.checked)}
              className="w-4 h-4 text-blue-600 mt-1"
            />
            <span className="text-sm text-gray-600">
              It&apos;s okay to share my question and both answers with the team to help improve the service
            </span>
          </label>
        </div>

        <div className="flex justify-end space-x-3">
          <button
            onClick={handleClose}
            className={`${styles.cloudButton} bg-gray-200 hover:bg-gray-300 rounded-xl px-6 py-2`}
            disabled={isSubmitting}
          >
            Skip
          </button>
          <button
            onClick={handleSubmit}
            className={`${styles.cloudButton} bg-blue-600 hover:bg-blue-700 text-white rounded-xl px-6 py-2`}
            disabled={isSubmitting || !preference}
          >
            {isSubmitting ? "Submitting..." : "Submit Feedback"}
          </button>
        </div>
      </div>
    </div>
  );
}
