import React, { useState } from "react";
import { Modal } from "@/components/ui/Modal";

interface PasswordChangeModalProps {
  isOpen: boolean;
  onClose: () => void;
  hasPassword: boolean;
  onPasswordChanged: (successMessage: string) => void;
}

export function PasswordChangeModal({ isOpen, onClose, hasPassword, onPasswordChanged }: PasswordChangeModalProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  // Reset state when modal opens/closes
  React.useEffect(() => {
    if (isOpen) {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setShowCurrentPassword(false);
      setShowNewPassword(false);
      setShowConfirmPassword(false);
      setMessage(null);
      setIsSubmitting(false);
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);

    // Validation
    if (!hasPassword && !newPassword) {
      setMessage({ text: "Password is required", type: "error" });
      return;
    }
    if (hasPassword && !currentPassword) {
      setMessage({ text: "Current password is required", type: "error" });
      return;
    }
    if (!newPassword) {
      setMessage({ text: "New password is required", type: "error" });
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage({ text: "Passwords do not match", type: "error" });
      return;
    }
    if (newPassword.length < 8) {
      setMessage({ text: "Password must be at least 8 characters", type: "error" });
      return;
    }
    if (!/[A-Z]/.test(newPassword)) {
      setMessage({ text: "Password must contain at least one uppercase letter", type: "error" });
      return;
    }
    if (!/[a-z]/.test(newPassword)) {
      setMessage({ text: "Password must contain at least one lowercase letter", type: "error" });
      return;
    }
    if (!/[0-9]/.test(newPassword)) {
      setMessage({ text: "Password must contain at least one number", type: "error" });
      return;
    }

    try {
      setIsSubmitting(true);

      // Get JWT token
      const tokenRes = await fetch("/api/web-token");
      const tokenData = await tokenRes.json();
      if (!tokenRes.ok || !tokenData?.token) {
        throw new Error("Authentication required");
      }

      const endpoint = hasPassword ? "/api/auth/changePassword" : "/api/auth/setPassword";
      const body = hasPassword ? { currentPassword, newPassword } : { password: newPassword };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenData.token}`,
        },
        body: JSON.stringify(body),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to save password");

      const successMessage = hasPassword ? "Password changed successfully" : "Password set successfully";
      setMessage({
        text: successMessage,
        type: "success",
      });

      // Notify parent component
      onPasswordChanged(successMessage);

      // Close modal after a short delay to let user read the success message
      setTimeout(() => {
        onClose();
      }, 2000);
    } catch (error: any) {
      setMessage({
        text: error?.message || "Failed to save password",
        type: "error",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={hasPassword ? "Change Password" : "Set Password"}>
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

      <form onSubmit={handleSubmit} className="space-y-4">
        {hasPassword && (
          <div>
            <label htmlFor="currentPassword" className="block text-sm font-medium text-gray-700 mb-1">
              Current Password
            </label>
            <div className="relative">
              <input
                id="currentPassword"
                type={showCurrentPassword ? "text" : "password"}
                className="w-full rounded border border-gray-300 px-3 py-2 pr-16 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter current password"
                autoComplete="current-password"
                disabled={isSubmitting}
                required
              />
              <button
                type="button"
                onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-500 hover:text-gray-700"
                disabled={isSubmitting}
              >
                {showCurrentPassword ? "Hide" : "Show"}
              </button>
            </div>
          </div>
        )}

        <div>
          <label htmlFor="newPassword" className="block text-sm font-medium text-gray-700 mb-1">
            {hasPassword ? "New Password" : "Password"}
          </label>
          <div className="relative">
            <input
              id="newPassword"
              type={showNewPassword ? "text" : "password"}
              className="w-full rounded border border-gray-300 px-3 py-2 pr-16 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Enter new password"
              autoComplete="new-password"
              disabled={isSubmitting}
              required
            />
            <button
              type="button"
              onClick={() => setShowNewPassword(!showNewPassword)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-500 hover:text-gray-700"
              disabled={isSubmitting}
            >
              {showNewPassword ? "Hide" : "Show"}
            </button>
          </div>
        </div>

        <div>
          <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-1">
            Confirm Password
          </label>
          <div className="relative">
            <input
              id="confirmPassword"
              type={showConfirmPassword ? "text" : "password"}
              className="w-full rounded border border-gray-300 px-3 py-2 pr-16 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
              autoComplete="new-password"
              disabled={isSubmitting}
              required
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-500 hover:text-gray-700"
              disabled={isSubmitting}
            >
              {showConfirmPassword ? "Hide" : "Show"}
            </button>
          </div>
        </div>

        <div className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded p-3">
          <p className="font-medium mb-1">Password requirements:</p>
          <ul className="list-disc list-inside space-y-0.5">
            <li>At least 8 characters</li>
            <li>One uppercase letter</li>
            <li>One lowercase letter</li>
            <li>One number</li>
          </ul>
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex-1 rounded bg-blue-600 px-4 py-2 text-white text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? "Saving..." : hasPassword ? "Change Password" : "Set Password"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded border border-gray-300 px-4 py-2 text-gray-700 text-sm hover:bg-gray-50"
            disabled={isSubmitting}
          >
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
