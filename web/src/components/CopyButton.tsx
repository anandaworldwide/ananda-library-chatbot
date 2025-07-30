import React from "react";
import { copyTextToClipboard } from "../utils/client/clipboard";
import { logEvent } from "@/utils/client/analytics";
import { Converter } from "showdown";
import { Document } from "langchain/document";
import { DocMetadata } from "@/types/DocMetadata";
import { getSiteName } from "@/utils/client/siteConfig";
import { SiteConfig } from "@/types/siteConfig";
import { getCachedPublicAudioUrl } from "@/utils/client/getPublicAudioUrl";

interface CopyButtonProps {
  markdown: string;
  answerId?: string;
  sources?: Document<DocMetadata>[];
  question: string;
  siteConfig: SiteConfig | null;
}

const CopyButton: React.FC<CopyButtonProps> = ({ markdown, answerId, sources, question, siteConfig }) => {
  const [copied, setCopied] = React.useState(false);

  const convertMarkdownToHtml = (markdown: string): string => {
    const converter = new Converter();
    return converter.makeHtml(markdown);
  };

  const formatSecondsToHHMMSS = (totalSecondsInput: number): string => {
    if (totalSecondsInput < 0) return "";
    if (totalSecondsInput === 0) return "0:00";

    let totalSeconds = Math.floor(totalSecondsInput);
    const hours = Math.floor(totalSeconds / 3600);
    totalSeconds %= 3600;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
    }
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  const formatSources = async (sources: Document<DocMetadata>[]): Promise<string> => {
    const formattedSources = await Promise.all(
      sources.map(async (doc) => {
        const title = doc.metadata.title || "Unknown source";
        const collection = doc.metadata.library || "";
        const sourceUrlProp = doc.metadata.source;
        const youtubeUrlProp = doc.metadata.url;
        const startTime = doc.metadata.start_time; // in seconds
        const type = doc.metadata.type;

        let markdownUrl = "";
        let timeSuffixDisplay = "";

        if (type === "youtube" && youtubeUrlProp) {
          markdownUrl = youtubeUrlProp;
          if (typeof startTime === "number" && startTime >= 0) {
            try {
              const urlObj = new URL(markdownUrl);
              urlObj.searchParams.set("t", String(Math.floor(startTime)));
              markdownUrl = urlObj.toString();
            } catch (e) {
              // console.warn(`Invalid YouTube URL, cannot append time: ${markdownUrl}`);
              // If URL is invalid, markdownUrl remains the original youtubeUrlProp
            }
          }
        } else if (type === "audio") {
          if (doc.metadata.filename) {
            // Use public (non-expiring) audio URL generation for copying/sharing
            try {
              markdownUrl = await getCachedPublicAudioUrl(doc.metadata.filename, doc.metadata.library);
            } catch (error) {
              console.error("Failed to generate public audio URL for copying:", error);
              // Fallback to source URL if public URL generation fails
              if (sourceUrlProp) {
                markdownUrl = sourceUrlProp;
              } else {
                throw new Error("Unable to generate audio URL for copying");
              }
            }
          } else if (sourceUrlProp) {
            // Fallback to metadata.source if filename is not available
            markdownUrl = sourceUrlProp;
          }

          if (typeof startTime === "number" && startTime >= 0) {
            const formattedTime = formatSecondsToHHMMSS(startTime); // Handles 0 to "0:00"
            timeSuffixDisplay = formattedTime;
          }
        } else if (sourceUrlProp) {
          // Other types with a sourceUrl
          markdownUrl = sourceUrlProp;
        } else if (youtubeUrlProp) {
          // Other types with a youtubeUrl (e.g. generic video type)
          markdownUrl = youtubeUrlProp;
        }

        if (markdownUrl) {
          return `- [${title}](${markdownUrl}) (${collection})${timeSuffixDisplay ? ` → ${timeSuffixDisplay}` : ""}`;
        } else {
          return `- ${title} (${collection})${timeSuffixDisplay ? ` → ${timeSuffixDisplay}` : ""}`;
        }
      })
    );
    return formattedSources.join("\n");
  };

  const handleCopy = async () => {
    let contentToCopy = `## Question:\n\n${question}\n\n## Answer:\n\n${markdown}`;

    if (sources && sources.length > 0 && !siteConfig?.hideSources) {
      contentToCopy += "\n\n### Sources\n" + (await formatSources(sources));
    }

    contentToCopy +=
      `\n\n### From:\n\n[${getSiteName(siteConfig)}](` +
      `${process.env.NEXT_PUBLIC_BASE_URL}/answers/${answerId}` +
      ")";
    const htmlContent = convertMarkdownToHtml(contentToCopy);
    await copyTextToClipboard(htmlContent, true);
    setCopied(true);
    setTimeout(() => setCopied(false), 1000);

    // Log the event to Google Analytics.
    logEvent("copy_answer", "UI", answerId || "unknown");
  };

  return (
    <button onClick={handleCopy} className="p-1 rounded hover:bg-gray-200" title="Copy answer to clipboard">
      {copied ? <span className="material-icons">check</span> : <span className="material-icons">content_copy</span>}
    </button>
  );
};

export default CopyButton;
