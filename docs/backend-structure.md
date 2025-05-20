# Backend Structure

**Purpose:** This document describes the architecture and organization of the backend for the Ananda Library Chatbot
application. It details API endpoints, data storage, authentication mechanisms, and key server-side processes to facilitate
understanding and future development.

---

## 1. Architecture Overview

- **Framework:** The backend is built primarily using **Next.js**, leveraging both the `pages/api` directory for traditional
  serverless functions and the `app/api` directory (App Router) for edge-compatible routes.
- **Language:** **TypeScript** is the primary language for the Next.js backend logic. **Python** is used for data ingestion
  and processing scripts, including website crawling (`data_ingestion/crawler/website_crawler.py`), PDF parsing,
  audio transcription, and SQL data conversion.
- **Hosting:** Likely deployed on **Vercel** (implied by Next.js usage and edge functions) and potentially uses **AWS S3**
  for media storage and **Firebase** services (Firestore).
- **Key Technologies:**
  - **Node.js:** Runtime for the Next.js application.
  - **LangChain:** Framework used for building the core chat logic, orchestrating retrieval, context management, and LLM
    interaction (`makechain.ts`).
  - **OpenAI:** Used for Large Language Model (LLM) inference and text embeddings (via LangChain).
  - **Pinecone:** Vector database used for storing and retrieving document embeddings for the Retrieval-Augmented
    Generation (RAG) process (`pinecone-client.ts`, `config/pinecone.ts`).
  - **Firestore:** NoSQL database used for storing chat logs, user data, votes, likes, cached related questions, and
    potentially ingestion queue state (`firestoreUtils.ts`, `services/firebase.ts`).
  - **Redis:** In-memory data store used primarily for API rate limiting (`redisUtils.ts`, `genericRateLimiter.ts`).
  - **AWS S3:** Object storage used for hosting source audio files (`awsConfig.ts`,
    `data_ingestion/audio_video/s3_utils.py`).
  - **AssemblyAI / Whisper:** Likely used for audio transcription within the Python ingestion scripts.

---

## 2. API Endpoints

API endpoints are defined in `pages/api/` and `app/api/`. Most endpoints are protected and require authentication.

**Core Chat:**

- **`POST /api/chat/v1`** (`app/api/chat/v1/route.ts`)
  - **Purpose:** Main endpoint for handling user chat queries. Implements the RAG pipeline.
  - **Auth:** Requires JWT authentication (validated via `appRouterJwtUtils.ts`).
  - **Logic:** Takes user question, history, and selected namespace. Retrieves relevant context from Pinecone, interacts
    with LLM via LangChain, streams the response, logs interaction to Firestore.
  - **Response:** Streams `StreamingResponseData` containing text chunks, source documents, and related questions.

**Authentication & Authorization:**

- **`POST /api/login`** (`pages/api/login.ts`)
  - **Purpose:** Authenticates users based on username/password.
  - **Auth:** Open.
  - **Logic:** Compares provided password with stored hash (`passwordUtils.ts`), generates a JWT (`jwtUtils.ts`), and sets
    it as an HttpOnly cookie.
- **`POST /api/logout`** (`pages/api/logout.ts`)
  - **Purpose:** Logs out the user.
  - **Auth:** Requires valid JWT.
  - **Logic:** Clears the authentication cookie.
- **`GET /api/web-token`** (`pages/api/web-token.ts`)
  - **Purpose:** Generates a short-lived token, likely for embedding the chatbot in external sites.
  - **Auth:** Requires API key/secret validation.
- **`POST /api/get-token`** (`pages/api/get-token.ts`)
  - **Purpose:** Part of a secure token exchange flow, potentially for WordPress integration.
  - **Auth:** Requires specific token validation.
- **`POST /api/sudoCookie`** (`pages/api/sudoCookie.ts`)
  - **Purpose:** Sets or clears an admin "sudo mode" cookie, bypassing certain restrictions.
  - **Auth:** Requires admin-level privileges (checks JWT for admin role).

**Data Interaction & Features:**

- **`POST /api/vote`** (`pages/api/vote.ts`)
  - **Purpose:** Records user upvotes or downvotes on chat answers.
  - **Auth:** Requires JWT authentication (`authMiddleware.ts`).
  - **Logic:** Updates vote counts in Firestore (`firestoreUtils.ts`).
- **`POST /api/like`** (`pages/api/like.ts`)
  - **Purpose:** Records user likes on chat answers.
  - **Auth:** Requires JWT authentication.
  - **Logic:** Updates like counts in Firestore (`likeService.ts`, `firestoreUtils.ts`).
- **`GET /api/answers`** (`pages/api/answers.ts`)
  - **Purpose:** Retrieves specific answers or question details.
  - **Auth:** Requires JWT authentication.
  - **Logic:** Fetches data from Firestore (`answersUtils.ts`).
- **`POST /api/relatedQuestions`** (`pages/api/relatedQuestions.ts`)
  - **Purpose:** Generates and returns related questions based on the current query context.
  - **Auth:** Requires JWT authentication.
  - **Logic:** Uses LLM via `relatedQuestionsUtils.ts`, potentially caching results.
- **`POST /api/contact`** (`pages/api/contact.ts`)
  - **Purpose:** Handles contact form submissions.
  - **Auth:** Likely open or uses basic CSRF protection.
  - **Logic:** Sends email or stores contact message.
- **`POST /api/submitNpsSurvey`** (`pages/api/submitNpsSurvey.ts`)
  - **Purpose:** Stores Net Promoter Score survey results.
  - **Auth:** Requires JWT authentication.
  - **Logic:** Writes survey data to Firestore.

**Admin & Maintenance:**

- **`GET /api/firestoreCron`** (`pages/api/firestoreCron.ts`)
  - **Purpose:** Scheduled task endpoint for Firestore maintenance (e.g., data cleanup, aggregation).
  - **Auth:** Requires Cron Secret (`cronAuthUtils.ts`).
- **`POST /api/pruneRateLimits`** (`pages/api/pruneRateLimits.ts`)
  - **Purpose:** Scheduled task endpoint to clean up expired rate limit entries in Redis.
  - **Auth:** Requires Cron Secret.
- **`GET /api/stats`**, **`GET /api/downvotedAnswers`**, **`POST /api/adminAction`**
  - **Purpose:** Various endpoints for administrative tasks like viewing statistics, managing content.
  - **Auth:** Requires admin-level privileges (JWT validation).

**Middleware:**

- **Next.js Middleware (`middleware.ts`):** Intercepts requests globally or for specific paths. Handles JWT verification
  for protected pages/routes and potentially redirects.
- **API Middleware:** Wrappers applied to API handlers to enforce authentication (JWT validation), CORS policies, rate
  limiting, and error handling.

---

## 3. Database Schema

Data is stored across multiple services:

- **Firestore:**

  - **`chatLogs` (Collection):** Stores records of each chat interaction.
    - `question`: User's query.
    - `answer`: LLM's generated response.
    - `sources`: Array of source document metadata used for the answer.
    - `timestamp`: Time of the interaction.
    - `userId`: Identifier for the user (if logged in).
    - `sessionId`: Identifier for the chat session.
    - `vote`: Number indicating vote status (e.g., 1 for up, -1 for down, 0 for none).
    - `likeCount`: Number of likes.
    - `messageId`: Unique ID for the message pair.
    - `namespace`: The Pinecone namespace used.
    - (Other potential fields: feedback, model used, etc.)
  - **`answers` (Collection):** Possibly stores standalone answers or references chat logs for voting/retrieval. Schema
    likely overlaps significantly with `chatLogs`.
  - **`votes` (Collection):** Tracks individual votes.
    - `userId`: Voting user.
    - `questionId`/`messageId`: Identifier for the voted item.
    - `voteType`: 'up' or 'down'.
  - **`likes` (Collection):** Tracks individual likes.
    - `userId`: Liking user.
    - `questionId`/`messageId`: Identifier for the liked item.
  - **`users` (Collection - Inferred):** Stores user login credentials.
    - `username`: User identifier.
    - `passwordHash`: Hashed password (`bcrypt` used in `passwordUtils.ts`).
    - `roles`: (Potentially) User roles (e.g., 'admin').
  - **`npsSurveys` (Collection):** Stores NPS survey responses.
  - **`relatedQuestionsCache` (Collection):** Caches generated related questions to avoid re-computation.
  - **`modelComparisons`, `modelComparisonVotes` (Collections):** Data related to A/B testing or comparing different LLM
    responses.
  - **`ingestQueue` (Collection - Inferred):** Used by Python scripts to manage the data ingestion pipeline for sources
    like websites, PDFs, audio, video, and SQL databases.

- **Pinecone:**

  - **Index(es):** Contains vector embeddings of source documents. Organized by `namespace` (e.g., 'ananda', 'jairam',
    'crystal').
  - **Vectors:** High-dimensional representations of text chunks.
  - **Metadata (`DocMetadata.ts`):** Stored alongside vectors.
    - `source`: Original filename or URL.
    - `pageNumber`: Page number for PDFs.
    - `loc`: Location information (e.g., line numbers).
    - `txtPath`: Path to the text file.
    - `text`: The actual text chunk embedded.
    - `type`: Source type ('pdf', 'audio', 'youtube', 'txt').
    - `title`: Document title.
    - `author`: Document author.
    - `url`: URL source (e.g., from web crawling).
    - `publishedDate`: Publication date.
    - `s3Key`: Path to the audio file in S3 (for audio sources).
    - `startSecond`, `endSecond`: Timestamps for audio/video chunks.

- **Redis:**

  - Stores key-value pairs for rate limiting, typically mapping an IP address or user ID to a request count within a time
    window. Keys might look like `rateLimit:<ip_address>`.

- **AWS S3:**
  - Stores raw media files (primarily audio `.mp3`, `.wav`) processed during data ingestion. File paths are stored in
    Pinecone metadata (`s3Key`).

---

## 4. Authentication Flows

- **Standard User Login:**
  1. User submits username/password to `POST /api/login`.
  2. Server validates credentials against Firestore (`users` collection).
  3. If valid, server generates a JWT containing user ID and potentially roles (`jwtUtils.ts`).
  4. JWT is set as an HttpOnly, Secure cookie in the response.
  5. Subsequent requests include this cookie.
- **API Request Verification:**
  1. Requests arrive at protected API endpoints (most endpoints).
  2. Next.js Middleware or API Route Middleware intercepts the request.
  3. Middleware extracts the JWT from the cookie.
  4. JWT signature and expiration are verified using the secret key.
  5. If valid, the request proceeds; otherwise, a 401/403 error is returned.
- **WordPress/Web Integration Token Flow:**
  1. An initial secure request hits `GET /api/web-token`.
  2. The endpoint validates the secret and generates a short-lived, single-use token.
  3. This token is potentially passed to the frontend client running within WordPress.
  4. The client might use this token to call `POST /api/get-token`.
  5. `POST /api/get-token` validates the token and issues a standard JWT cookie.
- **Cron Job Authentication:**
  1. Scheduled jobs call specific endpoints (`/api/firestoreCron`, `/api/pruneRateLimits`).
  2. The request must include an `Authorization: Bearer <CRON_SECRET>` header.
  3. The endpoint validates the secret using `cronAuthUtils.ts`.
- **Admin Sudo Mode:**
  1. An admin user calls `POST /api/sudoCookie` (likely triggered from a specific admin UI).
  2. The endpoint verifies the user's JWT confirms they are an admin.
  3. If admin, a separate "sudo mode" cookie is set (`sudoCookieUtils.ts`).
  4. Certain operations might check for this cookie to allow privileged actions.

---

## 5. Server-Side Logic

- **Chat Response Generation (`makechain.ts`, `app/api/chat/v1/route.ts`):**
  - Core RAG pipeline implementation using LangChain.
  - Selects appropriate prompt based on namespace (`site-config/prompts/`).
  - Initializes Pinecone vector store connection for the relevant namespace.
  - Uses `ConversationalRetrievalQAChain` which:
    1. Optionally rephrases the question based on history.
    2. Performs similarity search in Pinecone to find relevant document chunks.
    3. Injects retrieved context and chat history into the LLM prompt.
    4. Calls the LLM (e.g., OpenAI) to generate an answer.
    5. Streams the answer back to the client.
  - Handles source document formatting and logging.
- **Data Ingestion (`data_ingestion/`):**
  - A collection of Python scripts responsible for populating the Pinecone vector database.
  - `transcribe_and_ingest_media.py`: Main script orchestrating the process for various media types.
  - **Steps:**
    1. **Source Acquisition:** Fetches files from local paths, S3, or downloads from URLs.
    2. **Preprocessing:** Extracts text from PDFs, transcribes audio/video.
    3. **Chunking:** Splits large documents/transcripts into smaller, manageable chunks.
    4. **Metadata Extraction:** Gathers relevant metadata (source, author, title, etc.).
    5. **Embedding:** Generates vector embeddings for text chunks.
    6. **Upserting:** Uploads vectors and associated metadata to the correct Pinecone namespace.
  - Uses helper scripts for specific tasks (`youtube_utils.py`, `s3_utils.py`, `pinecone_utils.py`).
  - Manages tasks potentially via a queue (`IngestQueue.py`, `manage_queue.py`).
- **Related Questions Generation:**
  - Takes the user's query and potentially the conversation context.
  - Sends a request to an LLM to generate relevant follow-up questions.
  - Caches results (Firestore/Redis) to reduce LLM calls.
- **Voting and Liking:**
  - API endpoints receive vote/like requests with message/answer IDs.
  - Use Firestore transactions or atomic increments to update vote/like counts.
  - Record individual votes/likes in separate collections to prevent duplicate actions.
- **Rate Limiting:**
  - Implemented as API middleware.
  - Uses Redis to store counters keyed by IP address (or potentially user ID).
  - For each request, increments the counter and checks if it exceeds the defined limit.
  - If the limit is exceeded, returns a 429 Too Many Requests error.
  - Expired keys are periodically pruned via the `/api/pruneRateLimits` cron job.
- **Configuration Management:**
  - Server loads configuration details from `site-config/config.json`.
  - Prompts specific to different namespaces/personas are loaded from JSON files within `site-config/prompts/`.

---

## 5. Utility Scripts & Cron Jobs

The `bin/` directory and parts of `data_ingestion/audio_video/` contain various Python utility scripts for maintenance,
data processing, and analysis.

- **`bin/count_hallucinated_urls.py`**
  - **Purpose:** Analyzes Firestore `chatLogs` (effectively "Answers" based on environment) to identify and count URLs
    present in answer fields that return errors or non-2xx HTTP status codes (e.g., 404 Not Found).
  - **Functionality:**
    - Connects to Firestore.
    - Queries chat logs within specified time intervals.
    - Extracts all URLs from the 'answer' field of each log.
    - Performs HTTP HEAD requests to each unique URL to check its status.
    - Reports counts of invalid/broken URLs, categorized by time interval.
  - **Usage:** Typically run manually or as a scheduled task to monitor the health of URLs provided in chatbot answers.
    `python bin/count_hallucinated_urls.py --site <site_id> -e <environment> --interval <days> [--num-intervals <count>]`
