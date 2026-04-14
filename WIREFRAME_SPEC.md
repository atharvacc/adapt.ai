# Adapt AI — Wireframe Specification

> Feed this file into Cursor to build the React frontend. Every component, interaction, state, and API call is specified below.

## Tech Stack

- React 18 + TypeScript
- Tailwind CSS
- React Router (4 top-level routes matching sidebar tabs)
- Zustand for state management
- React Query for API calls
- WebSocket for real-time DAG status updates
- Lucide React for icons

## Layout

```
┌──────────────────────────────────────────────────────┐
│ Top Bar: "Adapt AI" logo left, user avatar right     │
├──────────┬───────────────────────────────────────────┤
│ Sidebar  │ Main Content Area                         │
│          │                                           │
│ Accounts │                                           │
│ Intel Hub│                                           │
│ Workflows│                                           │
│ Analytics│                                           │
│          │                                           │
│          │                                           │
└──────────┴───────────────────────────────────────────┘
```

- Sidebar: fixed left, 220px wide, dark background (#0D1B2A)
- 4 nav items with icons, active state highlighted
- Main content: fluid width, light background (#FAFAFA), 24px padding

---

## Page 1: Accounts

**Route:** `/accounts`

### Default View: Account Card Grid

Display connected social accounts as cards in a 2-column grid.

Each card:
- Platform icon (LinkedIn blue, X black, Instagram gradient, TikTok black, Facebook blue)
- Account handle (@company)
- Connection status badge: green "Connected" or gray "Not Connected"
- Post count and last sync timestamp
- Click entire card → opens detail pane

Top-right: "+ Connect Account" button → opens OAuth flow (mock for MVP)

### Detail View (when card clicked)

Slides in from right or replaces main content. Breadcrumb: "← Accounts / @company LinkedIn"

3 tabs:

**Overview tab:**
- Stats row: Total Posts (number), Date Range (earliest to latest), Avg Engagement Rate (%), Data Health (% with complete metrics)
- Format mix: horizontal bar chart showing % text, image, video, carousel, thread, article

**Posts tab:**
- Sortable table: Date, Content (truncated to 100 chars), Type (badge), Hook Type (badge with color), Impressions, Engagement Rate
- Pagination (20 per page)
- Sort by any column header click

**Inferences tab:**
- 4 cards in 2x2 grid:
  - Top Formats: ranked list with engagement multiplier (e.g., "Carousel: 2.1x, Thread: 1.6x")
  - Best Times: day × hour heatmap or ranked list ("Tue 10am: 1.8x, Wed 2pm: 1.4x")
  - Hook Performance: bar chart or ranked list by hook type with engagement rate
  - Audience Signals: key demographics summary (from audience_demographics)

### Data

```typescript
interface SocialAccount {
  id: string;
  platform: 'linkedin' | 'x' | 'instagram' | 'tiktok' | 'facebook';
  handle: string;
  status: 'connected' | 'syncing' | 'disconnected';
  postCount: number;
  lastSyncAt: string;
  dataHealthPercent: number;
}

interface SocialPost {
  id: string;
  accountId: string;
  platform: string;
  contentText: string;
  mediaType: string;
  hookType: string;
  publishedAt: string;
  impressions: number;
  engagementRate: number;
}

interface AccountInference {
  id: string;
  accountId: string;
  inferenceType: 'top_format' | 'best_time' | 'hook_perf' | 'audience_signal';
  data: any; // JSONB
}
```

### API Calls
- `GET /v1/accounts` → list all accounts
- `POST /v1/accounts` → initiate OAuth connection
- `DELETE /v1/accounts/:id` → disconnect
- `GET /v1/accounts/:id/posts?page=1&sort=publishedAt&order=desc` → paginated posts
- `GET /v1/accounts/:id/inferences` → inference data

---

## Page 2: Intelligence Hub

**Route:** `/intelligence`

### Sub-Navigation

Sidebar within the Intelligence Hub page (or horizontal tabs):
- **Brand Voice** (default)
- **Personas**
- **Rules**
- **Insights**

---

### 2A: Brand Voice

**Route:** `/intelligence/voice`

#### Default View: Voice Card Gallery

Cards in a 2-column grid. Each card:
- Voice name (e.g., "Primary", "Product Launch")
- Purpose (1-line description)
- Voice consistency: circular progress indicator with % (e.g., 87%)
- Posts trained on: number
- Attached rule sets: count badge
- Data sources: count badge (social accounts)
- Click card → detail view

Top-right: "+ Create Voice" button → opens creation wizard

#### Voice Detail View

Breadcrumb: "← Brand Voice / Primary"

6 tabs:

**Overview tab:**
- Purpose (text block)
- Creation method: "Auto-generated from LinkedIn + X (last 6 months, 847 posts)"
- Attribute sliders: 5 bars (professional, data_driven, conversational, authoritative, playful) each 0-100%
- Voice consistency explanation: "87% of generated content matches this voice profile"
- Avoid list: tag chips (deletable)
- Platform overrides: collapsible per-platform sections showing how voice differs

**Edit tab:**
- Full editable form: name, purpose, description (textarea), attribute score sliders (draggable), avoid list (tag input), per-platform override textareas
- "Save" button, "Retrain from Data" button (triggers re-computation), "Delete Voice" button (red, confirmation modal)
- Time period selector: dropdown (Last 3 months, Last 6 months, Last 12 months, All time)

**Rule Sets tab:**
- List of attached rule sets with "Detach" button each
- "+ Attach Rule Set" dropdown showing available sets
- Note: "These rule sets auto-apply when this voice is used in a workflow"

**Data Sources tab:**
- List of connected social accounts with toggle switches (on = included in training)
- Each shows: platform icon, handle, post count contributed, sync status
- "Retrain" button at bottom (triggers re-computation with current toggles + time period)

**Create Post tab:**
- Source content textarea (paste blog post, brief, etc.)
- Platform checkboxes (which platforms to generate for)
- "Generate" button → shows loading → displays variant cards per platform
- Each variant card: text preview, consistency score badge, rationale expandable, "Copy" button

**History tab:**
- Timeline of model updates: "Voice created", "Retrained from 912 posts", "Taste-maker pattern auto-applied: removed aggressive CTAs"
- Each entry: timestamp, event type, before/after consistency score
- Pending patterns section: patterns detected but awaiting approval, with "Apply" / "Dismiss" buttons

#### Voice Creation Wizard (Modal or Full-Page)

3 steps with step indicator:

**Step 1 — Select Social Accounts + Time Period:**
- List of connected social accounts with toggle switches
- Time period dropdown: Last 3 months, Last 6 months (default), Last 12 months, All time
- Post count preview: "Selected: 847 posts from 2 accounts"
- "Next" button

**Step 2 — Generate:**
- Loading state with progress: "Analyzing 847 posts... Extracting voice attributes... Detecting platform overrides..."
- When complete: shows generated voice profile preview
  - Auto-generated name suggestion
  - Description (editable textarea)
  - Attribute scores (5 sliders, pre-filled)
  - Avoid list (tag chips, pre-filled)
  - Platform overrides detected (collapsible sections)
- "Regenerate" button, "Next" button

**Step 3 — Refine & Save:**
- Everything from step 2 is editable
- Name field (editable, pre-filled with suggestion)
- Purpose field (short text)
- Attach rule sets: multi-select dropdown
- "Save Voice" button → creates and redirects to voice detail

---

### 2B: Personas

**Route:** `/intelligence/personas`

#### Default View

Two sections on the page:

**Audience Personas section:**
- Header: "Audience Personas" with "+ Audience" button
- Cards: name, description (truncated), avg engagement badge, trend arrow (↑/↓/→)
- e.g., "B2B Decision Maker", "Developer / IC"

**Agent Personas section:**
- Header: "Agent Personas" with "+ Agent" button
- Cards: name, writing approach badge (e.g., "Thought Leader"), description (truncated), platform chips showing configured platforms
- e.g., "Thought Leader", "Community Builder"

Click any card → detail view

#### Audience Persona Detail

3 tabs: Details, Edit, Performance

**Details tab:**
- Name, description
- Source: "Auto-inferred from @company LinkedIn" or "Manual"
- Demographics summary (if auto-inferred): seniority breakdown, function breakdown
- Platform behavior: per-platform text blocks
- Tags: positive (green chips), negative (red chips)

**Edit tab:**
- All fields editable. Name, description (textarea), platform behavior per platform (textareas), tags (tag inputs)
- If auto-inferred: "Re-infer from account" button to refresh from latest data

**Performance tab:**
- Table: platform, avg engagement when this persona was targeted, best hook type, sample size
- Compared against overall average

#### Audience Persona Creation

Two paths shown as tabs or toggle:

**Auto-Infer tab:**
- Select social account from dropdown
- "Generate Persona" button → loading → shows generated persona preview
- Name suggestion, description, seniority/function breakdown, platform behaviors, tags
- User reviews, edits, saves

**Manual tab:**
- Form: name, description, platform behavior (textarea per platform), tags_positive (tag input), tags_negative (tag input)
- Save

#### Agent Persona Detail

3 tabs: Configuration, Platform Config, Performance

**Configuration tab:**
- Name, description
- Writing approach: badge (e.g., "Thought Leader")
- Tone: visual blend bars (professional: 80%, conversational: 40%, etc.)
- Structure preference: text
- Enabled tools: checkboxes showing which retrieval paths are active (voice exemplars ✓, performance data ✓, trending ✗, etc.)
- Default audience personas: list of attached audiences

**Platform Config tab:**
- Accordion/collapsible per platform (LinkedIn, X, IG, TT, FB)
- Each platform section:
  - Rule set: dropdown selector
  - Audience persona(s): multi-select dropdown (can target multiple)
  - Behavior overrides: textarea for platform-specific instructions
  - Status: "Configured" / "Using defaults"

**Performance tab:**
- Table: platform × audience persona combination, avg engagement, best hook, sample size
- Highlights best-performing combos

#### Agent Persona Creation

Guided form:

- Name (text input)
- Description (textarea)
- Writing approach: dropdown (Thought Leader, Community Builder, Educator, Provocateur, Storyteller, Custom)
  - If Custom: shows textarea for custom approach description
- Tone: slider group (professional, conversational, casual, authoritative, playful — each 0-100, must sum roughly to a blend)
- Structure preference: dropdown (Insight→Evidence→Implication, Question→Exploration→Takeaway, Story→Lesson→CTA, Custom)
  - If Custom: textarea
- Enabled tools: checkbox group
  - ☑ Voice exemplars (RAG)
  - ☑ Performance data
  - ☑ Taste-maker patterns
  - ☑ Audience context
  - ☐ Trending signals
  - ☐ Cross-brand benchmarks
- Default audience personas: multi-select dropdown (select 1 or more)
- Per-platform config: expandable sections per connected platform
  - Rule set: dropdown
  - Audience override: multi-select (or "use default")
  - Behavior override: textarea (or empty = use default)
- "Create Agent" button

---

### 2C: Rules

**Route:** `/intelligence/rules`

#### Default View: Rule Set Card Grid

Cards in 2-column grid. Each card:
- Rule set name (e.g., "LinkedIn Professional")
- Rule count badge (e.g., "7 rules")
- Platform badge (e.g., "LinkedIn")
- Workflow usage count (e.g., "Used in 3 workflows")
- Tag for special sets: "Emergency" (red) for Crisis Mode
- Click → detail view

Top-right: "+ New Rule Set" button

#### Rule Set Detail View

3 tabs: Rules, Edit, Usage

**Rules tab:**
- List of individual rules, each with:
  - Type dot: blue = Platform, green = Learned, amber = Custom, red = Compliance
  - Rule name and description
  - Enforcement badge: "Hard" (blocks), "Soft" (warns), "Advisory" (suggests)
  - Toggle switch (on/off per rule within the set)

**Edit tab:**
- Name, description, default platform (dropdown)
- Rule list with reorder (drag handles), add/remove
- "+ Add Rule" button opens a rule picker modal:
  - Tabs for rule types: Platform, Custom, Compliance, Learned
  - Search/filter within each tab
  - Click to add to set
- "Create New Rule" inline: name, description, type dropdown, enforcement dropdown, platform dropdown, trigger condition (optional JSON/text)

**Usage tab:**
- Table: workflow definition name, which node(s) use this set, run count
- Links to the workflow definitions

#### Rule Set Creation

- Name (text input)
- Description (textarea)
- Default platform (dropdown: LinkedIn, X, Instagram, TikTok, Facebook, All)
- Rule selection: same picker as Edit tab
- "Create Rule Set" button

---

### 2D: Insights

**Route:** `/intelligence/insights`

#### Default View: 4 Insight Cards

2x2 grid:

**Hook Performance card:**
- Title: "Hook Performance"
- Summary: "Data hooks lead on LinkedIn (2.1x)"
- Click → expanded view: table with hook_type × platform × avg engagement rate × sample size

**Format Comparison card:**
- Title: "Format Performance"
- Summary: "Carousel outperforms text by 1.7x on IG"
- Click → expanded view: table with media_type × platform × avg engagement × sample size

**Timing card:**
- Title: "Optimal Timing"
- Summary: "Tue 10am best for LinkedIn"
- Click → expanded view: heatmap (day × hour) per platform, or ranked list

**Trending card:**
- Title: "Trending Now"
- Summary: "AI agents replacing SDRs ↑ (high velocity)"
- Click → expanded view: table with signal_type, signal_value, platform, velocity_score, relevance_score, detected_at
- Cross-brand section: "Similar B2B SaaS brands: data hooks 2.1x on LI (n=340)"

---

## Page 3: Workflows

**Route:** `/workflows`

### Default View: Workflow Definition List

Collapsible cards, each representing a workflow definition:

Each card (collapsed):
- Name (e.g., "Weekly Product Content")
- Active runs badge (e.g., "2 active")
- Platform chips (LI, X, IG, TT, FB)
- Agent persona name
- Voice name
- Click arrow to expand → shows run list

Each card (expanded):
- Run list below the card:
  - Run ID, source content title (truncated), status badge (Active/Done/Scheduled/Failed)
  - Timestamp
  - Progress dots: 5 stages (Source → Adapt → Review → Publish → Complete)
    - Green = complete, Amber = in progress, Gray = pending, Red = failed
  - Click run → opens DAG editor
- "+ Start New Run" button at bottom of run list

Top-right: "+ New Workflow" button

### DAG Editor (when run clicked)

**Route:** `/workflows/:defId/runs/:runId`

Breadcrumb: "← Workflows / Weekly Product Content / Run #12"

#### DAG Canvas (top section, ~60% of viewport)

Horizontal flow of nodes connected by edges:

```
[Source] → [LinkedIn] → [Review] → [LI Publish]
              [X]     →          → [X Publish]
              [IG]    →          → [IG Publish]
              [TT]    →          → [TT Publish]
              [FB]    →          → [FB Publish]
```

Each platform node shows composition at a glance:
- 4 rows with colored dots:
  - 🔵 Voice: "Primary"
  - 🟠 Agent: "Thought Leader"
  - 🟢 Audience: "B2B DM"
  - ⚫ Rules: "LI Professional"
- Status badge: pending/running/done/failed

Source node: shows source content title, word count
Review node: shows per-platform approval status (✓/✗/⏳ per platform)
Publish nodes: show scheduled time or "Published at..."

**Double-click any platform node → opens detail pane below**

#### Detail Pane (bottom section, ~40% of viewport)

3 tabs:

**Composition tab:**
- 4 cards in a row, each with colored left border:
  - Voice (blue): current voice name, "Change →" link → dropdown of all voices
  - Agent (amber): current agent name, "Change →" link → dropdown of all agents
  - Audience (green): current audience name(s), "Change →" link → multi-select of audiences
  - Rules (gray): current rule set name, "Change →" link → dropdown of all rule sets
- Changing any element: triggers PUT /runs/:id/nodes/:nodeId, discards existing variants, auto-regenerates

**Variants tab:**
- Card per variant (A, B, C):
  - Variant label badge: "A", "B", "C"
  - Full text of the variant (scrollable if long)
  - Metadata row: hook type badge, consistency score (with color: green ≥75%, amber 60-75%, red <60%)
  - Rationale: expandable section explaining why this variant was generated this way
  - 3 action buttons:
    - "Accept" (green) → marks as accepted, advances to review
    - "Edit" (blue) → text becomes editable textarea, "Save" button appears, consistency re-scored on save
    - "Regen" (purple) → optional text input for context ("make it more casual"), generates new variant preserving old in history

**Rules tab:**
- Applied rule set name
- List of individual rules with type-coded dots (same as Rules page)
- Each rule shows: name, type badge, enforcement level, whether it was satisfied or violated for each variant

### New Run (from definition)

When user clicks "+ Start New Run":
- Source content input: large textarea + "Paste source content here"
- Pre-configured with definition's default platforms, voice, agent, audiences, rules
- "Start Run" button → creates run, opens DAG editor, begins execution

### New Workflow Definition

Form:
- Name, description
- Platform selection: checkboxes (LI, X, IG, TT, FB)
- Default voice: dropdown
- Default agent: dropdown
- Per-platform config inherits from agent's per_platform_config but can be overridden here
- "Create Workflow" button

---

## Page 4: Analytics

**Route:** `/analytics`

### Default View

**Headline Metrics Row (3 cards):**
- Engagement Index: "1.42x" with trend arrow and "vs. pre-Adapt baseline"
- Time to Final Draft: "4.2 min" with trend arrow and "across 5 platforms"
- Posts/Month: "127" with "3.1x vs. manual" subtitle

**Platform Breakdown Section:**
- 5 cards (1 per connected platform):
  - Platform icon + name
  - Best hook type with engagement multiplier
  - Optimal posting time
  - Key metric change (e.g., "+23% engagement since onboarding")

**Adaptation Engine Section:**
- Edit rate convergence: line chart showing edit rate % over time (target: decreasing)
- Current edit rate vs. month-1 edit rate
- Blind preference score: "AI preferred 62% of the time"
- Cross-brand insight highlight: "Question hooks underperform for B2B brands by 0.9x"

---

## Shared Components

### Color System
- Voice: `#818CF8` (indigo)
- Agent Persona: `#F59E0B` (amber)
- Audience Persona: `#22C55E` (green)
- Rule Set: `#9CA3AF` (gray)
- Platform rule: `#3B82F6` (blue dot)
- Learned rule: `#22C55E` (green dot)
- Custom rule: `#F59E0B` (amber dot)
- Compliance rule: `#EF4444` (red dot)

### Status Badges
- Connected: green background, white text
- Syncing: amber background, white text
- Not Connected: gray background, white text
- Active run: blue
- Done: green
- Failed: red
- Scheduled: purple
- Pending: gray

### Toast Notifications
- Success: green left border, appears top-right, auto-dismiss 3s
- Error: red left border, persists until dismissed
- Info: blue left border, auto-dismiss 5s

### Loading States
- Skeleton loaders for cards and tables
- Spinner for async operations (voice generation, variant generation)
- Progress bar for multi-step operations (onboarding import)

### Empty States
- Each section has an empty state with illustration and CTA
- Accounts: "Connect your first social account to get started" + button
- Voices: "Create your first brand voice" + button (or auto-created from onboarding)
- Workflows: "Create your first workflow" + button

---

## API Endpoints Summary

```
Accounts:
  GET    /v1/accounts
  POST   /v1/accounts
  DELETE /v1/accounts/:id
  GET    /v1/accounts/:id/posts
  GET    /v1/accounts/:id/inferences

Voices:
  GET    /v1/voices
  POST   /v1/voices
  GET    /v1/voices/:id
  PUT    /v1/voices/:id
  DELETE /v1/voices/:id
  POST   /v1/voices/:id/generate
  POST   /v1/voices/:id/create-post

Personas:
  GET    /v1/personas
  POST   /v1/personas
  GET    /v1/personas/:id
  PUT    /v1/personas/:id
  DELETE /v1/personas/:id
  POST   /v1/personas/auto-infer  (body: {accountId})

Rule Sets:
  GET    /v1/rule-sets
  POST   /v1/rule-sets
  GET    /v1/rule-sets/:id
  PUT    /v1/rule-sets/:id
  DELETE /v1/rule-sets/:id

Rules:
  GET    /v1/rules
  POST   /v1/rules
  PUT    /v1/rules/:id
  DELETE /v1/rules/:id

Insights:
  GET    /v1/insights/:type  (hooks, formats, timing, trending)

Workflows:
  GET    /v1/workflows
  POST   /v1/workflows
  GET    /v1/workflows/:id
  PUT    /v1/workflows/:id
  DELETE /v1/workflows/:id

Runs:
  GET    /v1/workflows/:id/runs
  POST   /v1/workflows/:id/runs
  GET    /v1/runs/:id
  PUT    /v1/runs/:id

Nodes:
  GET    /v1/runs/:id/nodes/:nodeId
  PUT    /v1/runs/:id/nodes/:nodeId

Variants:
  GET    /v1/runs/:id/nodes/:nodeId/variants
  POST   /v1/runs/:id/nodes/:nodeId/variants
  PUT    /v1/variants/:id

Review:
  GET    /v1/runs/:id/review
  PUT    /v1/runs/:id/review

Publish:
  POST   /v1/runs/:id/publish

Analytics:
  GET    /v1/analytics/summary

Trending:
  GET    /v1/trending
  GET    /v1/trending/:platform

Cross-Brand:
  GET    /v1/cross-brand
  GET    /v1/cross-brand/cohort
```

---

## WebSocket Events

Connection: `ws://api.adapt.ai/ws?token=...`

Events pushed to frontend:

```typescript
// DAG node status change
{ type: 'node_status', runId: string, nodeId: string, status: 'pending' | 'running' | 'done' | 'failed' }

// Variants generated for a node
{ type: 'variants_ready', runId: string, nodeId: string, variantCount: number }

// Review action received
{ type: 'review_update', runId: string, platform: string, action: 'approved' | 'rejected' }

// Publish complete
{ type: 'publish_complete', runId: string, platform: string, publishedAt: string }

// Account sync complete
{ type: 'account_synced', accountId: string, postCount: number }

// Voice generation complete
{ type: 'voice_generated', voiceId: string, consistency: number }
```
