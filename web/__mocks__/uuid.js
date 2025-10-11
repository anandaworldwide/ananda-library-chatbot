// Mock implementation of uuid for Jest tests
module.exports = {
  v4: jest.fn(() => "test-uuid-123"),
  v1: jest.fn(() => "test-uuid-v1-123"),
  v3: jest.fn(() => "test-uuid-v3-123"),
  v5: jest.fn(() => "test-uuid-v5-123"),
  validate: jest.fn(() => true),
  version: jest.fn(() => 4),
};
