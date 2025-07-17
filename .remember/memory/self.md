# self.md

## Critical Lessons Learned

### 1. Always Add `--site` CLI Argument and Environment Loading

**Wrong**: Creating scripts without `--site` command-line option and not calling `load_env(site)`.

```python
# Missing site arg and env load
args = parser.parse_args()
# ... directly uses get_pinecone_client() → env vars not loaded
```

**Correct**: Always follow ingestion-script pattern:

```python
from pyutil.env_utils import load_env

args = parser.parse_args()
load_env(args.site)  # loads .env.<site>
# now safe to access Pinecone/OpenAI env vars
```

### 2. Token vs Word Count Confusion in Chunking Systems

**Problem**: Chunking systems use **token-based targets** (600 tokens) but analysis/statistics often report **word
counts**, creating evaluation mismatches.

**Wrong**: Measuring words when system uses token targets.

```python
word_count = len(text.split())
target_range = 225-450  # words
```

**Correct**: Use same tokenization as production system.

```python
import tiktoken
encoding = tiktoken.encoding_for_model("text-embedding-ada-002")
token_count = len(encoding.encode(text))
target_range = 450-750  # tokens (75%-125% of 600-token target)
```

### 3. HTML Processing Destroying Paragraph Structure

**Wrong**: Aggressive whitespace normalization destroys paragraph breaks.

```python
text = soup.get_text()
text = re.sub(r'\s+', ' ', text).strip()  # DESTROYS ALL PARAGRAPHS
```

**Correct**: Preserve block structure, then selectively normalize.

```python
text = soup.get_text(separator='\n\n', strip=True)  # PRESERVES BLOCK STRUCTURE
text = re.sub(r'[ \t]+', ' ', text)        # Fix spacing within lines
text = re.sub(r'\n{3,}', '\n\n', text)     # Normalize excessive newlines
```

### 4. Test During Development, Not at End

**Wrong**: Separating unit tests into "Phase III" at the end.

**Correct**: Test immediately after each component:

```markdown
### [ ] 1. Create `utils/text_processing.py`

- [ ] Functions to extract...
- [ ] Create unit tests for `text_processing.py` ← IMMEDIATE
- [ ] Validate one script works before moving on
```

### 5. Explicit TypeScript Typing for Firestore Operations

**Wrong**: Implicit 'any' types in Firestore map functions.

```typescript
querySnapshot.docs.map((doc) => ...)  // 'doc' has implicit 'any' type
```

**Correct**: Always explicitly type Firestore document parameters.

```typescript
querySnapshot.docs.map(
  (doc: firebase.firestore.QueryDocumentSnapshot) => ...
);
```

### 6. Implement Retry Logic for External Service Failures

**Pattern**: Google Cloud/Firestore intermittent failures (code 14, "Policy checks unavailable").

**Solution**: Centralized retry utilities with exponential backoff.

```typescript
import { firestoreGet, firestoreUpdate } from "@/utils/server/firestoreRetryUtils";

// Instead of direct Firestore calls
const doc = await firestoreGet(docRef, "operation name", "context");
```

### 7. Overlap Logic Must Respect Token Limits

**Wrong**: Blindly adding overlap without validation.

```python
overlapped_chunk = overlap_text + " " + chunk  # Could exceed 600 tokens!
```

**Correct**: Calculate available token budget first.

```python
chunk_tokens = len(self._tokenize_text(chunk))
max_overlap_tokens = self.chunk_size - chunk_tokens

if max_overlap_tokens > 0:
    actual_overlap = min(self.chunk_overlap, max_overlap_tokens)
    # Only add overlap that fits within token budget
```

### 8. HTML Paragraph Tag Processing for PDF Generation

**Wrong**: BeautifulSoup tree manipulation with insert_before/insert_after can fail to preserve newlines.

```python
# Unreliable - BeautifulSoup may not preserve inserted newlines
for p_tag in soup.find_all("p"):
    p_tag.insert_before("\n\n")
    p_tag.insert_after("\n\n")
    p_tag.unwrap()
```

**Correct**: Use regex preprocessing before BeautifulSoup for reliable paragraph conversion.

```python
# Reliable - Convert <p> tags to newlines before parsing
content = re.sub(r'<p[^>]*>', '\n\n', content)  # Opening tags
content = re.sub(r'</p>', '\n\n', content)      # Closing tags
soup = BeautifulSoup(content, "html.parser")    # Then clean attributes
```

### 9. ReportLab PDF Generation - Remove Problematic Tags and Attributes

**Wrong**: Removing all HTML or not removing problematic tags/attributes that cause ReportLab paraparser failures.

```python
# Either too aggressive (removes formatting)
text = soup.get_text()  # Loses <em>, <strong> formatting

# Or insufficient (misses problematic tags/attributes)
if attr in ["id", "class", "style"]:  # Misses "rel", "alt", etc.
# Missing: <img> tags without src attribute cause "paraparser: syntax error: <img> needs src attribute"
```

**Correct**: Remove problematic tags completely, then clean attributes while preserving formatting tags.

```python
# STEP 1: Remove tags that cause paraparser failures
for img_tag in soup.find_all("img"):
    img_tag.decompose()  # <img> tags without src cause paraparser errors

# STEP 2: Remove problematic attributes while keeping formatting tags
problematic_attrs = [
    "id", "class", "style", "href", "onclick", "onload", "name",
    "rel", "target", "alt", "height", "width", "src",
    "title", "lang", "dir", "tabindex", "accesskey", "contenteditable",
    "draggable", "hidden", "spellcheck", "translate"
]

for attr in tag.attrs:
    if (attr in problematic_attrs
        or attr.startswith("data-")
        or attr.startswith("on")
        or attr.startswith("aria-")):
        del tag.attrs[attr]  # Remove attribute but keep the tag
```

### 10. Vector ID Format Change Breaking Document Counting - VALIDATED FIX

**Problem**: The `vector_db_stats.py` script was showing chunks and documents as nearly equal numbers, which is incorrect since documents are split into multiple chunks.

**Root Cause**: The vector ID format changed from 6 parts to 7 parts:
- **Old format**: `{type}||{library}||{source}||{title}||{author}||{chunk_index}`
- **New format**: `{content_type}||{library}||{source_location}||{sanitized_title}||{sanitized_author}||{document_hash}||{chunk_index}`

The key issue is that `document_hash` is now chunk-specific (includes `chunk_text`), so each chunk has a different hash.

**Wrong**: Removing only the chunk_index for document identification:
```python
if len(parts) >= 6:
    doc_id = "||".join(parts[:-1])  # Still includes chunk-specific hash
```

**Correct**: Remove both document_hash and chunk_index for proper document identification:
```python
if len(parts) >= 7:
    # Use first 5 parts: {content_type}||{library}||{source_location}||{sanitized_title}||{sanitized_author}
    doc_id = "||".join(parts[:5])  # Excludes chunk-specific hash and index
elif len(parts) >= 6:
    # Fallback for older format
    doc_id = "||".join(parts[:-1])
```

**Pattern**: When vector ID formats change, always verify what makes a document unique vs. what makes a chunk unique.

**Validated**: Successfully tested with 10,000 vectors showing proper chunk-to-document ratios (~50 chunks per document).
