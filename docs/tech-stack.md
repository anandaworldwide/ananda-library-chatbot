# Tech Stack

Here's a breakdown of the tech stack used in the project:

## Core Technologies

- **Programming Languages:**
  - TypeScript
  - JavaScript
  - Python
  - PHP
- **Frameworks/Libraries:**
  - Next.js [cite: 5]
  - React [cite: 5]
  - LangChain
  - Tailwind CSS
  - Express
- **Databases:**
  - Pinecone
  - Google Firestore
  - MySQL
- **Tools:**
  - Node.js
  - NPM
  - Yarn
  - Firebase CLI
  - Jest [cite: 5]
  - pyenv
  - Prettier

## Key Components and Their Technologies

- **Frontend:**
  - Built with Next.js and React[cite: 5].
  - Uses Tailwind CSS for styling.
- **Backend:**
  - Uses Node.js and Express for server-side logic and APIs[cite: 5].
  - Potentially uses Firebase for some backend functions (authentication, database).
- **AI/LLM:**
  - LangChain is the primary framework for building the chatbot.
  - OpenAI APIs are used.
  - Pinecone is used as a vector store for embeddings.
- **Data Ingestion/Processing:**
  - Python scripts are used for data ingestion, including website crawling (e.g., using `Playwright`,
    `BeautifulSoup4`), processing PDF files, audio files, YouTube videos, and SQL databases.
  - TypeScript scripts (e.g., `pdf_to_vector_db.ts`) are also utilized for specific ingestion tasks.
  - Scripts interact with a MySQL database (likely Wordpress).
- **Testing:**
  - Jest is used for JavaScript/TypeScript testing[cite: 5].
  - Python's `unittest` is used for Python testing.
- **WordPress Plugin:**
  - A WordPress plugin is included, using PHP, to integrate the chatbot into WordPress sites.
