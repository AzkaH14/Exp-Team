# Graph Report - experience-team-  (2026-09-29)

## Corpus Check
- Large corpus: 218 files · ~762,763 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder.

## Summary
- 1724 nodes · 4873 edges · 88 communities (82 shown, 6 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 36 edges (avg confidence: 0.84)
- Token cost: 117,421 input · 0 output

## Community Hubs (Navigation)
- Celebrations Calendar Store
- Odoo Sync & Cutover Checks
- Google Sheets Calendar Sync
- Parity Check & Queue Intelligence
- HubSpot Owner Discovery Scripts
- Dashboard Pages & Charts
- Engagement Assessment PDF
- Data Source & Cancel Filters
- Client QoL Views
- Historical Analytics Aggregation
- HubSpot Ticket Creation
- Engagement Calendar API
- Python HubSpot Discovery Scripts
- Engagement Calendar UI
- Family Monthly Report Types
- Calendar Clients & Cities
- HubSpot Birthdays Sync
- NPM Scripts
- Client Profile & Sidebar UI
- Celebrations Calendar UI
- Medical & Physio Tickets
- Registry Reconcile & Discovery
- Tables & Registry Hub UI
- Risk Assessment Birthday Import
- HubSpot Notes Sync
- Engagement Client Meta
- Client Name Matching
- Ticket Insight Notes Script
- Internal Profile PDF Import
- Benchmark & Blocklist Scripts
- Family Profile Audit API
- Sacred Registry Sheet Sync
- HubSpot Description Parsing
- Underutilising Sheet Cross-check
- Family Report Cache API
- HubSpot Activity Fetch
- HubSpot Sync & Analytics Build
- Ticket Notes Sync
- Mohsyn Sheet Parser
- Live Tickets & Report HTML Cache
- TypeScript Config
- Next.js App Shell
- Dashboard Home & Settings Pages
- Engagement Suggestions & Segmentation
- Clinical Note Summarization
- Package Manifest
- Engagement Calendar Suggestions
- Client Registry Audit Types
- QoL Scoring Engine
- HubSpot Filter Audit
- Care Team & Health Enrichment
- Buttons & Error Boundaries
- HubSpot Birthdays Python Sync
- Client Profile Merge
- HubSpot Ticket Sync Script
- Historical Sheet Build
- Registry One-off Sync
- Ticket Insight Notes API
- Report Period Utilities
- Dev Dependencies
- Clinical Intelligence Analysis
- Vercel Function Config
- Runtime Dependencies
- Unified Timeline Check
- Risk Assessment Data
- Analytics Data Types
- Clinical Owner Resolution
- Family Health Assessment Report
- Dashboard Caching Architecture
- Engagement Doctors
- Family Report HTML Renderer
- Odoo Date Traps & Cutover
- Aggregate Split Check
- Registry Supplement
- HubSpot Notes Store
- Odoo Data Model
- Client Registry Builder
- Odoo JSON-RPC Integration
- Odoo Loader Contract
- Engagement Learning Store
- Ticket-Client Matching
- Timezone & Cutover Date
- ESLint Config
- PostCSS Config
- Tailwind Config
- HubSpot Contacts Client
- WhatsApp Template Sender

## God Nodes (most connected - your core abstractions)
1. `server-only` - 58 edges
2. `getSacredRegistry()` - 54 edges
3. `matchRegistryRecord()` - 42 edges
4. `warmSession()` - 41 edges
5. `Card` - 34 edges
6. `CardContent` - 34 edges
7. `Ticket` - 31 edges
8. `Badge()` - 29 edges
9. `scripts` - 28 edges
10. `next` - 28 edges

## Surprising Connections (you probably didn't know these)
- `Family Status (Active 106 / Paused 7 / Gratis 2 / Cancelled 1)` --semantically_similar_to--> `res.partner Benefactor Segmentation Tags`  [INFERRED] [semantically similar]
  output/Client-Family-Relationship-Health-Assessment.pdf → odoo_arc.md
- `Client Family Relationship Health Assessment` --conceptually_related_to--> `Mohsyn Dashboard`  [INFERRED]
  output/Client-Family-Relationship-Health-Assessment.pdf → README.md
- `Client Family Relationship Health Assessment` --references--> `HubSpot Live Sync`  [INFERRED]
  output/Client-Family-Relationship-Health-Assessment.pdf → README.md
- `Blocking Business Questions` --references--> `Sacred Client Registry`  [INFERRED]
  odoo_instruct.md → output/Client-Family-Relationship-Health-Assessment.pdf
- `Benefactor / Beneficiary Family Model` --conceptually_related_to--> `res.partner Benefactor Segmentation Tags`  [INFERRED]
  output/Client-Family-Relationship-Health-Assessment.pdf → odoo_arc.md

## Import Cycles
- 3-file cycle: `src/lib/analytics-data.ts -> src/lib/data-source.ts -> src/lib/client-registry/reconcile.ts -> src/lib/analytics-data.ts`

## Hyperedges (group relationships)
- **Unified HubSpot-history + Odoo-live Loader** — odoo_instruct_cutover_date, scripts_build_historical, odoo_instruct_frozen_historical_files, src_lib_historical, odoo_instruct_odoo_ts_client, odoo_instruct_fetch_odoo_tickets, odoo_instruct_sync_all_tickets, odoo_instruct_merge_aggregates [EXTRACTED 1.00]
- **Odoo Date Field Traps** — odoo_arc_create_date_import_artifact, odoo_arc_last_activity_date, odoo_arc_bulk_migration, odoo_instruct_timezone_split_brain, odoo_arc_response_quirks [INFERRED 0.85]
- **Dashboard Session Cache Pipeline** — readme_data_source_ts, src_lib_session_metrics, src_lib_data_provider, readme_api_sync_hubspot, src_lib_integrations_hubspot_sync [EXTRACTED 1.00]

## Communities (88 total, 6 thin omitted)

### Community 0 - "Celebrations Calendar Store"
Cohesion: 0.07
Nodes (76): DELETE(), dynamic, GET(), KINDS, PATCH(), POST(), RECURRENCES, STATUSES (+68 more)

### Community 1 - "Odoo Sync & Cutover Checks"
Cohesion: 0.06
Nodes (56): cities, html, importDay, months, root, t0, urgent, withEmail (+48 more)

### Community 2 - "Google Sheets Calendar Sync"
Cohesion: 0.09
Nodes (47): ref_crypto, api(), base64url(), COLUMNS, getToken(), loadEnvLocal(), loadServiceAccount(), main() (+39 more)

### Community 3 - "Parity Check & Queue Intelligence"
Cohesion: 0.06
Nodes (44): ref_node_crypto, ref_node_fs, ref_node_path, base, basePath, CALENDAR_CITIES, capture(), CELEBRATION_MONTHS (+36 more)

### Community 4 - "HubSpot Owner Discovery Scripts"
Cohesion: 0.07
Nodes (33): ref_fs, ref_path, headers, ROOT, token, ROOT, token, headers (+25 more)

### Community 5 - "Dashboard Pages & Charts"
Cohesion: 0.17
Nodes (33): AlertsPage(), revalidate, FSO_KEYWORDS, FsoPage(), isFsoSubService(), revalidate, SettingsPage(), CITY_COLORS (+25 more)

### Community 6 - "Engagement Assessment PDF"
Cohesion: 0.07
Nodes (33): analytics, assessments, buildRow(), byMohsyn, byYou, CITY_COLORS, CITY_ORDER, cityGroup() (+25 more)

### Community 7 - "Data Source & Cancel Filters"
Cohesion: 0.15
Nodes (33): filterCancelledAnalyticsClients(), filterCancelledTickets(), invalidateCancelledFilterCaches(), filterAnalyticsData(), filterExcludedTickets(), invalidateReconcileCache(), getRegistryVersion(), getDashboardLiveSnapshot() (+25 more)

### Community 8 - "Client QoL Views"
Cohesion: 0.11
Nodes (24): recharts, dynamic, GET(), ClientsPage(), revalidate, ClientsQoLTableProps, CITIES, ClientsQoLView() (+16 more)

### Community 9 - "Historical Analytics Aggregation"
Cohesion: 0.13
Nodes (30): src_data_historical_aggregates, src_data_historical_tickets_detail, src_data_historical_tickets_index, accumulate(), addCounts(), ClientAggregate, emptyAggregate(), finalizeAggregate() (+22 more)

### Community 10 - "HubSpot Ticket Creation"
Cohesion: 0.16
Nodes (33): engagementCoordinatorLabel(), appendHubSpotTicketNote(), archiveHubSpotEngagementTicket(), assignTicketClinicalOwner(), BenefactorContactMatch, benefactorEmailCandidates(), benefactorNameCandidates(), buildHubSpotTicketContent() (+25 more)

### Community 11 - "Engagement Calendar API"
Cohesion: 0.12
Nodes (30): DELETE(), dynamic, GET(), normalizeCity(), PATCH(), POST(), VALID_CITIES, VALID_STATUS (+22 more)

### Community 12 - "Python HubSpot Discovery Scripts"
Cohesion: 0.10
Nodes (25): base64, datetime, json, os, pathlib, re, api(), load_env_local() (+17 more)

### Community 13 - "Engagement Calendar UI"
Cohesion: 0.09
Nodes (25): addDays(), CITIES, CityFilter, EngagementCalendar(), EngagementCalendarProps, EVENT_TYPES, formatDayLabel(), formatRange() (+17 more)

### Community 14 - "Family Monthly Report Types"
Cohesion: 0.10
Nodes (26): FamilyReportsHubProps, buildSections(), categorizeTicket(), ERRAND_CATEGORIES, EXPERIENCE_CATEGORIES, groupBySubcategory(), MONTH_ABBREV, ticketToRow() (+18 more)

### Community 15 - "Calendar Clients & Cities"
Cohesion: 0.14
Nodes (26): CALENDAR_CITY_SET, CALENDAR_ELIGIBLE_STATUSES, calendarRowCity(), engagementCitiesFor(), isCalendarEligibleClient(), mapSatelliteToEngagementCity(), resolveScheduleCity(), toEngagementCity() (+18 more)

### Community 16 - "HubSpot Birthdays Sync"
Cohesion: 0.16
Nodes (24): server-only, dynamic, maxDuration, POST(), BIRTHDAYS_PATH, ensureLoadedFromDisk(), getHubSpotBirthdayMap(), getHubSpotBirthdaysMeta() (+16 more)

### Community 17 - "NPM Scripts"
Cohesion: 0.07
Nodes (28): scripts, bench, build, build:historical, check:aggregate, check:all, check:cutover, check:odoo (+20 more)

### Community 18 - "Client Profile & Sidebar UI"
Cohesion: 0.14
Nodes (19): lucide-react, ClientProfilePage(), ClientProfilePageProps, revalidate, AppSidebar(), AppSidebarProps, navItems, HubSpotSyncButton() (+11 more)

### Community 19 - "Celebrations Calendar UI"
Cohesion: 0.13
Nodes (24): blankForm(), CelebrationsCalendar(), openAdd(), refreshCurrent(), remove(), save(), CITIES, CITY_STYLES (+16 more)

### Community 20 - "Medical & Physio Tickets"
Cohesion: 0.17
Nodes (22): buildFamilyMonthlyReport(), buildFamilyReport(), emptySectionCounts(), buildMedicalSessionNotes(), buildPhysiotherapySessionNotes(), isConciergeTicket(), isMedicalTicket(), isPhysiotherapyTicket() (+14 more)

### Community 21 - "Registry Reconcile & Discovery"
Cohesion: 0.22
Nodes (20): dynamic, GET(), ClientProfilesPage(), revalidate, discoverHubSpotBenefactors(), isExcludedHubSpotContact(), getHubSpotNotesMeta(), isMohsynDuplicateLabel() (+12 more)

### Community 22 - "Tables & Registry Hub UI"
Cohesion: 0.26
Nodes (19): react, ClientRegistryHub(), EDITORS, bandVariant, ClientsQoLTable(), ATTENTION_VARIANT, QUALITY_VARIANT, TicketsTable() (+11 more)

### Community 23 - "Risk Assessment Birthday Import"
Cohesion: 0.18
Nodes (23): benefactor_from_filename(), collapse_text(), compact(), extract_text_docx(), extract_text_pdf(), is_excluded(), is_invalid_date(), main() (+15 more)

### Community 24 - "HubSpot Notes Sync"
Cohesion: 0.18
Nodes (20): dynamic, GET(), maxDuration, POST(), setHubSpotNotesCache(), refreshHubSpotNotesFromHubSpot(), beneficiaryNamesForFamily(), buildFamilyNoteRecords() (+12 more)

### Community 25 - "Engagement Client Meta"
Cohesion: 0.19
Nodes (19): EngagementHubProps, SEGMENTS, matchRegistryRecord(), engagementCityMatches(), EngagementClientMeta, engagementTeamCitiesFor(), normalizeEngagementCity(), registryCityToEngagement() (+11 more)

### Community 26 - "Client Name Matching"
Cohesion: 0.23
Nodes (20): addNameKeys(), getCancelledClientKeys(), isCancelledHubSpotClient(), buildRegistryCanonicalMap(), canonicalizeHubSpotClientNameFast(), compactRegistryName(), expandBeneficiaryNameVariants(), formatHubSpotBenefactorLabel() (+12 more)

### Community 27 - "Ticket Insight Notes Script"
Cohesion: 0.18
Nodes (21): argparse, html, api(), assoc_ids(), chunk(), compose_call(), compose_email(), compose_meeting() (+13 more)

### Community 28 - "Internal Profile PDF Import"
Cohesion: 0.20
Nodes (20): pypdf, collapse(), compact(), detect_flags(), extract_clients_from_pdf(), extract_hobbies_interests(), extract_name_from_page(), is_client_start() (+12 more)

### Community 29 - "Benchmark & Blocklist Scripts"
Cohesion: 0.10
Nodes (15): ref_url, root, all, root, analytics, raw, registry, root (+7 more)

### Community 30 - "Family Profile Audit API"
Cohesion: 0.15
Nodes (17): dynamic, GET(), maxDuration, dynamic, GET(), PATCH(), RouteParams, dynamic (+9 more)

### Community 31 - "Sacred Registry Sheet Sync"
Cohesion: 0.19
Nodes (20): dynamic, GET(), maxDuration, POST(), filterSacredRegistryClients(), slugFromBenefactor(), mohsynClientsToRegistry(), fetchRecentHubSpotBenefactors() (+12 more)

### Community 32 - "HubSpot Description Parsing"
Cohesion: 0.20
Nodes (21): countInlineKnownLabels(), countInlineLabels(), escapeRegex(), extractClinicalNarrative(), findFormFields(), findGenericFormFields(), FormFieldMatch, GenericFieldSpan (+13 more)

### Community 33 - "Underutilising Sheet Cross-check"
Cohesion: 0.17
Nodes (20): GET(), buildUnderutilisingCrossCheck(), cell(), colIndex(), combineName(), getUnderutilisingSheetBenefactors(), getUnderutilisingSheetMeta(), is28DayNonUtilizer() (+12 more)

### Community 34 - "Family Report Cache API"
Cohesion: 0.17
Nodes (18): dynamic, GET(), getOrBuildReport(), PUT(), resolvePeriodFromRequest(), FamilyReportsPage(), revalidate, listFamiliesForReports() (+10 more)

### Community 35 - "HubSpot Activity Fetch"
Cohesion: 0.19
Nodes (19): addActivity(), chunk(), CRM_ACTIVITY_READERS, extractLegacyEngagementText(), fetchAssociatedObjectIds(), fetchCrmActivitiesForTickets(), fetchCrmObjectBodies(), fetchLegacyActivitiesForTickets() (+11 more)

### Community 36 - "HubSpot Sync & Analytics Build"
Cohesion: 0.15
Nodes (17): Vercel Read-Only FS Silent Sync Bug, buildAnalyticsFromTickets(), parseSyncSinceMs(), syncPeriodLabel(), previewBenefactorFromHubSpotRow(), ANALYTICS_JSON_PATH, CATEGORY_COLUMNS, fetchAllHubSpotTickets() (+9 more)

### Community 37 - "Ticket Notes Sync"
Cohesion: 0.18
Nodes (16): dynamic, maxDuration, POST(), syncHubSpotData(), attachInsightNotesToTickets(), getToken(), isHubSpotTicketNotesConfigured(), OUT_PATH (+8 more)

### Community 38 - "Mohsyn Sheet Parser"
Cohesion: 0.19
Nodes (19): beneficiaryColIndex(), cleanName(), colIndex(), findHeaderRow(), hasValidSno(), isBlockedSheetBenefactor(), isNewBenefactorRow(), isSkipRow() (+11 more)

### Community 39 - "Live Tickets & Report HTML Cache"
Cohesion: 0.18
Nodes (16): getLiveTickets(), cache, CacheEntry, cacheKey(), getCachedReportHtml(), setCachedReportHtml(), clearSessionDerived(), rebuildSessionMetrics() (+8 more)

### Community 40 - "TypeScript Config"
Cohesion: 0.11
Nodes (18): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+10 more)

### Community 41 - "Next.js App Shell"
Cohesion: 0.13
Nodes (7): nextConfig, next, src_app_globals, metadata, RootLayout(), AutoHubSpotSync(), config

### Community 42 - "Dashboard Home & Settings Pages"
Cohesion: 0.17
Nodes (12): CelebrationsCalendarPage(), dynamic, DashboardPage(), revalidate, revalidate, revalidate, TicketsPage(), AppHeader() (+4 more)

### Community 43 - "Engagement Suggestions & Segmentation"
Cohesion: 0.39
Nodes (14): buildEngagementClientFromCandidate(), getEngagementClientsPage(), generateIntelligenceSuggestions(), buildLastTicketByRegistryId(), daysSinceLastTicket(), getLastTicketDateForHubSpotClient(), isUnderutilisingClient(), classifySegment() (+6 more)

### Community 44 - "Clinical Note Summarization"
Cohesion: 0.22
Nodes (16): rankClinicalNotes(), scoreClinicalNote(), buildClinicalSessionNotesText(), cleanFieldMultiline(), cleanFieldSingleLine(), extractMedicalSessionNote(), firstSentence(), isGenericLabel() (+8 more)

### Community 45 - "Package Manifest"
Cohesion: 0.12
Nodes (16): name, private, version, autoprefixer, clsx, eslint, eslint-config-next, pdfkit (+8 more)

### Community 46 - "Engagement Calendar Suggestions"
Cohesion: 0.18
Nodes (13): dynamic, VALID_CITIES, VALID_SEGMENTS, EngagementClientCardProps, CalendarEvent, getHobbySuggestions(), getPersonalDateSuggestions(), getUpcomingUniversalSuggestions() (+5 more)

### Community 47 - "Client Registry Audit Types"
Cohesion: 0.15
Nodes (15): RegistryResponse, HubSpotOnlyClient, RegistryAuditResult, RegistryOnlyClient, SupplementFile, RegistryFile, RegistryClientIndex, ClientProfileListItem (+7 more)

### Community 48 - "QoL Scoring Engine"
Cohesion: 0.21
Nodes (16): getAnalyticsData(), bandFromScore(), buildUrgentFlags(), computeDimensions(), computeQoLForClient(), computeQoLFromTicketStats(), DIMENSION_WEIGHTS, dimensionScore() (+8 more)

### Community 49 - "HubSpot Filter Audit"
Cohesion: 0.13
Nodes (12): afterBlock, afterRegistry, blockDrops, fmtMonth(), mapHubSpotTicketToDashboard(), raw, regDrops, registry (+4 more)

### Community 50 - "Care Team & Health Enrichment"
Cohesion: 0.22
Nodes (14): CareCity, careTeamForCity(), CITY_TEAMS, CityCareTeam, normalizeCareCity(), SENIOR_CONSULTANTS, WELLNESS_COUNSELLOR, buildManualMilestones() (+6 more)

### Community 51 - "Buttons & Error Boundaries"
Cohesion: 0.23
Nodes (10): class-variance-authority, Error(), GlobalError(), channelIcon, EngagementClientCard(), EngagementHub(), Button, ButtonProps (+2 more)

### Community 52 - "HubSpot Birthdays Python Sync"
Cohesion: 0.33
Nodes (13): api_post(), compact(), fetch_all_contacts(), is_excluded(), main(), match_registry(), names_match(), normalize() (+5 more)

### Community 53 - "Client Profile Merge"
Cohesion: 0.30
Nodes (13): getHubSpotBirthdayForClient(), getHubSpotBirthdaysVersion(), getHubSpotNotesVersion(), buildHubspotTicketIndex(), buildMergedClientProfiles(), computeCompleteness(), getClientProfileListItems(), getMergedClientProfiles() (+5 more)

### Community 54 - "HubSpot Ticket Sync Script"
Cohesion: 0.21
Nodes (10): fetchAll(), formatDisplayDate(), formatHubSpotBenefactorLabel(), formatMonth(), mapTicket(), PROPERTIES, rebuilt, ROOT (+2 more)

### Community 55 - "Historical Sheet Build"
Cohesion: 0.15
Nodes (11): Historical HubSpot Export Sheet (gid 43693950), aggregate, detail, historical, index, kept, meta, months (+3 more)

### Community 56 - "Registry One-off Sync"
Cohesion: 0.15
Nodes (10): clients, __dirname, out, parsed, payload, records, root, rows (+2 more)

### Community 57 - "Ticket Insight Notes API"
Cohesion: 0.24
Nodes (11): dynamic, maxDuration, POST(), GET(), TicketInsightNotesRecord, getTicketInsightNotesMap(), getTicketInsightNotesMeta(), loadFromDisk() (+3 more)

### Community 58 - "Report Period Utilities"
Cohesion: 0.28
Nodes (12): countTicketsInPeriod(), filterTicketsInPeriod(), formatPeriodRange(), monthKeyToLabel(), parseIsoDate(), parsePeriodInput(), parseReportPeriod(), ReportPeriodMode (+4 more)

### Community 59 - "Dev Dependencies"
Cohesion: 0.17
Nodes (12): devDependencies, autoprefixer, eslint, eslint-config-next, pdfkit, postcss, tailwindcss, tsx (+4 more)

### Community 60 - "Clinical Intelligence Analysis"
Cohesion: 0.23
Nodes (11): analyzeClinicalProgress(), analyzeNoteText(), buildSummary(), ClinicalProgressAnalysis, ClinicalTrajectory, CONCERN_PATTERNS, POSITIVE_PATTERNS, recommendedActions() (+3 more)

### Community 61 - "Vercel Function Config"
Cohesion: 0.17
Nodes (11): functions, src/app/api/sync/birthdays/route.ts, src/app/api/sync/hubspot/route.ts, src/app/api/sync/notes/route.ts, src/app/api/sync/registry/route.ts, src/app/api/sync/ticket-notes/route.ts, maxDuration, maxDuration (+3 more)

### Community 62 - "Runtime Dependencies"
Cohesion: 0.20
Nodes (10): dependencies, class-variance-authority, clsx, lucide-react, next, react, react-dom, recharts (+2 more)

### Community 63 - "Unified Timeline Check"
Cohesion: 0.20
Nodes (8): ascending, aug, gaps, meta, order, parsed, root, t0

### Community 64 - "Risk Assessment Data"
Cohesion: 0.27
Nodes (7): src_data_client_risk_assessment, HubSpotBirthdaysFile, getRiskAssessmentForClient(), getRiskAssessmentMap(), loadFromFile(), RiskAssessmentFile, HubSpotBirthdayRecord

### Community 65 - "Analytics Data Types"
Cohesion: 0.31
Nodes (8): AnalyticsClient, AnalyticsData, AnalyticsTopClient, CacheState, OdooTicket, UnifiedSyncResult, ReportTicketIndex, Ticket

### Community 66 - "Clinical Owner Resolution"
Cohesion: 0.47
Nodes (9): clinicalOwnerDisplayName(), envOwner(), hubSpotOwnerFarwa(), hubSpotOwnerLaiba(), hubSpotOwnerWajeeha(), isClinicalEngagementEvent(), resolveHubSpotClinicalOwnerId(), resolveHubSpotEngagementCreateOwnerId() (+1 more)

### Community 67 - "Family Health Assessment Report"
Cohesion: 0.28
Nodes (9): res.partner Benefactor Segmentation Tags, Partner-Id Client Registry Linkage, Benefactor / Beneficiary Family Model, City Breakdown (Islamabad/Karachi/Lahore/Other), Family Status (Active 106 / Paused 7 / Gratis 2 / Cancelled 1), NPS / CSAT (Not Collected), Client Family Relationship Health Assessment, Sacred Client Registry (+1 more)

### Community 68 - "Dashboard Caching Architecture"
Cohesion: 0.28
Nodes (9): Frozen Historical Index/Detail/Aggregates JSON, ISR + Immutable Static Caching (Vercel Free Tier), revalidatePath on Successful Sync, POST /api/sync/hubspot, data-source.ts (warmSession session cache), HubSpot Live Sync, Mohsyn Dashboard, Static src/data JSON Fallback (+1 more)

### Community 69 - "Engagement Doctors"
Cohesion: 0.28
Nodes (8): openAdd(), openEdit(), DEFAULT_DOCTOR_BY_CITY, defaultDoctorForCity(), ENGAGEMENT_DOCTORS, EngagementDoctor, listDoctorsForPicker(), normalizeCity()

### Community 70 - "Family Report HTML Renderer"
Cohesion: 0.58
Nodes (8): escapeHtml(), renderClinicalAnalysis(), renderFamilyReportHtml(), renderHealthPart(), renderMedicalSessions(), renderPhysioSessions(), renderProfileSnippet(), renderSectionTable()

### Community 71 - "Odoo Date Traps & Cutover"
Cohesion: 0.29
Nodes (8): HubSpot Bulk Migration (8 Jul 2026), create_date Is Import Date, HubSpot to Odoo Cutover Rule, last_activity_date (Hidden Historical Timeline), Odoo Architecture & Integration Brief, 8-13 Aug Overlap Hazard, Corrections to odoo_arc.md, Odoo Wiring Instructions

### Community 72 - "Aggregate Split Check"
Cohesion: 0.25
Nodes (6): cut, merged, root, split, tickets, whole

### Community 73 - "Registry Supplement"
Cohesion: 0.36
Nodes (7): src_data_client_registry_supplement, namesMatch(), findSupplement(), applyRegistrySupplement(), findSupplementEntry(), SupplementEntry, beneficiaryNameOverlap()

### Community 74 - "HubSpot Notes Store"
Cohesion: 0.39
Nodes (7): ensureLoadedFromDisk(), getHubSpotNotesForClient(), getHubSpotNotesMap(), HubSpotNotesFile, NOTES_PATH, readNotesFile(), HubSpotNotesRecord

### Community 75 - "Odoo Data Model"
Cohesion: 0.29
Nodes (7): Field Service Project (id 2), helpdesk.ticket (Wrong Model), project.task (Ticket Model), service.category (Self-Referencing Categories), Utilization Business Rules, Blocking Business Questions, Category Reconciliation Table

### Community 76 - "Client Registry Builder"
Cohesion: 0.33
Nodes (6): CLIENTS, __dirname, out, records, slug(), target

### Community 77 - "Odoo JSON-RPC Integration"
Cohesion: 0.47
Nodes (6): coverage-app Reference Implementation, Odoo JSON-RPC execute_kw, Read-Only Posture (Convention, Not Permission), Odoo Response Quirks (m2o tuple, false, naive UTC, HTTP 200 errors), Snapshot Cache + In-Flight Dedupe, odoo.ts JSON-RPC Client

### Community 78 - "Odoo Loader Contract"
Cohesion: 0.33
Nodes (6): fetchOdooTickets (odoo-sync.ts), mergeAggregates (analytics-build.ts), Partner Join for Email, Priority Mapping (0-3 -> normal/urgent), syncAllTickets (unified-sync.ts), Ticket[] Contract

### Community 79 - "Engagement Learning Store"
Cohesion: 0.53
Nodes (5): getLearnedActions(), readStore(), recordLearnedAction(), writeStore(), LearnedAction

### Community 80 - "Ticket-Client Matching"
Cohesion: 0.47
Nodes (4): beneficiaryTokens(), monthBounds(), ticketBelongsToRegistryClient(), ticketsInMonth()

### Community 81 - "Timezone & Cutover Date"
Cohesion: 0.40
Nodes (5): read_group with lazy:false, Acceptance Tests, CUTOVER_DATE = 2026-08-15 (cutover.ts), Shared Date Formatters (PKT created/month), Timezone Split Brain (UTC domain vs PKT buckets)

## Knowledge Gaps
- **424 isolated node(s):** `extends`, `next/core-web-vitals`, `nextConfig`, `name`, `version` (+419 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 510 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `server-only` connect `HubSpot Birthdays Sync` to `Celebrations Calendar Store`, `Odoo Sync & Cutover Checks`, `Google Sheets Calendar Sync`, `Parity Check & Queue Intelligence`, `HubSpot Owner Discovery Scripts`, `Data Source & Cancel Filters`, `Client QoL Views`, `Historical Analytics Aggregation`, `HubSpot Ticket Creation`, `Engagement Calendar API`, `Family Monthly Report Types`, `Calendar Clients & Cities`, `Medical & Physio Tickets`, `Registry Reconcile & Discovery`, `HubSpot Notes Sync`, `Engagement Client Meta`, `Client Name Matching`, `Family Profile Audit API`, `Sacred Registry Sheet Sync`, `Underutilising Sheet Cross-check`, `Family Report Cache API`, `HubSpot Activity Fetch`, `HubSpot Sync & Analytics Build`, `Ticket Notes Sync`, `Live Tickets & Report HTML Cache`, `Engagement Suggestions & Segmentation`, `Package Manifest`, `Client Registry Audit Types`, `QoL Scoring Engine`, `Care Team & Health Enrichment`, `Client Profile Merge`, `Risk Assessment Data`, `Analytics Data Types`, `Clinical Owner Resolution`, `HubSpot Notes Store`?**
  _High betweenness centrality (0.174) - this node is a cross-community bridge._
- **Why does `next` connect `Next.js App Shell` to `Celebrations Calendar Store`, `Family Report Cache API`, `Parity Check & Queue Intelligence`, `Ticket Notes Sync`, `Dashboard Pages & Charts`, `Client QoL Views`, `Engagement Calendar API`, `Package Manifest`, `Engagement Calendar Suggestions`, `HubSpot Birthdays Sync`, `Client Profile & Sidebar UI`, `Buttons & Error Boundaries`, `Registry Reconcile & Discovery`, `Tables & Registry Hub UI`, `HubSpot Notes Sync`, `Ticket Insight Notes API`, `Family Profile Audit API`, `Sacred Registry Sheet Sync`?**
  _High betweenness centrality (0.039) - this node is a cross-community bridge._
- **Why does `fetchOdooTickets (odoo-sync.ts)` connect `Odoo Loader Contract` to `Timezone & Cutover Date`, `Odoo Data Model`, `Odoo JSON-RPC Integration`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._
- **What connects `extends`, `next/core-web-vitals`, `nextConfig` to the rest of the system?**
  _424 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Celebrations Calendar Store` be split into smaller, more focused modules?**
  _Cohesion score 0.06550632911392405 - nodes in this community are weakly interconnected._
- **Should `Odoo Sync & Cutover Checks` be split into smaller, more focused modules?**
  _Cohesion score 0.05780885780885781 - nodes in this community are weakly interconnected._
- **Should `Google Sheets Calendar Sync` be split into smaller, more focused modules?**
  _Cohesion score 0.08979591836734693 - nodes in this community are weakly interconnected._