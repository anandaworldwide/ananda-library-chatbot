import * as React from 'react';

// Simple mock for react-markdown that renders its children directly
function ReactMarkdown({ children }) {
  return React.createElement(
    'div',
    { className: 'markdown-content' },
    children,
  );
}

// Mock the exports from react-markdown
ReactMarkdown.defaultProps = {
  remarkPlugins: [],
  rehypePlugins: [],
};

export default ReactMarkdown;
