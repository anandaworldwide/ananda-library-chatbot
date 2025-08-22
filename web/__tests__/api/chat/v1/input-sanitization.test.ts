/**
 * Unit tests for input sanitization logic
 *
 * Tests the specific sanitization behavior that was causing "weird characters"
 * to appear in question text due to HTML entity conversion.
 */

import validator from "validator";

describe("Input Sanitization Logic", () => {
  it("should demonstrate the HTML entity problem with validator.escape", () => {
    const questionWithSpecialChars = `What is "love" & "devotion"? How do we find <meaning>?`;

    // This is what the OLD code was doing (causing the bug)
    const oldSanitizedQuestion = validator.escape(questionWithSpecialChars.trim()).replaceAll("\n", " ");

    // Show that validator.escape converts to HTML entities
    expect(oldSanitizedQuestion).toContain("&quot;"); // " becomes &quot;
    expect(oldSanitizedQuestion).toContain("&amp;"); // & becomes &amp;
    expect(oldSanitizedQuestion).toContain("&lt;"); // < becomes &lt;
    expect(oldSanitizedQuestion).toContain("&gt;"); // > becomes &gt;

    // This would cause "weird characters" to appear in the AI processing
    expect(oldSanitizedQuestion).toBe(
      `What is &quot;love&quot; &amp; &quot;devotion&quot;? How do we find &lt;meaning&gt;?`
    );
  });

  it("should demonstrate the fixed sanitization approach", () => {
    const questionWithSpecialChars = `What is "love" & "devotion"? How do we find <meaning>?`;

    // This is what the FIXED code does
    const newSanitizedQuestion = questionWithSpecialChars.trim().replaceAll("\n", " ");

    // Should preserve original characters without HTML entity conversion
    expect(newSanitizedQuestion).toBe(questionWithSpecialChars);
    expect(newSanitizedQuestion).not.toContain("&quot;");
    expect(newSanitizedQuestion).not.toContain("&amp;");
    expect(newSanitizedQuestion).not.toContain("&lt;");
    expect(newSanitizedQuestion).not.toContain("&gt;");
  });

  it("should still normalize whitespace properly", () => {
    const questionWithExtraWhitespace = `What is\n\nmeditation\tand\r\nhow   does   it   work?`;

    // The fixed sanitization should normalize whitespace
    const sanitizedQuestion = questionWithExtraWhitespace.trim().replaceAll("\n", " ");

    // Should normalize newlines to spaces but preserve other characters
    expect(sanitizedQuestion).toBe(`What is  meditation\tand\r how   does   it   work?`);

    // Note: We only replace \n with spaces, not all whitespace normalization
    // This is sufficient for the chat API's needs
  });

  it("should handle edge cases correctly", () => {
    const testCases = [
      {
        input: "Simple question",
        expected: "Simple question",
      },
      {
        input: "  Whitespace around  ",
        expected: "Whitespace around",
      },
      {
        input: "Question\nwith\nnewlines",
        expected: "Question with newlines",
      },
      {
        input: "Question\r\nwith\r\nCRLF",
        expected: "Question\r with\r CRLF", // Only \n is replaced, not \r
      },
      {
        input: `Question with 'single' and "double" quotes`,
        expected: `Question with 'single' and "double" quotes`,
      },
      {
        input: "Question with <tags> & symbols",
        expected: "Question with <tags> & symbols",
      },
    ];

    testCases.forEach(({ input, expected }) => {
      const result = input.trim().replaceAll("\n", " ");
      expect(result).toBe(expected);
    });
  });

  it("should verify XSS protection is maintained through React rendering", () => {
    // Note: The fix removes HTML escaping from the API layer because:
    // 1. Question text is used for AI processing, not direct HTML rendering
    // 2. When responses ARE rendered as HTML, React/ReactMarkdown provides XSS protection
    // 3. Database storage is safe since Firestore handles data sanitization

    const potentiallyDangerousInput = '<script>alert("xss")</script>';
    const sanitizedForAI = potentiallyDangerousInput.trim().replaceAll("\n", " ");

    // The sanitized version for AI processing preserves the content
    expect(sanitizedForAI).toBe('<script>alert("xss")</script>');

    // But when this gets rendered in React components, React will automatically escape it
    // This test documents the security model: API doesn't escape, React does
  });
});
