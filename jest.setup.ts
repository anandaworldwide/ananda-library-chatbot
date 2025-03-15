// Add custom jest matchers for DOM elements
import '@testing-library/jest-dom';
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';

// Polyfill for TextEncoder/TextDecoder
// @ts-expect-error - importing from a JS module
import { TextEncoder, TextDecoder } from 'text-encoding';
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// Extend Jest matchers using module augmentation
declare module 'expect' {
  interface Matchers<R>
    extends TestingLibraryMatchers<typeof expect.stringContaining, R> {
    // This is needed to satisfy the linter, even though we're extending the interface
    _brand: 'jest-matchers';
  }
}

// Mock next/router
jest.mock('next/router', () => ({
  useRouter() {
    return {
      route: '/',
      pathname: '',
      query: {},
      asPath: '',
      push: jest.fn(),
      replace: jest.fn(),
    };
  },
}));
