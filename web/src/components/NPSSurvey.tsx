// This component implements a Net Promoter Score (NPS) survey for collecting user feedback.
// It handles survey display logic, user input, and submission of survey data to the server.

import React, { useState, useEffect } from 'react';
import { SiteConfig } from '@/types/siteConfig';
import { getOrCreateUUID } from '@/utils/client/uuid';
import Toast from '@/components/Toast';
import { motion, AnimatePresence } from 'framer-motion';
import { logEvent } from '@/utils/client/analytics';
import validator from 'validator';
import { fetchWithAuth } from '@/utils/client/tokenManager';

interface NPSSurveyProps {
  siteConfig: SiteConfig;
  forceSurvey?: boolean;
}

const NPSSurvey: React.FC<NPSSurveyProps> = ({
  siteConfig,
  forceSurvey = false,
}) => {
  // State variables for managing survey display and user input
  const [showSurvey, setShowSurvey] = useState(false);
  const [showFeedbackIcon, setShowFeedbackIcon] = useState(false);
  const [score, setScore] = useState<number | null>(null);
  const [feedback, setFeedback] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [additionalComments, setAdditionalComments] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    // Logic to determine when to show the survey based on user interaction history
    if (forceSurvey) {
      setShowSurvey(true);
      setShowFeedbackIcon(false);
      return;
    }

    const surveyFrequency = siteConfig.npsSurveyFrequencyDays;
    const lastCompleted = localStorage.getItem('npsSurveyCompleted');
    const lastDismissed = localStorage.getItem('npsSurveyDismissed');
    const currentTime = Date.now();
    const visitCount = parseInt(localStorage.getItem('visitCount') || '0');

    // Show survey if conditions are met (frequency, visit count, time since last interaction)
    if (surveyFrequency > 0 && visitCount >= 3) {
      const timeSinceCompleted = lastCompleted
        ? currentTime - parseInt(lastCompleted)
        : Infinity;
      const timeSinceDismissed = lastDismissed
        ? currentTime - parseInt(lastDismissed)
        : Infinity;
      const frequencyInMs = surveyFrequency * 24 * 60 * 60 * 1000;

      if (
        timeSinceCompleted >= frequencyInMs &&
        timeSinceDismissed >= frequencyInMs
      ) {
        // Set a timer to show the survey after a delay
        setTimeout(
          () => {
            setShowSurvey(true);
            setShowFeedbackIcon(false);
            logEvent('Display', 'NPS_Survey', 'Automatic');
          },
          process.env.NODE_ENV === 'production' ? 2 * 60 * 1000 : 15 * 1000,
        );
      } else if (lastDismissed && timeSinceDismissed < frequencyInMs) {
        setShowSurvey(false);
        setShowFeedbackIcon(true);
      }
    }
  }, [siteConfig.npsSurveyFrequencyDays, forceSurvey]);

  // Function to handle survey dismissal
  const dismissSurvey = () => {
    logEvent('Dismiss', 'NPS_Survey', forceSurvey ? 'Forced' : 'Regular');
    if (forceSurvey) {
      // Redirect to homepage if survey is forced
      window.location.href = '/';
    } else {
      setShowSurvey(false);
      setErrorMessage(null);
      // Show feedback icon after a delay to allow for animation
      setTimeout(() => setShowFeedbackIcon(true), 500);
      localStorage.setItem('npsSurveyDismissed', Date.now().toString());
    }
  };

  // Function to validate user input before submission
  const validateInput = () => {
    if (score === null) {
      setErrorMessage('Please select a score');
      return false;
    }
    if (!validator.isInt(score.toString(), { min: 0, max: 10 })) {
      setErrorMessage('Score must be between 0 and 10');
      return false;
    }
    if (feedback && feedback.length > 1000) {
      setErrorMessage('Feedback must be 1000 characters or less');
      return false;
    }
    if (additionalComments.length > 1000) {
      setErrorMessage('Additional comments must be 1000 characters or less');
      return false;
    }
    return true;
  };

  // Function to submit the survey data to the server
  const submitSurvey = async () => {
    if (!validateInput()) {
      return;
    }

    logEvent('Submit', 'NPS_Survey', `Score: ${score}`, score ?? undefined);
    const uuid = getOrCreateUUID();
    const surveyData = {
      uuid,
      score: score!,
      feedback: feedback.trim(),
      additionalComments: additionalComments.trim(),
      timestamp: new Date().toISOString(),
    };

    try {
      const response = await fetchWithAuth('/api/submitNpsSurvey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(surveyData),
      });

      const data = await response.json();

      if (response.ok) {
        // Update local storage and UI state on successful submission
        localStorage.setItem('npsSurveyCompleted', Date.now().toString());
        localStorage.removeItem('npsSurveyDismissed');
        setShowSurvey(false);
        setErrorMessage(null);
        setShowFeedbackIcon(false);
        setToastMessage('Thank you for your feedback!');

        if (forceSurvey) {
          // Redirect to homepage after a delay if survey was forced
          setTimeout(() => {
            window.location.href = '/';
          }, 3000);
        }
      } else {
        setErrorMessage(data.message);
      }
    } catch (error) {
      console.error(error);
      setErrorMessage('Error submitting survey: An unexpected error occurred');
    }
  };

  // Function to open the survey when feedback icon is clicked
  const openSurvey = () => {
    logEvent('Open', 'NPS_Survey', 'From Feedback Icon');
    setShowSurvey(true);
    setShowFeedbackIcon(false);
  };

  // Render the survey component, feedback icon, and toast message
  return (
    <>
      <AnimatePresence>
        {showSurvey && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{
              opacity: 0,
              scale: 0.8,
              x: window.innerWidth - 100,
              y: window.innerHeight - 100,
              transition: { duration: 0.5 },
            }}
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
            onClick={forceSurvey ? undefined : dismissSurvey}
          >
            {/* Survey form content */}
            <div
              className="bg-white p-6 rounded-lg max-w-md w-full relative"
              onClick={(e) => e.stopPropagation()}
            >
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
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
              {/* Survey questions and input fields */}
              <h2 className="text-xl font-bold mb-4">
                How likely are you to recommend the Ananda Chatbot to a
                gurubhai?
              </h2>
              {/* Score buttons */}
              <div className="flex flex-col mb-4">
                <div className="flex justify-between">
                  {[...Array(11)].map((_, i) => (
                    <button
                      key={i}
                      className={`px-2 py-1 text-sm rounded ${score === i ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
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
              <h3 className="text-base font-medium mb-2">
                What&apos;s the main reason for your score?
              </h3>
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
              {errorMessage && (
                <div className="text-red-500 mb-4">{errorMessage}</div>
              )}
              {/* Submit button */}
              <div className="flex justify-end">
                <button
                  className={`px-4 py-2 rounded ${score !== null ? 'bg-blue-500 text-white' : 'bg-gray-300 text-gray-500 cursor-not-allowed'}`}
                  onClick={submitSurvey}
                  disabled={score === null}
                >
                  Submit
                </button>
              </div>
              {/* Privacy notice */}
              <p className="text-xs text-gray-500 mt-4">
                This survey information is collected solely to improve our
                service.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Feedback icon */}
      <AnimatePresence>
        {showFeedbackIcon && (
          <motion.button
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 20 }}
            onClick={openSurvey}
            className="fixed bottom-4 right-4 bg-green-500 text-white rounded-full p-3 shadow-lg hover:bg-green-600 transition-colors duration-200 z-50 group"
            aria-label="Open Feedback Survey"
          >
            <span className="material-icons">ballot</span>
            <span className="absolute bottom-full right-0 mb-2 bg-gray-800 text-white text-xs rounded py-1 px-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
              Take 1-minute survey
            </span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Toast message */}
      {toastMessage && (
        <Toast message={toastMessage} onClose={() => setToastMessage(null)} />
      )}
    </>
  );
};

export default NPSSurvey;
