# Scripts Directory

This directory contains utility scripts for the Ananda Library Chatbot project.

## Available Scripts

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
