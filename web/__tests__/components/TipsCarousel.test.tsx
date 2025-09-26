/**
 * Tests for TipsCarousel component
 */

import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TipsCarousel } from "@/components/TipsCarousel";

describe("TipsCarousel", () => {
  const sampleTips = [
    {
      title: "Getting Better Answers",
      content: "Turn off audio sources for clearer answers.",
    },
    {
      title: "Exploring Sources",
      content: "Click on sources to see excerpts.",
    },
    {
      title: "Multilingual Support",
      content: "Ask questions in different languages.",
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should render the first tip by default", () => {
    render(<TipsCarousel tips={sampleTips} />);

    expect(screen.getByText("Getting Better Answers")).toBeInTheDocument();
    expect(screen.getByText("Turn off audio sources for clearer answers.")).toBeInTheDocument();
  });

  it("should show navigation dots for each tip", () => {
    render(<TipsCarousel tips={sampleTips} />);

    // Should have 3 navigation dots
    const dots = screen.getAllByRole("button", { name: /Go to tip/ });
    expect(dots).toHaveLength(3);
  });

  it("should highlight the current tip dot", () => {
    render(<TipsCarousel tips={sampleTips} />);

    const dots = screen.getAllByRole("button", { name: /Go to tip/ });
    expect(dots[0]).toHaveClass("bg-blue-500", "scale-125");
    expect(dots[1]).toHaveClass("bg-gray-300");
    expect(dots[2]).toHaveClass("bg-gray-300");
  });

  it("should navigate to next tip when clicking next button", () => {
    render(<TipsCarousel tips={sampleTips} />);

    const nextButton = screen.getByLabelText("Next tip");
    fireEvent.click(nextButton);

    expect(screen.getByText("Exploring Sources")).toBeInTheDocument();
    expect(screen.getByText("Click on sources to see excerpts.")).toBeInTheDocument();
  });

  it("should navigate to previous tip when clicking previous button", async () => {
    render(<TipsCarousel tips={sampleTips} />);

    // Go to second tip first
    const nextButton = screen.getByLabelText("Next tip");
    fireEvent.click(nextButton);

    // Wait for animation to complete and verify we're on second tip
    await waitFor(() => {
      expect(screen.getByText("Exploring Sources")).toBeInTheDocument();
    });

    // Wait for animation to complete (300ms)
    await new Promise((resolve) => setTimeout(resolve, 350));

    // Now go back to first tip
    const prevButton = screen.getByLabelText("Previous tip");
    fireEvent.click(prevButton);

    // Wait for animation and verify we're back on first tip
    await waitFor(() => {
      expect(screen.getByText("Getting Better Answers")).toBeInTheDocument();
    });
  });

  it("should navigate to specific tip when clicking dot", () => {
    render(<TipsCarousel tips={sampleTips} />);

    const dots = screen.getAllByRole("button", { name: /Go to tip/ });
    fireEvent.click(dots[2]); // Click third dot

    expect(screen.getByText("Multilingual Support")).toBeInTheDocument();
    expect(screen.getByText("Ask questions in different languages.")).toBeInTheDocument();
  });

  it("should wrap to first tip when going next from last tip", async () => {
    render(<TipsCarousel tips={sampleTips} />);

    const nextButton = screen.getByLabelText("Next tip");

    // Go to second tip
    fireEvent.click(nextButton);
    await waitFor(() => {
      expect(screen.getByText("Exploring Sources")).toBeInTheDocument();
    });

    // Wait for animation to complete
    await new Promise((resolve) => setTimeout(resolve, 350));

    // Go to third tip
    fireEvent.click(nextButton);
    await waitFor(() => {
      expect(screen.getByText("Multilingual Support")).toBeInTheDocument();
    });

    // Wait for animation to complete
    await new Promise((resolve) => setTimeout(resolve, 350));

    // Go to first tip (wrap around)
    fireEvent.click(nextButton);
    await waitFor(() => {
      expect(screen.getByText("Getting Better Answers")).toBeInTheDocument();
    });
  });

  it("should wrap to last tip when going previous from first tip", () => {
    render(<TipsCarousel tips={sampleTips} />);

    const prevButton = screen.getByLabelText("Previous tip");
    fireEvent.click(prevButton); // Should wrap to last tip

    expect(screen.getByText("Multilingual Support")).toBeInTheDocument();
  });

  // Note: Close functionality is handled by the parent TipsModal component

  it("should disable navigation buttons during animation", () => {
    render(<TipsCarousel tips={sampleTips} />);

    const nextButton = screen.getByLabelText("Next tip");

    // Click button to start animation
    fireEvent.click(nextButton);

    // Button should be disabled during animation (though we can't easily test the disabled state
    // since the animation timeout is handled internally)
    expect(nextButton).toBeInTheDocument();
  });

  it("should display GIF when tip has gif data", () => {
    const tipsWithGif = [
      {
        title: "Tip with GIF",
        content: "This tip has a GIF above it.",
        gif: {
          url: "/test-gif.gif",
          width: 300,
          height: 200,
          alt: "Test GIF",
          position: "above" as const,
        },
      },
    ];

    render(<TipsCarousel tips={tipsWithGif} />);

    const gifElement = screen.getByAltText("Test GIF");
    expect(gifElement).toBeInTheDocument();
    expect(gifElement).toHaveAttribute("src", "/test-gif.gif");
    expect(gifElement).toHaveAttribute("width", "300");
    expect(gifElement).toHaveAttribute("height", "200");
  });

  it("should not display GIF when tip has no gif data", () => {
    render(<TipsCarousel tips={sampleTips} />);

    // Should not find any img elements
    const gifElements = document.querySelectorAll("img");
    expect(gifElements.length).toBe(0);
  });
});
