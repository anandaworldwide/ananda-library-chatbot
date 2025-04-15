# TODO: Related Questions - OpenAI Embeddings & Pinecone Integration

This checklist outlines the remaining tasks to fully implement and verify the switch from keyword-based related questions to OpenAI embeddings with Pinecone.

- [ ] **Testing & Validation:**
  - Check application logs for any errors related to Pinecone initialization, OpenAI API calls, embedding upserts, or Pinecone queries.
  - Run tests locally: `npm test -- __tests__/utils/server/relatedQuestionsUtils.test.ts` to verify all tests pass.
- [ ] **Cleanup Old Resources (Optional but Recommended):**
  - Once the new system is verified and stable, consider deleting the old Firestore keyword collections (`${envName}_keywords`).
