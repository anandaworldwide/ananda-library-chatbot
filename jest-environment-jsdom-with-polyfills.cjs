/* eslint-disable @typescript-eslint/no-require-imports */
/* eslint-disable @typescript-eslint/no-var-requires */
// Custom Jest environment with TextEncoder and TextDecoder polyfills
const JSDOMEnvironment = require('jest-environment-jsdom').default;
const { TextEncoder, TextDecoder } = require('util');

class CustomEnvironment extends JSDOMEnvironment {
  constructor(config) {
    super(config);

    // Add TextEncoder and TextDecoder to the global scope
    this.global.TextEncoder = TextEncoder;
    this.global.TextDecoder = TextDecoder;
  }
}

module.exports = CustomEnvironment;
