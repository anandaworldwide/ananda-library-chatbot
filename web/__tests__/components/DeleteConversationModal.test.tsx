import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import DeleteConversationModal from "@/components/DeleteConversationModal";

describe("DeleteConversationModal", () => {
  const mockOnClose = jest.fn();
  const mockOnConfirm = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockOnConfirm.mockResolvedValue(undefined);
  });

  it("should not render when not open", () => {
    render(
      <DeleteConversationModal
        isOpen={false}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
        conversationTitle="Test Conversation"
      />
    );

    expect(screen.queryByText("Delete Conversation")).not.toBeInTheDocument();
  });

  it("should render when open", () => {
    render(
      <DeleteConversationModal
        isOpen={true}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
        conversationTitle="Test Conversation"
      />
    );

    expect(screen.getByRole("heading", { name: /delete conversation/i })).toBeInTheDocument();
    expect(screen.getByText(/are you sure you want to delete this conversation/i)).toBeInTheDocument();
    // The title is rendered with quotes, search for it with regex
    expect(screen.getByText(/Test Conversation/)).toBeInTheDocument();
  });

  it("should show warning message", () => {
    render(
      <DeleteConversationModal
        isOpen={true}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
        conversationTitle="Test Conversation"
      />
    );

    expect(screen.getByText(/this action cannot be undone/i)).toBeInTheDocument();
    expect(screen.getByText(/This will permanently delete all questions and answers/)).toBeInTheDocument();
  });

  it("should call onConfirm when delete button is clicked", async () => {
    render(
      <DeleteConversationModal
        isOpen={true}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
        conversationTitle="Test Conversation"
      />
    );

    const deleteButton = screen.getByRole("button", { name: /delete conversation/i });
    fireEvent.click(deleteButton);

    expect(mockOnConfirm).toHaveBeenCalledTimes(1);
  });

  it("should call onClose when cancel button is clicked", () => {
    render(
      <DeleteConversationModal
        isOpen={true}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
        conversationTitle="Test Conversation"
      />
    );

    const cancelButton = screen.getByText("Cancel");
    fireEvent.click(cancelButton);

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it("should close modal on backdrop click", () => {
    render(
      <DeleteConversationModal
        isOpen={true}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
        conversationTitle="Test Conversation"
      />
    );

    const backdrop = screen.getByRole("dialog").parentElement;
    fireEvent.click(backdrop!);

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it("should close modal on escape key", () => {
    render(
      <DeleteConversationModal
        isOpen={true}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
        conversationTitle="Test Conversation"
      />
    );

    fireEvent.keyDown(document, { key: "Escape" });

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it("should show loading state", () => {
    render(
      <DeleteConversationModal
        isOpen={true}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
        conversationTitle="Test Conversation"
        isLoading={true}
      />
    );

    const deleteButton = screen.getByRole("button", { name: /delete conversation/i });
    expect(deleteButton).toBeDisabled();

    const cancelButton = screen.getByText("Cancel");
    expect(cancelButton).toBeDisabled();

    // Should show loading spinner
    expect(deleteButton.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("should not close on escape when loading", () => {
    render(
      <DeleteConversationModal
        isOpen={true}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
        conversationTitle="Test Conversation"
        isLoading={true}
      />
    );

    fireEvent.keyDown(document, { key: "Escape" });

    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it("should not close on backdrop click when loading", () => {
    render(
      <DeleteConversationModal
        isOpen={true}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
        conversationTitle="Test Conversation"
        isLoading={true}
      />
    );

    const backdrop = screen.getByRole("dialog").parentElement;
    fireEvent.click(backdrop!);

    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it("should handle onConfirm errors gracefully", async () => {
    mockOnConfirm.mockRejectedValue(new Error("Delete failed"));

    render(
      <DeleteConversationModal
        isOpen={true}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
        conversationTitle="Test Conversation"
      />
    );

    const deleteButton = screen.getByRole("button", { name: /delete conversation/i });
    fireEvent.click(deleteButton);

    // Should not crash when onConfirm fails
    expect(mockOnConfirm).toHaveBeenCalledTimes(1);
  });

  it("should display conversation title correctly", () => {
    const longTitle = "This is a very long conversation title that should be displayed correctly";

    render(
      <DeleteConversationModal
        isOpen={true}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
        conversationTitle={longTitle}
      />
    );

    // The title is rendered with quotes, search for it with regex
    expect(screen.getByText(new RegExp(longTitle))).toBeInTheDocument();
  });

  it("should have proper accessibility attributes", () => {
    render(
      <DeleteConversationModal
        isOpen={true}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
        conversationTitle="Test Conversation"
      />
    );

    // Should have warning icon
    const warningIcon = screen.getByText("warning");
    expect(warningIcon).toBeInTheDocument();

    // Should have proper button roles
    const deleteButton = screen.getByRole("button", { name: /delete conversation/i });
    const cancelButton = screen.getByRole("button", { name: /cancel/i });

    expect(deleteButton).toBeInTheDocument();
    expect(cancelButton).toBeInTheDocument();
  });

  it("should prevent modal content click from closing modal", () => {
    render(
      <DeleteConversationModal
        isOpen={true}
        onClose={mockOnClose}
        onConfirm={mockOnConfirm}
        conversationTitle="Test Conversation"
      />
    );

    const modalContent = screen.getByRole("dialog");
    fireEvent.click(modalContent);

    expect(mockOnClose).not.toHaveBeenCalled();
  });
});
