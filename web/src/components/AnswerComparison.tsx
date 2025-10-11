// Component for displaying side-by-side answer comparison (original vs GPT-4.1)

import React from "react";
import ReactMarkdown from "react-markdown";
import gfm from "remark-gfm";
import markdownStyles from "@/styles/MarkdownStyles.module.css";
import { ExtendedAIMessage } from "@/types/ExtendedAIMessage";

interface AnswerComparisonProps {
  originalAnswer: ExtendedAIMessage;
  newAnswer: ExtendedAIMessage;
  originalModel: string;
  newModel: string;
  isStreaming: boolean;
}

export default function AnswerComparison({
  originalAnswer,
  newAnswer,
  originalModel,
  newModel,
  isStreaming,
}: AnswerComparisonProps) {
  return (
    <div className="w-full">
      {/* Desktop: Side-by-side comparison */}
      <div className="hidden md:grid md:grid-cols-2 gap-4 mt-4">
        {/* Original Answer */}
        <div className="border-2 border-blue-300 rounded-lg p-4 bg-blue-50">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-blue-900">Original Answer</h3>
            <span className="text-xs px-2 py-1 bg-blue-200 text-blue-800 rounded">{originalModel}</span>
          </div>
          <div className="prose prose-sm max-w-none">
            <ReactMarkdown
              remarkPlugins={[gfm]}
              className={`${markdownStyles.markdownanswer} text-[15px] text-gray-800 font-normal leading-relaxed`}
            >
              {originalAnswer.message.replace(/\n/g, "  \n").replace(/\n\n/g, "\n\n")}
            </ReactMarkdown>
          </div>
        </div>

        {/* New Answer (GPT-4.1) */}
        <div className="border-2 border-purple-300 rounded-lg p-4 bg-purple-50">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-purple-900">New Answer</h3>
            <span className="text-xs px-2 py-1 bg-purple-200 text-purple-800 rounded">{newModel}</span>
          </div>
          {isStreaming && newAnswer.message === "" ? (
            <div className="flex items-center space-x-2 text-gray-600">
              <span className="material-icons text-sm animate-pulse">more_horiz</span>
              <span className="text-sm">Generating answer...</span>
            </div>
          ) : (
            <div className="prose prose-sm max-w-none">
              <ReactMarkdown
                remarkPlugins={[gfm]}
                className={`${markdownStyles.markdownanswer} text-[15px] text-gray-800 font-normal leading-relaxed`}
              >
                {newAnswer.message.replace(/\n/g, "  \n").replace(/\n\n/g, "\n\n")}
              </ReactMarkdown>
            </div>
          )}
        </div>
      </div>

      {/* Mobile: Stacked comparison */}
      <div className="md:hidden space-y-4 mt-4">
        {/* Original Answer */}
        <div className="border-2 border-blue-300 rounded-lg p-4 bg-blue-50">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-blue-900">Original Answer</h3>
            <span className="text-xs px-2 py-1 bg-blue-200 text-blue-800 rounded">{originalModel}</span>
          </div>
          <div className="prose prose-sm max-w-none">
            <ReactMarkdown
              remarkPlugins={[gfm]}
              className={`${markdownStyles.markdownanswer} text-[15px] text-gray-800 font-normal leading-relaxed`}
            >
              {originalAnswer.message.replace(/\n/g, "  \n").replace(/\n\n/g, "\n\n")}
            </ReactMarkdown>
          </div>
        </div>

        {/* New Answer (GPT-4.1) */}
        <div className="border-2 border-purple-300 rounded-lg p-4 bg-purple-50">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-purple-900">New Answer</h3>
            <span className="text-xs px-2 py-1 bg-purple-200 text-purple-800 rounded">{newModel}</span>
          </div>
          {isStreaming && newAnswer.message === "" ? (
            <div className="flex items-center space-x-2 text-gray-600">
              <span className="material-icons text-sm animate-pulse">more_horiz</span>
              <span className="text-sm">Generating answer...</span>
            </div>
          ) : (
            <div className="prose prose-sm max-w-none">
              <ReactMarkdown
                remarkPlugins={[gfm]}
                className={`${markdownStyles.markdownanswer} text-[15px] text-gray-800 font-normal leading-relaxed`}
              >
                {newAnswer.message.replace(/\n/g, "  \n").replace(/\n\n/g, "\n\n")}
              </ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
