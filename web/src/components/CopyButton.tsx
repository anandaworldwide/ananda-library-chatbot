import React from 'react';
import { copyTextToClipboard } from '../utils/client/clipboard';
import { logEvent } from '@/utils/client/analytics';
import { Converter } from 'showdown';
import { Document } from 'langchain/document';
import { DocMetadata } from '@/types/DocMetadata';
import { getSiteName } from '@/utils/client/siteConfig';
import { SiteConfig } from '@/types/siteConfig';

interface CopyButtonProps {
  markdown: string;
  answerId?: string;
  sources?: Document<DocMetadata>[];
  question: string;
  siteConfig: SiteConfig | null;
}

const CopyButton: React.FC<CopyButtonProps> = ({
  markdown,
  answerId,
  sources,
  question,
  siteConfig,
}) => {
  const [copied, setCopied] = React.useState(false);

  const convertMarkdownToHtml = (markdown: string): string => {
    const converter = new Converter();
    return converter.makeHtml(markdown);
  };

  const formatSecondsToHHMMSS = (totalSecondsInput: number): string => {
    if (totalSecondsInput < 0) return '';
    if (totalSecondsInput === 0) return '0:00';

    let totalSeconds = Math.floor(totalSecondsInput);
    const hours = Math.floor(totalSeconds / 3600);
    totalSeconds %= 3600;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const formatSources = (sources: Document<DocMetadata>[]): string => {
    return sources
      .map((doc) => {
        const title = doc.metadata.title || 'Unknown source';
        const collection = doc.metadata.library || '';
        const sourceUrlProp = doc.metadata.source;
        const youtubeUrlProp = doc.metadata.url;
        const startTime = doc.metadata.start_time; // in seconds
        const type = doc.metadata.type;

        let markdownUrl = '';
        let timeSuffixDisplay = '';

        if (type === 'youtube' && youtubeUrlProp) {
          markdownUrl = youtubeUrlProp;
          if (typeof startTime === 'number' && startTime >= 0) {
            try {
              const urlObj = new URL(markdownUrl);
              urlObj.searchParams.set('t', String(Math.floor(startTime)));
              markdownUrl = urlObj.toString();
            } catch (e) {
              // console.warn(`Invalid YouTube URL, cannot append time: ${markdownUrl}`);
              // If URL is invalid, markdownUrl remains the original youtubeUrlProp
            }
          }
        } else if (type === 'audio') {
          if (sourceUrlProp) {
            markdownUrl = sourceUrlProp;
          }
          if (typeof startTime === 'number' && startTime >= 0) {
            const formattedTime = formatSecondsToHHMMSS(startTime); // Handles 0 to "0:00"
            timeSuffixDisplay = ` (starting at ${formattedTime})`;
          }
        } else if (sourceUrlProp) {
          // Other types with a sourceUrl
          markdownUrl = sourceUrlProp;
        } else if (youtubeUrlProp) {
          // Other types with a youtubeUrl (e.g. generic video type)
          markdownUrl = youtubeUrlProp;
        }

        if (markdownUrl) {
          return `- [${title}](${markdownUrl})${timeSuffixDisplay} (${collection})`;
        } else {
          return `- ${title}${timeSuffixDisplay} (${collection})`;
        }
      })
      .join('\n');
  };

  const handleCopy = async () => {
    let contentToCopy = `## Question:\n\n${question}\n\n## Answer:\n\n${markdown}`;

    if (sources && sources.length > 0 && !siteConfig?.hideSources) {
      contentToCopy += '\n\n### Sources\n' + formatSources(sources);
    }

    contentToCopy +=
      `\n\n### From:\n\n[${getSiteName(siteConfig)}](` +
      `${process.env.NEXT_PUBLIC_BASE_URL}/answers/${answerId}` +
      ')';
    const htmlContent = convertMarkdownToHtml(contentToCopy);
    await copyTextToClipboard(htmlContent, true);
    setCopied(true);
    setTimeout(() => setCopied(false), 1000);

    // Log the event to Google Analytics
    logEvent('copy_answer', 'UI', answerId || 'unknown');
  };

  return (
    <button
      onClick={handleCopy}
      className="p-1 rounded hover:bg-gray-200"
      title="Copy answer to clipboard"
    >
      {copied ? (
        <span className="material-icons">check</span>
      ) : (
        <span className="material-icons">content_copy</span>
      )}
    </button>
  );
};

export default CopyButton;
