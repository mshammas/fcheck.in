# Homepage & sharing

The public front door. Design ported from `wireframes/homepage.html` (+ the
mobile variants) into `src/pages/index.astro`.

**Status:** Search mode is built. Editorial mode currently renders a placeholder.
The Country/Language filter UI and the TL;DR share flow are on the
[roadmap](roadmap.md); the filter backend already works
([data-model.md](data-model.md)).

---

## Two modes — toggled by user, preference saved to localStorage

### Search mode (default) — built

- Hero search bar — a single input area that accepts any combination of content
  simultaneously; no "pick one type" restriction
- Input is treated as a single claim package regardless of how many content
  types it contains

**Input handling rules**
- Text typed or pasted into the bar is always accepted
- URLs embedded anywhere within pasted text are auto-extracted and processed
  alongside the surrounding text (`normalize()`)
- Attachment button (📎) opens a multi-file picker — images, videos, audio, and
  documents simultaneously *(files accepted and recorded; analysis is on the roadmap)*
- Drag-and-drop onto the search bar is supported
- Any combination is valid: text only, URL only, image only, or all together —
  processed as one claim package
- Detected content is shown as chips below the bar in real time ("📝 Text
  detected", "🔗 URL detected", "🎬 Video URL detected", "📎 2 files attached")
- Input type is never restricted by a mode selector — the system detects automatically

**Filters below the input area**
- **Country** — multi-select searchable dropdown; filters both fcheck.in DB and
  external fact-checker queries by country coverage; default: All
- **Language** — multi-select; filters language of the report returned (not the
  language of input); default: All; selecting a country auto-suggests common
  languages for that country but remains overridable
- The two filters are independent but offer smart suggestions when one is set
- Trust anchor below filters: "Checked by X trusted fact-checkers worldwide"
- Trending section below (see below)
- Toggle in top-right header: [Search] [Editorial] — active mode underlined

### Editorial mode — placeholder

Intended: featured article (large card with image) at top; right sidebar (sticky)
with Region / Category / Country / Language filters and a stats block; latest
reports grid (3 columns desktop), narrowed by the same filters. Currently a
placeholder panel in `index.astro`.

---

## Trending section — card queue model

Cards are pulled from the admin-managed queue described in [admin.md](admin.md).

**Card display**
- Each card shows: claim headline, verdict badge (color-coded), source badge
  (fcheck.in vs. external fact-checker name), date
- fcheck.in articles use a distinct color treatment from external source cards —
  attribution is always visible
- Clicking a card: fcheck.in original → full article at `/article/[slug]`;
  external → its TYPE 2 page at `/check/[claim_id]`, which attributes and
  summarises the external report with a link out

---

## TL;DR Share Feature *(planned — see [roadmap.md](roadmap.md))*

Every published report (TYPE 1 or TYPE 2) is to include a one-tap share flow:

- User selects target platform (WhatsApp, Twitter/X, Facebook, SMS, copy link)
- fcheck.in generates a platform-appropriate TL;DR — short enough for a reply,
  with a link to the full report
- The TL;DR is AI-generated but scoped strictly to the report content — no extrapolation
