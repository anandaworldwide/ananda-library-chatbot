// Mock uuid module for Jest tests
module.exports = {
  v4: jest.fn(() => "mock-uuid-v4"),
  v1: jest.fn(() => "mock-uuid-v1"),
  v3: jest.fn(() => "mock-uuid-v3"),
  v5: jest.fn(() => "mock-uuid-v5"),
  validate: jest.fn(() => true),
  version: jest.fn(() => 4),
};
