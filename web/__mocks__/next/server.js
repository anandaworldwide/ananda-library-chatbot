// __mocks__/next/server.js

// Mock implementation for NextRequest and NextResponse used by Edge Runtime

class MockHeaders {
  constructor(init) {
    this.headers = init || {};
  }
  get(name) {
    return this.headers[name.toLowerCase()] || null;
  }
  set(name, value) {
    this.headers[name.toLowerCase()] = value;
  }
  has(name) {
    return name.toLowerCase() in this.headers;
  }
  append(name, value) {
    const lowerName = name.toLowerCase();
    if (this.headers[lowerName]) {
      this.headers[lowerName] += `, ${value}`;
    } else {
      this.headers[lowerName] = value;
    }
  }
  delete(name) {
    delete this.headers[name.toLowerCase()];
  }
  forEach(callback) {
    Object.entries(this.headers).forEach(([key, value]) =>
      callback(value, key, this),
    );
  }
  entries() {
    return Object.entries(this.headers);
  }
  keys() {
    return Object.keys(this.headers);
  }
  values() {
    return Object.values(this.headers);
  }
  [Symbol.iterator]() {
    return this.entries()[Symbol.iterator]();
  }
}

class MockNextRequest {
  constructor(input, init) {
    this.url = typeof input === 'string' ? input : input.url;
    this.method = init?.method || 'GET';
    this.headers = new MockHeaders(init?.headers);
    this.geo = init?.geo || {};
    this.ip = init?.ip || '';
    // Add other properties as needed for tests
  }

  json() {
    return Promise.resolve({});
  }

  text() {
    return Promise.resolve('');
  }

  // Add other methods as needed
}

class MockNextResponse {
  constructor(body, init) {
    this.body = body;
    this.status = init?.status || 200;
    this.statusText = init?.statusText || '';
    this.headers = new MockHeaders(init?.headers);
    this.bodyUsed = false; // Track body usage
  }

  // Instance methods to mimic Response API
  async json() {
    if (this.bodyUsed) {
      throw new TypeError('Already read');
    }
    this.bodyUsed = true;
    try {
      return JSON.parse(this.body);
    } catch (e) {
      throw new SyntaxError('Invalid JSON');
    }
  }

  async text() {
    if (this.bodyUsed) {
      throw new TypeError('Already read');
    }
    this.bodyUsed = true;
    return String(this.body);
  }

  get ok() {
    return this.status >= 200 && this.status < 300;
  }

  clone() {
    // Basic clone, may need enhancement depending on usage
    const cloned = new MockNextResponse(this.body, {
      status: this.status,
      statusText: this.statusText,
      headers: this.headers.headers,
    });
    return cloned;
  }

  static json(data, init) {
    const headers = new MockHeaders(init?.headers);
    headers.set('content-type', 'application/json');
    return new MockNextResponse(JSON.stringify(data), { ...init, headers });
  }

  // Add other static methods like redirect, rewrite etc. if needed
}

module.exports = {
  NextRequest: MockNextRequest,
  NextResponse: MockNextResponse,
  Headers: MockHeaders,
};
