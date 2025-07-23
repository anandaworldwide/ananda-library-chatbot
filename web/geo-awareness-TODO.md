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
- [ ] Verify OpenAI ignores tools for non-location queries like "What is meditation?"
- [ ] Test various phrasings: "centers near me", "closest community", "spiritual groups in my area"
- [x] Confirm no manual detection code is triggered - pure AI decision making - working with fixed templates

**Status**: 🐣 **TO TEST** - Template parsing errors resolved, geo-awareness tools binding correctly

## Step 2: Tool Execution & Response Generation 🐥

- [x] Implement user location confirmation flow in chat interface
- [x] Add Google Maps API integration for geocoding corrections - working with real coordinates
- [x] Create geocoding utility functions in tools file
- [x] Handle user corrections like "Actually, I'm in Tokyo"
- [x] Implement stateless confirmation pattern (no session state needed initially)
- [x] Add error handling for geocoding API failures
- [ ] **STREAMLINE**: Ensure tool results are seamlessly integrated into AI responses
- [ ] **NATURAL**: AI should incorporate tool results naturally in conversational responses

### 🧪 Checkpoint 2: End-to-End Tool Flow

- [x] Test complete flow: "Are there Ananda centers near me?" → tool calls → natural response - working after template
      fix
- [ ] Verify tool execution happens transparently without exposing technical details
- [ ] Test tool chaining: location detection → geocoding → nearest center lookup
- [x] Confirm AI generates natural responses incorporating tool results - functioning with fixed templates
- [ ] Test error handling when tools fail (network issues, S3 unavailable, etc.)

**Status**: 🐣 **TO TEST** - Template parsing errors resolved, end-to-end flow working

## Step 3: Nearest Lookup & Fallback 🐣

- [x] Implement S3 CSV loading with simple CSV parser (no external dependencies)
- [x] Create Haversine distance calculation function (miles version)
- [x] Add 150-mile (240 km) radius filtering logic
- [x] Implement fallback to online events at ananda.org/events
- [ ] **ENHANCE**: AI should naturally explain fallback when no centers found
- [ ] **LOGGING**: Add logging for distance calculations and fallback triggers

### 🧪 Checkpoint 3: Natural Language Integration

- [ ] Test fallback responses feel natural: "I don't see any physical centers near Miami, but..."
- [ ] Verify AI contextualizes distance results: "The closest center is X miles away in..."
- [ ] Test international responses: "While there are no centers in Tokyo, you might be interested in..."
- [ ] Confirm responses include actionable information: addresses, contact details, websites

**Status**: 🐣 **TO TEST** - Core lookup functionality ready for testing with fixed templates

## Step 4: Production Deployment & Testing 🥚

- [ ] **REMOVE**: All manual keyword detection code from makechain.ts
- [ ] **REMOVE**: web/src/pages/api/debug scripts
- [ ] **RE-ADD**: Token requirement in route.ts that was temporarily removed for testing.
- [ ] **VERIFY**: Tool binding is working correctly with OpenAI model
- [ ] **TEST**: Production-like queries with various phrasings and contexts
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
- [ ] **FINAL**: Remove all manual detection logic and verify AI-only approach
- [ ] **PERFORMANCE**: Test with multiple concurrent requests
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
