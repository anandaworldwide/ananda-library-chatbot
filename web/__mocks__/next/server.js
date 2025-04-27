// Mock implementation of next/server
module.exports = {
  NextResponse: {
    json: (data) => ({
      ...data,
      headers: new Map(),
    }),
    redirect: (url) => ({
      url,
      headers: new Map(),
    }),
  },
  cookies: () => ({
    get: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
  }),
  NextRequest: class {
    constructor(input, init = {}) {
      this.url = input;
      this.method = init.method || 'GET';
      this.headers = new Headers(init.headers);
    }
  },
};
