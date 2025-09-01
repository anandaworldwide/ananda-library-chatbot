// Floating feedback button component that appears in the bottom right corner
import React from "react";
import Link from "next/link";
import { SiteConfig } from "@/types/siteConfig";

interface FeedbackButtonProps {
  siteConfig: SiteConfig | null;
}

// Get feedback icon based on site configuration
const getFeedbackIcon = (siteConfig: SiteConfig | null): string => {
  if (!siteConfig?.feedbackIcon) return "/bot-image.png"; // Default fallback
  return `/${siteConfig.feedbackIcon}`;
};

const FeedbackButton: React.FC<FeedbackButtonProps> = ({ siteConfig }) => {
  const feedbackIcon = getFeedbackIcon(siteConfig);

  return (
    <div className="fixed bottom-6 right-6 z-40">
      <Link
        href="/contact?mode=feedback"
        className="flex items-center bg-white rounded-full shadow-lg hover:shadow-xl transition-all duration-300 ease-in-out px-4 py-2 space-x-3"
        aria-label="Give feedback"
      >
        {/* Profile photo on the left */}
        <img
          src={feedbackIcon}
          alt="Feedback"
          className="w-10 h-10 rounded-full object-cover flex-shrink-0"
          onError={(e) => {
            // Fallback to default icon if site-specific icon fails to load
            const target = e.target as HTMLImageElement;
            if (target.src !== "/bot-image.png") {
              target.src = "/bot-image.png";
            }
          }}
        />

        {/* Feedback text on the right */}
        <span className="text-gray-800 text-sm font-medium whitespace-nowrap pr-1">Feedback</span>
      </Link>
    </div>
  );
};

export default FeedbackButton;
