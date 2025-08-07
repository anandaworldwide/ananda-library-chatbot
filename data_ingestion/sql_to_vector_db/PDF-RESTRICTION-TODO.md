# PDF Restriction Implementation Plan

## Overview

Enhance PDF security without user-specific watermarks (due to lack of emails). Focus on:

- Download tracking for auditing
- JWT authentication requirement
- PDF permissions to disable copying
- Maintain current signed URL expiry (no reduction)

## 🥚 1. Implement Download Tracking (Backend - Low Effort)

Track each PDF download request in Firestore for monitoring and abuse detection.

### Sub-tasks

- Create new Firestore collection 'pdf_downloads' with schema: { userId: string (from JWT), pdfKey: string, timestamp:
  date, ipAddress: string (optional) }
- In the existing signed URL endpoint (web/src/pages/api/getPdfSignedUrl.ts), after successful auth, log the event using
  firestoreUtils.ts
- Add error handling and basic rate limiting (extend genericRateLimiter.ts, e.g., 5 downloads/min and 20 downloads/hour
  per user)
- Dependencies: Existing JWT utils and Firestore service

## 🥚 2. Add JWT Authentication for PDF Downloads (Backend/Frontend - Medium Effort)

Require authentication to get signed URLs, preventing anonymous access.

### Sub-tasks for JWT

- Use existing Pages Router endpoint: web/src/pages/api/getPdfSignedUrl.ts
- Add JWT validation (jwtUtils.ts); return 401 with standard error shape on invalid/missing token
- Keep current URL expiry; no changes needed
- Update frontend (SourcesList.tsx, etc.): Call existing endpoint; handle auth errors (e.g., redirect to login)
- Add tests: Extend api tests in web/**tests**/api/ with auth scenarios
- Dependencies: appRouterJwtUtils.ts, existing S3 signed URL logic

## 🥚 3. Disable Text Copying in PDFs (Data Ingestion - Medium Effort)

Set PDF security flags during generation to prevent text selection/copying.

### Sub-tasks for #3

- Use ReportLab built-in encryption (already installed). In data_ingestion/sql_to_vector_db/ingest_db_text.py
  (create_pdf_from_content / SimpleDocTemplate), apply reportlab.lib.pdfencrypt.StandardEncryption with permissions to
  disallow copying (and optionally printing)
- Do not add PyPDF2 dependency
- Validate exact ReportLab flags (e.g., canCopy=False, canPrint=True/False as desired)
- Test: Generate sample PDF, verify in Adobe Reader that text can't be selected/copied
- Handle in --overwrite-pdfs mode; update any related tests
- Dependencies: ReportLab output as bytes, reportlab.lib.pdfencrypt.StandardEncryption

## Prioritization & Timeline

- Priority 1: Download Tracking (quick win for monitoring)
- Priority 2: JWT Auth (core security)
- Priority 3: PDF Permissions (file-level protection)

## Risks/Notes

- PDF permissions aren't foolproof (e.g., screenshots), but deter casual copying
- Ensure mobile compatibility for downloads
- Monitor performance impact on PDF generation
- After implementation, update docs/SECURITY-README.md
