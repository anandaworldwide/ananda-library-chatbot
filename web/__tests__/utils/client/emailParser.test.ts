import {
  parseEmailAddresses,
  isValidEmail,
  extractEmailAddresses,
  validateEmailInput,
} from "@/utils/client/emailParser";

describe("emailParser", () => {
  describe("isValidEmail", () => {
    it("validates correct email addresses", () => {
      expect(isValidEmail("user@example.com")).toBe(true);
      expect(isValidEmail("test.email+tag@domain.co.uk")).toBe(true);
      expect(isValidEmail("user123@test-domain.org")).toBe(true);
    });

    it("rejects invalid email addresses", () => {
      expect(isValidEmail("")).toBe(false);
      expect(isValidEmail("invalid-email")).toBe(false);
      expect(isValidEmail("@domain.com")).toBe(false);
      expect(isValidEmail("user@")).toBe(false);
      expect(isValidEmail("user@domain")).toBe(false);
      expect(isValidEmail("user space@domain.com")).toBe(false);
    });
  });

  describe("parseEmailAddresses", () => {
    it("parses single bare email address", () => {
      const result = parseEmailAddresses("user@example.com");
      expect(result).toEqual([{ email: "user@example.com" }]);
    });

    it("parses single email with name in angle brackets", () => {
      const result = parseEmailAddresses("John Doe <john@example.com>");
      expect(result).toEqual([{ email: "john@example.com", name: "John Doe" }]);
    });

    it("parses comma-separated emails", () => {
      const result = parseEmailAddresses("user1@example.com, user2@example.com");
      expect(result).toEqual([{ email: "user1@example.com" }, { email: "user2@example.com" }]);
    });

    it("parses newline-separated emails", () => {
      const result = parseEmailAddresses("user1@example.com\nuser2@example.com");
      expect(result).toEqual([{ email: "user1@example.com" }, { email: "user2@example.com" }]);
    });

    it("parses mixed format emails", () => {
      const input = `user1@example.com
John Doe <john@example.com>, jane@example.com
Support Team <support@company.com>`;

      const result = parseEmailAddresses(input);
      expect(result).toEqual([
        { email: "user1@example.com" },
        { email: "john@example.com", name: "John Doe" },
        { email: "jane@example.com" },
        { email: "support@company.com", name: "Support Team" },
      ]);
    });

    it("handles quoted names", () => {
      const result = parseEmailAddresses('"John Doe" <john@example.com>');
      expect(result).toEqual([{ email: "john@example.com", name: "John Doe" }]);
    });

    it("filters out invalid emails", () => {
      const result = parseEmailAddresses("valid@example.com, invalid-email, user@domain.com");
      expect(result).toEqual([{ email: "valid@example.com" }, { email: "user@domain.com" }]);
    });

    it("handles empty input", () => {
      expect(parseEmailAddresses("")).toEqual([]);
      expect(parseEmailAddresses("   ")).toEqual([]);
    });

    it("handles whitespace around entries", () => {
      const result = parseEmailAddresses("  user1@example.com  ,  user2@example.com  ");
      expect(result).toEqual([{ email: "user1@example.com" }, { email: "user2@example.com" }]);
    });
  });

  describe("extractEmailAddresses", () => {
    it("extracts email addresses from parsed data", () => {
      const parsedEmails = [{ email: "user1@example.com" }, { email: "user2@example.com", name: "User Two" }];

      const result = extractEmailAddresses(parsedEmails);
      expect(result).toEqual(["user1@example.com", "user2@example.com"]);
    });

    it("handles empty array", () => {
      expect(extractEmailAddresses([])).toEqual([]);
    });
  });

  describe("validateEmailInput", () => {
    it("validates mixed valid and invalid emails", () => {
      const input = "valid@example.com, invalid-email, user@domain.com";
      const result = validateEmailInput(input);

      expect(result).toEqual({
        validEmails: ["valid@example.com", "user@domain.com"],
        invalidEntries: ["invalid-email"],
        totalEntries: 3,
        validCount: 2,
      });
    });

    it("handles all valid emails", () => {
      const input = "user1@example.com, user2@example.com";
      const result = validateEmailInput(input);

      expect(result).toEqual({
        validEmails: ["user1@example.com", "user2@example.com"],
        invalidEntries: [],
        totalEntries: 2,
        validCount: 2,
      });
    });

    it("handles all invalid emails", () => {
      const input = "invalid-email, another-invalid";
      const result = validateEmailInput(input);

      expect(result).toEqual({
        validEmails: [],
        invalidEntries: ["invalid-email", "another-invalid"],
        totalEntries: 2,
        validCount: 0,
      });
    });

    it("handles empty input", () => {
      const result = validateEmailInput("");

      expect(result).toEqual({
        validEmails: [],
        invalidEntries: [],
        totalEntries: 0,
        validCount: 0,
      });
    });

    it("handles emails with names", () => {
      const input = "John Doe <john@example.com>, invalid-email";
      const result = validateEmailInput(input);

      expect(result).toEqual({
        validEmails: ["john@example.com"],
        invalidEntries: ["invalid-email"],
        totalEntries: 2,
        validCount: 1,
      });
    });
  });
});
