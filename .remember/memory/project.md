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

### Vercel Monorepo Local Package Build Order Fix

**Problem:** Vercel builds from a subdirectory (e.g., web/) that depends on a local package (e.g., packages/shared-utils). The build fails if the local package is not built first (e.g., missing dist/loadEnv.js).

**Fix:** Add the following scripts to the subdirectory's package.json (e.g., web/package.json):

```
"prebuild": "cd ../packages/shared-utils && npm install && npm run build",
"postinstall": "cd ../packages/shared-utils && npm install && npm run build"
```

This ensures the local package is built before the subdirectory's build runs, fixing module not found errors on Vercel.

### Browserslist Error in Next.js Build

**Problem:** Vercel build fails with `Cannot find module 'browserslist'` during the Next.js build process. This happens when processing CSS files with autoprefixer in the Next.js application.

**Fix:**

- Add browserslist directly to the devDependencies of the package running Next.js (web/package.json):
  ```
  "browserslist": "^4.23.0"
  ```
- Run `npm install` to update the lockfile.

**Important note:** The error might appear to be coming from a dependency package (like packages/shared-utils) if that package is built in a prebuild step, but the actual error occurs in the Next.js build context when processing CSS. Always check the require stack carefully to identify which package actually needs the dependency.
