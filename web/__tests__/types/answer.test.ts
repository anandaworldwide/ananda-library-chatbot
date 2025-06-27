/**
 * Tests for the Answer type definition
 * 
 * Verifies that the Answer type includes all expected fields,
 * particularly the new restatedQuestion field.
 */

import { Answer } from '../../src/types/answer';

describe('Answer type', () => {
  it('should include restatedQuestion field', () => {
    const answer: Answer = {
      id: 'test-id',
      question: 'Original question?',
      answer: 'Test answer',
      timestamp: {
        _seconds: 1234567890,
        _nanoseconds: 0,
      },
      likeCount: 5,
      restatedQuestion: 'What is the meaning of the original question?',
    };

    expect(answer.restatedQuestion).toBe('What is the meaning of the original question?');
    expect(typeof answer.restatedQuestion).toBe('string');
  });

  it('should allow restatedQuestion to be undefined', () => {
    const answer: Answer = {
      id: 'test-id',
      question: 'Original question?',
      answer: 'Test answer',
      timestamp: {
        _seconds: 1234567890,
        _nanoseconds: 0,
      },
      likeCount: 5,
      // No restatedQuestion field
    };

    expect(answer.restatedQuestion).toBeUndefined();
  });

  it('should maintain all existing required fields', () => {
    const answer: Answer = {
      id: 'test-id',
      question: 'Test question?',
      answer: 'Test answer',
      timestamp: {
        _seconds: 1234567890,
        _nanoseconds: 0,
      },
      likeCount: 5,
    };

    // Verify all required fields are present
    expect(answer.id).toBeDefined();
    expect(answer.question).toBeDefined();
    expect(answer.answer).toBeDefined();
    expect(answer.timestamp).toBeDefined();
    expect(answer.likeCount).toBeDefined();
    
    // Verify types
    expect(typeof answer.id).toBe('string');
    expect(typeof answer.question).toBe('string');
    expect(typeof answer.answer).toBe('string');
    expect(typeof answer.timestamp).toBe('object');
    expect(typeof answer.likeCount).toBe('number');
  });

  it('should support optional fields', () => {
    const answer: Answer = {
      id: 'test-id',
      question: 'Test question?',
      answer: 'Test answer',
      timestamp: {
        _seconds: 1234567890,
        _nanoseconds: 0,
      },
      likeCount: 5,
      collection: 'test-collection',
      ip: '127.0.0.1',
      restatedQuestion: 'What is the test question asking?',
      relatedQuestionsV2: [
        {
          id: 'related-1',
          title: 'Related question 1',
          similarity: 0.85,
        },
      ],
      history: [
        { role: 'user', content: 'Previous question' },
        { role: 'assistant', content: 'Previous answer' },
      ],
    };

    expect(answer.collection).toBe('test-collection');
    expect(answer.ip).toBe('127.0.0.1');
    expect(answer.restatedQuestion).toBe('What is the test question asking?');
    expect(Array.isArray(answer.relatedQuestionsV2)).toBe(true);
    expect(Array.isArray(answer.history)).toBe(true);
  });
});