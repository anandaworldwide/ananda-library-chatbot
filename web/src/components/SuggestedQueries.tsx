import React, { useState, useEffect } from "react";
import { logEvent } from "@/utils/client/analytics";
import { fetchWithAuth } from "@/utils/client/tokenManager";
import { getOrCreateUUID } from "@/utils/client/uuid";
import { SiteConfig } from "@/types/siteConfig";

interface SuggestedQueriesProps {
  queries: string[];
  onQueryClick: (query: string) => void;
  isLoading: boolean;
  shuffleQueries: () => void;
  isMobile: boolean;
  siteConfig: SiteConfig | null;
  onRefreshFunctionReady?: (refreshFn: () => void) => void;
}

const SuggestedQueries: React.FC<SuggestedQueriesProps> = ({
  queries,
  onQueryClick,
  isLoading,
  shuffleQueries,
  isMobile,
  siteConfig, // eslint-disable-line @typescript-eslint/no-unused-vars
  onRefreshFunctionReady,
}) => {
  const [suggestedPrompts, setSuggestedPrompts] = useState<string[]>([]);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [editingIndex, setEditingIndex] = useState<number>(-1);
  const [editedPrompt, setEditedPrompt] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [hasEnoughHistory, setHasEnoughHistory] = useState<boolean>(false);
  const [initializing, setInitializing] = useState<boolean>(true);

  // Check if user has enough chat history (5+ questions) - only for sites that require login
  useEffect(() => {
    const checkChatHistory = async () => {
      try {
        // Only check chat history for AI suggestions on sites that require login
        if (!siteConfig?.requireLogin) {
          setHasEnoughHistory(false);
          setInitializing(false);
          return;
        }

        // Try to get AI suggestions - this will tell us if we have enough history
        const uuid = getOrCreateUUID();
        const response = await fetchWithAuth("/api/suggestPrompt", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ uuid }),
        });

        if (response.ok) {
          const data = await response.json();
          setHasEnoughHistory(data.hasEnoughHistory);
          if (data.hasEnoughHistory && data.suggestions.length > 0) {
            setSuggestedPrompts(data.suggestions);
          }
        } else {
          setHasEnoughHistory(false);
        }
      } catch (error) {
        console.error("Error checking chat history:", error);
        setHasEnoughHistory(false);
      } finally {
        setInitializing(false);
      }
    };

    checkChatHistory();
  }, [siteConfig?.requireLogin]); // Re-run if requireLogin changes

  // Refresh AI suggested prompts (used for auto-refresh after chat completion)
  const generateSuggestedPrompt = async () => {
    if (!hasEnoughHistory || loading) return;

    setLoading(true);
    try {
      // Use AI to generate personalized questions (API handles chat history fetching)
      const questions = await generatePersonalizedPrompts();
      setSuggestedPrompts(questions);
    } catch (error) {
      console.error("Error generating AI suggested prompt:", error);
      return;
    } finally {
      setLoading(false);
    }
  };

  // Generate personalized prompts using AI
  const generatePersonalizedPrompts = async (): Promise<string[]> => {
    try {
      const uuid = getOrCreateUUID();

      // Use the lightweight suggest prompt API
      const response = await fetchWithAuth("/api/suggestPrompt", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          uuid: uuid,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to generate AI suggestions");
      }

      const data = await response.json();
      return data.suggestions;
    } catch (error) {
      console.error("Error generating personalized prompts:", error);
      throw error; // Let the calling function handle the fallback
    }
  };

  // Expose refresh function to parent component
  useEffect(() => {
    if (onRefreshFunctionReady) {
      onRefreshFunctionReady(() => {
        if (hasEnoughHistory) {
          generateSuggestedPrompt();
        }
      });
    }
  }, [hasEnoughHistory, onRefreshFunctionReady]);

  const handlePromptClick = (prompt: string, index: number) => {
    if (!isLoading && prompt) {
      onQueryClick(prompt);
      logEvent("select_ai_suggested_prompt", "Engagement", `${prompt} (index: ${index})`);
    }
  };

  const handleEditClick = (prompt: string, index: number) => {
    setEditedPrompt(prompt);
    setEditingIndex(index);
    setIsEditing(true);
    logEvent("edit_ai_suggested_prompt", "Engagement", `index: ${index}`);
  };

  const handleSaveEdit = () => {
    if (editedPrompt.trim() && editingIndex >= 0) {
      // Submit the edited question directly
      onQueryClick(editedPrompt.trim());
      setIsEditing(false);
      setEditingIndex(-1);
      logEvent("save_edited_ai_prompt", "Engagement", editedPrompt.trim());
    }
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditingIndex(-1);
    setEditedPrompt("");
    logEvent("cancel_edit_ai_prompt", "Engagement", "");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSaveEdit();
    }
  };

  const handleRefresh = () => {
    generateSuggestedPrompt();
    logEvent("refresh_ai_suggested_prompt", "UI", "");
  };

  const [currentQueryIndex, setCurrentQueryIndex] = useState(0);

  const handleQueryClick = (query: string) => {
    if (!isLoading) {
      onQueryClick(query);
      setCurrentQueryIndex((prevIndex) => (prevIndex + 1) % queries.length);
      logEvent("select_suggested_query", "Engagement", query);
    }
  };

  const handleShuffleQueries = (e: React.MouseEvent) => {
    e.preventDefault();
    shuffleQueries();
    logEvent("randomize_suggested_queries", "UI", "");
  };

  // Don't render anything while we're determining which type to show
  if (initializing) {
    return null;
  }

  return (
    <div className="text-left w-full px-0">
      {/* Show AI Suggested Prompt if user has enough history, otherwise show Random Queries */}
      {hasEnoughHistory ? (
        <div className="bg-gradient-to-r from-blue-50 to-purple-50 p-4 rounded-lg w-full max-w-[450px] border border-blue-200 mt-8">
          <div className="flex justify-between items-center mb-3">
            <p className="font-semibold text-gray-800">{isMobile ? "AI Suggested Prompt:" : "AI Suggested Prompts:"}</p>
            <button
              onClick={handleRefresh}
              className="inline-flex justify-center items-center transform transition-transform duration-500 hover:rotate-180 flex-shrink-0 ml-2"
              aria-label="Generate new prompt"
              disabled={isLoading || loading}
            >
              <span className="material-icons text-blue-600 hover:text-blue-800">autorenew</span>
            </button>
          </div>

          {isEditing ? (
            <div className="space-y-3">
              <textarea
                value={editedPrompt}
                onChange={(e) => setEditedPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
                className="w-full p-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                rows={2}
                placeholder="Edit your question..."
                disabled={isLoading}
              />
              <div className="flex space-x-2">
                <button
                  onClick={handleSaveEdit}
                  className="px-3 py-1 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={isLoading || !editedPrompt.trim()}
                >
                  Submit
                </button>
                <button
                  onClick={handleCancelEdit}
                  className="px-3 py-1 bg-gray-300 text-gray-700 text-sm rounded-md hover:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-500"
                  disabled={isLoading}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              {loading ? (
                <div className="mb-3">
                  <p className="text-gray-700 italic text-sm leading-relaxed flex items-center">
                    <span className="material-icons animate-spin mr-2 text-sm">refresh</span>
                    Analyzing your recent queries...
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Desktop: Show all 3 suggestions */}
                  <div className="hidden md:block space-y-2">
                    {suggestedPrompts.slice(0, 3).map((prompt, index) => (
                      <div key={index} className="flex items-center space-x-2">
                        <button
                          onClick={() => handlePromptClick(prompt, index)}
                          className="flex-1 text-left px-3 py-2 bg-white border border-gray-200 text-gray-700 text-sm rounded-md hover:bg-gray-50 hover:border-blue-300 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
                          disabled={isLoading}
                        >
                          {prompt}
                        </button>
                        <button
                          onClick={() => handleEditClick(prompt, index)}
                          className="px-2 py-2 bg-white border border-gray-200 text-gray-500 text-xs rounded-md hover:bg-gray-50 hover:border-blue-300 hover:text-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
                          disabled={isLoading}
                          title="Edit this question"
                        >
                          <span className="material-icons text-sm">edit</span>
                        </button>
                      </div>
                    ))}
                  </div>

                  {/* Mobile/Tablet: Show only first suggestion */}
                  <div className="md:hidden">
                    {suggestedPrompts.length > 0 && (
                      <div className="mb-3">
                        <p className="text-gray-700 text-sm leading-relaxed">{suggestedPrompts[0]}</p>
                      </div>
                    )}
                    <div className="flex space-x-2">
                      <button
                        onClick={() => handlePromptClick(suggestedPrompts[0], 0)}
                        className="flex-1 px-3 py-2 rounded-md text-sm font-medium bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-blue-300 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
                        disabled={isLoading || suggestedPrompts.length === 0}
                      >
                        Submit Question
                      </button>
                      <button
                        onClick={() => handleEditClick(suggestedPrompts[0], 0)}
                        className="px-3 py-2 bg-white border border-gray-200 text-gray-500 text-sm rounded-md hover:bg-gray-50 hover:border-blue-300 hover:text-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
                        disabled={isLoading || suggestedPrompts.length === 0}
                        title="Edit this question"
                      >
                        Edit
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        /* Original Random Queries when not enough history */
        <div className="bg-gray-100 p-4 rounded-lg w-full max-w-[400px] mt-4">
          <div className="flex justify-between items-center mb-3">
            <p className="font-semibold">Suggested Query:</p>
            <button
              onClick={handleShuffleQueries}
              className="inline-flex justify-center items-center transform transition-transform duration-500 hover:rotate-180 flex-shrink-0 ml-2"
              aria-label="Refresh queries"
              disabled={isLoading}
            >
              <span className="material-icons text-blue-600 hover:text-blue-800">autorenew</span>
            </button>
          </div>
          {isMobile ? (
            <div className="flex items-center">
              <button
                className={`flex-grow text-left break-words ${
                  isLoading ? "text-gray-400 cursor-not-allowed" : "text-blue-600 hover:text-blue-800 hover:underline"
                }`}
                onClick={() => handleQueryClick(queries[currentQueryIndex])}
                disabled={isLoading}
              >
                {queries[currentQueryIndex]}
              </button>
            </div>
          ) : (
            <ul className="list-none w-full">
              {queries.slice(0, 3).map((query, index) => (
                <li
                  key={index}
                  className={`mb-2 ${
                    isLoading ? "text-gray-400" : "text-blue-600 hover:text-blue-800 hover:underline"
                  }`}
                >
                  <button
                    className={`focus:outline-none focus:underline w-full text-left break-words ${
                      isLoading ? "cursor-not-allowed" : ""
                    }`}
                    onClick={() => handleQueryClick(query)}
                    aria-label={`Sample query: ${query}`}
                    disabled={isLoading}
                  >
                    {query}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

export default SuggestedQueries;
