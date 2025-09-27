import React from "react";

interface SuggestionPillsProps {
  suggestions: string[];
  onSuggestionClick: (suggestion: string) => void;
  loading?: boolean;
}

const SuggestionPills: React.FC<SuggestionPillsProps> = ({ suggestions, onSuggestionClick, loading = false }) => {
  if (suggestions.length === 0) {
    return null;
  }

  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-2">
        {suggestions.map((suggestion, index) => (
          <button
            key={index}
            onClick={() => onSuggestionClick(suggestion)}
            disabled={loading}
            className={`
              inline-flex items-center px-3 py-1.5 rounded-xl text-sm font-medium
              bg-gray-100 text-gray-700 border border-gray-200
              hover:bg-gray-200 hover:border-gray-300 hover:text-gray-900
              active:bg-gray-300 active:border-gray-400
              transition-all duration-150 ease-in-out
              disabled:opacity-50 disabled:cursor-not-allowed
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1
              whitespace-nowrap
            `}
            title={`Ask: ${suggestion}`}
          >
            <span className="material-icons text-gray-500 mr-1.5 text-sm">lightbulb</span>
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
};

export default SuggestionPills;
