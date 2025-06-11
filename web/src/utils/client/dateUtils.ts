import { formatDistanceToNow, format } from "date-fns";

/**
 * Formats a timestamp intelligently - uses relative time for recent items
 * and absolute time for older items.
 *
 * @param timestamp - Unix timestamp in seconds (Firestore format) or Date object
 * @param cutoffDays - Number of days after which to show absolute time (default: 7)
 * @returns - Formatted time string (e.g., "5 minutes ago", "May 10", "Apr 3, 2024")
 */
export function formatSmartTimestamp(
  timestamp: { _seconds: number; _nanoseconds: number } | Date | number,
  cutoffDays: number = 7
): string {
  let date: Date;

  // Handle different timestamp formats
  if (typeof timestamp === "number") {
    date = new Date(timestamp * 1000);
  } else if (timestamp instanceof Date) {
    date = timestamp;
  } else if (timestamp && typeof timestamp === "object" && "_seconds" in timestamp) {
    date = new Date(timestamp._seconds * 1000);
  } else {
    return "Unknown date";
  }

  // Calculate time difference in milliseconds
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  // If older than cutoff, show absolute date
  if (diffDays > cutoffDays) {
    const currentYear = now.getFullYear();
    const dateYear = date.getFullYear();

    // Format: "May 10" (same year) or "Apr 3, 2024" (different year)
    if (currentYear === dateYear) {
      return format(date, "MMM d");
    } else {
      return format(date, "MMM d, yyyy");
    }
  }

  // Otherwise show relative time
  return formatDistanceToNow(date, { addSuffix: true });
}

/**
 * Common presets for different use cases
 */
export const TIME_CUTOFFS = {
  VERY_SHORT: 2, // 2 days - for high-frequency content
  SHORT: 3, // 3 days - for active discussions
  STANDARD: 7, // 1 week - most consumer apps
  LONG: 14, // 2 weeks - for longer-term content
  VERY_LONG: 30, // 1 month - for archival content
} as const;

/**
 * Convenience function for answers page with your preferred 2-day cutoff
 */
export function formatAnswerTimestamp(timestamp: { _seconds: number; _nanoseconds: number } | Date | number): string {
  return formatSmartTimestamp(timestamp, TIME_CUTOFFS.VERY_SHORT);
}

/**
 * Convenience function using standard 7-day cutoff (most consumer apps)
 */
export function formatStandardTimestamp(timestamp: { _seconds: number; _nanoseconds: number } | Date | number): string {
  return formatSmartTimestamp(timestamp, TIME_CUTOFFS.STANDARD);
}
