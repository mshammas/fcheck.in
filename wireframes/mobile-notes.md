# fcheck.in — Mobile Wireframe Reference

ASCII wireframes designed in the prior session. Use these as the specification for building the mobile HTML wireframes.

---

## Mobile Homepage — Search Mode (~390px)

```
┌─────────────────────────────────┐
│  ✓ fcheck.in              [ ≡ ] │  ← hamburger opens side drawer
├─────────────────────────────────┤
│  [ Search ]    [ Editorial ]    │  ← segmented control
├─────────────────────────────────┤
│                                 │
│         ✓ fcheck.in             │
│   Fact-check anything.          │
│   Instantly.                    │
│                                 │
│  ┌──[📎]──────────────────[→]─┐ │
│  │  Paste text, link or drop  │ │
│  │  a file…                   │ │
│  └────────────────────────────┘ │
│                                 │
│  [ Text ][ URL ][ Image][Video] │  ← scrollable tabs (auto-detected, not exclusive)
│                                 │
│  🌍 Country: All   🗣 Lang: All │  ← tap each to open bottom sheet
│                                 │
│  Powered by 47 fact-checkers    │
│                                 │
├─────────────────────────────────┤
│  Trending Now · 2h ago          │
│                                 │
│  ┌─────────┐ ┌─────────┐        │  ← horizontal scroll
│  │ [image] │ │ [image] │  ···   │
│  │ ● FALSE │ │ ●MISLED │        │
│  │ Claim   │ │ Claim   │        │
│  │ headlin │ │ headlin │        │
│  │ Reuters │ │ fcheck  │        │
│  │ 2h ago  │ │ 5h ago  │        │
│  └─────────┘ └─────────┘        │
│                                 │
│       [ View all reports ]      │
│                                 │
├─────────────────────────────────┤
│  🔍 Search  📰 Reports  ➕ Submit│  ← bottom nav
└─────────────────────────────────┘
```

**Filter bottom sheets (tap 🌍 or 🗣):**
```
┌─────────────────────────────────┐
│                         [ Done ]│
│  ▔▔▔▔▔▔▔  (drag handle)         │
│                                 │
│  Filter by Country              │
│  ┌─────────────────────────┐    │
│  │ 🔍 Search countries…    │    │
│  └─────────────────────────┘    │
│                                 │
│  ☑ All countries                │
│  ☐ India                        │
│  ☐ United Kingdom               │
│  ☐ United States                │
│  ☐ Pakistan                     │
│  ☐ Nigeria                      │
│  ···                            │
│                                 │
│         [ Apply filters ]       │
└─────────────────────────────────┘
```

---

## Mobile Homepage — Editorial Mode

```
┌─────────────────────────────────┐
│  ✓ fcheck.in              [ ≡ ] │
├─────────────────────────────────┤
│  [ Search ]    [ Editorial ]    │
├─────────────────────────────────┤
│                                 │
│  [ All ][ Politics ][ Health ]  │  ← horizontal scroll category pills
│  [ Science ][ Social ][ Tech ]  │
│                                 │
│  🌍 Country: All   🗣 Lang: All │
│                                 │
│  ┌─────────────────────────────┐ │
│  │       [FEATURED IMAGE]      │ │
│  │                             │ │
│  │  ● FALSE          Reuters   │ │
│  │                             │ │
│  │  "Viral claim about X has   │ │
│  │   been thoroughly debunked" │ │
│  │                             │ │
│  │  Short excerpt giving user  │ │
│  │  enough context to decide   │ │
│  │  whether to read more…      │ │
│  │                             │ │
│  │    [ Read full report → ]   │ │
│  └─────────────────────────────┘ │
│                                 │
│  Latest Reports                 │
│                                 │
│  ┌─────────────────────────────┐ │
│  │ [img]  ● MISLEADING         │ │
│  │        Headline here…       │ │
│  │        ✓ fcheck.in · 3h ago │ │
│  └─────────────────────────────┘ │
│                                 │
│  ┌─────────────────────────────┐ │
│  │ [img]  ● FALSE              │ │
│  │        Headline here…       │ │
│  │        AFP · Yesterday      │ │
│  └─────────────────────────────┘ │
│                                 │
│  ┌─────────────────────────────┐ │
│  │ [img]  ● FALSE              │ │
│  │        Headline here…       │ │
│  │        Boom Live · 2d ago   │ │
│  └─────────────────────────────┘ │
│                                 │
│       [ Load more reports ]     │
│                                 │
├─────────────────────────────────┤
│  🔍 Search  📰 Reports  ➕ Submit│
└─────────────────────────────────┘
```

---

## Mobile Search Results — TYPE 1

```
┌─────────────────────────────────┐
│  ✓ fcheck.in              [ ≡ ] │
├─────────────────────────────────┤
│  ┌──[📎]──────────────────[→]─┐ │  ← pre-filled, editable
│  │  Does warm water cure       │ │
│  │  viral infections?          │ │
│  └────────────────────────────┘ │
│  [ Text ][ URL ][ Image][Video] │
│  🌍 India ×        🗣 English × │
├─────────────────────────────────┤
│                                 │
│  ┌─────────────────────────────┐ │
│  │  ✓ fcheck.in  · Mar 2026   │ │
│  │                             │ │
│  │  ● FALSE                    │ │
│  │                             │ │
│  │  "Warm water does not cure  │ │
│  │   viral infections"         │ │
│  │                             │ │
│  │  Multiple virologists and   │ │
│  │  the WHO confirm there is   │ │
│  │  no scientific basis for    │ │
│  │  this claim.                │ │
│  │                             │ │
│  │  Sources: WHO · Lancet · CDC│ │
│  │                             │ │
│  │  [ Read full report → ]     │ │
│  │  [ 📤 Share TL;DR ]         │ │
│  └─────────────────────────────┘ │
│                                 │
│  Also reported by               │
│  ┌───────┐ ┌───────┐ ┌───────┐  │  ← horizontal scroll
│  │Boom   │ │AFP    │ │Full   │  │
│  │Live   │ │Fact   │ │Fact   │  │
│  │●FALSE │ │●FALSE │ │●FALSE │  │
│  │[View] │ │[View] │ │[View] │  │
│  └───────┘ └───────┘ └───────┘  │
│                                 │
│  Related fact-checks            │
│  ┌─────────────────────────────┐ │
│  │ [img]  ● FALSE              │ │
│  │        Related health claim │ │
│  │        Snopes · 3d ago      │ │
│  └─────────────────────────────┘ │
│  ┌─────────────────────────────┐ │
│  │ [img]  ● MISLEADING         │ │
│  │        Related health claim │ │
│  │        ✓ fcheck.in · 1w ago │ │
│  └─────────────────────────────┘ │
│                                 │
├─────────────────────────────────┤
│  🔍 Search  📰 Reports  ➕ Submit│
└─────────────────────────────────┘
```

**TYPE 2, 3, 4 differences (same structural changes as desktop):**
- TYPE 2: Source badge replaces fcheck.in badge, trust tier bar shown, "View original at Reuters" CTA
- TYPE 3: Amber top band, confidence bar, bullet findings, notify me input field
- TYPE 4: Muted blue band, no verdict, notify me input, related claims below

---

## Mobile Full Article Page

```
┌─────────────────────────────────┐
│  ✓ fcheck.in              [ ≡ ] │
├─────────────────────────────────┤
│  ← Back to results             │
├─────────────────────────────────┤
│                                 │
│  ✓ fcheck.in  ·  Mar 2026      │
│  Health · India · English       │
│                                 │
│  ● FALSE                        │
│                                 │
│  "Drinking warm water does      │
│   not cure viral infections"    │
│                                 │
├─────────────────────────────────┤
│  The Claim                      │
│                                 │
│  "Drinking warm water kills     │
│  viruses and cures infections   │
│  including COVID."              │
│                                 │
│  Circulating on WhatsApp via    │
│  voice notes since Feb 2026     │
│  across South Asia.             │
│                                 │
├─────────────────────────────────┤
│  Our Verdict               FALSE│
│                                 │
│  Warm water has no antiviral    │
│  properties. While it may       │
│  soothe a sore throat, it       │
│  cannot kill viruses or cure    │
│  infections. Confirmed by WHO,  │
│  CDC and multiple virologists.  │
│                                 │
├─────────────────────────────────┤
│  Evidence                       │
│                                 │
│  ┌─────────────────────────────┐ │
│  │ 1. WHO statement  Feb 2026  │ │
│  │ "No evidence warm water     │ │
│  │  prevents any viral…" [→]   │ │
│  └─────────────────────────────┘ │
│  ┌─────────────────────────────┐ │
│  │ 2. The Lancet  Jan 2026     │ │
│  │ Review of 14 studies found  │ │
│  │ no antiviral effect… [→]    │ │
│  └─────────────────────────────┘ │
│  ┌─────────────────────────────┐ │
│  │ 3. CDC Guidance  Ongoing    │ │
│  │ No recommendation for warm  │ │
│  │ water as treatment… [→]     │ │
│  └─────────────────────────────┘ │
│                                 │
├─────────────────────────────────┤
│  Where did this claim come from?│
│                                 │
│  Traced to a voice note on      │
│  WhatsApp attributed to "a      │
│  doctor." No such doctor has    │
│  been identified. Similar claim │
│  circulated in 2020.            │
│                                 │
├─────────────────────────────────┤
│  Also reported by               │
│                                 │
│  Boom Live · FALSE · Mar 2026   │
│                          [View] │
│  AFP Fact Check · FALSE · Feb   │
│                          [View] │
│  Full Fact · FALSE · Jan 2026   │
│                          [View] │
│                                 │
├─────────────────────────────────┤
│  Was this helpful?              │
│         [ 👍 Yes ]  [ 👎 No ]   │
│                                 │
├─────────────────────────────────┤
│  Related fact-checks            │
│  ┌─────────────────────────────┐ │
│  │ [img] ● FALSE               │ │
│  │ Related health claim        │ │
│  │ ✓ fcheck.in · 1w ago        │ │
│  └─────────────────────────────┘ │
│                                 │
├─────────────────────────────────┤
│  🔍 Search  📰 Reports  ➕ Submit│
└─────────────────────────────────┘

  ┌─────────────────────────────┐   ← sticky above bottom nav
  │  📤 Share TL;DR             │
  └─────────────────────────────┘
```

**Share TL;DR bottom sheet (tap Share):**
```
┌─────────────────────────────────┐
│                         [ Done ]│
│  ▔▔▔▔▔▔▔                        │
│                                 │
│  Share this report              │
│                                 │
│  ┌─────────────────────────────┐ │
│  │ FALSE: Warm water has no    │ │
│  │ antiviral properties. WHO   │ │
│  │ confirms no viral infection │ │
│  │ can be cured this way.      │ │
│  │ Full report: fcheck.in/a/   │ │
│  │ xyz123                      │ │
│  └─────────────────────────────┘ │
│  [ Regenerate ]                 │
│                                 │
│  [ 📱 WhatsApp  ]               │
│  [ 🐦 Twitter/X ]               │
│  [ 📘 Facebook  ]               │
│  [ 📋 Copy text ]               │
│  [ 📧 Email     ]               │
│                                 │
└─────────────────────────────────┘
```

---

## Mobile Submit a Claim Page

```
┌─────────────────────────────────┐
│  ✓ fcheck.in              [ ≡ ] │
├─────────────────────────────────┤
│  Submit a Claim                 │
│  Our team will review and       │
│  notify you when ready.         │
├─────────────────────────────────┤
│                                 │
│  STEP 1 — What to check?        │
│                                 │
│  [ Text ][ URL ][ Image][Video] │
│                [Mixed]          │
│                                 │
│  ┌─────────────────────────────┐ │
│  │                             │ │
│  │  Paste or type the claim,   │ │
│  │  link, or message here…     │ │
│  │                             │ │
│  └─────────────────────────────┘ │
│                                 │
│  ┌─────────────────────────────┐ │
│  │  📎 Attach file             │ │
│  └─────────────────────────────┘ │
│                                 │
├─────────────────────────────────┤
│  STEP 2 — Where did you         │  ← collapsible, starts collapsed
│  encounter this?  (optional) ▾  │
├─────────────────────────────────┤
│                                 │
│  ┌──────┐ ┌──────┐ ┌──────┐    │
│  │  WA  │ │  FB  │ │  X   │    │
│  └──────┘ └──────┘ └──────┘    │
│  ┌──────┐ ┌──────┐ ┌──────┐    │
│  │  TG  │ │  YT  │ │  TK  │    │
│  └──────┘ └──────┘ └──────┘    │
│  ┌──────┐ ┌──────┐ ┌──────┐    │
│  │Email │ │ SMS  │ │Other │    │
│  └──────┘ └──────┘ └──────┘    │
│                                 │
├─────────────────────────────────┤
│  STEP 3 — Source context        │  ← collapsible, starts collapsed
│  (optional)                  ▾  │
├─────────────────────────────────┤
│  🌍 Country: All         [ ▾ ]  │
│  🗣 Language: All         [ ▾ ] │
│                                 │
├─────────────────────────────────┤
│  STEP 4 — Get notified          │  ← collapsible, starts collapsed
│  (optional)                  ▾  │
├─────────────────────────────────┤
│  ○ Email                        │
│  ┌─────────────────────────────┐ │
│  │  your@email.com             │ │
│  └─────────────────────────────┘ │
│  ○ WhatsApp                     │
│  ○ No thanks                    │
│                                 │
├─────────────────────────────────┤
│  ┌─────────────────────────────┐ │
│  │   Check our database first  │ │
│  └─────────────────────────────┘ │
│              or                 │
│  ┌─────────────────────────────┐ │
│  │     Submit for review →     │ │
│  └─────────────────────────────┘ │
│                                 │
├─────────────────────────────────┤
│  🔍 Search  📰 Reports  ➕ Submit│
└─────────────────────────────────┘
```

---

## Mobile Admin Dashboard

```
┌─────────────────────────────────┐
│  ✓ fcheck.in ADMIN   Mohammed   │
├─────────────────────────────────┤
│  ┌───────┐┌───────┐┌───┐┌─────┐ │
│  │Drafts ││Trending││Clm││Rpts │ │  ← tab bar (replaces desktop sidebar)
│  │  7    ││  ⚠2!  ││   ││     │ │
│  └───────┘└───────┘└───┘└─────┘ │
├─────────────────────────────────┤
│                                 │
│  ⚠ Trending queue low (4 left)  │
│  ⚠ 2 cards expiring in <6h      │
│                                 │
│  ── Draft Queue (7) ─────────── │
│                                 │
│  ┌─────────────────────────────┐ │
│  │ ● 91% · 38 submissions      │ │
│  │ "Warm water cures viral…"   │ │
│  │ WhatsApp (31) · Web (7)     │ │
│  │              [Review →]     │ │
│  └─────────────────────────────┘ │
│                                 │
│  ┌─────────────────────────────┐ │
│  │ ● 88% · 24 submissions      │ │
│  │ "Fluoride for mind control" │ │
│  │ WhatsApp (19) · TG (5)      │ │
│  │              [Review →]     │ │
│  └─────────────────────────────┘ │
│                                 │
│  ┌─────────────────────────────┐ │
│  │ ○ 54% · 12 submissions      │ │
│  │ "Tax on WhatsApp messages"  │ │
│  │ WhatsApp (12)               │ │
│  │              [Review →]     │ │
│  └─────────────────────────────┘ │
│                                 │
│       [ Load more drafts ]      │
│                                 │
└─────────────────────────────────┘
```

**Mobile Draft Review (full screen):**
```
┌─────────────────────────────────┐
│  ← Drafts                       │
│                    [Reject][✓]  │
├─────────────────────────────────┤
│  AI Confidence: 91%             │
│  ████████████░░░░               │
│  Submissions: 38                │
│  Sources: WHO · CDC · Lancet    │
├─────────────────────────────────┤
│  Verdict  [ ● FALSE       ▾ ]  │
│                                 │
│  Headline                       │
│  ┌─────────────────────────────┐ │
│  │ Warm water does not cure    │ │
│  │ viral infections            │ │
│  └─────────────────────────────┘ │
│                                 │
│  Summary                        │
│  ┌─────────────────────────────┐ │
│  │ Warm water has no antiviral │ │
│  │ properties. WHO and CDC     │ │
│  │ confirm…                    │ │
│  └─────────────────────────────┘ │
│                                 │
│  Evidence  [ + Add ]            │
│  1. WHO statement       [ × ]   │
│  2. The Lancet          [ × ]   │
│  3. CDC guidance        [ × ]   │
│                                 │
│  Tags                           │
│  [ Health × ][ India × ][ + ]   │
│                                 │
├─────────────────────────────────┤
│  [ Reject ]       [ Publish → ] │
└─────────────────────────────────┘
```

**Mobile Trending Queue:**
```
┌─────────────────────────────────┐
│  ✓ fcheck.in ADMIN   Mohammed   │
├─────────────────────────────────┤
│  Drafts  Trending  Claims  Rpts │
├─────────────────────────────────┤
│                                 │
│  ── Live now ─────────────────  │
│                                 │
│  📌 "Warm water claim debunked" │
│  ● FALSE · ✓ fcheck.in          │
│  Pinned · No expiry  [ Unpin ]  │
│                                 │
│  📌 "5G tower claim debunked"   │
│  ● FALSE · Reuters              │
│  Pinned · No expiry  [ Unpin ]  │
│                                 │
│  ── Queue (4 remaining) ─────⚠  │
│                                 │
│  ↕ #1 "Fluoride claim"          │
│     ● FALSE · fcheck.in         │
│     Expires 31h  [Pin][ × ]     │
│                                 │
│  ↕ #2 "Tax on WhatsApp" ⚠       │
│     ● FALSE · AFP               │
│     Expires 5h   [Pin][ × ]     │
│                                 │
│  ↕ #3 "Election claim"  ⚠       │
│     ● MISLEADING · fcheck.in    │
│     Expires 3h   [Pin][ × ]     │
│                                 │
│  ↕ #4 "Health minister claim"   │
│     ● FALSE · Boom Live         │
│     Expires 44h  [Pin][ × ]     │
│                                 │
│  ── Candidates ───────────────  │
│                                 │
│  "Vaccine side effect claim"    │
│  ● FALSE · Snopes · 67 subs     │
│  [ Approve ]        [ Skip ]    │
│                                 │
│  "Petrol price claim"           │
│  ● MISLEADING · fcheck.in       │
│  43 subs  [ Approve ]  [ Skip ] │
│                                 │
│  [ Manually nominate → ]        │
│                                 │
└─────────────────────────────────┘
```

---

## Mobile Design Notes

**Bottom navigation** — three tabs for public users (Search, Reports, Submit). Admin sees a separate tab-based layout within the admin section, not the public bottom nav.

**Collapsible steps on Submit page** — Steps 2, 3, 4 start collapsed on mobile to keep the form from feeling overwhelming. Step 1 (the claim itself) is always open and in focus.

**Horizontal scroll** — Trending cards, "Also reported by" cards, and category pills all scroll horizontally. A visible card peek on the right edge signals scrollability.

**Share TL;DR** — sticky button above bottom nav on the article page ensures it's always one tap away regardless of scroll position. Opens as a bottom sheet rather than a new page.

**Admin on mobile** — tabs replace the desktop sidebar. Draft review goes full screen. Trending queue reordering uses the `↕` drag handle — same as desktop but optimised for thumb reach.

**Filters** — Country and Language open as bottom sheets (slide up), not dropdowns. Same data as desktop but touch-native interaction.

---

## Screens Summary

**Desktop HTML wireframes (complete):**
- `homepage.html` — Search mode + Editorial mode
- `results.html` — All four TYPE responses (switcher in header)
- `article.html` — Full article, TYPE 1 and TYPE 2, claim artifacts with variant tabs
- `admin.html` — Overview, Draft Queue, Draft Review, Trending Queue

**Mobile HTML wireframes (to build):**
- `mobile-homepage.html` — Search mode + Editorial mode + bottom nav + filter bottom sheets
- `mobile-results.html` — All four TYPE responses, compact header
- `mobile-article.html` — Full article, sticky Share TL;DR button, share bottom sheet
- `mobile-admin.html` — Tab-based nav, draft queue, full-screen draft review, trending queue
