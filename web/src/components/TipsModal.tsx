/**
 * TipsModal Component
 *
 * This component displays site-specific tips and tricks in a modal dialog.
 * It loads content from site-specific files and presents them in a user-friendly format.
 *
 * Key features:
 * - Site-specific content loading from /data/[siteId]/tips.txt
 * - Modal overlay with backdrop click to close
 * - Keyboard accessibility (Escape key to close)
 * - Loading and error states
 * - Responsive design
 */

import React, { useState, useEffect } from "react";
import { SiteConfig } from "@/types/siteConfig";
import { loadSiteTips } from "@/utils/client/loadTips";
import { logEvent } from "@/utils/client/analytics";

interface TipsModalProps {
  isOpen: boolean;
  onClose: () => void;
  siteConfig: SiteConfig | null;
}

export const TipsModal: React.FC<TipsModalProps> = ({ isOpen, onClose, siteConfig }) => {
  const [tipsContent, setTipsContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load tips content when modal opens
  useEffect(() => {
    if (isOpen && siteConfig) {
      setIsLoading(true);
      setError(null);

      loadSiteTips(siteConfig)
        .then((content) => {
          setTipsContent(content);
          if (content) {
            logEvent("tips_content_loaded", "UI", siteConfig.siteId || "unknown");
          }
        })
        .catch((err) => {
          console.error("Failed to load tips:", err);
          setError("Failed to load tips content");
          logEvent("tips_load_error", "UI", siteConfig.siteId || "unknown");
        })
        .finally(() => {
          setIsLoading(false);
        });
    }
  }, [isOpen, siteConfig]);

  // Handle Escape key to close modal
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isOpen) {
        onClose();
        logEvent("tips_modal_close", "UI", "escape_key");
      }
    };

    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
    }

    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen, onClose]);

  // Handle backdrop click to close modal
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
      logEvent("tips_modal_close", "UI", "backdrop_click");
    }
  };

  // Handle close button click
  const handleCloseClick = () => {
    onClose();
    logEvent("tips_modal_close", "UI", "close_button");
  };

  // Don't render if not open
  if (!isOpen) {
    return null;
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 backdrop-blur-sm z-[100]"
        onClick={handleBackdropClick}
        aria-hidden="true"
      />

      {/* Modal */}
      <div className="fixed z-[101] top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white p-6 rounded-lg shadow-lg max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto">
        {/* Header */}
        <div className="flex justify-between items-start mb-4">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center">
            <span className="material-icons text-blue-500 mr-2">lightbulb</span>
            Tips & Tricks
          </h3>
          <button
            onClick={handleCloseClick}
            className="text-gray-500 hover:text-gray-700 transition-colors"
            aria-label="Close tips"
          >
            <span className="material-icons">close</span>
          </button>
        </div>

        {/* Content */}
        <div className="space-y-4">
          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
              <span className="ml-3 text-gray-600">Loading tips...</span>
            </div>
          )}

          {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
              <span className="block sm:inline">{error}</span>
            </div>
          )}

          {!isLoading && !error && !tipsContent && (
            <div className="text-center py-8 text-gray-600">
              <span className="material-icons text-4xl mb-2 block text-gray-400">info</span>
              No tips available for this site yet.
            </div>
          )}

          {!isLoading && !error && tipsContent && (
            <div className="prose prose-sm max-w-none">
              {/* Split content by double newlines to create paragraphs */}
              {tipsContent.split("\n\n").map((paragraph, index) => {
                // Check if this paragraph looks like a heading (short line, often first paragraph)
                const isHeading = index === 0 && paragraph.length < 100 && !paragraph.includes(".");

                if (isHeading) {
                  return (
                    <h4 key={index} className="text-lg font-semibold text-gray-900 mb-3">
                      {paragraph}
                    </h4>
                  );
                } else {
                  return (
                    <p key={index} className="text-gray-700 leading-relaxed mb-4">
                      {paragraph}
                    </p>
                  );
                }
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        {!isLoading && !error && tipsContent && (
          <div className="mt-6 pt-4 border-t border-gray-200">
            <p className="text-xs text-gray-500 text-center">
              Have suggestions for more tips? Use the feedback button to let us know!
            </p>
          </div>
        )}
      </div>
    </>
  );
};
