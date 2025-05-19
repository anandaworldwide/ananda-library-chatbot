# Project.md

## Current project

See @crawler-TODO.md

## S3 Bucket Policy for Public Access

The user wants to restrict public access to a specific path within the S3 bucket.

**Previous Policy Snippet (PublicReadGetObject Statement)**:

```json
{
  "Sid": "PublicReadGetObject",
  "Effect": "Allow",
  "Principal": "*",
  "Action": "s3:GetObject",
  "Resource": "arn:aws:s3:::ananda-chatbot/*"
}
```

**Current Preference (PublicReadGetObject Statement)**:
The `Resource` should be restricted to a specific path, e.g., `public/audio/*`.

```json
{
  "Sid": "PublicReadGetObject",
  "Effect": "Allow",
  "Principal": "*",
  "Action": "s3:GetObject",
  "Resource": "arn:aws:s3:::ananda-chatbot/public/audio/*"
}
```

### Dependency Version Alignment

- All shared dependencies across web, data_ingestion, and packages/shared-utils must match the versions in web/package.json. Web versions take priority.
- As of [2024-07-09], @types/jest and ts-jest in packages/shared-utils were updated to match web/package.json.
- If adding or updating a dependency in any package, ensure the version matches web/package.json if it exists there.
