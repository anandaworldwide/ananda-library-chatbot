/**
 * SourcesList Component
 *
 * This component renders a list of sources used in generating a response.
 * It supports various types of sources including text, audio, and YouTube videos.
 *
 * Key features:
 * - Expandable/collapsible source items
 * - Render different content types (text, audio player, YouTube embed)
 * - Display source titles with links when available
 * - Show library names with optional links
 * - Expand/collapse all sources functionality
 * - Mobile-responsive design
 * - Markdown rendering for source content
 * - Analytics event logging for user interactions
 *
 * The component is designed to handle various metadata formats and
 * provide a consistent display across different source types.
 */

import React, { useState, useCallback } from "react";
import { Document } from "langchain/document";
import ReactMarkdown from "react-markdown";
import gfm from "remark-gfm";
import styles from "@/styles/Home.module.css";
import { collectionsConfig, CollectionKey } from "@/utils/client/collectionsConfig";
import { logEvent } from "@/utils/client/analytics";
import { AudioPlayer } from "./AudioPlayer";
import { getMappedLibraryName, getLibraryUrl } from "@/utils/client/libraryMappings";
import { DocMetadata } from "@/types/DocMetadata";
import { SiteConfig } from "@/types/siteConfig";

// Helper function to extract the title from document metadata.
const extractTitle = (metadata: DocMetadata): string => {
  return metadata.title || metadata["pdf.info.Title"] || "Unknown source";
};

interface SourcesListProps {
  sources: Document<DocMetadata>[];
  collectionName?: string | null;
  siteConfig?: SiteConfig | null;
  isSudoAdmin?: boolean;
}

// Function to transform YouTube URLs into embed URLs
const transformYouTubeUrl = (url: string, startTime: number | undefined) => {
  const urlObj = new URL(url);
  let videoId = "";
  if (urlObj.hostname === "youtu.be") {
    videoId = urlObj.pathname.slice(1);
  } else if (urlObj.hostname === "www.youtube.com" && urlObj.pathname.includes("watch")) {
    videoId = urlObj.searchParams.get("v") || "";
  }
  const baseUrl = `https://www.youtube.com/embed/${videoId}`;
  const params = new URLSearchParams(urlObj.search);
  params.set("start", Math.floor(startTime || 0).toString());
  params.set("rel", "0");
  return `${baseUrl}?${params.toString()}`;
};

const SourcesList: React.FC<SourcesListProps> = ({
  sources,
  collectionName = null,
  siteConfig,
  isSudoAdmin = false,
}) => {
  // DEBUG: Add logging for sources display debugging
  React.useEffect(() => {
    console.log(`🔍 SOURCELIST DEBUG: Component received ${sources.length} sources`);
    if (sources.length === 0) {
      console.log(`⚠️ SOURCELIST WARNING: No sources to display`);
    } else {
      console.log(`🔍 SOURCELIST DEBUG: First source:`, {
        hasPageContent: !!sources[0]?.pageContent,
        hasMetadata: !!sources[0]?.metadata,
        type: sources[0]?.metadata?.type,
        title: sources[0]?.metadata?.title,
      });
    }
  }, [sources]);

  // State hooks
  const [expandedSources, setExpandedSources] = useState<Set<number>>(new Set());
  const [showSourcesPopover, setShowSourcesPopover] = useState<boolean>(false);

  // Callback hooks
  const renderAudioPlayer = useCallback((doc: Document<DocMetadata>, index: number, isExpanded: boolean) => {
    if (doc.metadata.type === "audio" && doc.metadata.filename) {
      const audioId = `audio_${doc.metadata.file_hash}_${index}`;
      return (
        <div className="pt-1 pb-2">
          <AudioPlayer
            key={audioId}
            src={doc.metadata.filename}
            library={doc.metadata.library}
            startTime={doc.metadata.start_time ?? 0}
            audioId={audioId}
            lazyLoad={true}
            isExpanded={isExpanded}
          />
        </div>
      );
    }
    return null;
  }, []);

  const renderYouTubePlayer = useCallback((doc: Document<DocMetadata>) => {
    if (doc.metadata.type === "youtube") {
      if (!doc.metadata.url) {
        return <div className="text-red-500 mb-2">Error: YouTube URL is missing for this source.</div>;
      }
      const embedUrl = transformYouTubeUrl(doc.metadata.url, doc.metadata.start_time);
      return (
        <div className="aspect-video mb-7">
          <iframe
            className="h-full w-full rounded-lg"
            src={embedUrl}
            title={doc.metadata.title}
            style={{ border: "none" }}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          ></iframe>
        </div>
      );
    }
    return null;
  }, []);

  // Check if sources should be hidden based on site config
  const shouldHideSources = siteConfig?.hideSources && !isSudoAdmin;
  const shouldShowSimpleLink = siteConfig?.hideSources && isSudoAdmin;

  // Return null if sources should be hidden and user is not admin
  if (shouldHideSources) {
    return null;
  }

  // double colon separates parent title from the (child) source title,
  // e.g., "2009 Summer Clarity Magazine:: Letters of Encouragement". We here
  // replace double colon with right arrow.
  const formatTitle = (title: string | undefined) => (title || "").replace(/::/g, " > ");

  const displayCollectionName = collectionName ? collectionsConfig[collectionName as CollectionKey] : "";

  // Handle expanding/collapsing all sources
  const handleExpandAll = () => {
    if (expandedSources.size === sources.length) {
      setExpandedSources(new Set());
      logEvent("collapse_all_sources", "UI", "accordion");
    } else {
      setExpandedSources(new Set(sources.map((_, index) => index)));
      logEvent("expand_all_sources", "UI", "accordion");
    }
  };

  // Handle toggling individual source expansion
  const handleSourceToggle = (index: number) => {
    setExpandedSources((prev) => {
      const newSet = new Set(prev);
      const isExpanding = !newSet.has(index);
      if (isExpanding) {
        newSet.add(index);
        logEvent("expand_source", "UI", `expanded:${index}`);
      } else {
        newSet.delete(index);
        logEvent("collapse_source", "UI", `collapsed:${index}`);
      }
      return newSet;
    });
  };

  // Handle clicking on a source link
  const handleSourceClick = (e: React.MouseEvent<HTMLAnchorElement>, source: string) => {
    e.preventDefault(); // Prevent default link behavior
    logEvent("click_source", "UI", source);
    window.open(source, "_blank", "noopener,noreferrer"); // Open link manually
  };

  // Handle clicking on a library link
  const handleLibraryClick = (e: React.MouseEvent<HTMLAnchorElement>, library: string) => {
    e.preventDefault();
    const libraryUrl = getLibraryUrl(library);
    if (libraryUrl) {
      logEvent("click_library", "UI", library);
      window.open(libraryUrl, "_blank", "noopener,noreferrer");
    }
  };

  // Get the appropriate icon for each source type
  const getSourceIcon = (doc: Document<DocMetadata>) => {
    switch (doc.metadata.type) {
      case "audio":
        return "mic";
      case "youtube":
        return "videocam";
      default:
        return "description";
    }
  };

  // Render the title of a source, including a link if available
  const renderSourceTitle = (doc: Document<DocMetadata>) => {
    // Extract the title using the helper function
    let sourceTitle = formatTitle(extractTitle(doc.metadata));

    // For audio sources with album metadata, format as "Album > Title"
    if (doc.metadata.type === "audio" && doc.metadata.album) {
      sourceTitle = `${doc.metadata.album} > ${sourceTitle}`;
    }

    // All source titles should be non-clickable to encourage proper interaction patterns:
    // - Audio: expand to use inline player with download button
    // - YouTube: expand to use inline video player
    // - Text: expand to read content with "Go to source" button
    return <span className="text-black font-medium">{sourceTitle}</span>;
  };

  // Render a PDF download button if pdf_s3_key exists
  const renderPdfDownloadButton = (doc: Document<DocMetadata>) => {
    if (!doc.metadata.pdf_s3_key) {
      return null;
    }

    const handlePdfDownload = async (e: React.MouseEvent) => {
      e.preventDefault();

      try {
        logEvent("download_pdf", "UI", doc.metadata.pdf_s3_key || "unknown");

        // Call API to get signed URL
        const response = await fetch("/api/getPdfSignedUrl", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ pdfS3Key: doc.metadata.pdf_s3_key }),
        });

        if (!response.ok) {
          throw new Error("Failed to get download URL");
        }

        const { signedUrl } = await response.json();

        // Open the signed URL in a new tab to trigger download
        window.open(signedUrl, "_blank");
      } catch (error) {
        console.error("Error downloading PDF:", error);
        // TODO: Show user-friendly error message
      }
    };

    return (
      <button
        onClick={handlePdfDownload}
        className="inline-flex items-center gap-2 px-3 py-1.5 text-sm bg-green-50 hover:bg-green-100 text-green-700 rounded-md transition-colors"
      >
        <span className="material-icons text-sm">download</span>
        Download PDF
      </button>
    );
  };

  // Render a "Go to source" button for text sources
  const renderGoToSourceButton = (doc: Document<DocMetadata>) => {
    const linkUrl = doc.metadata.source;

    if (!linkUrl || doc.metadata.type !== "text") {
      return null;
    }

    return (
      <button
        onClick={(e) => {
          e.preventDefault();
          handleSourceClick(e as any, linkUrl);
        }}
        className="inline-flex items-center gap-2 px-3 py-1.5 text-sm bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-md transition-colors"
      >
        <span className="material-icons text-sm">open_in_new</span>
        Go to source
      </button>
    );
  };

  // Render the library name, including a link if available
  const renderLibraryName = (doc: Document<DocMetadata>) => {
    const libraryName = getMappedLibraryName(doc.metadata.library);
    const libraryUrl = getLibraryUrl(doc.metadata.library);

    return libraryUrl ? (
      <a
        href={libraryUrl}
        onClick={(e) => handleLibraryClick(e, doc.metadata.library)}
        className={`${styles.libraryNameLink} text-gray-400 hover:text-gray-600 text-sm hover:underline`}
      >
        {libraryName}
      </a>
    ) : (
      <span className={`${styles.libraryNameText} text-gray-400 text-sm`}>{libraryName}</span>
    );
  };

  // Simple link view for admins when sources are hidden
  if (shouldShowSimpleLink) {
    return (
      <div className="relative">
        <button
          onClick={() => setShowSourcesPopover(!showSourcesPopover)}
          className="text-blue-600 hover:underline text-sm"
        >
          {showSourcesPopover ? "Admin: Hide sources" : "Admin: Show sources"}
        </button>

        {showSourcesPopover && (
          <>
            {/* Backdrop */}
            <div className="fixed inset-0 bg-black bg-opacity-50 z-40" onClick={() => setShowSourcesPopover(false)} />

            {/* Popover */}
            <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white rounded-lg shadow-xl p-6 z-50 max-w-2xl w-full max-h-[80vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold">Sources</h3>
                <button onClick={() => setShowSourcesPopover(false)} className="text-gray-500 hover:text-gray-700">
                  <span className="material-icons">close</span>
                </button>
              </div>

              <div className="space-y-4">
                {sources.map((doc, index) => (
                  <div key={index} className="border-b border-gray-200 pb-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="material-icons text-sm">{getSourceIcon(doc)}</span>
                      {renderSourceTitle(doc)}
                      {doc.metadata.library && doc.metadata.library !== "Default Library" && (
                        <span className="text-gray-400 text-sm ml-auto">{renderLibraryName(doc)}</span>
                      )}
                    </div>
                    {doc.metadata.type === "audio" && renderAudioPlayer(doc, index, true)}
                    {doc.metadata.type === "youtube" && renderYouTubePlayer(doc)}
                    <ReactMarkdown
                      remarkPlugins={[gfm]}
                      components={{
                        a: ({ ...props }) => <a target="_blank" rel="noopener noreferrer" {...props} />,
                      }}
                    >
                      {doc.pageContent}
                    </ReactMarkdown>
                    <div className="mt-2 mb-3 flex gap-2">
                      {renderPdfDownloadButton(doc)}
                      {renderGoToSourceButton(doc)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  // Regular view (unchanged)
  return (
    <div className="bg-white sourcesContainer pb-4">
      {/* Render sources header if there are sources */}
      {sources.length > 0 && (
        <div
          className={`flex justify-between items-center w-full px-3 py-1 ${!shouldHideSources || (shouldHideSources && isSudoAdmin) ? "border-b border-gray-200" : ""}`}
        >
          <div className="flex items-baseline">
            {!shouldHideSources && <h3 className="text-base font-bold mr-2">Sources</h3>}
            {shouldHideSources ? (
              isSudoAdmin && (
                <button
                  onClick={() => setShowSourcesPopover(!showSourcesPopover)}
                  className="text-sm text-blue-600 hover:underline"
                >
                  {showSourcesPopover ? "(hide sources)" : "(show sources)"}
                </button>
              )
            ) : (
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  handleExpandAll();
                }}
                className="text-sm text-blue-600 hover:underline"
              >
                {expandedSources.size === sources.length ? "(collapse all)" : "(expand all)"}
              </a>
            )}
          </div>
          {displayCollectionName && <span className="text-sm text-gray-400">{displayCollectionName}</span>}
        </div>
      )}
      {(!shouldHideSources || (shouldHideSources && showSourcesPopover)) && (
        <div className="px-3">
          {/* Render each source as an expandable details element */}
          {sources.map((doc, index) => {
            const isExpanded = expandedSources.has(index);
            const isLastSource = index === sources.length - 1;
            return (
              <details
                key={index}
                className={`${styles.sourceDocsContainer} ${isLastSource ? "" : "border-b border-gray-200"} group`}
                open={isExpanded}
              >
                {/* Source summary (always visible) */}
                <summary
                  onClick={(e) => {
                    e.preventDefault();
                    handleSourceToggle(index);
                  }}
                  className="flex items-center cursor-pointer list-none py-1 px-2 hover:bg-gray-50"
                >
                  <div className="grid grid-cols-[auto_1fr_auto] items-center w-full gap-2">
                    <div className="flex items-center">
                      <span className="inline-block w-4 h-4 transition-transform duration-200 transform group-open:rotate-90 arrow-icon">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                          className="w-4 h-4"
                        >
                          <path
                            fillRule="evenodd"
                            d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </span>
                      <span className="material-icons text-sm ml-1">{getSourceIcon(doc)}</span>
                    </div>
                    <div className="flex items-center">{renderSourceTitle(doc)}</div>
                    <div className="text-right">
                      {doc.metadata.library && doc.metadata.library !== "Default Library" && renderLibraryName(doc)}
                    </div>
                  </div>
                </summary>
                {/* Expanded source content */}
                <div className="pl-5 pb-1">
                  {isExpanded && (
                    <>
                      {/* Render audio or YouTube player if applicable */}
                      {doc.metadata && doc.metadata.type === "audio" && renderAudioPlayer(doc, index, isExpanded)}
                      {doc.metadata && doc.metadata.type === "youtube" && renderYouTubePlayer(doc)}
                    </>
                  )}
                  {/* Render source content as markdown */}
                  <ReactMarkdown
                    remarkPlugins={[gfm]}
                    components={{
                      a: ({ ...props }) => <a target="_blank" rel="noopener noreferrer" {...props} />,
                    }}
                  >
                    {doc.pageContent}
                  </ReactMarkdown>
                  {/* Render PDF download and Go to source buttons */}
                  <div className="mt-2 mb-3 flex gap-2">
                    {renderPdfDownloadButton(doc)}
                    {renderGoToSourceButton(doc)}
                  </div>
                </div>
              </details>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SourcesList;
