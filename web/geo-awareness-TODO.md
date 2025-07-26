# Geo-Enhanced Ananda Chatbot Project Plan

**Overview:** Integrate OpenAI tool calls using proper LangChain tool binding for location queries like "Nearest Ananda
Center?" The AI will naturally decide when to call geo tools based on user intent, eliminating manual keyword detection.

**Architecture:** User Question → OpenAI Model (with tools bound) → Tool Call Decision → Tool Execution → Tool Results →
Final Response Generation

## Step 1: LangChain Tool Binding Integration 🐥

- [x] Create generic tools file `web/src/utils/server/tools.ts` for reusable tool implementations
- [x] Define `get_user_location` tool that handles IP fetch for city/lat/long
- [x] Define `find_nearest_center` tool that processes CSV for nearest match
- [x] Upload Ananda locations CSV file to S3 at `s3://ananda-chatbot/site-config/location/ananda-locations.csv`
- [x] Implement IP detection logic using `x-vercel-ip-city` header and ip-api.com fallback
- [x] **CRITICAL**: Bind tools to OpenAI model using `.bind({ tools: [...] })` in makechain.ts
- [x] **REMOVE**: Delete manual keyword detection logic (line 830 in makechain.ts)
- [x] **IMPLEMENT**: Let OpenAI naturally decide when to call location tools
- [x] **CONFIGURE**: Set up Google Maps API key (GOOGLE_MAPS_API_KEY)
- [x] **ARCHITECTURE FIX**: Pass siteConfig properly to makeChain function instead of manual loading
- [x] **TEMPLATE FIX**: Fixed LangChain template parsing errors by escaping JSON examples in prompt file

### 🧪 Checkpoint 1: AI-Driven Tool Selection

- [x] Test that OpenAI calls location tools for natural queries like "meditation centers nearby" - LangChain template
      parsing errors fixed
- [x] Verify OpenAI ignores tools for non-location queries like "What is meditation?"
- [x] Test various phrasings: "centers near me", "closest community", "spiritual groups in my area"
- [x] Confirm no manual detection code is triggered - pure AI decision making - working with fixed templates

**Status**: 🐣 **TO TEST** - Template parsing errors resolved, geo-awareness tools binding correctly

## Step 2: Tool Execution & Response Generation 🐥

- [x] Implement user location confirmation flow in chat interface
- [x] Add Google Maps API integration for geocoding corrections - working with real coordinates
- [x] Create geocoding utility functions in tools file
- [x] Handle user corrections like "Actually, I'm in Tokyo"
- [x] Implement stateless confirmation pattern (no session state needed initially)
- [x] Add error handling for geocoding API failures

### 🧪 Checkpoint 2: End-to-End Tool Flow

- [x] Test complete flow: "Are there Ananda centers near me?" → tool calls → natural response - working after template
      fix
- [x] Verify tool execution happens transparently without exposing technical details
- [x] Test tool chaining: location detection → geocoding → nearest center lookup
- [x] Confirm AI generates natural responses incorporating tool results - functioning with fixed templates
- [x] Test error handling when tools fail (network issues, S3 unavailable, etc.)

**Status**: 🐣 **TO TEST** - Template parsing errors resolved, end-to-end flow working

## Step 3: Nearest Lookup & Fallback 🐣

- [x] Implement S3 CSV loading with simple CSV parser (no external dependencies)
- [x] Create Haversine distance calculation function (miles version)
- [x] Add 150-mile (240 km) radius filtering logic
- [x] Implement fallback to online events at ananda.org/events
- [x] **ENHANCE**: AI should naturally explain fallback when no centers found

## Step 3B: Semantic Location Intent Detection (Production Implementation) 🥚

**Overview:** Replace current regex-based `hasLocationIntent()` with production-ready semantic detection achieving 94.9%
accuracy with full multilingual support.

> **⚠️ IMPORTANT:** All coding for Step 3B should be based on the proven research implementation in
> `scripts/measure_location_intent_latency.ts`. This script contains the validated semantic detection approach,
> embedding generation patterns, contrastive scoring logic, and multilingual test datasets that achieve 96.6% accuracy.
> Use this as the reference implementation for all production code.

### 3B.1: Static Asset Generation 🐥

- [x] **CREATE**: Site-specific seed files in `web/site-config/location-intent/`
  - [x] `ananda-public-seeds.json` - positive/negative location intent examples for public site
  - [x] **NOTE**: Only ananda-public needs location intent currently, but maintain site argument for future expansion
- [x] **STRUCTURE**: Each seed file contains:

  ```json
  {
    "positive": ["Where is the closest spiritual center?", "¿Hay grupos aquí?", ...],
    "negative": ["Virtual meditation classes online", "Meditation practice techniques", ...]
  }
  ```

### 3B.2: Embedding Generation Script 🐥

- [x] **CREATE**: `web/scripts/generate-location-intent-embeddings.ts`
- [x] **IMPLEMENT**: CLI with `--site` argument (supports any site, currently only ananda-public has location intent
      enabled)
- [x] **FUNCTIONALITY**:
  - [x] Read site-specific seeds from `web/site-config/location-intent/{site}-seeds.json`
  - [x] Generate embeddings using configurable embedding model from environment
  - [x] Write to `web/private/location-intent/{site}-embeddings.json`
  - [x] Include metadata: model, timestamp, seed counts, embedding dimensions
- [x] **ERROR HANDLING**: Validate OPENAI_API_KEY, handle rate limits, verify file writes
- [x] **DOCUMENTATION**: Comprehensive header comment explaining:
  - [x] Purpose: "One-time script to generate semantic embeddings for location intent detection"
  - [x] Usage: `npx tsx web/scripts/generate-location-intent-embeddings.ts --site ananda-public`
  - [x] Regeneration: "Must regenerate if embedding model changes"
  - [x] Rate limits: Batch processing recommendations

### 3B.3: Runtime Detection Module 🐥

- [x] **CREATE**: `web/src/utils/server/locationIntentDetector.ts`
- [x] **EXPORTS**:
  - [x] `async function initializeLocationIntentDetector(siteId: string): Promise<void>`
  - [x] `function hasLocationIntentAsync(query: string): Promise<boolean>`
- [x] **IMPLEMENTATION**:
  - [x] Load site-specific embeddings from `web/private/location-intent/{site}-embeddings.json`
  - [x] Cache embeddings in memory after first load
  - [x] Implement contrastive scoring: positive similarity > 0.45 AND difference > 0.1
  - [x] Use configurable OpenAI embedding model from environment
  - [x] ~66ms average latency per query (includes OpenAI API call)
- [x] **ERROR HANDLING**: Graceful fallback if embeddings file missing or corrupted

### 3B.4: MakeChain Integration 🐥

- [x] **REMOVE**: Current inline `hasLocationIntent()` function from `web/src/utils/server/makechain.ts`
- [x] **IMPORT**:
      `import { initializeLocationIntentDetector, hasLocationIntentAsync } from "@/utils/server/locationIntentDetector"`
- [x] **INITIALIZE**: Call `initializeLocationIntentDetector(siteId)` during chain setup
- [x] **REPLACE**: Use async `hasLocationIntentAsync()` function where geo-tools are conditionally bound
- [x] **VERIFY**: No changes to existing geo-awareness tool binding logic

### 3B.5: Testing & Validation 🐥

- [x] **CREATE**: `web/__tests__/utils/server/locationIntentDetector.test.ts`
- [x] **TEST CASES**:
  - [x] Positive multilingual examples: English, Spanish, German, French, Italian, Portuguese, Hindi
  - [x] Negative examples: meditation content, spiritual teachings, online courses
  - [x] Edge cases: empty queries, very long queries, error scenarios
  - [x] Error handling: missing embeddings file, network failures, missing environment variables
  - [x] Performance: ~66ms average latency (includes OpenAI API call)
- [x] **INTEGRATION TESTS**: End-to-end location queries through makechain
- [x] **REGRESSION TESTS**: Ensure no impact on non-location queries

### 3B.6: Build & Deployment Setup 🐣

- [x] **ADD**: npm script in `web/package.json`:

  ```json
  "build:location-intent": "tsx scripts/generate-location-intent-embeddings.ts"
  ```

- [x] **CREATE**: `web/private/location-intent/` directory structure
- [x] **GENERATE**: Initial embeddings for ananda-public:
  - [x] `npm run build:location-intent -- --site ananda-public` 🐥 - Generated 8MB embeddings file with 68 positive + 28
        negative seeds using text-embedding-3-large (3072D)
  - [x] **NOTE**: Script supports other sites via --site argument for future expansion
- [x] **COMMIT**: All seed files and generated embeddings to version control
- [x] **DOCUMENT**: Update `docs/backend-structure.md` with semantic location detection section 🐥 - Added comprehensive
      section covering architecture, components, integration, performance, file structure, and maintenance workflow

### 3B.7: Clean up

- [x] Remove Research file scripts/measure_location_intent_latency.ts

### 🧪 Checkpoint 3B: Semantic Detection Ready

- [x] **ACCURACY**: Achieve 96.6% accuracy on multilingual test dataset (based on research implementation)
- [x] **PERFORMANCE**: ~66ms average latency per query (includes OpenAI API call for embedding generation)
- [x] **RELIABILITY**: Graceful fallback if embeddings unavailable
- [x] **MAINTAINABILITY**: Clear separation between seeds (human-editable) and embeddings (generated)
- [x] **SCALABILITY**: Site-specific configuration without code changes

**Status**: 🐣 **TO TEST** - Implementation complete, embeddings generated, threshold logic fixed (>= instead of > for
exact threshold matches), positive threshold adjusted to 0.44

### File Structure Summary

```
web/
├── site-config/location-intent/
│   └── ananda-public-seeds.json    # Currently only ananda-public needs location intent
├── private/location-intent/
│   └── ananda-public-embeddings.json    # Generated from seeds above
├── scripts/
│   └── generate-location-intent-embeddings.ts    # Supports any site via --site argument
└── src/utils/server/
    └── locationIntentDetector.ts    # Runtime detection module
```

### 🧪 Checkpoint 3: Natural Language Integration

- [x] Test fallback responses feel natural: "I don't see any physical centers near Miami, but..."
- [x] Verify AI contextualizes distance results: "The closest center is X miles away in..."
- [x] Test international responses: "While there are no centers in Tokyo, you might be interested in..."
- [x] Confirm responses include actionable information: addresses, contact details, websites

**Status**: 🐣 **TO TEST** - Core lookup functionality ready for testing with fixed templates

## Step 4: Production Deployment & Testing 🥚

- [ ] **REMOVE**: All manual keyword detection code from makechain.ts
- [ ] **REMOVE**: web/src/pages/api/debug scripts
- [ ] **RE-ADD**: Token requirement in route.ts that was temporarily removed for testing.
- [x] **VERIFY**: Tool binding is working correctly with OpenAI model
- [x] **TEST**: Production-like queries with various phrasings and contexts
- [ ] **MONITOR**: Add comprehensive logging for tool usage and performance
- [ ] **DOCUMENT**: Update documentation with AI-driven geo-awareness feature
- [ ] **DEPLOY**: Test in Vercel preview environment

### 🧪 Checkpoint 4: Production Readiness

- [x] **CSV Parsing Bug Fixed**: Multi-line quoted fields in CSV were breaking row parsing - implemented proper CSV
      parser that handles quoted fields spanning multiple lines
- [x] Test with locations near existing centers (e.g., Nevada City, CA finds Ananda Village, Meditation Retreat,
      Sacramento center)
- [x] Test Austin, TX - finds Ananda Austin Meditation Group (exact match) and Houston group (145 miles)
- [x] Verify distance calculations are accurate using known coordinates
- [x] Test edge cases: exactly 150 miles (240 km), just under 150 miles, just over 150 miles
- [x] Confirm response format includes center name, address, distance, and contact info
- [x] Test with international locations (working - Italy finds 5 centers near Milan)
- [x] **FINAL**: Remove all manual detection logic and verify AI-only approach
- [ ] After launch to production, remove production S3 system prompt.

**Status**: ✅ **WORKING** - CSV parsing fixed, ready for AI-driven integration

## Architecture Principles

### AI-Driven Intent Detection

- **NO manual keyword detection** - let OpenAI understand user intent naturally
- **Natural language understanding** - AI is better at detecting location queries than regex
- **Scalable approach** - adding new tools requires no detection logic changes
- **Maintainable** - zero custom detection logic to maintain

### Tool Binding Pattern

```typescript
// CORRECT: Bind tools to model and let AI decide
const modelWithTools = model.bind({
  tools: [getUserLocationTool, findNearestCenterTool],
});

// WRONG: Manual detection (to be removed)
const isLocationQuery = /\b(near|nearest|center)\b/i.test(question);
```

### Natural Response Flow

```cat
User: "Are there any meditation centers near me?"
↓
AI detects location intent → calls get_user_location
↓
AI receives location data → calls find_nearest_center
↓
AI generates natural response incorporating tool results
```

## Quick Testing Commands

### Testing AI-Driven Tool Selection

```bash
# Test natural language queries that should trigger tools
curl -X POST http://localhost:3000/api/chat/v1 \
  -H "Content-Type: application/json" \
  -H "x-vercel-ip-city: Mountain View" \
  -H "x-vercel-ip-country: US" \
  -d '{"question": "Are there any spiritual communities nearby?", "history": [], "collection": "whole_library"}'

# Test non-location queries that should NOT trigger tools
curl -X POST http://localhost:3000/api/chat/v1 \
  -H "Content-Type: application/json" \
  -d '{"question": "What is meditation?", "history": [], "collection": "whole_library"}'
```

## Technical Implementation Details

### Code Structure

```cat
web/src/utils/server/
├── tools.ts              # Tool definitions for OpenAI function calls
├── makechain.ts          # LangChain integration with tool binding
└── geoUtils.ts          # Haversine and geocoding utilities

S3 Structure:
└── s3://ananda-chatbot/site-config/location/
    ├── ananda-locations.csv      # Main Ananda centers
```

### LangChain Tool Binding

```typescript
// Bind tools to OpenAI model - AI decides when to call
const modelWithTools = model.bind({
  tools: [getUserLocationTool, findNearestCenterTool],
});

// Chain handles tool execution automatically
const chain = answerPrompt.pipe(modelWithTools);
```

### Tool Execution Flow

```typescript
// AI-driven tool execution (automatic)
User Query → OpenAI Model → Tool Selection → Tool Execution → Response Generation

// No manual detection needed:
// ❌ const isLocationQuery = /pattern/.test(question);
// ✅ Let OpenAI decide naturally
```
