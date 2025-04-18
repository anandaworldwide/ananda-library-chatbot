// Add custom jest matchers for DOM elements
import '@testing-library/jest-dom';

// Polyfill for TextEncoder/TextDecoder
import {
  TextEncoder as TextEncodingPolyfill,
  TextDecoder as TextDecodingPolyfill,
} from 'text-encoding';

if (typeof global.TextEncoder === 'undefined') {
  global.TextEncoder = TextEncodingPolyfill as typeof global.TextEncoder;
}

if (typeof global.TextDecoder === 'undefined') {
  global.TextDecoder = TextDecodingPolyfill as typeof global.TextDecoder;
}

// Make sure jest-dom matchers are properly set up
expect.extend({});

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
