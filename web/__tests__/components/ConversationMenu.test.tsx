import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ConversationMenu from "@/components/ConversationMenu";

describe("ConversationMenu", () => {
  const mockOnRename = jest.fn();
  const mockOnDelete = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should not render when not visible", () => {
    render(<ConversationMenu isVisible={false} onRename={mockOnRename} onDelete={mockOnDelete} />);

    expect(screen.queryByRole("button", { name: /conversation options/i })).not.toBeInTheDocument();
  });

  it("should render three-dot button when visible", () => {
    render(<ConversationMenu isVisible={true} onRename={mockOnRename} onDelete={mockOnDelete} />);

    expect(screen.getByRole("button", { name: /conversation options/i })).toBeInTheDocument();
  });

  it("should show menu when three-dot button is clicked", () => {
    render(<ConversationMenu isVisible={true} onRename={mockOnRename} onDelete={mockOnDelete} />);

    const menuButton = screen.getByRole("button", { name: /conversation options/i });
    fireEvent.click(menuButton);

    expect(screen.getByText("Rename")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeInTheDocument();
  });

  it("should hide menu when three-dot button is clicked again", () => {
    render(<ConversationMenu isVisible={true} onRename={mockOnRename} onDelete={mockOnDelete} />);

    const menuButton = screen.getByRole("button", { name: /conversation options/i });

    // Open menu
    fireEvent.click(menuButton);
    expect(screen.getByText("Rename")).toBeInTheDocument();

    // Close menu
    fireEvent.click(menuButton);
    expect(screen.queryByText("Rename")).not.toBeInTheDocument();
  });

  it("should call onRename when rename option is clicked", () => {
    render(<ConversationMenu isVisible={true} onRename={mockOnRename} onDelete={mockOnDelete} />);

    const menuButton = screen.getByRole("button", { name: /conversation options/i });
    fireEvent.click(menuButton);

    const renameButton = screen.getByText("Rename");
    fireEvent.click(renameButton);

    expect(mockOnRename).toHaveBeenCalledTimes(1);
  });

  it("should call onDelete when delete option is clicked", () => {
    render(<ConversationMenu isVisible={true} onRename={mockOnRename} onDelete={mockOnDelete} />);

    const menuButton = screen.getByRole("button", { name: /conversation options/i });
    fireEvent.click(menuButton);

    const deleteButton = screen.getByText("Delete");
    fireEvent.click(deleteButton);

    expect(mockOnDelete).toHaveBeenCalledTimes(1);
  });

  it("should close menu when rename option is clicked", () => {
    render(<ConversationMenu isVisible={true} onRename={mockOnRename} onDelete={mockOnDelete} />);

    const menuButton = screen.getByRole("button", { name: /conversation options/i });
    fireEvent.click(menuButton);

    const renameButton = screen.getByText("Rename");
    fireEvent.click(renameButton);

    expect(screen.queryByText("Rename")).not.toBeInTheDocument();
  });

  it("should close menu when delete option is clicked", () => {
    render(<ConversationMenu isVisible={true} onRename={mockOnRename} onDelete={mockOnDelete} />);

    const menuButton = screen.getByRole("button", { name: /conversation options/i });
    fireEvent.click(menuButton);

    const deleteButton = screen.getByText("Delete");
    fireEvent.click(deleteButton);

    expect(screen.queryByText("Delete")).not.toBeInTheDocument();
  });

  it("should close menu when clicking outside", async () => {
    render(
      <div>
        <ConversationMenu isVisible={true} onRename={mockOnRename} onDelete={mockOnDelete} />
        <div data-testid="outside">Outside element</div>
      </div>
    );

    const menuButton = screen.getByRole("button", { name: /conversation options/i });
    fireEvent.click(menuButton);

    expect(screen.getByText("Rename")).toBeInTheDocument();

    // Click outside
    const outsideElement = screen.getByTestId("outside");
    fireEvent.mouseDown(outsideElement);

    await waitFor(() => {
      expect(screen.queryByText("Rename")).not.toBeInTheDocument();
    });
  });

  it("should close menu when parent becomes invisible", () => {
    const { rerender } = render(<ConversationMenu isVisible={true} onRename={mockOnRename} onDelete={mockOnDelete} />);

    const menuButton = screen.getByRole("button", { name: /conversation options/i });
    fireEvent.click(menuButton);

    expect(screen.getByText("Rename")).toBeInTheDocument();

    // Make parent invisible
    rerender(<ConversationMenu isVisible={false} onRename={mockOnRename} onDelete={mockOnDelete} />);

    expect(screen.queryByText("Rename")).not.toBeInTheDocument();
  });

  it("should prevent event propagation on menu button click", () => {
    const mockParentClick = jest.fn();

    render(
      <div onClick={mockParentClick}>
        <ConversationMenu isVisible={true} onRename={mockOnRename} onDelete={mockOnDelete} />
      </div>
    );

    const menuButton = screen.getByRole("button", { name: /conversation options/i });
    fireEvent.click(menuButton);

    expect(mockParentClick).not.toHaveBeenCalled();
  });

  it("should prevent event propagation on menu option clicks", () => {
    const mockParentClick = jest.fn();

    render(
      <div onClick={mockParentClick}>
        <ConversationMenu isVisible={true} onRename={mockOnRename} onDelete={mockOnDelete} />
      </div>
    );

    const menuButton = screen.getByRole("button", { name: /conversation options/i });
    fireEvent.click(menuButton);

    const renameButton = screen.getByText("Rename");
    fireEvent.click(renameButton);

    expect(mockParentClick).not.toHaveBeenCalled();
    expect(mockOnRename).toHaveBeenCalledTimes(1);
  });

  it("should render menu with portal when opened", () => {
    // Mock getBoundingClientRect for positioning calculations
    const mockGetBoundingClientRect = jest.fn(() => ({
      bottom: 100,
      right: 200,
      top: 80,
      left: 180,
      width: 20,
      height: 20,
    }));

    render(<ConversationMenu isVisible={true} onRename={mockOnRename} onDelete={mockOnDelete} />);

    const menuButton = screen.getByRole("button", { name: /conversation options/i });

    // Mock the button ref
    Object.defineProperty(menuButton, "getBoundingClientRect", {
      value: mockGetBoundingClientRect,
    });

    fireEvent.click(menuButton);

    // Menu should be rendered in portal (document.body)
    const menuItems = screen.getAllByRole("button");
    expect(menuItems.length).toBeGreaterThan(1); // Menu button + menu items
    expect(screen.getByText("Rename")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeInTheDocument();
  });

  it("should close menu on scroll event", async () => {
    render(<ConversationMenu isVisible={true} onRename={mockOnRename} onDelete={mockOnDelete} />);

    const menuButton = screen.getByRole("button", { name: /conversation options/i });
    fireEvent.click(menuButton);

    expect(screen.getByText("Rename")).toBeInTheDocument();

    // Simulate scroll event
    fireEvent.scroll(window);

    await waitFor(() => {
      expect(screen.queryByText("Rename")).not.toBeInTheDocument();
    });
  });
});
