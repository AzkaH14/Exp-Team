# Odoo Architecture & Integration Brief

**Audience:** an engineer or agent integrating an existing HubSpot-connected system with Odoo.
**Purpose:** explain what our Odoo instance actually contains, why its dates cannot be trusted, how to split reporting between the HubSpot export and Odoo, and how to query Odoo the way we already do it in production.

**Verified against the live instance on 20 August 2026.** Every number, field name and id below was read from Odoo directly, not taken from documentation. Re-verify before relying on it after a migration or a project rebuild.

---

## 0. Read this first — the five findings that break normal assumptions

| # | Finding | Consequence |
|---|---|---|
| 1 | **`create_date` is the import date, not the real date.** 4,995 of 5,431 tasks were created in a single batch on **8 July 2026**. | Any time-series built on `create_date` shows a meaningless spike and an empty year before it. |
| 2 | **Genuine Odoo usage began 8 August 2026**, not at migration. | Only ~340 tasks were actually raised by staff in Odoo. Everything older is imported history. |
| 3 | **`last_activity_date` secretly holds the real pre-migration timeline** (May 2025 → July 2026), but with 655 gaps and a misleading name. | It is the only surviving historical date — treat it as evidence, not as truth, until the business confirms its meaning. |
| 4 | **99% of tasks are in `Done`** (5,381 of 5,431). | Stage-based metrics are dominated by imported closed history, not live work. |
| 5 | **`helpdesk.ticket` also exists (279 records) and is *not* the ticket model.** Tickets are `project.task` in project **Field Service (id 2)**. | Querying the wrong model silently returns plausible but wrong numbers. |

---

## 1. The instance

| Property | Value |
|---|---|
| Odoo version | `19.0+e` (Enterprise, Odoo Online) |
| API surface | JSON-RPC at `POST {ODOO_URL}/jsonrpc` |
| Auth | database + integration user login + API key |
| Ticket model | `project.task` |
| Ticket scope | `project_id = 2` ("Field Service") |
| Access posture | **Read-only by convention** — see §5.9 |

Credentials live in environment variables and never in source or documentation:

```
ODOO_URL        instance host, no trailing slash
ODOO_DB         database name
ODOO_USERNAME   integration user login
ODOO_API_KEY    API key (Preferences → Account Security → New API Key)
```

> **Odoo Online note:** external API access requires the *Custom* plan. It is disabled on One App Free and Standard. This is a live dependency of any integration, not just a setup detail.

---

## 2. The data situation

This is the section that determines what you can and cannot calculate. Read it fully before designing any metric.

### 2.1 How the data got here

The Field Service project holds **5,431 tasks**, which arrived in three distinct waves:

| Wave | When | Volume | Created by | What it is |
|---|---|---|---|---|
| Pilot | May – early Jul 2026 | 95 | mixed | Early setup and testing |
| **Bulk migration** | **8 July 2026, 08:22** | **4,995** | `Tech Team` | The entire HubSpot history, imported in one transaction |
| Organic use | 8 Aug 2026 → present | 340 | `Rizwan Ahmad` (328) + `Tech Team` (12) | Real tickets raised by staff in Odoo |

`create_date` by month:

```
May 2026        6
June 2026      89
July 2026    4996   ← 4,995 of these share the timestamp 2026-07-08 08:22:13
August 2026   340
```

August, by day — note this is genuine one-at-a-time activity, confirmed because each task carries a *distinct* timestamp (50 tasks on 10 August had 50 different timestamps, whereas the July batch shares one):

```
Aug 08:  2      Aug 13: 36      Aug 18: 33
Aug 10: 50      Aug 14: 22      Aug 19: 41
Aug 11: 18      Aug 15: 52      Aug 20:  6
Aug 12: 22      Aug 16: 27
                Aug 17: 31
```

### 2.2 What each date field actually means

This is the trap. Three date fields look authoritative and are not:

| Field | Populated (migrated / organic) | What it actually holds |
|---|---|---|
| `create_date` | 5,091 / 340 | **Migrated: 8 Jul 2026 import timestamp.** Organic: real. |
| `date_end` | 5,091 / 297 | **Migrated: Aug 2026** — 5,034 share one value from a bulk stage move on 11 Aug. Organic: real. |
| `date_last_stage_update` | 5,091 / 340 | Same corruption as `date_end`. |
| `write_date` | 5,091 / 340 | Migrated: Aug 2026 bulk edit. Useless for history. |
| `date_deadline` | 0 / 0 | Never used. |
| `date_assign` | 3 / 214 | Only meaningful on organic tasks. |
| **`last_activity_date`** | **4,342 / 0** | **The real pre-migration timeline — see below.** |

### 2.3 The one field that preserved history

`last_activity_date` on the 8-July batch spreads across the genuine operating history:

```
May 2025    26     Nov 2025   102     May 2026   677
Jun 2025    53     Dec 2025    87     Jun 2026   723
Jul 2025    77     Jan 2026   515     Jul 2026    43
Aug 2025    67     Feb 2026   481     (missing)  655
Sep 2025    75     Mar 2026   616
Oct 2025   159     Apr 2026   639
```

Sample rows — all created in the same import second, yet carrying distinct, chronologically ordered historical dates:

```json
{ "id": 66030, "create_date": "2026-07-08 08:22:13", "last_activity_date": "2025-05-17 12:34:00" }
{ "id": 66029, "create_date": "2026-07-08 08:22:13", "last_activity_date": "2025-05-18 12:13:00" }
{ "id": 66027, "create_date": "2026-07-08 08:22:13", "last_activity_date": "2025-05-19 13:59:00" }
```

**Handle this carefully.** Odoo's own help text for the field reads *"Datetime when the last recurring activity was created"* — which is plainly not how it is being used. The migration repurposed a stored, writable datetime column to carry a HubSpot date across.

Three caveats before you build anything on it:

1. **The semantics are unconfirmed.** The name says *last activity*, not *created*. It may map to HubSpot's last-activity or last-modified timestamp rather than ticket creation. Confirm with whoever ran the migration.
2. **655 of the batch have no value** (~13%), so any series built on it under-counts.
3. **It is zero-populated on organic tasks**, so it cannot be used as a single unified date column across both eras.

**Recommendation:** do not use it as the primary date axis. Use the cutover strategy in §3 instead, which does not depend on it. Keep `last_activity_date` in reserve for reconciliation — for example, sanity-checking that the HubSpot sheet's monthly volumes match what the imported tasks imply.

### 2.4 Stage distribution

```
Done        5381      New          35
Cancelled      7      In Progress   4
                      Hold          4
```

99% Done, because the migration imported closed history. **Any "open tickets" metric describes only the ~43 live tasks**, and any "completion rate" computed across the whole table is meaningless — it is measuring the import, not the team.

---

## 3. The HubSpot → Odoo cutover

### 3.1 The rule

Because Odoo's imported history has no usable creation dates, historical reporting must come from the HubSpot export, not from Odoo:

| Period | Source of truth |
|---|---|
| 1 Nov 2025 → cutover date | **The HubSpot export sheet** |
| Cutover date → present | **Odoo**, `project.task` where `project_id = 2`, filtered on `create_date` |

Both halves must be unioned into one series for any metric that spans the boundary. Never compute a cross-boundary metric from Odoo alone.

### 3.2 The cutover date needs one decision — and there is a hazard

The intended cutover is **14 August 2026**. Volumes available from Odoo at each candidate boundary:

```
create_date >= 2026-08-01   →  340 tasks
create_date >= 2026-08-10   →  338 tasks
create_date >= 2026-08-14   →  212 tasks
```

> ⚠️ **Overlap hazard.** Staff began raising tickets in Odoo on **8 August**, but the HubSpot export runs to **14 August**. The window of **8–13 August (128 tasks)** may exist in *both* sources.
>
> - If the team double-entered during changeover → **those tickets will be counted twice.**
> - If they switched cleanly to Odoo on 8 August but the sheet still contains rows → same problem.
> - If the sheet genuinely holds nothing after 8 August → there is instead a **gap** if you cut at the 14th.

**This must be resolved before any number is published.** Concretely:

1. Filter the HubSpot sheet to rows dated 8–14 August and count them.
2. Pull the 128 Odoo tasks in the same window (query in §6.4).
3. Compare on customer + service + date.
4. Pick the boundary that produces neither duplicates nor a gap, and **hardcode it in exactly one place** in the codebase — a single `CUTOVER_DATE` constant that both loaders read.

### 3.3 Reconciliation checklist

- [ ] Confirm the sheet's last populated date and its timezone.
- [ ] Confirm whether 8–13 August appears in both sources.
- [ ] Agree one `CUTOVER_DATE` and use it as an exclusive boundary on one side (`< cutover` for the sheet, `>= cutover` for Odoo).
- [ ] Map HubSpot ticket categories onto Odoo's `service.category` names — they are **not** guaranteed to match, and unmapped values will silently vanish from grouped reports.
- [ ] Map HubSpot pipeline stages onto Odoo stage names (§4.4).
- [ ] Confirm what `last_activity_date` meant in the migration (§2.3).
- [ ] Decide how customers are keyed across both systems — Odoo uses `partner_id`; the sheet probably uses a name or email string.

---

## 4. Data model reference

### 4.1 `project.task` — the ticket

214 fields exist; these are the ones that matter.

| Field | Type | Notes |
|---|---|---|
| `name` | char | Ticket title. Convention: `Service (Detail) - Customer Name - CITY` |
| `project_id` | many2one | **Must be 2 (Field Service).** Other projects exist — see §4.5 |
| `stage_id` | many2one | The kanban column staff work. See §4.4 |
| `state` | selection | A *separate* required status axis — see below |
| `partner_id` | many2one → `res.partner` | The customer |
| `partner_city` | char | **Stored related field**, auto-filled from the partner. Fully populated — use it for city analysis |
| `category_id` | many2one → `service.category` | Ticket category (root level) |
| `subcategory_id` | many2one → `service.category` | Ticket sub category (child level) |
| `priority` | selection | A **string**: `"0"` normal, `"2"` high |
| `description` | html | Not plain text |
| `create_date` | datetime | **See §2.2 before using** |
| `last_activity_date` | datetime | **See §2.3 before using** |

**`state` vs `stage_id` — do not conflate them.** `stage_id` is the workflow column ops staff actually move tickets through, and is what every report should group on. `state` is a separate required field whose values merely look like statuses:

```
01_in_progress | 02_changes_requested | 03_approved | 1_done | 1_canceled | 04_waiting_normal
```

Every task currently in the `New` stage carries `state = "01_in_progress"`.

**Custom fields:** only four exist, none date-related, none holding a HubSpot id:
`x_studio_customer_name`, `x_studio_assignees`, `x_studio_many2one_field_4n5_1jv1mbgts`, `x_studio_char_field_3n0_1joirp400`.
**There is no field linking an Odoo task back to its HubSpot ticket id.** Reconciliation must be done on customer + service + date.

### 4.2 `service.category` — categories and sub categories

Categories and sub categories are **one self-referencing model**, not two:

- A **root category** has `parent_id = false`
- A **sub category** has its parent's id in `parent_id`
- `child_ids` lists a category's children; `level` gives depth

116 rows total: **32 roots, of which only 17 have children.** Data-quality issues to code around:

- **15 roots are dead ends** with no sub categories at all.
- **"Engagement Call" appears three times** as a root (ids 193, 276, 277); only 193 has children.
- **Odoo does not validate the pairing** between `category_id` and `subcategory_id`. A task can be saved with a sub category belonging to a different parent, and it will then be filed wrongly in every report with no error raised. Validate in application code.
- A sub category name can legitimately repeat under different parents, so **when aggregating by sub category, key on `parent:child`, never on the name alone**, or rows will silently merge.

Roots with children:

```
 11 Emergency Services (5)          17 Experience (6)
 12 Errand Services/Non-emergency (13)   18 Internal Information Request (3)
 13 Medical Errands (non-emergency) (8)  19 Offboarding (1)
 14 Domestic Services (11)          20 Onboarding (3)
 15 Travel Services (5)            174 Healthcare Services (6)
 16 Customer Complaints (6)        179 Psychologist Call (2)
183 Errand Services (8)            193 Engagement Call (2)
195 Financial Services (1)         198 Supervisory Services (3)
202 Complaints (1)
```

### 4.3 `res.partner` — customers and segmentation

Customers are contacts carrying the tag **`Benefactor`** (spelled with an "a") on `category_id`, which is a many2many to `res.partner.category`. A second tag holds their state:

| Tag | Meaning |
|---|---|
| `Active` | Live paying customer |
| `Paused` | Temporarily inactive |
| `Gratis` | Live, non-paying |
| `Churned` | Left — **exclude from any "live customers" denominator** |

There are **145 Benefactor contacts**. A customer must carry both the `Benefactor` tag and a state tag; contacts with only the former are not live customers and should be skipped.

`res.partner` has **no "customer since" field**, so customer-growth-over-time cannot be computed from Odoo. If the HubSpot sheet carries an onboarding date, that is the only source.

### 4.4 Field Service stage ids

```
16 New   ·  17 Planned  ·  18 In Progress  ·  33 Hold
34 Approval  ·  19 Done  ·  20 Cancelled
```

Conventions already in production, which a new integration should match:

- **`Approval` is excluded** from ticket-mix and category reporting — those tickets are awaiting close/QA, not open work.
- **`Cancelled` is excluded** from utilization calculations.

### 4.5 Models and scopes NOT to use

- **`helpdesk.ticket`** — a separate model with 279 records. It is *not* the ticket source. Confusing the two returns plausible but wrong numbers.
- **Other projects** — `Internal` (2 tasks), `Medical Team` (0), `Recurring Activities` (103). Always constrain `project_id = 2`.

---

## 5. How to query Odoo

This is how our existing production integration works. Replicate this pattern rather than inventing another.

### 5.1 It is not REST

There are no resource routes and no `GET` requests. **One URL, one HTTP method**: every operation is a `POST` to `{ODOO_URL}/jsonrpc` with a different JSON body. Reading tasks, grouping, counting — same endpoint, different payload.

### 5.2 Authenticate once

```json
{ "jsonrpc": "2.0", "method": "call", "params": {
    "service": "common", "method": "authenticate",
    "args": ["<db>", "<username>", "<api_key>", {}] }, "id": 1 }
```

Returns a bare integer `uid`, or `false` on bad credentials.

**The uid is not a session token.** Odoo issues no session and no expiry — the API key is re-sent on *every* subsequent call. Cache the uid in process memory keyed on `url|db|username`, and clear it only when a call fails with a session/access error.

### 5.3 Everything else goes through `execute_kw`

```json
{ "jsonrpc": "2.0", "method": "call", "params": {
    "service": "object", "method": "execute_kw",
    "args": ["<db>", <uid>, "<api_key>",
             "project.task", "search_read",
             [ <domain> ],
             { "fields": [...], "limit": 500, "order": "create_date desc" }] }, "id": 1 }
```

This maps one-to-one onto the documented Python API:

```python
models.execute_kw(db, uid, key, 'project.task', 'search_read', [domain], {'fields': [...]})
```

The positional array is the method's `*args`; the trailing object is its `**kwargs`. **Any** method on any model is reachable this way.

### 5.4 Domains

Odoo's filter language: an array of `[field, operator, value]` conditions, implicitly AND-ed, with optional `"&"` / `"|"` / `"!"` prefix operators. Dotted paths traverse relations inside a single query:

```json
[["project_id", "=", 2],
 ["stage_id.name", "not in", ["Approval"]],
 ["create_date", ">=", "2026-08-14 00:00:00"]]
```

Note the nesting when passed as an argument — the domain array is itself the first positional arg, producing `[ [ [...], [...] ] ]`. Getting a bracket level wrong is the most common first-attempt error.

### 5.5 Push aggregation into Odoo with `read_group`

**Do not fetch rows and count them in application code.** The ticket table is 5,400+ rows and growing. Use `read_group`, and pass `lazy: false`:

```json
"args": ["<db>", <uid>, "<key>", "project.task", "read_group",
         [ <domain>, ["id"], ["category_id", "subcategory_id"] ],
         { "lazy": false }]
```

**`lazy: false` is mandatory for multi-dimension grouping.** Without it Odoo groups by the *first* dimension only and expects follow-up calls — a browsing-UI optimisation that is exactly wrong for analytics. With it you get the full cross-tab in one round trip, each row carrying `__count`.

Date bucketing is built in — group on `create_date:month` or `create_date:day` to get monthly/daily series without pulling rows.

### 5.6 Response quirks — all three cause silent corruption

| Odoo returns | Trap | Fix |
|---|---|---|
| `[id, "Display Name"]` for many2one | It is a **tuple, not an object** | Read `[0]` / `[1]`; helpers `m2oId` / `m2oName` |
| `false` for *any* empty field | Not `null` — for strings, dates and relations alike | Normalise before use |
| `"2026-08-19 07:48:34"` | **Naive UTC, no zone marker.** JS parses it as *local* | Append `Z` before parsing |

The datetime one is the dangerous case: no error is raised, every timestamp is simply shifted by your offset.

### 5.7 Errors arrive with HTTP 200

**Odoo returns `200 OK` for application-level failures** — bad field, permission denied, Python traceback. `res.ok` tells you almost nothing. Check the body first:

```js
const body = await res.json();
if (body.error) {
    throw new Error(body.error?.data?.message || body.error?.message);
}
```

`body.error.data.message` is the readable line; `body.error.data.debug` carries the server traceback.

### 5.8 Caching

Odoo Online is not fast and rate-limits under load. Our production pattern, worth copying:

- **Module-level snapshot with a TTL** — serve the cached result until it ages out.
- **In-flight promise dedupe** — ten simultaneous requests trigger one Odoo call, not ten.
- **Explicit bypass** for a manual refresh button.
- **Never serve a stale snapshot on error** — surface the failure instead, or the dashboard lies quietly.

### 5.9 Read-only posture

Our current integration performs **only** `search_read`, `search_count`, `read_group` and `fields_get`. Nothing writes.

> ⚠️ **This is a code convention, not a permission boundary.** The integration user has full rights. Any new integration should be given its own Odoo user scoped to exactly what it needs, so the guarantee comes from the credential rather than from developer discipline.

---

## 6. Query cookbook

All of these go in the `args` array of an `execute_kw` call as described in §5.3.

### 6.1 All tickets in scope, excluding Approval

```json
["project.task", "search_read",
 [ [["project_id", "=", 2], ["stage_id.name", "not in", ["Approval"]]] ],
 { "fields": ["name", "stage_id", "partner_id", "partner_city",
              "category_id", "subcategory_id", "create_date"],
   "limit": 20000, "order": "create_date desc" }]
```

### 6.2 Category × sub category cross-tab, one round trip

```json
["project.task", "read_group",
 [ [["project_id", "=", 2], ["stage_id.name", "not in", ["Approval"]]],
   ["id"], ["category_id", "subcategory_id"] ],
 { "lazy": false }]
```

Each row returns `category_id`, `subcategory_id` and `__count`. Key results on `${categoryId}:${subId}` — sub category names repeat across parents.

### 6.3 Monthly volume series (post-cutover only)

```json
["project.task", "read_group",
 [ [["project_id", "=", 2], ["create_date", ">=", "2026-08-14 00:00:00"]],
   ["id"], ["create_date:month"] ],
 { "lazy": false }]
```

### 6.4 The overlap window, for reconciliation (§3.2)

```json
["project.task", "search_read",
 [ [["project_id", "=", 2],
    ["create_date", ">=", "2026-08-08 00:00:00"],
    ["create_date", "<",  "2026-08-15 00:00:00"]] ],
 { "fields": ["name", "partner_id", "category_id", "subcategory_id", "create_date"],
   "limit": 500, "order": "create_date asc" }]
```

### 6.5 Live customers by segment

```json
["res.partner", "search_read",
 [ [["category_id.name", "=", "Benefactor"],
    ["category_id.name", "in", ["Active", "Paused", "Gratis", "Churned"]]] ],
 { "fields": ["name", "city", "category_id"], "limit": 2000 }]
```

Resolve tag ids to names via `res.partner.category`, then assign each contact its state tag. Exclude `Churned` from live-customer denominators.

### 6.6 Category picker source

```json
["service.category", "search_read",
 [ [["parent_id", "=", false]] ],
 { "fields": ["name", "child_ids"], "order": "name" }]
```

Filter out rows with empty `child_ids` (§4.2).

---

## 7. Business rules already in production

If the new integration is meant to agree with existing reporting, it must apply the same rules.

**Ticket mix (category / sub category reporting)**
- Scope: `project_id = 2`
- Exclude stage `Approval`; every other stage counts

**Utilization (is a customer actually using the service?)**
- Exclude stage `Cancelled`
- Exclude these categories entirely — they are not customer-demand signals:
  `Logistics Planning Exercise`, `SNS`, `Complaints`, `Charge Back / Dispute`, `Onboarding`, `Customer Complaints`, `QA Complaints`, `Internal Information Request`
- Treat these as **outreach**, not demand — they represent us contacting the customer rather than the customer requesting service, and are toggled separately:
  `Engagement Call`, `Experience`
- Track only `Active` and `Gratis` customers

**Customer segmentation**
- Live book = `Active` + `Paused` + `Gratis`
- `Churned` is reported but excluded from the denominator, so segment shares stay comparable over time

---

## 8. Traps checklist

- [ ] Never build a time series on `create_date` across the migration boundary (§2.2)
- [ ] Never treat `date_end` / `date_last_stage_update` as historical (§2.2)
- [ ] Never trust `last_activity_date` without confirming its semantics (§2.3)
- [ ] Always constrain `project_id = 2` (§4.5)
- [ ] Never query `helpdesk.ticket` for tickets (§4.5)
- [ ] Always pass `lazy: false` to `read_group` for multi-dimension grouping (§5.5)
- [ ] Always check `body.error` — HTTP 200 does not mean success (§5.7)
- [ ] Always append `Z` to Odoo datetimes before parsing (§5.6)
- [ ] Always key sub category aggregates on `parent:child` (§4.2)
- [ ] Always validate `category_id` / `subcategory_id` pairing yourself (§4.2)
- [ ] Resolve the 8–13 August overlap before publishing any number (§3.2)

---

## 9. Reference implementation

A working read-only integration exists in the `coverage-app` repository. Reuse the patterns rather than rewriting them.

| File | What it demonstrates |
|---|---|
| `src/lib/odoo.ts` | The JSON-RPC client: auth, uid caching, `execute_kw`, domain typing, error extraction, many2one and datetime normalisation |
| `src/lib/odoo-ops.ts` | `read_group` cross-tabs, customer segmentation from partner tags, sub category keying |
| `src/lib/odoo-utilization.ts` | The category exclusion rules and the outreach toggle in §7 |
| `src/app/api/odoo/*/route.ts` | The snapshot cache + in-flight dedupe pattern from §5.8 |

---

## 10. Open questions for the business

These cannot be answered from the data and will block correct numbers until resolved.

1. **What does `last_activity_date` map to** in the HubSpot export — ticket creation, last activity, or last modification? (§2.3)
2. **Does the HubSpot sheet contain rows dated 8–14 August 2026?** This decides the cutover boundary and whether duplicates exist. (§3.2)
3. **Why do 655 migrated tasks have no `last_activity_date`?** Were they missing the source field, or did the import drop them?
4. **Do HubSpot ticket categories map cleanly onto `service.category` names,** and who owns that mapping table?
5. **Is there any customer onboarding date anywhere?** Odoo has none, so customer-growth-over-time is impossible without it. (§4.3)
