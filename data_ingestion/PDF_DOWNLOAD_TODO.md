# PDF Download Project - Implementation TODO

## Project Overview

Add PDF file upload and download capabilities to both SQL and PDF ingestion pipelines, with frontend download buttons
for users to access source documents.

## Implementation Order & Tasks

### Phase 1: SQL Ingestion PDF Generation (PRIORITY)

- [x] **1.1** Install PDF generation dependencies
  - Add `reportlab` to `requirements.in` (more popular than weasyprint)
  - Update `requirements.txt` via pip-compile
- [x] **1.2** Modify `data_ingestion/sql_to_vector_db/ingest_db_text.py`
  - Import PDF generation libraries and S3 utilities
  - Add `--no-pdf-uploads` command line argument to argparse
  - Create PDF generation function using scraped content (simple text-based PDFs with basic formatting)
  - Generate document hash for consistent S3 naming
  - Upload generated PDF to S3 using existing `s3_utils.upload_to_s3()`
  - Add `pdf_s3_key` to chunk metadata: `f"{site_prefix}/public/pdf/{library_name}/{document_hash}.pdf"`
  - Implement 200 MB file size limit for generated PDFs
  - Add error handling with retry/backup strategy: retry once with backup approach, then fail whole processing if that
    doesn't work
- [x] **1.3** Update SQL ingestion test suite
  - Add tests for PDF generation functionality
  - Mock S3 uploads in test environment
  - Test `--no-pdf-uploads` flag behavior
  - Verify metadata includes correct S3 keys

### Phase 2: Frontend PDF Download Capabilities

- [x] **2.1** Create server-side signed URL generation
  - Create `web/src/utils/server/getS3PdfSignedUrl.ts`
  - Follow pattern from `web/src/utils/client/getS3AudioUrl.ts`
  - Generate signed URLs with 8-hour expiration using AWS SDK
  - Handle error cases (missing S3 key, AWS errors)
- [x] **2.2** Add PDF download button to SourcesList component
  - Modify `web/src/components/SourcesList.tsx`
  - Create `renderPdfDownloadButton()` function similar to `renderGoToSourceButton()`
  - Position download button to the left of "Go to source" button
  - Use download icon (e.g., `download` Material Icon)
  - Only show if `pdf_s3_key` exists in source metadata
  - Handle download click events with proper analytics logging
- [x] **2.3** Update TypeScript types

  - Add `pdf_s3_key?: string` to `web/src/types/DocMetadata.ts`
  - Ensure type safety across components

- [ ] **2.4** Update frontend test suite
  - Add tests for PDF download button rendering
  - Test signed URL generation
  - Mock S3 interactions
  - Test analytics event logging

### Phase 3: Environment Variable Updates

- [ ] **3.1** Update environment variable names
  - Change `NEXT_PUBLIC_S3_AUDIO_BUCKET_NAME` to `NEXT_PUBLIC_S3_BUCKET_NAME` in all codebase references
  - Change `NEXT_PUBLIC_S3_AUDIO_REGION` to `NEXT_PUBLIC_S3_REGION` in all codebase references
  - Update development environment configurations for all sites
  - Update production environment configurations for all sites:
    - ananda site production environment
    - ananda-public site production environment
    - crystal site production environment
    - jairam site production environment
  - Update documentation and deployment scripts
  - Test all sites after environment variable changes

### Phase 4: PDF Ingestion S3 Upload

- [ ] **4.1** Modify `data_ingestion/pdf_to_vector_db.py`
  - Import S3 utilities from `data_ingestion/utils/s3_utils.py`
  - Add `--no-pdf-uploads` command line argument
  - Upload source PDF to S3 during processing using `upload_to_s3()`
  - Generate document hash for consistent naming
  - Store S3 key in chunk metadata format: `f"{site_prefix}/public/pdf/{library_name}/{document_hash}.pdf"`
  - Implement 200 MB file size limit for source PDFs
  - Add error handling with retry/backup strategy: retry once with backup approach, then fail whole processing if that
    doesn't work
- [ ] **4.2** Update PDF ingestion metadata flow
  - Modify `_extract_document_metadata()` function to include S3 key
  - Ensure all chunks from same PDF share same S3 key
  - Handle cases where PDF upload fails gracefully
- [ ] **4.3** Update PDF ingestion test suite
  - Add tests for S3 upload functionality
  - Mock S3 operations in test environment
  - Test `--no-pdf-uploads` flag behavior
  - Verify metadata consistency across chunks

## Technical Implementation Details

### S3 Key Format

```bash
{site_prefix}/public/pdf/{library_name}/{document_hash}.pdf
```

- `site_prefix`: Follow same pattern as audio files (e.g., "ananda", "crystal")
- `library_name`: Library identifier (e.g., "anandalib", "treasures")
- `document_hash`: SHA-256 hash of document content for uniqueness

### Metadata Structure

Add to both ingestion methods:

```python
metadata = {
    # ... existing fields ...
    "pdf_s3_key": f"{site_prefix}/public/pdf/{library_name}/{document_hash}.pdf"
}
```

### Command Line Arguments

Both ingestion scripts should support:

```bash
python script.py --no-pdf-uploads  # Disable S3 uploads for testing/development
```

### Frontend Button Placement

In `SourcesList.tsx`, modify `renderGoToSourceButton()` area:

```jsx
<div className="mt-2 mb-3 flex gap-2">
  {renderPdfDownloadButton(doc)} {/* New download button */}
  {renderGoToSourceButton(doc)} {/* Existing "Go to source" button */}
</div>
```

## Dependencies Required

### Python Dependencies

- `reportlab` for PDF generation from HTML/text (more popular than weasyprint)
- Existing `boto3` (already installed) for S3 operations

### Environment Variables In production

- `NEXT_PUBLIC_S3_BUCKET_NAME` (renamed from `NEXT_PUBLIC_S3_AUDIO_BUCKET_NAME`)
- `NEXT_PUBLIC_S3_REGION` (renamed from `NEXT_PUBLIC_S3_AUDIO_REGION`)

## Testing Strategy

### Unit Tests

- PDF generation from scraped content
- S3 upload with proper error handling
- Metadata inclusion and consistency
- Command line argument processing

### Integration Tests

- End-to-end PDF generation and upload workflow
- Frontend download button functionality
- Signed URL generation and expiration

### Manual Testing

- Test downloads across different browsers
- Verify PDF content matches source documents
- Test error scenarios (missing files, expired URLs)

## Risk Mitigation

### Potential Issues

1. **Large PDF files**: May hit Lambda/Vercel function size limits
2. **PDF generation quality**: Scraped content may not format well
3. **S3 costs**: Additional storage and bandwidth costs
4. **Processing time**: PDF generation may slow ingestion

### Mitigation Strategies

1. Implement 200 MB file size limits for both generated and source PDFs
2. Test PDF generation quality with sample content (simple text-based PDFs with basic formatting)
3. Monitor S3 usage and costs
4. Make PDF uploads optional via `--no-pdf-uploads` flag
5. Implement retry/backup strategy: retry once with backup approach, then fail whole processing if that doesn't work

## Success Criteria

- [ ] SQL ingestion generates and uploads PDFs successfully
- [ ] PDF ingestion uploads source PDFs to S3
- [ ] Frontend shows download buttons for sources with PDFs
- [ ] Download buttons generate working signed URLs
- [ ] All tests pass with good coverage
- [ ] Performance impact is minimal
- [ ] Error handling is robust

## Notes

- Web crawling does NOT need PDF generation - users should link directly to web pages
- Follow existing patterns from audio file handling
- Ensure consistent S3 key naming across all ingestion methods
- Consider PDF generation as "nice to have" - prioritize source PDF uploads for PDF ingestion
