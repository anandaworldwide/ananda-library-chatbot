// Add Jest DOM type support
import '@testing-library/jest-dom';
import 'whatwg-fetch';
import { fetch, Headers, Request, Response } from 'cross-fetch';

// Setup fetch polyfill - safely handle both browser and node environments
if (typeof window !== 'undefined') {
  global.fetch = window.fetch;
} else {
  global.fetch = fetch;
  global.Headers = Headers;
  global.Request = Request;
  global.Response = Response;
}

// Add a simple test to make this file valid in Jest
describe('Setup file', () => {
  it('should be valid', () => {
    expect(true).toBe(true);
  });
});
