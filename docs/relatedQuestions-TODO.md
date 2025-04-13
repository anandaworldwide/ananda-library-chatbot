# TODO: Related Questions - OpenAI Embeddings & Pinecone Integration

This checklist outlines the remaining tasks to fully implement and verify the switch from keyword-based related questions to OpenAI embeddings with Pinecone.

- [ ] **Initial Embedding Generation / Backfill:**
  - Run the batch update process (e.g., via `python/bin/manual_related_qs_updater.py` or by calling the `GET /api/relatedQuestions` endpoint) to generate embeddings for all existing questions in the `answers` collection and upsert them into the Pinecone index.
  - Monitor the process for errors (OpenAI API errors, Pinecone upsert errors).
  - This may need to be run multiple times with appropriate batch sizes until the `lastProcessedId` in the `progress` collection indicates a full pass.
- [ ] **Rewrite Unit Tests:**
  - Update the tests in `__tests__/utils/server/relatedQuestionsUtils.test.ts` to mock OpenAI and Pinecone clients/API calls.
  - Ensure tests cover embedding generation, Pinecone upserts, Pinecone queries, and the overall logic of `updateRelatedQuestions` and `updateRelatedQuestionsBatch`.
- [ ] **Testing & Validation:**
  - Deploy the changes to a development/staging environment.
  - Test the `POST /api/relatedQuestions` endpoint (triggered when a new Q&A is added) to ensure it correctly generates an embedding, finds related questions via Pinecone, and updates the Firestore document.
  - Test the `GET /api/relatedQuestions` endpoint (batch update) to confirm it processes batches, updates embeddings, finds related questions, and updates progress correctly.
  - Manually review the `relatedQuestionsV2` field in Firestore documents to verify the results seem semantically relevant.
  - Check application logs for any errors related to Pinecone initialization, OpenAI API calls, embedding upserts, or Pinecone queries.
- [ ] **Cleanup Old Resources (Optional but Recommended):**
  - Once the new system is verified and stable, consider deleting the old Firestore keyword collections (`${envName}_keywords`).
  - Remove old Redis cache entries related to keywords if they are no longer used elsewhere.
