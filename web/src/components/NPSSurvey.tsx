// This component implements a Net Promoter Score (NPS) survey for collecting user feedback.
// It handles survey display logic, user input, and submission of survey data to the server.

import React, { useState, useEffect } from "react";
import { SiteConfig } from "@/types/siteConfig";
import { getOrCreateUUID } from "@/utils/client/uuid";
import Toast from "@/components/Toast";
import { motion, AnimatePresence } from "framer-motion";
import { logEvent } from "@/utils/client/analytics";
import validator from "validator";
import { fetchWithAuth } from "@/utils/client/tokenManager";

interface NPSSurveyProps {
  siteConfig: SiteConfig;
  forceSurvey?: boolean;
}

const NPSSurvey: React.FC<NPSSurveyProps> = ({ siteConfig, forceSurvey = false }) => {
  // State variables for managing survey display and user input
  const [showSurvey, setShowSurvey] = useState(false);
  const [score, setScore] = useState<number | null>(null);
  const [feedback, setFeedback] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [additionalComments, setAdditionalComments] = useState("");
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [surveyAvailable, setSurveyAvailable] = useState<boolean | null>(null);

  // Check if NPS survey is available (has required environment configuration)
  useEffect(() => {
    const checkSurveyAvailability = async () => {
      try {
        const response = await fetch("/api/npsAvailable");

        if (!response.ok) {
          console.error(`NPS availability check failed with status ${response.status}`);
          setSurveyAvailable(false);
          return;
        }

        const data = await response.json();
        setSurveyAvailable(data.available);
      } catch (error) {
        console.error("Error checking NPS survey availability:", error);
        setSurveyAvailable(false);
      }
    };

    checkSurveyAvailability();
  }, []);

  useEffect(() => {
    // Don't show survey if it's not available (missing configuration)
    if (surveyAvailable === false) {
      return;
    }

    // Don't proceed if we haven't checked availability yet
    if (surveyAvailable === null) {
      return;
    }

    // Logic to determine when to show the survey based on user interaction history
    if (forceSurvey) {
      setShowSurvey(true);
      return;
    }

    const surveyFrequency = siteConfig.npsSurveyFrequencyDays;
    const lastCompleted = localStorage.getItem("npsSurveyCompleted");
    const lastDismissed = localStorage.getItem("npsSurveyDismissed");
    const currentTime = Date.now();
    // visitCount is really a page view count.
    const pageViewCount = parseInt(localStorage.getItem("visitCount") || "0");

    // Show survey if conditions are met (frequency, visit count, time since last interaction)
    if (surveyFrequency > 0 && pageViewCount >= 12) {
      const timeSinceCompleted = lastCompleted ? currentTime - parseInt(lastCompleted) : Infinity;
      const timeSinceDismissed = lastDismissed ? currentTime - parseInt(lastDismissed) : Infinity;
      const frequencyInMs = surveyFrequency * 24 * 60 * 60 * 1000;

      if (timeSinceCompleted >= frequencyInMs && timeSinceDismissed >= frequencyInMs) {
        // Set a timer to show the survey after a delay
        setTimeout(
          () => {
            setShowSurvey(true);
            logEvent("Display", "NPS_Survey", "Automatic");
          },
          process.env.NODE_ENV === "production" ? 2 * 60 * 1000 : 15 * 1000
        );
      }
    }
  }, [siteConfig.npsSurveyFrequencyDays, forceSurvey, surveyAvailable]);

  // Function to handle survey dismissal (close/click away)
  const dismissSurvey = () => {
    logEvent("Dismiss", "NPS_Survey", forceSurvey ? "Forced" : "Regular");
    if (forceSurvey) {
      // Redirect to homepage if survey is forced
      window.location.href = "/";
    } else {
      setShowSurvey(false);
      setErrorMessage(null);
      localStorage.setItem("npsSurveyDismissed", Date.now().toString());
    }
  };

  // Function to handle "Remind Me Later" button
  const remindMeLater = () => {
    logEvent("Remind_Later", "NPS_Survey", forceSurvey ? "Forced" : "Regular");
    if (forceSurvey) {
      // Redirect to homepage if survey is forced
      window.location.href = "/";
    } else {
      setShowSurvey(false);
      setErrorMessage(null);
      // Set reminder for 3 days from now
      const threeDaysFromNow = Date.now() + 3 * 24 * 60 * 60 * 1000;
      localStorage.setItem("npsSurveyDismissed", threeDaysFromNow.toString());
    }
  };

  // Function to validate user input before submission
  const validateInput = () => {
    if (score === null) {
      setErrorMessage("Please select a score");
      return false;
    }
    if (!validator.isInt(score.toString(), { min: 0, max: 10 })) {
      setErrorMessage("Score must be between 0 and 10");
      return false;
    }
    if (feedback && feedback.length > 1000) {
      setErrorMessage("Feedback must be 1000 characters or less");
      return false;
    }
    if (additionalComments.length > 1000) {
      setErrorMessage("Additional comments must be 1000 characters or less");
      return false;
    }
    return true;
  };

  // Function to submit the survey data to the server
  const submitSurvey = async () => {
    if (!validateInput()) {
      return;
    }

    logEvent("Submit", "NPS_Survey", `Score: ${score}`, score ?? undefined);
    const uuid = getOrCreateUUID();
    const surveyData = {
      uuid,
      score: score!,
      feedback: feedback.trim(),
      additionalComments: additionalComments.trim(),
      timestamp: new Date().toISOString(),
    };

    try {
      const response = await fetchWithAuth("/api/submitNpsSurvey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(surveyData),
      });

      const data = await response.json();

      if (response.ok) {
        // Update local storage and UI state on successful submission
        localStorage.setItem("npsSurveyCompleted", Date.now().toString());
        localStorage.removeItem("npsSurveyDismissed");
        setShowSurvey(false);
        setErrorMessage(null);
        setToastMessage("Thank you for your feedback!");

        if (forceSurvey) {
          // Redirect to homepage after a delay if survey was forced
          setTimeout(() => {
            window.location.href = "/";
          }, 3000);
        }
      } else {
        setErrorMessage(data.message);
      }
    } catch (error) {
      console.error(error);
      setErrorMessage("Error submitting survey: An unexpected error occurred");
    }
  };

  // Render the survey component and toast message
  return (
    <>
      <AnimatePresence>
        {showSurvey && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
            onClick={forceSurvey ? undefined : dismissSurvey}
          >
            {/* Survey form content */}
            <div className="bg-white p-6 rounded-lg max-w-md w-full relative" onClick={(e) => e.stopPropagation()}>
              {/* Close button */}
              <button
                className="absolute top-2 right-2 text-gray-500 hover:text-gray-700"
                onClick={dismissSurvey}
                aria-label="Close"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              {/* Survey questions and input fields */}
              <h2 className="text-xl font-bold mb-4">
                How likely are you to recommend {siteConfig.shortname} to {siteConfig.other_visitors_reference}?
              </h2>
              {/* Score buttons */}
              <div className="flex flex-col mb-4">
                <div className="flex justify-between">
                  {[...Array(11)].map((_, i) => (
                    <button
                      key={i}
                      className={`px-2 py-1 text-sm rounded ${score === i ? "bg-blue-500 text-white" : "bg-gray-200"}`}
                      onClick={() => setScore(i)}
                    >
                      {i}
                    </button>
                  ))}
                </div>
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>least</span>
                  <span>most</span>
                </div>
              </div>
              {/* Feedback textarea */}
              <h3 className="text-base font-medium mb-2">What&apos;s the main reason for your score?</h3>
              <textarea
                className="w-full p-2 border rounded mb-4"
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                maxLength={1000}
              />
              {/* Additional comments textarea */}
              <h3 className="text-base font-medium mb-2">
                What would make it even better? Or other comments (optional).
              </h3>
              <textarea
                className="w-full p-2 border rounded mb-4"
                value={additionalComments}
                onChange={(e) => setAdditionalComments(e.target.value)}
                maxLength={1000}
              />
              {/* Error message display */}
              {errorMessage && <div className="text-red-500 mb-4">{errorMessage}</div>}
              {/* Action buttons */}
              <div className="flex justify-between">
                <button
                  className="px-4 py-2 rounded bg-gray-200 text-gray-700 hover:bg-gray-300 transition-colors"
                  onClick={remindMeLater}
                >
                  Remind Me Later
                </button>
                <button
                  className={`px-4 py-2 rounded ${score !== null ? "bg-blue-500 text-white hover:bg-blue-600" : "bg-gray-300 text-gray-500 cursor-not-allowed"} transition-colors`}
                  onClick={submitSurvey}
                  disabled={score === null}
                >
                  Submit
                </button>
              </div>
              {/* Privacy notice */}
              <p className="text-xs text-gray-500 mt-4">
                This survey information is collected solely to improve our service.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toast message */}
      {toastMessage && <Toast message={toastMessage} onClose={() => setToastMessage(null)} />}
    </>
  );
};

export default NPSSurvey;
