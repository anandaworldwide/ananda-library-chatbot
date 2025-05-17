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
