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
  - spaCy (for semantic text chunking)
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
  - Python scripts are primarily used for data ingestion tasks, including web crawling (`BeautifulSoup4`), processing
    PDF files (`pdf_to_vector_db.py`), audio files, YouTube videos, and SQL databases.
  - **spaCy** is used for semantic text chunking with dynamic paragraph-based splitting (225-450 word target range)
    which significantly outperforms fixed-size chunking based on RAG evaluation results. Includes adaptive token sizing
    and smart merging for optimal chunk quality.
  - Document-level hashing strategy is implemented for Pinecone vector IDs to enable efficient bulk operations.
  - Scripts interact with a MySQL database (likely Wordpress).
  - **pdfplumber** replaces PyPDF2 for improved PDF processing and full-document text extraction with superior layout
    preservation.
- **Testing:**
  - Jest is used for JavaScript/TypeScript testing[cite: 5].
  - **pytest** is used for Python testing with comprehensive coverage of data ingestion functionality.
- **WordPress Plugin:**
  - A WordPress plugin is included, using PHP, to integrate the chatbot into WordPress sites.
