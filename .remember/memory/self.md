# self.md

## Mistake: S3 URL Mismatch in Tests

**Wrong**:

```
// web/__tests__/components/CopyButton.test.tsx
// Expected URL did not match the actual generated URL by getS3AudioUrl.ts
expect(callHtml).toContain(
  '<a href="https://ananda-audio.s3.us-west-2.amazonaws.com/my%20treasures%2Faudiofile.mp3">Direct Audio Test</a> (My Treasures) → 1:10',
);
```

**Correct**:

```
// web/__tests__/components/CopyButton.test.tsx
// Updated expected URL to match the output of getS3AudioUrl.ts
expect(callHtml).toContain(
  '<a href="https://ananda-chatbot.s3.us-west-1.amazonaws.com/public/audio/my%20treasures/audiofile.mp3">Direct Audio Test</a> (My Treasures) → 1:10',
);
```

## Mistake: npm run Argument Parsing

**Wrong**:
Running `npm run <script> <arg1> <arg2> --flag` might result in `--flag` not being passed to the script, as npm can intercept it.
Command: `npm run prompt ananda-public push ananda-public-base.txt --skip-tests`
Result: `--skip-tests` was not included in `process.argv` inside `manage-prompts.ts`.

**Correct**:
Use `--` to explicitly separate npm options from script arguments.
Command: `npm run prompt -- ananda-public push ananda-public-base.txt --skip-tests`
Result: `--skip-tests` is correctly passed to the script and included in `process.argv`.

### Finding: Script for Checking Firestore URLs

**Situation**: User asked for the location of a Python script that checks Firestore for 404 URLs included in "Answers". Initial searches focused on `data_ingestion` and general crawler utilities, which did not directly match the requirement of interacting with Firestore "Answers" for this specific purpose.

**Resolution**: A broader codebase search for Python scripts interacting with Firestore, URLs, and terms like "answers" and "404" identified `bin/count_hallucinated_urls.py`. This script specifically:

- Connects to Firestore.
- Queries a `chatLogs` collection (derived from an environment prefix, effectively the "Answers").
- Extracts URLs from answer fields.
- Performs HTTP HEAD requests to check their status (including 404s).
- Reports on these URLs.

**Script Path**: `bin/count_hallucinated_urls.py`
