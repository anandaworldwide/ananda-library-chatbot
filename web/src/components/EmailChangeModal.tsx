import React, { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { fetchWithAuth } from "@/utils/client/tokenManager";

interface EmailChangeModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentEmail: string;
  pendingEmail: string | null;
  onEmailChangeRequested: (newEmail: string) => void;
  onEmailChangeCancelled: () => void;
}

export function EmailChangeModal({
  isOpen,
  onClose,
  currentEmail,
  pendingEmail,
  onEmailChangeRequested,
  onEmailChangeCancelled,
}: EmailChangeModalProps) {
  const [newEmail, setNewEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  // Reset state when modal opens/closes
  React.useEffect(() => {
    if (isOpen) {
      setNewEmail("");
      setMessage(null);
      setIsSubmitting(false);
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    if (!newEmail.trim()) {
      setMessage({ text: "Please enter a new email address", type: "error" });
      return;
    }

    if (newEmail.toLowerCase().trim() === currentEmail.toLowerCase()) {
      setMessage({ text: "New email must be different from current email", type: "error" });
      return;
    }

    try {
      setIsSubmitting(true);
      const res = await fetchWithAuth("/api/requestEmailChange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newEmail: newEmail.trim() }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data?.error || "Failed to request email change");
      }

      setMessage({
        text: `Verification email sent to ${newEmail.trim()}. Check your inbox and click the verification link to complete the change.`,
        type: "success",
      });

      // Notify parent component
      onEmailChangeRequested(newEmail.trim());

      // Close modal after a short delay to let user read the success message
      setTimeout(() => {
        onClose();
      }, 3000);
    } catch (error: any) {
      setMessage({
        text: error?.message || "Failed to request email change",
        type: "error",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelPendingChange = async () => {
    try {
      setIsSubmitting(true);
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cancelEmailChange: true }),
      });

      if (res.ok) {
        onEmailChangeCancelled();
        setMessage({ text: "Email change cancelled", type: "success" });
        setTimeout(() => {
          onClose();
        }, 2000);
      } else {
        throw new Error("Failed to cancel email change");
      }
    } catch (error: any) {
      setMessage({
        text: error?.message || "Failed to cancel email change",
        type: "error",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Change Email Address">
      {message && (
        <div
          className={`mb-4 rounded border p-3 text-sm ${
            message.type === "success"
              ? "border-green-300 bg-green-50 text-green-800"
              : "border-red-300 bg-red-50 text-red-800"
          }`}
        >
          {message.text}
        </div>
      )}

      {pendingEmail ? (
        // Show pending email change status
        <div className="space-y-4">
          <div className="text-sm text-gray-700">
            <p>
              <strong>Current email:</strong> {currentEmail}
            </p>
            <p>
              <strong>Pending change to:</strong> {pendingEmail}
            </p>
          </div>

          <div className="text-sm text-gray-600 bg-blue-50 border border-blue-200 rounded p-3">
            <p>
              We've sent a verification email to <strong>{pendingEmail}</strong>.
            </p>
            <p className="mt-1">Check your inbox and click the verification link to complete the change.</p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleCancelPendingChange}
              disabled={isSubmitting}
              className="flex-1 rounded bg-gray-600 px-4 py-2 text-white text-sm hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? "Cancelling..." : "Cancel Email Change"}
            </button>
            <button
              onClick={onClose}
              className="flex-1 rounded border border-gray-300 px-4 py-2 text-gray-700 text-sm hover:bg-gray-50"
            >
              Close
            </button>
          </div>
        </div>
      ) : (
        // Show email change form
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="currentEmail" className="block text-sm font-medium text-gray-700 mb-1">
              Current email
            </label>
            <input
              id="currentEmail"
              type="email"
              value={currentEmail}
              disabled
              className="w-full rounded border border-gray-300 px-3 py-2 text-gray-500 bg-gray-50 cursor-not-allowed"
            />
          </div>

          <div>
            <label htmlFor="newEmail" className="block text-sm font-medium text-gray-700 mb-1">
              New email address
            </label>
            <input
              id="newEmail"
              type="email"
              className="w-full rounded border border-gray-300 px-3 py-2 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="Enter new email address"
              disabled={isSubmitting}
              required
            />
          </div>

          <div className="text-sm text-gray-600 bg-yellow-50 border border-yellow-200 rounded p-3">
            <p>
              <strong>Important:</strong> We'll send a verification email to your new address.
            </p>
            <p className="mt-1">You must click the verification link within 24 hours to complete the change.</p>
          </div>

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={isSubmitting || !newEmail.trim()}
              className="flex-1 rounded bg-blue-600 px-4 py-2 text-white text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? "Sending..." : "Send Verification Email"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded border border-gray-300 px-4 py-2 text-gray-700 text-sm hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
