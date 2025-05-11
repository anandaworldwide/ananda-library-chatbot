# Ananda Library Chatbot - Product Requirements Document

## Product Requirements Document: Ananda Library Chatbot

### 1. Introduction

The Ananda Library Chatbot is a sophisticated question-answering system designed to respond to user queries based on
a specific corpus of knowledge, primarily spiritual teachings and related materials associated with Ananda. It utilizes
Retrieval-Augmented Generation (RAG) by leveraging Large Language Models (LLMs) combined with vector database lookups
(Pinecone) to provide contextually relevant answers derived from ingested source documents (texts, PDFs, potentially
audio/video transcripts). The system features configurable personalities/prompts, user feedback mechanisms,
authentication, and integration options, including a WordPress plugin.

### 2. Goals

- Provide accurate, context-aware answers to user questions based on the Ananda library's knowledge base.
- Offer a conversational and intuitive user interface for interacting with the knowledge base.
- Support multiple configurations or "personas" tailored to specific subsets of the library or user needs.
- Enable efficient ingestion and updating of the knowledge base from various sources.
- Provide mechanisms for monitoring usage, collecting user feedback, and improving answer quality.
- Ensure secure and reliable operation with appropriate access controls and rate limiting.
- Offer integration capabilities, specifically with WordPress sites.

### 3. User Roles

- **End User:** Interacts with the chatbot via a web interface or integrated plugin to ask questions and receive answers.
  May provide feedback on answer quality (like/dislike).
- **Administrator:** Configures chatbot instances (prompts, models, data sources), manages the data ingestion process,
  monitors system health and usage, manages user access (if applicable), and potentially reviews feedback.

### 4. Functional Requirements

- **FR1: Chat Interface & Interaction**
  - **FR1.1:** Provide a web-based chat interface where users can input questions.
  - **FR1.2:** Display responses from the chatbot, including citations/references to source documents
    (`calculateSources`).
  - **FR1.3:** Support streaming responses for better perceived performance.
  - **FR1.4:** Maintain conversation history within a session (`chatHistory`).
  - **FR1.5:** Allow users to clear the conversation history.
  - **FR1.6:** Offer mechanisms for user feedback (e.g., thumbs up/down) on individual answers (`useVote`, `/api/vote`).
  - **FR1.7:** Display related questions based on the current query (`/api/relatedQuestions`).
  - **FR1.8:** (Optional/Configurable) Support audio playback for answers or source material (`useAudioPlayer`).
- **FR2: Question Answering (RAG Core)**
  - **FR2.1:** Accept user queries via the designated API endpoint (`/api/chat/v1/route.ts`).
  - **FR2.2:** Process user queries using Langchain (`makechain.ts`).
  - **FR2.3:** Query the configured Pinecone vector index to retrieve relevant document chunks based on the user's
    question.
  - **FR2.4:** Construct a prompt for the LLM (e.g., OpenAI's GPT models) including the user query and retrieved context.
  - **FR2.5:** Utilize pre-defined system prompts based on the selected configuration (`site-config/prompts`,
    `loadSiteConfig`).
  - **FR2.6:** Generate a coherent answer based on the LLM response.
  - **FR2.7:** Extract and format source citations from the retrieved document metadata (`DocMetadata.ts`).
- **FR3: Data Ingestion & Management**
  - **FR3.1:** Provide Python scripts for processing and ingesting data into Pinecone (`python/data_ingestion`).
  - **FR3.2:** Support ingestion from text files and PDFs (`customPDFLoader.ts`, `db-to-pdfs.py`).
  - **FR3.3:** Support transcription of audio/video files (using external services like AssemblyAI inferred from
    `transcription_utils.py`) and ingestion of transcripts (`transcribe_and_ingest_media.py`).
  - **FR3.4:** Support crawling web content (`ananda_crawler.py`).
  - **FR3.5:** Utilize a queue system for managing ingestion tasks (`IngestQueue.py`, `manage_queue.py`).
  - **FR3.6:** Associate relevant metadata (source, author, URL, potentially timestamps) with ingested data chunks
    (`DocMetadata.ts`).
  - **FR3.7:** Provide scripts for managing data in Pinecone (delete, migrate, stats) (`delete_pinecone_data.py`,
    `migrate_pinecone.py`, `vector_db_stats.py`).
- **FR4: Configuration & Personalization**
  - **FR4.1:** Allow definition of multiple chatbot configurations/sites (`site-config/config.json`).
  - **FR4.2:** Each configuration specifies:
    - Target Pinecone namespace/collection (`pineconeNamespace`).
    - LLM model (`modelName`).
    - System prompts (`prompts`).
    - Feature flags (e.g., `enable_sources`, `enable_related_questions`).
    - UI elements (titles, logos).
  - **FR4.3:** (Client-side) Allow users to select between available data collections if configured
    (`CollectionSelector.jsx`, `useMultipleCollections.ts`).
- **FR5: Authentication & Authorization**
  - **FR5.1:** Secure the chat API endpoint (`/api/chat/v1/route.ts`).
  - **FR5.2:** Implement JWT-based authentication for API access (`jwtUtils.ts`, `authMiddleware.ts`,
    `appRouterJwtUtils.ts`).
  - **FR5.3:** Provide endpoints for login (`/api/login`) and potentially token generation (`/api/get-token`,
    `/api/web-token`).
  - **FR5.4:** Support basic password authentication (`passwordUtils.ts`).
  - **FR5.5:** Implement "sudo" mode for privileged actions using cookies (`/api/sudoCookie.ts`, `sudoCookieUtils.ts`).
  - **FR5.6:** Secure administrative actions (`/api/adminAction`).
- **FR6: Monitoring & Feedback**
  - **FR6.1:** Log chat interactions (questions, answers, feedback) to a persistent store (likely Firestore based on
    `firestoreUtils.ts`, `likeService.ts`).
  - **FR6.2:** Provide API endpoints to retrieve chat logs and feedback (`/api/answers`, `/api/downvotedAnswers`).
  - **FR6.3:** Implement analytics tracking (client-side) (`analytics.ts`).
  - **FR6.4:** (Optional) Support NPS surveys (`/api/submitNpsSurvey`).
  - **FR6.5:** (Optional) Support model comparison data collection and voting (`/api/model-comparison*`).
- **FR7: WordPress Integration**
  - **FR7.1:** Provide a WordPress plugin (`wordpress/plugins/ananda-ai-chatbot`).
  - **FR7.2:** Embed the chatbot interface into WordPress pages/posts using a shortcode or block.
  - **FR7.3:** Handle authentication between WordPress and the chatbot backend securely (`secure-api-client.php`,
    `chatbot-auth.js`).
- **FR8: Rate Limiting**
  - **FR8.1:** Implement rate limiting on API endpoints to prevent abuse (`genericRateLimiter.ts`, likely using Redis
    based on `redisUtils.ts`).
  - **FR8.2:** Provide mechanisms to prune expired rate limit data (`/api/pruneRateLimits`).

### 5. Non-Functional Requirements

- **NFR1: Performance**
  - **NFR1.1:** Provide low-latency responses for user queries, utilizing streaming where possible.
  - **NFR1.2:** Ensure efficient vector searches in Pinecone.
  - **NFR1.3:** Data ingestion processes should be performant and scalable.
- **NFR2: Scalability**
  - **NFR2.1:** The system should handle a growing number of users and concurrent requests (Leverages serverless
    platforms like Vercel).
  - **NFR2.2:** The knowledge base (Pinecone index) should scale to accommodate large amounts of data.
  - **NFR2.3:** Data ingestion should handle large files and potentially large batches of data.
- **NFR3: Security**
  - **NFR3.1:** Implement robust authentication and authorization mechanisms (JWT).
  - **NFR3.2:** Protect against common web vulnerabilities (OWASP Top 10).
  - **NFR3.3:** Secure API keys and sensitive credentials (using environment variables, potentially secrets management).
  - **NFR3.4:** Address items listed in `SECURITY-TODO.md`.
  - **NFR3.5:** Ensure secure communication between WordPress and the backend.
- **NFR4: Reliability & Availability**
  - **NFR4.1:** The chatbot service should be highly available.
  - **NFR4.2:** Implement proper error handling and logging throughout the application stack.
  - **NFR4.3:** Ensure reliable data persistence for chat logs and feedback (Firestore).
- **NFR5: Maintainability**
  - **NFR5.1:** Codebase should be well-structured, documented, and follow consistent coding standards (TypeScript,
    Python).
  - **NFR5.2:** Implement unit and integration tests for critical components (`__tests__`, `TESTS-TODO.md`).
  - **NFR5.3:** Configuration should be externalized and easy to manage (`site-config`).
- **NFR6: Usability**
  - **NFR6.1:** The chat interface should be intuitive and easy to use.
  - **NFR6.2:** Setup and configuration for administrators should be clearly documented.

### 6. Technical Specifications (Based on Code Analysis)

- **Frontend:** Next.js, React, TypeScript, CSS Modules
- **Backend:** Node.js (via Next.js API routes), TypeScript, Python (for data ingestion & utilities)
- **AI/ML:** Langchain (JS & Python), OpenAI API (GPT models)
- **Vector Database:** Pinecone
- **Data Storage:** Firestore (for chat logs, feedback, potentially rate limiting/user data), AWS S3 (likely for storing
  media files for transcription)
- **Caching/Rate Limiting:** Redis (inferred)
- **Authentication:** JWT, Basic Auth (Password hashing)
- **Deployment:** Vercel (inferred from `vercel.json`, `next.config.js`)
- **Key Libraries:**
  - Node: `langchain`, `@pinecone-database/pinecone`, `openai`, `jsonwebtoken`, `redis`, `firebase-admin`,
    `react-query`, `axios`.
  - Python: `langchain`, `pinecone-client`, `openai`, `tiktoken`, `unstructured`, `pdfminer.six`, `pydub`, `librosa`,
    `assemblyai`, `boto3` (AWS SDK), `beautifulsoup4` (web scraping), `firebase-admin`, `google-cloud-firestore`.

### 7. Future Considerations / Open Issues (from TODOs)

- Enhance security measures as outlined in `SECURITY-TODO.md`.
- Increase test coverage as outlined in `TESTS-TODO.md`.
- Refine data ingestion pipelines for robustness and error handling.
- Explore alternative LLMs or vector databases if needed.
- Improve admin interface/tooling for configuration and monitoring.
- Add more sophisticated analytics and reporting.

This document provides a comprehensive overview based on the provided codebase. It should serve as a solid foundation
for further development and refinement of the Ananda Library Chatbot.
