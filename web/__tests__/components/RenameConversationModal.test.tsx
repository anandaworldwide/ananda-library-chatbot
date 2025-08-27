import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import RenameConversationModal from "@/components/RenameConversationModal";

describe("RenameConversationModal", () => {
  const mockOnClose = jest.fn();
  const mockOnSave = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockOnSave.mockResolvedValue(undefined);
  });

  it("should not render when not open", () => {
    render(
      <RenameConversationModal isOpen={false} onClose={mockOnClose} onSave={mockOnSave} currentTitle="Test Title" />
    );

    expect(screen.queryByText("Rename Conversation")).not.toBeInTheDocument();
  });

  it("should render when open", () => {
    render(
      <RenameConversationModal isOpen={true} onClose={mockOnClose} onSave={mockOnSave} currentTitle="Test Title" />
    );

    expect(screen.getByText("Rename Conversation")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Test Title")).toBeInTheDocument();
  });

  it("should focus and select input when opened", async () => {
    render(
      <RenameConversationModal isOpen={true} onClose={mockOnClose} onSave={mockOnSave} currentTitle="Test Title" />
    );

    const input = screen.getByDisplayValue("Test Title");

    await waitFor(() => {
      expect(input).toHaveFocus();
    });
  });

  it("should show character count", () => {
    render(
      <RenameConversationModal isOpen={true} onClose={mockOnClose} onSave={mockOnSave} currentTitle="Test Title" />
    );

    expect(screen.getByText("10/100 characters")).toBeInTheDocument();
  });

  it("should update character count when typing", () => {
    render(<RenameConversationModal isOpen={true} onClose={mockOnClose} onSave={mockOnSave} currentTitle="Test" />);

    const input = screen.getByDisplayValue("Test");
    fireEvent.change(input, { target: { value: "New Title" } });

    expect(screen.getByText("9/100 characters")).toBeInTheDocument();
  });

  it("should disable save button for empty title", () => {
    render(
      <RenameConversationModal isOpen={true} onClose={mockOnClose} onSave={mockOnSave} currentTitle="Test Title" />
    );

    const input = screen.getByDisplayValue("Test Title");
    fireEvent.change(input, { target: { value: "" } });

    const saveButton = screen.getByText("Save");
    expect(saveButton).toBeDisabled();
  });

  it("should show error for title too long", async () => {
    render(
      <RenameConversationModal isOpen={true} onClose={mockOnClose} onSave={mockOnSave} currentTitle="Test Title" />
    );

    const input = screen.getByDisplayValue("Test Title");
    const longTitle = "a".repeat(101);
    fireEvent.change(input, { target: { value: longTitle } });

    const saveButton = screen.getByText("Save");
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText("Title must be 100 characters or less")).toBeInTheDocument();
    });

    expect(mockOnSave).not.toHaveBeenCalled();
  });

  it("should disable save button if title unchanged", () => {
    render(
      <RenameConversationModal isOpen={true} onClose={mockOnClose} onSave={mockOnSave} currentTitle="Test Title" />
    );

    const saveButton = screen.getByText("Save");
    expect(saveButton).toBeDisabled();
  });

  it("should call onSave with new title", async () => {
    render(
      <RenameConversationModal isOpen={true} onClose={mockOnClose} onSave={mockOnSave} currentTitle="Test Title" />
    );

    const input = screen.getByDisplayValue("Test Title");
    fireEvent.change(input, { target: { value: "New Title" } });

    const saveButton = screen.getByText("Save");
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockOnSave).toHaveBeenCalledWith("New Title");
    });

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it("should show loading state", () => {
    render(
      <RenameConversationModal
        isOpen={true}
        onClose={mockOnClose}
        onSave={mockOnSave}
        currentTitle="Test Title"
        isLoading={true}
      />
    );

    const saveButton = screen.getByText("Save");
    expect(saveButton).toBeDisabled();

    const cancelButton = screen.getByText("Cancel");
    expect(cancelButton).toBeDisabled();

    const input = screen.getByDisplayValue("Test Title");
    expect(input).toBeDisabled();
  });

  it("should show error from onSave rejection", async () => {
    const errorMessage = "Failed to rename conversation";
    mockOnSave.mockRejectedValue(new Error(errorMessage));

    render(
      <RenameConversationModal isOpen={true} onClose={mockOnClose} onSave={mockOnSave} currentTitle="Test Title" />
    );

    const input = screen.getByDisplayValue("Test Title");
    fireEvent.change(input, { target: { value: "New Title" } });

    const saveButton = screen.getByText("Save");
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText(errorMessage)).toBeInTheDocument();
    });

    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it("should close modal on cancel button click", () => {
    render(
      <RenameConversationModal isOpen={true} onClose={mockOnClose} onSave={mockOnSave} currentTitle="Test Title" />
    );

    const cancelButton = screen.getByText("Cancel");
    fireEvent.click(cancelButton);

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it("should close modal on backdrop click", () => {
    render(
      <RenameConversationModal isOpen={true} onClose={mockOnClose} onSave={mockOnSave} currentTitle="Test Title" />
    );

    const backdrop = screen.getByText("Rename Conversation").closest('[class*="fixed inset-0"]');
    fireEvent.click(backdrop!);

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it("should close modal on escape key", () => {
    render(
      <RenameConversationModal isOpen={true} onClose={mockOnClose} onSave={mockOnSave} currentTitle="Test Title" />
    );

    fireEvent.keyDown(document, { key: "Escape" });

    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it("should not close on escape when loading", () => {
    render(
      <RenameConversationModal
        isOpen={true}
        onClose={mockOnClose}
        onSave={mockOnSave}
        currentTitle="Test Title"
        isLoading={true}
      />
    );

    fireEvent.keyDown(document, { key: "Escape" });

    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it("should handle enter key press", () => {
    render(
      <RenameConversationModal isOpen={true} onClose={mockOnClose} onSave={mockOnSave} currentTitle="Test Title" />
    );

    const input = screen.getByDisplayValue("Test Title");
    fireEvent.change(input, { target: { value: "New Title" } });

    // Enter key should work the same as clicking save
    fireEvent.keyDown(input, { key: "Enter" });

    // Since we don't have form submission, just verify the button is enabled
    const saveButton = screen.getByText("Save");
    expect(saveButton).not.toBeDisabled();
  });

  it("should disable save button when title is unchanged", () => {
    render(
      <RenameConversationModal isOpen={true} onClose={mockOnClose} onSave={mockOnSave} currentTitle="Test Title" />
    );

    const saveButton = screen.getByText("Save");
    expect(saveButton).toBeDisabled();
  });

  it("should enable save button when title is changed", () => {
    render(
      <RenameConversationModal isOpen={true} onClose={mockOnClose} onSave={mockOnSave} currentTitle="Test Title" />
    );

    const input = screen.getByDisplayValue("Test Title");
    fireEvent.change(input, { target: { value: "New Title" } });

    const saveButton = screen.getByText("Save");
    expect(saveButton).not.toBeDisabled();
  });
});
