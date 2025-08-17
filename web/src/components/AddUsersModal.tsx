import React, { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { validateEmailInput } from "@/utils/client/emailParser";

interface AddUsersModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddUsers: (emails: string[]) => Promise<void>;
  isSubmitting?: boolean;
}

export function AddUsersModal({ isOpen, onClose, onAddUsers, isSubmitting = false }: AddUsersModalProps) {
  const [emailInput, setEmailInput] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!emailInput.trim()) {
      setValidationError("Please enter at least one email address");
      return;
    }

    const validation = validateEmailInput(emailInput);

    if (validation.validCount === 0) {
      setValidationError("No valid email addresses found");
      return;
    }

    if (validation.invalidEntries.length > 0) {
      setValidationError(
        `Invalid email format${validation.invalidEntries.length > 1 ? "s" : ""}: ${validation.invalidEntries.join(", ")}`
      );
      return;
    }

    setValidationError(null);

    try {
      await onAddUsers(validation.validEmails);
      // Clear the form and close modal on success
      setEmailInput("");
      onClose();
    } catch (error) {
      // Error handling is done by the parent component
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      setEmailInput("");
      setValidationError(null);
      onClose();
    }
  };

  const validation = validateEmailInput(emailInput);
  const hasContent = emailInput.trim().length > 0;

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Add Users" className="max-w-lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="email-input" className="block text-sm font-medium text-gray-700 mb-2">
            Email Addresses
          </label>
          <textarea
            id="email-input"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            disabled={isSubmitting}
            className="w-full h-32 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            placeholder="John Doe <john@example.com>, user@example.com"
          />
          <p className="mt-1 text-xs text-gray-500">
            Separate multiple email addresses with commas or new lines. You can use either bare email addresses or names
            with angle brackets.
          </p>
        </div>

        {hasContent && (
          <div className="text-sm text-gray-600">
            {validation.totalEntries > 0 && (
              <div>
                Found {validation.totalEntries} entr{validation.totalEntries === 1 ? "y" : "ies"}
                {validation.validCount > 0 && (
                  <span className="text-green-600">
                    , {validation.validCount} valid email{validation.validCount === 1 ? "" : "s"}
                  </span>
                )}
                {validation.invalidEntries.length > 0 && (
                  <span className="text-red-600">, {validation.invalidEntries.length} invalid</span>
                )}
              </div>
            )}
          </div>
        )}

        {validationError && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">{validationError}</div>
        )}

        <div className="flex justify-end space-x-3 pt-4">
          <button
            type="button"
            onClick={handleClose}
            disabled={isSubmitting}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting || validation.validCount === 0}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? "Adding..." : `Add ${validation.validCount} User${validation.validCount === 1 ? "" : "s"}`}
          </button>
        </div>
      </form>
    </Modal>
  );
}
