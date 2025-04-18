/// <reference types="@testing-library/jest-dom" />

// This empty export makes this file a module
export {};

declare global {
  namespace jest {
    // Instead of directly extending the interface with new matchers,
    // let the normal Jest DOM types do their work
  }
}
