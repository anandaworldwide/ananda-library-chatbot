import {
  formatSmartTimestamp,
  formatAnswerTimestamp,
  formatStandardTimestamp,
  TIME_CUTOFFS,
} from "@/utils/client/dateUtils";

// Mock date-fns functions
jest.mock("date-fns", () => ({
  formatDistanceToNow: jest.fn(),
  format: jest.fn(),
}));

import { formatDistanceToNow, format } from "date-fns";

const mockFormatDistanceToNow = formatDistanceToNow as jest.MockedFunction<typeof formatDistanceToNow>;
const mockFormat = format as jest.MockedFunction<typeof format>;

describe("dateUtils", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Mock current time as Jan 15, 2024 12:00 PM
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2024-01-15T12:00:00Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("formatSmartTimestamp", () => {
    it("shows relative time for recent dates (within cutoff)", () => {
      mockFormatDistanceToNow.mockReturnValue("2 hours ago");

      // Date 2 hours ago (within 7-day default cutoff)
      const recentDate = new Date("2024-01-15T10:00:00Z");
      const result = formatSmartTimestamp(recentDate);

      expect(mockFormatDistanceToNow).toHaveBeenCalledWith(recentDate, { addSuffix: true });
      expect(result).toBe("2 hours ago");
    });

    it("shows absolute time for old dates (beyond cutoff)", () => {
      mockFormat.mockReturnValue("Jan 1");

      // Date 14 days ago (beyond 7-day default cutoff)
      const oldDate = new Date("2024-01-01T15:30:00Z");
      const result = formatSmartTimestamp(oldDate);

      expect(mockFormat).toHaveBeenCalledWith(oldDate, "MMM d");
      expect(result).toBe("Jan 1");
    });

    it("includes year for dates from different year", () => {
      mockFormat.mockReturnValue("Dec 25, 2023");

      // Date from previous year
      const oldDate = new Date("2023-12-25T09:15:00Z");
      const result = formatSmartTimestamp(oldDate);

      expect(mockFormat).toHaveBeenCalledWith(oldDate, "MMM d, yyyy");
      expect(result).toBe("Dec 25, 2023");
    });

    it("handles custom cutoff days", () => {
      mockFormat.mockReturnValue("Jan 13");

      // Date 2 days ago with 1-day cutoff
      const date = new Date("2024-01-13T08:00:00Z");
      const result = formatSmartTimestamp(date, 1);

      expect(mockFormat).toHaveBeenCalled();
      expect(result).toBe("Jan 13");
    });

    it("handles Firestore timestamp format", () => {
      mockFormatDistanceToNow.mockReturnValue("5 minutes ago");

      // Firestore timestamp format
      const firestoreTimestamp = {
        _seconds: Math.floor(new Date("2024-01-15T11:55:00Z").getTime() / 1000),
        _nanoseconds: 0,
      };

      const result = formatSmartTimestamp(firestoreTimestamp);

      expect(mockFormatDistanceToNow).toHaveBeenCalled();
      expect(result).toBe("5 minutes ago");
    });

    it("handles unix timestamp in seconds", () => {
      mockFormatDistanceToNow.mockReturnValue("30 minutes ago");

      // Unix timestamp in seconds (30 minutes ago)
      const unixTimestamp = Math.floor(new Date("2024-01-15T11:30:00Z").getTime() / 1000);

      const result = formatSmartTimestamp(unixTimestamp);

      expect(mockFormatDistanceToNow).toHaveBeenCalled();
      expect(result).toBe("30 minutes ago");
    });

    it("handles invalid timestamp gracefully", () => {
      const result = formatSmartTimestamp(null as any);
      expect(result).toBe("Unknown date");
    });
  });

  describe("TIME_CUTOFFS", () => {
    it("has expected cutoff values", () => {
      expect(TIME_CUTOFFS.VERY_SHORT).toBe(2);
      expect(TIME_CUTOFFS.SHORT).toBe(3);
      expect(TIME_CUTOFFS.STANDARD).toBe(7);
      expect(TIME_CUTOFFS.LONG).toBe(14);
      expect(TIME_CUTOFFS.VERY_LONG).toBe(30);
    });
  });

  describe("formatAnswerTimestamp", () => {
    it("uses 2-day cutoff (VERY_SHORT)", () => {
      mockFormat.mockReturnValue("Jan 12");

      // Date 2.5 days ago (should show absolute)
      const date = new Date("2024-01-12T22:00:00Z");
      const result = formatAnswerTimestamp(date);

      expect(mockFormat).toHaveBeenCalled();
      expect(result).toBe("Jan 12");
    });
  });

  describe("formatStandardTimestamp", () => {
    it("uses 7-day cutoff (STANDARD)", () => {
      mockFormatDistanceToNow.mockReturnValue("3 days ago");

      // Date 3 days ago (should show relative with 7-day cutoff)
      const date = new Date("2024-01-12T12:00:00Z");
      const result = formatStandardTimestamp(date);

      expect(mockFormatDistanceToNow).toHaveBeenCalled();
      expect(result).toBe("3 days ago");
    });
  });
});
