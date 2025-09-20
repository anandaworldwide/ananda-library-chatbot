import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ResendInvitationModal } from "@/components/ResendInvitationModal";

// Mock fetch for profile API
global.fetch = jest.fn();

const defaultProps = {
  isOpen: true,
  onClose: jest.fn(),
  onResend: jest.fn(),
  email: "test@example.com",
  isSubmitting: false,
};

describe("ResendInvitationModal", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Mock profile API response
    (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValue({
      ok: true,
      json: async () => ({ firstName: "John" }),
    } as Response);
  });

  it("renders when open", () => {
    render(<ResendInvitationModal {...defaultProps} />);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Resending invitation to:")).toBeInTheDocument();
    expect(screen.getByText("test@example.com")).toBeInTheDocument();
    expect(screen.getByLabelText("Custom Message (Optional)")).toBeInTheDocument();
  });

  it("does not render when closed", () => {
    render(<ResendInvitationModal {...defaultProps} isOpen={false} />);

    expect(screen.queryByText("Resend Invitation")).not.toBeInTheDocument();
  });

  it("submits with custom message", async () => {
    const user = userEvent.setup();
    const mockOnResend = jest.fn().mockResolvedValue(undefined);
    render(<ResendInvitationModal {...defaultProps} onResend={mockOnResend} />);

    // Wait for the default message to load
    await waitFor(() => {
      expect(screen.getByDisplayValue(/Please join us in using Luca/)).toBeInTheDocument();
    });

    const textarea = screen.getByLabelText("Custom Message (Optional)");

    // Clear the existing content and type the new message
    await user.clear(textarea);
    await user.type(textarea, "Custom test message");

    // Wait for any async updates to complete before checking the value
    await waitFor(() => {
      expect(textarea).toHaveValue("Custom test message");
    });

    const submitButton = screen.getByRole("button", { name: /resend invitation/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(mockOnResend).toHaveBeenCalledWith("test@example.com", "Custom test message");
    });

    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it("submits with empty message when cleared", async () => {
    const user = userEvent.setup();
    const mockOnResend = jest.fn().mockResolvedValue(undefined);
    render(<ResendInvitationModal {...defaultProps} onResend={mockOnResend} />);

    // Wait for the default message to load
    await waitFor(() => {
      const textarea = screen.getByLabelText("Custom Message (Optional)") as HTMLTextAreaElement;
      expect(textarea.value).toContain("Please join us in using Luca");
    });

    const textarea = screen.getByLabelText("Custom Message (Optional)") as HTMLTextAreaElement;

    // Clear the textarea using userEvent
    await user.clear(textarea);

    // Verify it's empty
    expect(textarea.value).toBe("");

    const submitButton = screen.getByRole("button", { name: /resend invitation/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(mockOnResend).toHaveBeenCalledWith("test@example.com", undefined);
    });
  });

  it("updates admin name in default message", async () => {
    render(<ResendInvitationModal {...defaultProps} />);

    // Wait for the profile fetch and message update
    await waitFor(() => {
      const textarea = screen.getByLabelText("Custom Message (Optional)") as HTMLTextAreaElement;
      expect(textarea.value).toContain("Aums,\nJohn");
    });
  });

  it("handles profile fetch failure gracefully", async () => {
    (global.fetch as jest.MockedFunction<typeof fetch>).mockRejectedValue(new Error("Network error"));

    render(<ResendInvitationModal {...defaultProps} />);

    // Should still show default message with "Admin" fallback
    await waitFor(() => {
      const textarea = screen.getByLabelText("Custom Message (Optional)") as HTMLTextAreaElement;
      expect(textarea.value).toContain("Aums,\nAdmin");
    });
  });

  it("disables form when submitting", () => {
    render(<ResendInvitationModal {...defaultProps} isSubmitting={true} />);

    const textarea = screen.getByLabelText("Custom Message (Optional)");
    const submitButton = screen.getByRole("button", { name: /resending.../i });
    const cancelButton = screen.getByRole("button", { name: /cancel/i });

    expect(textarea).toBeDisabled();
    expect(submitButton).toBeDisabled();
    expect(cancelButton).toBeDisabled();
  });

  it("closes modal when cancel is clicked", () => {
    render(<ResendInvitationModal {...defaultProps} />);

    const cancelButton = screen.getByRole("button", { name: /cancel/i });
    fireEvent.click(cancelButton);

    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it("resets form when modal closes", async () => {
    const { rerender } = render(<ResendInvitationModal {...defaultProps} />);

    // Wait for the default message to load
    await waitFor(() => {
      expect(screen.getByDisplayValue(/Please join us in using Luca/)).toBeInTheDocument();
    });

    const textarea = screen.getByLabelText("Custom Message (Optional)");
    fireEvent.change(textarea, { target: { value: "Modified message" } });

    // Close and reopen modal
    rerender(<ResendInvitationModal {...defaultProps} isOpen={false} />);
    rerender(<ResendInvitationModal {...defaultProps} isOpen={true} />);

    // Should reset to default message
    await waitFor(() => {
      expect(screen.getByDisplayValue(/Please join us in using Luca/)).toBeInTheDocument();
    });
  });
});
