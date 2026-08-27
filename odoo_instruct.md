# Odoo Wiring Instructions — Mohsyn Experience Team Board

**Hand this to the agent doing the work.** It is the build spec for replacing the board's live HubSpot sync with a two-source loader: a frozen HubSpot export for history, Odoo for everything from the cutover onward.

**Companion document:** [`odoo_arc.md`](./odoo_arc.md) explains *what Odoo contains and why its dates lie*. Read it first. This document says *what to build in this repo*. Where the two disagree, **this document wins** — §1 lists the corrections.

**All facts below were read from the live Odoo instance and the live sheet on 20 August 2026.** Re-verify with `scripts/audit-hubspot-filters.mjs` and the queries in §8 before trusting any number after a migration.

---

## 0. The mission in one paragraph

The board currently calls HubSpot live on first page load. HubSpot is dead as an operational system — the business moved to Odoo. Replace the single HubSpot loader with a **union of two immutable-then-live sources**, split at one date constant: everything before the cutover comes from a frozen Google Sheet export of HubSpot, everything on or after comes from Odoo `project.task`. The board's existing types, filters, metrics and UI must keep working unchanged — you are replacing the *data plumbing under* `Ticket[]`, not the board.

**Do not delete the HubSpot code path yet.** Keep it behind a flag until the Odoo path is verified against the acceptance tests in §9.

---

## 1. Corrections to `odoo_arc.md` — verify these before you trust that doc

`odoo_arc.md` is broadly accurate but wrong or incomplete in six places that will cost you a day each if you take them at face value.

| # | `odoo_arc.md` says | Actually verified on 20 Aug 2026 | Why it matters |
|---|---|---|---|
| 1 | `priority` is "a **string**: `"0"` normal, `"2"` high" | **Four values**: `0` Low, `1` Medium, `2` High, `3` Urgent. Live distribution over 220 organic tasks: `0`=91, `1`=107, `2`=21, `3`=1 | Mapping only `2` to urgent silently mislabels every Urgent ticket. See §5 |
| 2 | `partner_city` is a "**stored** related field" | `store=false`. **But it still works** in `read_group`, domain filters and `order` — verified all three. What fails is the dotted form `partner_id.city` → *"Property name 'city' has to be used on a property field"* | Use `partner_city` directly; never `partner_id.city` |
| 3 | Lists `x_studio_customer_name` as a custom field of interest | It is a **100% duplicate of `partner_id`** — 220/220 organic tasks identical | Ignore it. Use `partner_id` |
| 4 | Task counts: 5,431 tasks / 340 organic | **5,439 / 348** and rising daily | The doc is a snapshot. Never hardcode counts |
| 5 | Cutover "intended 14 August", overlap window "8–13 August" | The real switch is **15 August**. Aug 14 is still a parallel day (sheet 30, Odoo 22). See §3 | Cutting at the 14th drops 30 sheet rows in favour of 22 Odoo rows |
| 6 | Silent on `email_from` | **Empty on all 220 organic tasks.** Customer email must come from `partner_id` → `res.partner.email` | `Ticket.email` is null for every Odoo ticket unless you join partners |

Two more that `odoo_arc.md` does not mention at all:

- **Timezone split brain.** Odoo domain filters compare against **naive UTC** strings, but `read_group` date buckets (`create_date:day`, `:month`) are rendered in the **user's timezone** — and the integration user `Tech Team` has `tz = "Asia/Karachi"` (UTC+5). A domain and a bucket therefore disagree about which day a 19:00–23:59 UTC ticket belongs to. **Always aggregate in application code from raw `create_date`, or accept that buckets are PKT.**
- **City spelling.** Odoo has `Faislabad`; the sheet has `Faisalabad`. Normalize or the board shows two cities.

---

## 2. Architecture — what to build

**The split below is also the performance architecture — read §12 before writing any of it.** History is immutable and belongs at build time; only the small Odoo delta is live. Building a "fetch everything at runtime" loader first and optimising later means writing these files twice.

```
BUILD TIME (committed to the repo, never recomputed at runtime)
  Google Sheet ──► scripts/build-historical.mjs ──► historical-tickets-index.json   (~2.1 MB)
  gid 43693950     CSV → Ticket[] → freeze        ├─► historical-tickets-detail.json (~3.0 MB, lazy)
  7,630 rows                                      └─► historical-aggregates.json     (counts)

RUNTIME (per instance — small)
  Odoo JSON-RPC ──► odoo-sync.ts ──► ~202 Ticket[] ──┐   create_date >= CUTOVER
  project.task                                       │
                                                     ▼
                       historical-aggregates + live aggregates ──► merged AnalyticsData
                       historical index + live tickets ──► EXISTING FILTERS ──► board
                                                              (unchanged)
```

### Files to create

| File | Responsibility |
|---|---|
| `src/lib/cutover.ts` | **The single `CUTOVER_DATE` constant.** Nothing else may define a boundary date |
| `src/lib/integrations/odoo.ts` | JSON-RPC client: auth, uid cache, `execute_kw`, error extraction, many2one + datetime normalisation |
| `src/lib/integrations/odoo-sync.ts` | `fetchOdooTickets(): Promise<Ticket[]>` — domain, partner join, field mapping. **The only live fetch** |
| `scripts/build-historical.mjs` | One-shot: sheet CSV → the three frozen JSON files. A build/maintenance script, **not a runtime dependency** |
| `src/lib/historical.ts` | Reads the frozen files. Index eagerly, detail lazily (§12.4) |
| `src/lib/integrations/unified-sync.ts` | `syncAllTickets()` — frozen history + live Odoo delta, merged aggregates (§12.3) |

### Files to change

| File | Change |
|---|---|
| `src/lib/data-source.ts` | `warmSession()` calls `syncAllTickets()` instead of `syncHubSpotData()`. **Keep every existing filter call** — `filterExcludedTickets`, `filterCancelledTickets`, `normalizeTicketsByRegistry` |
| `src/app/api/sync/hubspot/route.ts` | Rename to `/api/sync/refresh` (keep the old path as an alias so the Sync button keeps working) |
| `.env.example` / `.env.local` | Add the vars in §7 |

### Do not touch

`src/lib/session-metrics.ts`, `src/lib/data-provider.ts`, `src/lib/tickets-query.ts`, `src/lib/client-registry/**`, and every component. **If you find yourself editing these, your mapping in §5 is wrong.** They consume `Ticket[]` and must not know where it came from.

`src/lib/analytics-build.ts` is the one exception: §12.3 adds a `mergeAggregates()` path alongside `buildAnalyticsFromTickets()`. **Add to it, do not rewrite it** — the existing function stays as the build-time path and the fallback.

---

## 3. The cutover — the mechanism you were asked for

### 3.1 What the data says

Sheet rows vs Odoo tasks, per day, August 2026 (both verified live):

```
date          SHEET    ODOO    verdict
2026-08-01       33       0    sheet only
 ... (Aug 1-7)  297       0    sheet only
2026-08-08       21       2    both
2026-08-09       34       0    sheet only
2026-08-10       46      50    both
2026-08-11       28      18    both
2026-08-12       34      22    both
2026-08-13       45      36    both
2026-08-14       31      22    both      <-- still parallel
2026-08-15        1      52    ODOO TAKES OVER
2026-08-16        0      27    odoo only
2026-08-17        3      31    odoo only (3 sheet stragglers)
2026-08-18+       0      88    odoo only
```

Window totals — sheet / Odoo: **Aug 1–7:** 297 / 0 · **Aug 8–13:** 208 / 128 · **Aug 14–17:** 35 / 132 · **Aug 18+:** 0 / 88

Aug 8–14 is a genuine **double-entry period** — ops ran both systems. Customer-level check across Aug 10–17: 79 distinct customers in the sheet, 85 in Odoo, **55 shared**. These are the same tickets entered twice.

### 3.2 The decision

```ts
// src/lib/cutover.ts
/**
 * HubSpot → Odoo boundary. Sheet supplies < CUTOVER, Odoo supplies >= CUTOVER.
 *
 * 15 Aug 2026 is where HubSpot actually stopped: sheet volume collapses
 * 31 → 1 on this day while Odoo jumps 22 → 52. Aug 8-14 is a double-entry
 * window served by the sheet, which is the more complete source there.
 *
 * Splits the 7,630-row sheet 7,626 / 4. Cost of this boundary: those 4
 * straggler rows (Aug 15: 1, Aug 17: 3) are dropped.
 * Verified 20 Aug 2026 — see odoo_instruct.md §3.
 */
export const CUTOVER_DATE = "2026-08-15";
export const CUTOVER_TZ = "Asia/Karachi";
```

Make it overridable with `MOHSYN_CUTOVER_DATE` so it can be re-tuned without a deploy, but **keep the default in code** and never read the env var anywhere except this file.

### 3.3 The boundary rule — exclusive on one side, always

```
sheet:  ticketDate <  CUTOVER   (Asia/Karachi)
odoo:   create_date >= CUTOVER  (converted to UTC for the domain)
```

`2026-08-15 00:00 PKT` = **`2026-08-14 19:00:00` UTC**. That is the literal string in the Odoo domain:

```json
[["project_id","=",2],["create_date",">=","2026-08-14 19:00:00"]]
```

**Compute this conversion once, in `cutover.ts`, and export it.** Hardcoding `2026-08-15 00:00:00` in the domain silently pulls in 5 hours of Odoo tickets that the sheet already covers.

### 3.4 Why this also solves the "all tasks are Done" problem

You do not need to filter on stage to exclude the imported history. Filtering `create_date >= CUTOVER` **automatically excludes**:

- the 4,995-task bulk import (all stamped `2026-07-08 08:22:13`)
- the 95 May–June pilot tasks
- the 150 double-entered tasks from Aug 8–14

Leaving exactly **202 genuine organic tasks** as of 20 Aug 2026, growing ~30/day. The 99%-Done distribution is an artifact of the import and disappears entirely once the date filter is applied. **Never use `stage_id` or `last_activity_date` to separate history from live work** — the date boundary is the only correct mechanism.

---

## 4. Source A — the historical sheet

**Spreadsheet:** `1wTr5c5dc0iWIhgrTfBg5ZPWXYdopwcEyWD2oSkC9yq4` — *"Tickets Data (Hubspot Nov1 - Aug 17)"*
**Tab:** `Tickets Data`, **gid `43693950`** — the full HubSpot export. This is the single source of pre-cutover truth.

```
https://docs.google.com/spreadsheets/d/<ID>/export?format=csv&gid=43693950
```

Verified 20 Aug 2026: HTTP 200, ~9.65 MB, **7,630 data rows**, **266 columns** (188 carry data), `Create date` spanning **2025-11-01 12:52 → 2026-08-17 22:48**.

7,630 sheet rows against 7,629 from the HubSpot API for the same window — a one-row difference explained by the Nov 1 boundary falling at PKT midnight in the export and UTC midnight in the API. **The tab is complete; treat it as immutable history and snapshot it into the repo (§4.4).**

> ⚠️ **An earlier 10-column tab at this same gid held only 7,282 rows.** If a fetch ever returns ~7,282 rows or 10 columns, you have stale content — re-fetch and confirm the column count is 266 before using it.

### 4.1 Traps in this tab

1. **`Ticket ID` appears twice** — column 0 and column 234, identical values. Index columns by *first* occurrence, or a naive header→index map silently reads column 234.
2. **No "associated contact first names" column.** The live HubSpot mapper falls back from `benefactor_name` to `hs_all_associated_contact_firstnames`; that column does not exist here. Of the **1,342 rows with a blank `Benefactor Name`**: 1,140 have `All associated contact emails`, 783 have `Benefactor Email`, and **201 have no customer identifier at all**. Derive the client from the email local-part where possible; the remaining 201 will be dropped by the blocklist anyway (it excludes empty names).
3. **`Priority` is populated on only 1,633 of 7,630 rows** and holds display labels, not HubSpot's raw enum: `Medium` 1,302 · `High` 285 · `Low` 38 · `Urgent` 8 · blank 5,997.
4. **`Create date` is PKT**, format `YYYY-MM-DD HH:mm`. Do not parse as UTC — see §6.

### 4.2 Column mapping

| Sheet column | → `Ticket` field | Notes |
|---|---|---|
| `Ticket ID` (col 0) | `id` | 7,630 · HubSpot numeric id as string |
| `Ticket name` | `name` | 7,630 |
| `Ticket description` | `description` | 7,534 · run through `stripEmptyHubSpotFormFields()` |
| `Ticket Category` | `categoryFull` | 7,560 · 70 blanks → `"Unspecified"` |
| `Ticket Sub Category` | `subCategory` | 7,518 · blank → `""` |
| `Create date` | `created`, `month` | 7,630 · PKT |
| `Close date` | `closed` | 7,626 · blank → `null` |
| `Benefactor Name` | `client` | 6,288 · via `formatHubSpotBenefactorLabel()`; fall back per trap 2 |
| `Benefactor Email` → `All associated contact emails` | `email` | 7,065 / 7,423 · first `;`-separated value; null unless it contains `@` |
| `Serving City` | `city` | 7,519 · 111 blanks → `"Other"` |
| `Priority` | `priority` | 1,633 · `High`\|`Urgent` → `"urgent"`, else `"normal"` |
| `Special Requests / Notes`, `Any Other Requirement/Notes` | `hubspotFieldNotes` | 30 / 63 · same >20-char rule as `mapHubSpotTicketToDashboard` |
| `Claimable Engagement Hours` | *(see §4.3)* | 6,888 parsed · 3,219 non-zero · 7,493.4 hours total |
| `Ticket status` | *(see below)* | 7,630 · `Closed` 7,245 · `Cancelled` 381 · `Pending- Experience` 4 |

**`Ticket status` is a capability the old loader never had.** 381 historical tickets are `Cancelled`. Decide explicitly whether they count — the board already drops *cancelled clients* via `filterCancelledTickets`, but has never dropped *cancelled tickets*. Changing this shifts every historical KPI, so **default to keeping them** and raise it with the business rather than quietly filtering.

Everything else in the 266 columns is HubSpot pipeline telemetry (`Date entered "Pending- Karachi (Support Pipeline)"` and 100-odd similar). Ignore it — but note `Doctor Name` (173), `Type of Session` (9) and `Session Frequency` (9) survive if the clinical views ever need them.

### 4.3 `Claimable Engagement Hours` — decide before building

The sheet carries this on 6,888 rows (3,219 non-zero, 7,493.4 hours total). The board's `Ticket` type has no field for it. Odoo's nearest analogue is `effective_hours`, populated on only **90 of 220** organic tasks (`allocated_hours` is `0` on all of them).

Either add `claimableHours?: number` to `Ticket` and accept ~41% coverage on the Odoo side, or drop the column. **Do not silently default missing hours to 0** — that understates Odoo-era totals against a well-populated historical series and will look like a service collapse at the cutover. Ask the business (§10).

### 4.4 Operational rule — re-freeze after a registry sync

The frozen aggregate bakes in the registry that was current when it was built.
**A sacred-sheet sync rewrites `src/data/client-registry.json`**, which changes
`getRegistryVersion()` and makes the aggregate stale. Observed live: pressing
Sync moved the registry from `3:2026-08-12:143` to `3:2026-08-24:145`.

The staleness check in `unified-sync.ts` catches this and recomputes from the
frozen index — correct, but it costs ~7.8s instead of ~1.9s per instance.

**After any registry change, run `npm run build:historical` and commit the three
regenerated files.** The console warns loudly when the slow path is in use.

### 4.5 Freeze it

This tab is finished history — it will never gain a row. Fetching 9.65 MB of CSV on every cold start to parse 7,630 rows is waste, and it makes the board's history hostage to a Google Sheet's sharing settings.

**Run the sheet→`Ticket[]` mapping once, commit the result as `src/data/historical-tickets.json`, and import it directly.** Keep the CSV loader as a documented regeneration script (`scripts/rebuild-historical.mjs`), not a runtime dependency. This also retires the stale `src/data/tickets.json`, which is a mid-July snapshot of *unfiltered* HubSpot data and should be deleted once the new file lands.

---

## 5. Source B — Odoo

### 5.1 Scope

```json
[["project_id","=",2],["create_date",">=","<CUTOVER_UTC>"]]
```

`project_id = 2` is **Field Service** — verified: `2:Field Service | 1:Internal | 3:Medical Team | 4:Recurring Activities`. Never query `helpdesk.ticket` (279 rows, not the ticket model).

Do **not** exclude stages here. `odoo_arc.md` §4.4 says production excludes `Approval` from ticket-mix reporting and `Cancelled` from utilization — those are *reporting* rules that belong in the metric layer, not the loader. The loader returns everything; the board already has `filterCancelledTickets`.

### 5.2 Field mapping — Odoo `project.task` → `Ticket`

| `Ticket` field | Odoo source | Transform |
|---|---|---|
| `id` | `id` | **`` `odoo-${id}` ``** — prefix is mandatory, Odoo ids (71843) and HubSpot ids (33778612547) share a namespace otherwise |
| `ticketNumber` | `id` | `` `MOH-${String(id).slice(-5)}` `` — matches the existing HubSpot convention |
| `client` | `partner_id[1]` | Display name. Already clean — do **not** run `formatHubSpotBenefactorLabel()` |
| `email` | `res.partner.email` | **Requires a second query** — see §5.3. `email_from` on the task is empty |
| `city` | `partner_city` | Normalize `Faislabad` → `Faisalabad`. Falsy → `"Other"` |
| `category` | `category_id[1]` | First token: `catFull.split(/[\s/]/)[0]` — mirror `mapHubSpotTicketToDashboard` exactly |
| `categoryFull` | `category_id[1]` | `false` → `"Unspecified"` |
| `subCategory` | `subcategory_id[1]` | `false` → `""` |
| `name` | `name` | Convention: `Service (Detail) - Customer - CITY` |
| `description` | `description` | **HTML** — strip tags *and* the `data-last-history-steps` attribute noise |
| `created` | `create_date` | Append `Z`, then format — §6 |
| `closed` | `date_end` | Set on 174/220. Falsy → `null` |
| `month` | `create_date` | §6 |
| `priority` | `priority` | `"2"`\|`"3"` → `"urgent"`; `"0"`\|`"1"` → `"normal"` |
| `insightNotes` | `mail.message` | Optional — §5.4 |

### 5.3 The partner join (mandatory for `email`)

`search_read` returns `partner_id` as `[id, "Display Name"]` — no email. Batch it:

```ts
const partnerIds = [...new Set(tasks.map(t => m2oId(t.partner_id)).filter(Boolean))];
const partners = await kw("res.partner", "search_read",
  [[["id", "in", partnerIds]]], { fields: ["name", "email", "city"], limit: 2000 });
const emailById = new Map(partners.map(p => [p.id, p.email || null]));
```

**One query, not one per ticket.** Verified: 88 distinct partners across 220 organic tasks, **88/88 have an email**.

### 5.4 Insight notes (optional, defer to phase 2)

`mail.message` where `model = "project.task"` and `res_id in [...]` carries per-task discussion. **Most of it is system noise** — sampling 198 tasks returned 400 messages across only 70 tasks, dominated by:

```
"You have been assigned to a new task: ..."
"Your task '...' has been moved to stage: Done"
"Sent an attachment"
```

If you wire this, filter `message_type in ["comment","email"]`, drop `author_id` = the automation user, strip HTML, and discard bodies under ~20 chars — the same shape as the existing `rankClinicalNotes` logic in `hubspot-ticket-notes-sync.ts`. **Ship the board without notes first.**

### 5.5 Client registry linkage — an upgrade worth taking

The board matches tickets to the sacred registry by **fuzzy name** (`matchRegistryRecord`), which currently drops 110 tickets across 24 names. Odoo gives you a **stable `partner_id`**, and `res.partner` already carries the segmentation the registry duplicates:

- Tag `Benefactor` (id **7**) — **145 partners**, matching the sacred registry's 145
- State tags, exactly one per partner, none missing: **Active 122 · Churned 13 · Paused 8 · Gratis 2**
- Full tag list: `1:Active · 2:Gratis · 3:Paused · 4:Churned · 5:FSO · 6:Internal Employee · 7:Benefactor · 8:Beneficiary`

Odoo's 13 `Churned` vs the registry's 6 `cancelled` **do not agree** — reconcile before trusting either as the live-book denominator.

**Recommendation:** add optional `partnerId?: number` to `Ticket`, populate it on the Odoo side, and prefer it over name matching when present. Keep name matching as the fallback for historical rows. Do this *after* the board is working.

---

## 6. Date formatting — get this exactly right or every chart breaks

`analytics-build.ts` groups by the **`month` string**, and `tickets-query.ts` sorts on `created`. Both sources must produce byte-identical formats to the existing HubSpot mapper, or the cutover shows up as a fake gap in every time series.

```ts
// created — must equal formatDisplayDate() in hubspot-sync.ts
new Date(iso).toLocaleDateString("en-GB",
  { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Karachi" })
// -> "01 Nov 2025"

// month — must equal formatMonth()
new Date(iso).toLocaleDateString("en-GB",
  { month: "short", year: "numeric", timeZone: "Asia/Karachi" })
// -> "Nov 2025"
```

Feeding each source correctly:

- **Odoo** returns `"2026-08-19 07:48:34"` — naive UTC, no zone marker. **Append `"Z"` before `new Date()`** or JS parses it as local time and shifts every ticket by your machine's offset.
- **Sheet** returns `"2026-08-17 22:48"` — already **PKT**. Parse as `Asia/Karachi`, *not* as UTC. Getting this wrong moves late-evening tickets to the next day and misfiles the ones on the cutover boundary.

**Extract the two formatters into a shared module** that all three mappers import. Do not copy-paste them.

---

## 7. Environment

```bash
# Odoo (verified working 20 Aug 2026 — uid 2, user "Tech Team", tz Asia/Karachi)
ODOO_URL=https://mohsyn.odoo.com
ODOO_DB=prodoerp-mohsyn-prod-26872800
ODOO_USERNAME=Admin Account
ODOO_API_KEY=<key>

# Historical HubSpot export
HISTORICAL_SHEET_ID=1wTr5c5dc0iWIhgrTfBg5ZPWXYdopwcEyWD2oSkC9yq4
HISTORICAL_SHEET_GID=43693950

# Optional override; default lives in src/lib/cutover.ts
# MOHSYN_CUTOVER_DATE=2026-08-15
```

`ODOO_USERNAME` really is `Admin Account` — a login with a space, not a typo.

> ⚠️ **This key is a full-rights admin account.** `odoo_arc.md` §5.9 calls the read-only posture "a code convention, not a permission boundary" — that is still true and still a real risk. Before this ships, have someone create a dedicated Odoo user with read access to `project.task`, `res.partner`, `res.partner.category`, `service.category` and `mail.message`, and swap the key. Until then, **the loader must only ever call `search_read`, `search_count`, `read_group` and `fields_get`.** No writes, ever.
>
> **Odoo Online requires the *Custom* plan for external API access.** A downgrade silently kills the board.

---

## 8. Query cookbook

### 8.1 Auth

```json
{"jsonrpc":"2.0","method":"call","params":{
  "service":"common","method":"authenticate",
  "args":["<db>","Admin Account","<key>",{}]},"id":1}
```

Returns bare integer uid (**2** on this instance) or `false`. **Not a session token** — the key is re-sent on every call. Cache the uid in module memory keyed `url|db|username`; clear only on an access error.

### 8.2 The board's main fetch

```json
["project.task","search_read",
 [[["project_id","=",2],["create_date",">=","2026-08-14 19:00:00"]]],
 {"fields":["name","create_date","date_end","stage_id","priority","partner_id",
            "partner_city","category_id","subcategory_id","description","effective_hours"],
  "limit":20000,"order":"create_date desc"}]
```

### 8.3 Partner join

```json
["res.partner","search_read",[[["id","in",[/* ids */]]]],
 {"fields":["name","email","city","category_id"],"limit":2000}]
```

### 8.4 Live customer book

```json
["res.partner","search_read",[[["category_id","in",[7]]]],
 {"fields":["name","city","email","category_id"],"limit":500}]
```

Returns **145**. Resolve tag ids against `res.partner.category`; exclude `Churned` (4) from live denominators.

### 8.5 Response quirks — all three corrupt silently

| Odoo returns | Trap | Fix |
|---|---|---|
| `[id, "Display Name"]` | Tuple, not object | `m2oId = v => Array.isArray(v) ? v[0] : null` / `m2oName` |
| `false` for **any** empty field | Not `null` — strings, dates, relations alike | Normalize at the edge |
| `"2026-08-19 07:48:34"` | Naive UTC | Append `Z` |
| **HTTP 200 on error** | `res.ok` means nothing | Check `body.error` first — message at `body.error.data.message`, traceback at `.debug` |

### 8.6 Caching

Copy the existing pattern in `data-source.ts` — module-level snapshot + TTL, in-flight promise dedupe, explicit bypass for the Sync button. **Never serve a stale snapshot after a failed refresh**; surface the error instead. Odoo Online is slow and rate-limits.

Fetch both sources **in parallel** (`Promise.all`) — the sheet is a 1.3 MB static CSV and should never wait on Odoo.

---

## 9. Acceptance tests

Run these before declaring done. Numbers are live as of 20 Aug 2026; Odoo-side counts grow ~30/day, so treat them as floors.

| # | Check | Expected |
|---|---|---|
| 1 | Sheet loader row count | **7,630** (266 columns; a result near 7,282 or 10 columns means stale tab content) |
| 2 | Sheet loader date range | `2025-11-01` → `2026-08-17` |
| 2b | Sheet rows on the historical side of the cutover | **7,626** (4 stragglers dropped) |
| 3 | Odoo loader count, `create_date >= 2026-08-14 19:00 UTC` | **≥ 202** (verified exactly 202; `>= 2026-08-15 00:00` would give 198 — the 4-ticket difference is the PKT/UTC gap, and getting 198 means you skipped the conversion in §3.3) |
| 4 | Odoo loader returns **zero** of the 4,995 tasks dated `2026-07-08` | proves the import batch is excluded |
| 5 | Unified count before filters | **≥ 7,828** (7,626 sheet + 202 Odoo) |
| 6 | Unified count after existing filters | **~7,150** — blocklist ≈ −543, registry ≈ −110 |
| 6b | `description` non-null on historical tickets | ~7,534 of 7,630 |
| 6c | Historical tickets with `priority = "urgent"` | **293** (`High` 285 + `Urgent` 8) |
| 7 | `month` values form an unbroken series | `Nov 2025 … Aug 2026`, no gap or duplicate at the boundary |
| 8 | No ticket id collisions | every Odoo id starts `odoo-` |
| 9 | Aug 2026 total | sheet contributes Aug 1–14 only; Odoo contributes Aug 15+ |
| 10 | `email` non-null on Odoo tickets | ~100% (88/88 partners carry an email) |
| 11 | Urgent tickets exist post-cutover | ~22 of 220 (`priority` `2` or `3`) |
| 12 | Cities normalized | no `Faislabad`; `Faisalabad` only |
| 13 | Board loads with Odoo unreachable | sheet-only degradation, visible error, **no silent stale data** |

Re-run `npx tsx scripts/audit-hubspot-filters.mjs` to confirm filter attrition has not moved.

---

## 10. Blocking questions — get answers before going live

1. **Should the 381 historical `Cancelled` tickets count?** The board has never filtered cancelled *tickets* (only cancelled *clients*). Including them keeps continuity with every published historical number; excluding them changes each one. Default is to include. *(§4.2)*
2. **Is `Claimable Engagement Hours` a board requirement?** The sheet has it on 6,888 rows (7,493.4 hours); Odoo's `effective_hours` covers only 90/220 tasks. Accept the coverage drop, or does ops need to start filling it? *(§4.3)*
3. **Odoo says 13 `Churned` benefactors; the sacred registry says 6 `cancelled`.** Which is authoritative, and should the registry now be *derived* from Odoo tags rather than maintained in a sheet? *(§5.5)*
4. **Do the 4 straggler sheet rows (Aug 15 ×1, Aug 17 ×3) matter?** The recommended cutover drops them. *(§3.2)*
5. **What identifies the 201 rows with no benefactor name, no benefactor email, and no associated contact email?** They cannot be attributed to a client and will be dropped. *(§4.1)*
6. **Who owns the category mapping?** The sheet has 17 categories, Odoo has 32 roots. Sheet-only: `QA Complaints` (40 tickets), `Engagement Visit` (6). Odoo also has **`Engagement Call` duplicated three times** (ids 193, 276, 277 — only 193 has children) and both `Errand Services` (183) and `Errand Services/Non-emergency services` (12). Unmapped values vanish from grouped reports silently. *(§11)*
7. **Historical priority is only 21% populated** (1,633 of 7,630). Every other pre-cutover ticket becomes `normal`, so urgent-ticket trends across the boundary are not comparable. Acceptable? *(§4.1)*

**Resolved since the first draft:** the 348-row gap. The 10-column tab that held 7,282 rows has been replaced by the full 266-column export at the same gid, which carries all 7,630 rows and matches the HubSpot API to within one boundary row.
---

## 11. Category reconciliation

Sheet categories (17, with volumes from the 7,630-row tab) against Odoo roots (32). Same-name pairs map cleanly:

```
Errand Services/Non-emergency services  3530  -> 12
Medical Errands (non-emergency)         1314  -> 13
Healthcare Services                      860  -> 174
Psychologist Call                        503  -> 179
Domestic Services                        309  -> 14
Experience                               282  -> 17
Onboarding                               233  -> 20
Engagement Call                          134  -> 193   (NOT 276/277)
Travel Services                          124  -> 15
Emergency Services                        75  -> 11
Internal Information Request              50  -> 18
Complaints                                49  -> 202
QA Complaints                             40  -> ???   (unmapped)
Customer Complaints                       28  -> 16
Offboarding                               23  -> 19
Engagement Visit                           6  -> ???   (unmapped)
(blank)                                   70  -> "Unspecified"
```

**Unmapped — decide explicitly:**

- `QA Complaints` (40) — no Odoo root. Fold into `Complaints` (202)?
- `Engagement Visit` (6) — no Odoo root. Fold into `Engagement Call` (193)? Or `City Owner Visit` (251)?

**Odoo roots with no sheet equivalent** — these will appear as brand-new categories the moment ops uses them: `City Owner Visit`, `Driver Arrangment` *(sic)*, `Equipment Repairing and Replacement`, `Finance- Internal Information`, `Financial Services`, `Funeral Arrangment`, `Gift / Flower Delivery Assistance`, `Health Emergency`, `Hospitalization Support`, `log`, `Market Information & Inquiry- In Person`, `Market Information & Inquiry- Online`, `Non finance- Internal Information`, `Post-emergency monitoring`, `Supervisory Services`.

Only 10 roots are actually used by organic tasks so far: `Errand Services/Non-emergency services` 111, `Medical Errands` 45, `Experience` 25, `Healthcare Services` 20, `Domestic Services` 10, `Engagement Call` 3, `Travel Services` 2, `Offboarding` 2, `Internal Information Request` 1, `Onboarding` 1.

**Put the mapping in one exported table**, not scattered conditionals, and log unmapped values loudly rather than dropping them.

Sub-category note from `odoo_arc.md` §4.2 that still holds: Odoo **does not validate** that `subcategory_id` belongs to `category_id`, and sub-category names repeat across parents. **Key aggregates on `` `${categoryId}:${subId}` ``, never on the name.**

---

## 12. Performance — the Vercel free-tier budget

**Read this before writing §2's loaders, not after.** The naive Odoo wiring — "fetch everything on first page load, cache in module memory" — is exactly what the board does today with HubSpot, and it is the reason the free tier is at risk. Building it that way and optimising later means rewriting the loaders. The split below costs nothing extra to build correctly the first time.

### 12.1 Measured baseline

Per **cold serverless instance**, on the current 5.33 MB / 6,347-row snapshot, measured on a fast local machine (`npx tsx scripts/bench-compute.mjs`):

```
JSON.parse                 55ms
module import             270ms
filterExcludedTickets      77ms
buildAnalyticsFromTickets 119ms   (incl. 500-iteration Monte Carlo)
--------------------------------
TOTAL cold compute        522ms
```

Vercel's Hobby vCPU is slower than a dev laptop — budget **1–2s of pure CPU per cold instance**, before React server-rendering. And the real dataset is bigger: 7,630 rows with 7,534 descriptions, so expect ~6.5 MB and proportionally more.

Observed in the running dev server: first page load **80s** (56s compile + sync), subsequent **1.2s**; `/engagement-calendar` **66s**, `/celebrations-calendar` **61s**. Under concurrent requests during a warm-up the server **stopped responding entirely** — one wedged instance is the free-tier failure mode.

### 12.2 The two lines that make every page dynamic

```ts
// src/app/layout.tsx:12
export const dynamic = "force-dynamic";     // ← applies to EVERY page in the app
```

```ts
// next.config.ts:8-15
headers: [{ key: "Cache-Control", value: "no-store, must-revalidate" }]
source: "/:path*"                            // ← matches /_next/static/* too
```

Together these mean **every navigation is a serverless invocation with zero CDN caching**. The header pattern `/:path*` also matches hashed immutable assets under `/_next/static/`, overriding Next's own `max-age=31536000, immutable` — so tab switches re-download JS chunks that should be cached forever. **Verify this against a production build** (`npx next build && npx next start`, then check `Cache-Control` on a `/_next/static/*.js` response) before and after changing it — it is the single cheapest win available and it directly explains sluggish tab movement.

Target state:

| Route type | Rendering |
|---|---|
| Dashboard, clients, tickets, engagement, health, alerts | **ISR** — `export const revalidate = 900` |
| Engagement / celebrations calendar (live sheet writes) | keep `force-dynamic` |
| API read routes | `Cache-Control: s-maxage=300, stale-while-revalidate=3600` |
| `/_next/static/*` | Next's default immutable caching — **stop overriding it** |

Scope the `no-store` header to `source: "/api/:path*"` only.

### 12.3 The precompute split — the core change

The pre-cutover 7,626 tickets are **immutable**. Recomputing analytics over them on every cold instance is pure waste, and it is ~97% of the row volume.

```
BUILD TIME (committed, never recomputed at runtime)
  sheet CSV ──► historical-tickets-index.json    list + analytics fields
            └─► historical-tickets-detail.json   descriptions + notes
            └─► historical-aggregates.json       monthly / city / category / per-client counts

RUNTIME (per instance, small)
  Odoo ──► 202 tickets today, ~30/day  ──► aggregate over ~200 rows
                                          └─► merge with historical-aggregates
```

Most of `AnalyticsData` is **additive counts** — `monthly`, `cities`, `categories`, `clients[].tickets`, `topSubServices`, `cityMonth`. Merging two count maps over ~270 clients is microseconds. Only the derived layers need recomputing from the merged totals, and they are cheap once the counts exist: `pareto`, `forecast`, `monteCarlo`, and QoL in `rebuildSessionMetrics`.

**Net effect:** the per-instance scan drops from 7,800 rows to ~200. Expect the 522ms to fall well under 50ms.

> ⚠️ **The Monte Carlo runs 500 iterations** (`analytics-build.ts:164`) on every rebuild. It is derived from the monthly series only, so once aggregates are merged it is cheap — but it is also **non-deterministic**, which makes ISR output flicker between revalidations. Seed it, or precompute it in the cron and treat it as a stored value.

### 12.4 Split the payload — `description` is 56% of it

Measured across the current snapshot:

```
description         2.97 MB   55.8%   <-- needed only on ticket detail / family reports
name                0.31 MB    5.9%
categoryFull        0.19 MB    3.6%
everything else     1.86 MB   34.7%
```

Splitting `description`, `hubspotFieldNotes` and `insightNotes` into a lazily-loaded detail file leaves a **2.11 MB index** against a 5.33 MB monolith — a ~60% cut in parse cost on every cold start, for no loss of function. The detail file is read only by `/api/reports/family` and ticket-detail views.

This also settles the existing `MOHSYN_MERGE_TICKET_NOTES` flag: with a split file the merge is never needed on the hot path.

### 12.5 Tab-switch latency

The board's slowness between tabs is not data — the session cache already serves those in ~1.2s locally. It is:

1. Every navigation server-rendering because of `force-dynamic` in the layout (§12.2)
2. JS chunks re-downloading because of the blanket `no-store` (§12.2)
3. Cold instances redoing the 522ms compute (§12.3)

Fix those three and tab movement becomes a client-side transition. Additionally: confirm navigation uses `next/link` (prefetches the target route) rather than `<a>` or `router.push` on click, and that shared shell chrome lives in `layout.tsx` so it is not re-rendered per tab.

### 12.6 Two Vercel-specific bugs in the current code

1. **`syncHubSpotData()` writes to `src/data/tickets.json` and `analytics.json`** (`hubspot-sync.ts:283-284`). Vercel's filesystem is read-only outside `/tmp`, so on Vercel this throws and is swallowed by the surrounding `try/catch` — **the sync silently never persists**. The Odoo loader must not inherit this pattern. Write to `/tmp` or, better, hold the snapshot in module memory only.
2. **`/api/cron/hubspot-sync` already exists** and Vercel Cron hits it daily. Repoint it at Odoo. With the §12.3 split, the cron's job is small: refresh the ~200-row live delta and the merged aggregate snapshot.

### 12.7 Performance acceptance targets — VERIFIED 24 Aug 2026

| # | Metric | Target | Result |
|---|---|---|---|
| P1 | Cold per-instance compute (`bench-compute.mjs` equivalent) | **< 50ms** (from 522ms) | **18.3ms** — measured, `npm run bench` |
| P2 | Historical index file parsed at runtime | **< 2.5 MB** | 2.84 MB index (accepted — description split into a separate 1.78 MB lazy file, so the hot-path read is the 2.84 MB index + 0.10 MB aggregate, not the full 4.6 MB) |
| P3 | `Cache-Control` on `/_next/static/*.js` in a production build | `max-age=31536000, immutable` | **`public, max-age=31536000, immutable`** — confirmed via `curl -sD -` against a `next build && next start` |
| P4 | Pages using `force-dynamic` | **2** (the two calendars) — not all 14 | **2** — `celebrations-calendar`, `engagement-calendar`. Every other page is `○ Static` with `revalidate: 15m` in the build output |
| P5 | Tab switch, warm | **< 300ms**, client-side transition, no full document request | ISR pages respond in **18–80ms** server-side (curl, cold cache); client-side `next/link` transitions are faster still since JS chunks are now `immutable`-cached |
| P6 | Odoo calls per page load | **0** — cron and the Sync button only | Confirmed — pages read `store.cache` / the frozen fallback only; `warmSession({force:true})` (the only path that calls Odoo) runs exclusively from `/api/sync/hubspot`, `/api/cron/hubspot-sync`, `/api/sync/ticket-notes` |
| P7 | Board renders with Odoo unreachable | historical data + visible error, never silent staleness | Confirmed in Phase 1 — `syncAllTickets()` catches the Odoo fetch failure, serves history alone, and returns `degraded: true` / `odooError` in the sync meta |

**One addition beyond the original plan.** ISR caches each page for up to 15 minutes, which would have made the Sync button feel broken (previous UX: click Sync → data updates immediately). Fixed by calling `revalidatePath("/", "layout")` from every route that calls `warmSession({force: true})` or otherwise mutates the session cache (`/api/sync/hubspot`, `/api/cron/hubspot-sync`, `/api/sync/registry`, `/api/sync/birthdays`, `/api/sync/notes`, `/api/sync/ticket-notes`) — gated on success so a failed sync doesn't blow away a good cache. Verified live: dashboard KPI read **7,066 → synced → 7,402**, visible on the very next request despite the page being `○ Static`.

Re-run `npm run bench` after any change to the aggregate pipeline to confirm P1 holds.

---

## 13. Build order

**Phase 1 — correctness (the board runs on Odoo)**

1. `cutover.ts` — constant + UTC conversion + unit test on the boundary
2. `scripts/build-historical.mjs` — sheet → the three frozen files (§4.4, §12.3); assert acceptance tests 1, 2, 2b, 6b, 6c
3. `historical.ts` — reads the frozen index; detail stays lazy
4. `odoo.ts` — client; assert auth returns uid 2
5. `odoo-sync.ts` — tasks → `Ticket[]`; assert tests 3–4, 10–12
6. `unified-sync.ts` — frozen history + live delta; assert tests 5–9
7. Swap `data-source.ts` behind `MOHSYN_DATA_SOURCE=unified|hubspot`; verify the board renders identically for the historical period
8. Delete the HubSpot live path once test 13 passes

**Do not start step 7 until steps 1–6 have passing assertions.** The board's metric layer is dense and will happily compute plausible-looking nonsense from a subtly wrong `Ticket[]`.

**Phase 2 — cost and speed (§12) — DONE, verified 24 Aug 2026**

9. ~~Remove `force-dynamic` from `layout.tsx`; set `revalidate` per route~~ — done. `layout.tsx`'s blanket `force-dynamic` was the actual cause of all 14 pages showing `ƒ Dynamic` — a layout's dynamic export propagates to every route beneath it. Removed it; added `export const revalidate = 900` to `page.tsx`, `client-profiles`, `family-reports`, `tickets`, `clients`, `clients/[slug]`, `alerts`, `settings`, `fso`. Left `force-dynamic` only on `celebrations-calendar` and `engagement-calendar` (live sheet writes) — P4 confirmed.
10. ~~Scope the `no-store` header to `/api/:path*`~~ — done in `next.config.ts`. Confirmed via production build that `/_next/static/*.js` now serves `immutable` — P3.
11. ~~`mergeAggregates()`; seed the Monte Carlo~~ — done in Phase 1 as part of `analytics-aggregate.ts` (not deferred to Phase 2 as originally planned) — P1 confirmed at 18.3ms.
12. ~~Repoint the cron at Odoo; remove runtime `writeFileSync`~~ — the cron needed no code change: it already calls `warmSession({force:true})`, which routes through `syncAllTickets()` (Odoo) by default since Phase 1. The `writeFileSync` calls live only in the now-inactive `syncHubSpotData()` fallback path (`MOHSYN_DATA_SOURCE=hubspot`) — left in place per the "don't delete the HubSpot path yet" rule in §0, since it's unreachable by default and already wrapped in try/catch.
13. ~~Measure tab-switch latency~~ — ISR pages respond in 18–80ms server-rendered; the `immutable` fix on `/_next/static/*` is what actually fixes felt tab-switch speed, since it stops re-downloading JS chunks on every navigation — P5.

**Correctness fix required by ISR, not in the original plan:** `revalidatePath("/", "layout")` added to every route that force-syncs (`sync/hubspot`, `cron/hubspot-sync`, `sync/registry`, `sync/birthdays`, `sync/notes`, `sync/ticket-notes`), gated on success. Without it, ISR's 15-minute cache would have made the Sync button appear to do nothing for up to 15 minutes. Verified live — see §12.7.

**Phase 3 — only after both phases are green**

14. Partner-id registry linkage (§5.5) and Odoo insight notes (§5.4)

Phase 2 items 9 and 10 are two-line changes with the largest single effect on free-tier cost. If the free tier is under pressure before Phase 1 completes, they can be pulled forward safely — they are independent of the data source.
