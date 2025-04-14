# TODO: Related Questions - OpenAI Embeddings & Pinecone Integration

This checklist outlines the remaining tasks to fully implement and verify the switch from keyword-based related questions to OpenAI embeddings with Pinecone.

- [x] **Rewrite Unit Tests:**
  - Update the tests in `__tests__/utils/server/relatedQuestionsUtils.test.ts` to mock OpenAI and Pinecone clients/API calls.
  - Ensure tests cover embedding generation, Pinecone upserts, Pinecone queries, and the overall logic of `updateRelatedQuestions` and `updateRelatedQuestionsBatch`.
  - Added tests for site ID filtering to ensure multi-tenant separation in Pinecone.
  - Fixed TypeScript errors in mock implementations to ensure tests run successfully.
- [ ] **Testing & Validation:**
  - Manually review the `relatedQuestionsV2` field in Firestore documents to verify the results seem semantically relevant.
  - Check application logs for any errors related to Pinecone initialization, OpenAI API calls, embedding upserts, or Pinecone queries.
  - Run tests locally: `npm test -- __tests__/utils/server/relatedQuestionsUtils.test.ts` to verify all tests pass.
- [ ] **Cleanup Old Resources (Optional but Recommended):**
  - Once the new system is verified and stable, consider deleting the old Firestore keyword collections (`${envName}_keywords`).
