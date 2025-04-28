# Scripts Directory

This directory contains utility scripts for the Ananda Library Chatbot project.

## Available Scripts

### `ingest-text-data.ts`

A script for ingesting PDF documents into a Pinecone vector database for retrieval.

#### Usage of ingest-text-data.ts

```bash
npm run ingest
# OR with tracing for debugging
npm run ingest-trace
```

#### How ingest-text-data.ts works

1. Processes PDF files recursively from a given directory
2. Creates and manages a Pinecone index for storing document embeddings
3. Supports incremental updates with checkpointing
4. Handles graceful shutdowns and resumption of processing
5. Clears existing vectors for a given library name if requested
6. Uses OpenAI embeddings for vector representation

#### Options for ingest-text-data.ts

- `--file-path`: Path to the directory containing PDF files
- `--site`: Site name for loading environment variables
- `--library-name`: Name of the library to process (default: "Default Library")
- `--keep-data`: Flag to keep existing data in the index (default: false)

### `migrate_pinecone.py`

A Python script for migrating vectors between Pinecone indexes.

#### Usage of migrate_pinecone.py

```bash
python3 scripts/migrate_pinecone.py --source-key <key> --target-key <key> --source-index <name> --target-index <name>
```

#### How migrate_pinecone.py works

1. Connects to both source and target Pinecone instances
2. Queries vectors from the source index
3. Transforms metadata (e.g., updating library names)
4. Uploads vectors to the target index
5. Provides progress tracking and error handling
