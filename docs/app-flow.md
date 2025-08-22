# Ananda Library Chatbot - Application Flow

## Ananda Library Chatbot - App Flow Document

**Purpose:** This document outlines the typical user journey, navigation, and key interactions within the Ananda Library
Chatbot application.

**Contents:**

1. **User Workflows**
2. **Screen Transitions / States**
3. **Key Interactions**
4. **Integration Points**

---

### 1. User Workflows

#### Chat Interaction Flow

```text
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│    User     │    │  Frontend   │    │   Backend   │    │   AI/Data   │
│             │    │   (Next.js) │    │    APIs     │    │  Services   │
└──────┬──────┘    └──────┬──────┘    └──────┬──────┘    └──────┬──────┘
       │                  │                  │                  │
       │ 1. Enter Question│                  │                  │
       ├─────────────────→│                  │                  │
       │                  │ 2. JWT + Query   │                  │
       │                  ├─────────────────→│                  │
       │                  │                  │ 3. Vector Search │
       │                  │                  ├─────────────────→│
       │                  │                  │ 4. Context Chunks│
       │                  │                  │←─────────────────┤
       │                  │                  │ 5. LLM Generate  │
       │                  │                  ├─────────────────→│
       │                  │ 6. Stream Answer │ 6. Stream Response│
       │                  │←─────────────────┤←─────────────────┤
       │ 7. Display Answer│                  │                  │
       │←─────────────────┤                  │                  │
       │                  │                  │ 8. Log to DB     │
       │                  │                  ├─────────────────→│
       │ 9. Feedback      │                  │                  │
       ├─────────────────→│ 10. Store Vote   │                  │
       │                  ├─────────────────→│                  │
```

#### A. Basic Question & Answer Flow (Unauthenticated/Default)

1. **User Accesses Chatbot:** The user lands on the page hosting the chatbot (either the main Next.js application page
   or a WordPress page where the plugin is embedded).
2. **View Chat Interface:** The user sees the chat interface, including:
   - A message display area.
   - An input field for questions.
   - A submit button.
   - (Optional) A selector for choosing a knowledge base/collection (`CollectionSelector.jsx`,
     `hooks/useMultipleCollections.ts`).
   - (Optional) Example/suggested questions (`public/data/.../whole_library_queries.txt`).
3. **(Optional) Select Collection:** The user might select a specific library or collection to query against.
4. **Enter Question:** The user types their question into the input field.
5. **Submit Question:** The user clicks the submit button or presses Enter.
6. **Receive Answer:**
   - The frontend sends the question (and selected collection) to the backend chat API (`app/api/chat/v1/route.ts`).
   - The backend processes the question, retrieves relevant information (likely from Pinecone vector store -
     `utils/server/pinecone-client.ts`, `utils/server/makechain.ts`), generates an answer, and streams it back.
   - The frontend displays the answer, potentially showing sources or related questions
     (`pages/api/relatedQuestions.ts`).
7. **(Optional) Provide Feedback:** The user can like or dislike the answer using feedback buttons (`hooks/useVote.ts`,
   `pages/api/vote.ts`, `pages/api/like.ts`).

#### B. Authenticated User Flow

```text
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│    User     │    │  Frontend   │    │   Backend   │    │  Database   │
│             │    │   (Next.js) │    │    APIs     │    │ (Firestore) │
└──────┬──────┘    └──────┬──────┘    └──────┬──────┘    └──────┬──────┘
       │                  │                  │                  │
       │ 1. Access Site   │                  │                  │
       ├─────────────────→│                  │                  │
       │                  │ 2. Check Auth    │                  │
       │                  ├─────────────────→│                  │
       │                  │ 3. Redirect Login│                  │
       │                  │←─────────────────┤                  │
       │ 4. Enter Creds   │                  │                  │
       ├─────────────────→│                  │                  │
       │                  │ 5. Login Request │                  │
       │                  ├─────────────────→│                  │
       │                  │                  │ 6. Verify Hash   │
       │                  │                  ├─────────────────→│
       │                  │                  │ 7. User Valid    │
       │                  │                  │←─────────────────┤
       │                  │ 8. JWT + Cookie  │                  │
       │                  │←─────────────────┤                  │
       │ 9. Chat Access   │                  │                  │
       │←─────────────────┤                  │                  │
```

If the site is configured to require user login:

1. **User Navigates to Login:** The user accesses a login mechanism (potentially a dedicated page or modal).
2. **Enter Credentials:** The user provides credentials - a password shared by all users of the site.
3. **Submit Login:** The user submits the login form, triggering the login API (`pages/api/login.ts`). Authentication
   might involve JWT (`utils/server/jwtUtils.ts`) and password hashing (`utils/server/passwordUtils.ts`). Middleware
   (`middleware.ts`, `utils/server/authMiddleware.ts`) likely handles session/token validation for subsequent requests.
4. **Access Authenticated Features:** Once logged in, the user has access to
   - The main chat interaction page.
   - The All Answers page (if turned on for the site).
   - Individual answer pages.
5. **Perform Actions:** The user interacts with the chatbot as in the basic flow, but potentially with elevated
   privileges or access.
6. **Logout:** The user initiates logout, triggering the logout API (`pages/api/logout.ts`).

#### C. WordPress Integration Flow

1. **User Visits WordPress Page:** The user navigates to a WordPress page containing the chatbot embed code provided by
   the plugin (`wordpress/plugins/ananda-ai-chatbot/ai-chatbot.php`).
2. **Chatbot Widget Loads:** The chatbot JavaScript (`assets/js/chatbot.js`) initializes the chat interface widget on
   the page. Authentication might be handled via WordPress mechanisms feeding into the chatbot's auth
   (`assets/js/chatbot-auth.js`, `pages/api/web-token.ts`).
3. **Interact with Widget:** The user interacts with the chatbot within the widget, following the Basic Question &
   Answer Flow described above. API calls are made from the WordPress frontend to the Next.js backend API.

### 2. Screen Transitions / States

- **Initial Load:** Chat interface is displayed, possibly with introductory text or suggested questions.
- **Collection Selection:** If multiple collections exist, the UI updates to reflect the selected collection.
- **Question Input:** User focuses on the input field.
- **Loading/Waiting for Answer:** After submitting a question, a loading indicator (e.g.,
  `styles/loading-dots.module.css`) appears while waiting for the backend response.
- **Answer Display:** The chat area updates with the user's question and the chatbot's streamed response. Source links
  or related questions might appear alongside the answer.
- **Feedback State:** Buttons for liking/disliking might change appearance after being clicked.
- **(Authenticated) Login Screen:** A separate view/modal for entering credentials.
- **(Authenticated) Logged-in State:** UI might show user status or provide access to logout/admin features.

### 3. Key Interactions

- **Sending a Chat Message:** Typing text and submitting via button or Enter key (`hooks/useChat.ts`).
- **Selecting a Collection:** Choosing from a dropdown or list (`components/CollectionSelector.jsx`).
- **Liking/Disliking an Answer:** Clicking thumbs-up/down icons (`hooks/useVote.ts`, `pages/api/vote.ts`,
  `pages/api/like.ts`).
- **Viewing Sources:** Clicking links associated with an answer to see the origin of the information.
- **Viewing All Answers:** Viewing answers from all users (if turned on for the site) and liking them.
- **Viewing Related Questions:** Clicking on suggested follow-up questions.
- **(Authenticated) Logging In/Out:** Using forms/buttons to manage authentication state.
- **(WordPress) Opening/Closing Chat Widget:** Interacting with the embedded chat element on the page.

### 4. Integration Points

- **Backend API:** The core interaction point is the chat API (`app/api/chat/v1/route.ts`), handling question processing
  and answer generation.
- **Vector Database (Pinecone):** Used for retrieving relevant document chunks based on the user's query
  (`config/pinecone.ts`, `utils/server/pinecone-client.ts`). Data is populated into Pinecone through various ingestion
  processes, including a website crawler (`data_ingestion/crawler/website_crawler.py`), PDF processing, audio/video
  transcription, and direct SQL database imports.
- **Database (Firestore):** Likely used for storing chat logs, user votes, configuration, or other persistent data
  (`services/firebase.ts`, `utils/server/firestoreUtils.ts`).
- **Authentication System:** Manages user login, logout, and potentially JWT tokens (`pages/api/login.ts`,
  `pages/api/logout.ts`, `utils/server/jwtUtils.ts`).
- **WordPress:** The chatbot can be embedded and interact within a WordPress environment via the plugin (`wordpress/`).
- **Rate Limiting (Redis):** Mechanisms to prevent abuse (`utils/server/redisUtils.ts`,
  `utils/server/genericRateLimiter.ts`, `pages/api/pruneRateLimits.ts`).

This flow provides a high-level overview based on the project structure.
