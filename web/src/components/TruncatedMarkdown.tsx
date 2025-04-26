import React, { useState, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import gfm from 'remark-gfm';
import { SiteConfig } from '@/types/siteConfig';
import { Components } from 'react-markdown';

interface TruncatedMarkdownProps {
  markdown: string;
  maxCharacters: number;
  siteConfig?: SiteConfig | null;
}

const TruncatedMarkdown: React.FC<TruncatedMarkdownProps> = ({
  markdown = '',
  maxCharacters,
  siteConfig,
}) => {
  const [isTruncated, setIsTruncated] = useState(true);

  const shouldTruncate = markdown.length >= maxCharacters * 1.1;

  const displayedMarkdown = useMemo(() => {
    if (!markdown) return '';

    const endOfTruncatedContent = markdown
      .slice(0, maxCharacters)
      .lastIndexOf(' ');
    return isTruncated && shouldTruncate
      ? markdown.slice(0, endOfTruncatedContent)
      : markdown;
  }, [markdown, maxCharacters, isTruncated, shouldTruncate]);

  // Custom link component to handle GETHUMAN links
  const LinkComponent: Components['a'] = ({ href, children, ...props }) => {
    // Check if this is a GETHUMAN link for ananda-public site
    if (siteConfig?.siteId === 'ananda-public' && href === 'GETHUMAN') {
      // For ananda-public site, convert GETHUMAN links to contact page links
      return (
        <a href="https://www.ananda.org/contact-us/" {...props}>
          {children}
        </a>
      );
    }

    // Default link rendering
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
        {children}
      </a>
    );
  };

  if (!markdown) {
    return <div>(No content)</div>;
  }

  const toggleTruncated = (event: React.MouseEvent) => {
    event.preventDefault();
    setIsTruncated(!isTruncated);
  };

  return (
    <div>
      <ReactMarkdown
        remarkPlugins={[gfm]}
        className="inline"
        data-testid="react-markdown"
        components={{
          a: LinkComponent,
        }}
      >
        {displayedMarkdown}
      </ReactMarkdown>
      {isTruncated && shouldTruncate && (
        <a href="#" onClick={toggleTruncated} className="inline">
          ...See&nbsp;more
        </a>
      )}
    </div>
  );
};

export default React.memo(TruncatedMarkdown);
