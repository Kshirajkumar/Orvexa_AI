# Graph Report - TaxFlow_AI  (2026-11-14)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 1557 nodes · 3641 edges · 77 communities (59 shown, 18 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 134 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `f32881ee`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Community 0
- Community 1
- Community 2
- Community 3
- Community 4
- Community 5
- Community 6
- Community 7
- Community 8
- Community 9
- Community 10
- Community 11
- Community 12
- Community 13
- Community 14
- Community 15
- Community 16
- Community 17
- Community 18
- Community 19
- Community 20
- Community 21
- Community 22
- Community 23
- Community 24
- Community 25
- Community 26
- Community 27
- Community 28
- Community 29
- Community 30
- Community 31
- Community 32
- Community 33
- Community 34
- Community 35
- Community 36
- Community 37
- Community 38
- Community 39
- Community 40
- Community 41
- Community 42
- Community 43
- Community 44
- Community 45
- Community 46
- Community 47
- Community 48
- Community 49
- Community 50
- Community 51
- Community 52
- Community 53
- Community 54
- Community 55
- Community 56
- Community 57
- Community 58
- Community 59
- Community 60
- Community 61
- Community 62
- Community 63
- Community 64
- Community 65
- Community 66
- Community 69
- Community 70
- Community 71
- Community 75
- Community 76

## God Nodes (most connected - your core abstractions)
1. `WhatsAppPage()` - 64 edges
2. `authHeaders()` - 60 edges
3. `FilesPage()` - 45 edges
4. `search()` - 43 edges
5. `Icon()` - 40 edges
6. `DesignSystemGenerator` - 38 edges
7. `useAppState()` - 37 edges
8. `useDispatch()` - 37 edges
9. `search_stack()` - 35 edges
10. `ClientsPage()` - 34 edges

## Surprising Connections (you probably didn't know these)
- `TestReasoningContract` --uses--> `DesignSystemGenerator`  [INFERRED]
  .agents/skills/ui-ux-pro-max/scripts/tests/test_data_contracts.py → .agents/skills/ui-ux-pro-max/scripts/design_system.py
- `TestEndToEndCoherence` --uses--> `DesignSystemGenerator`  [INFERRED]
  .agents/skills/ui-ux-pro-max/scripts/tests/test_design_system_mode.py → .agents/skills/ui-ux-pro-max/scripts/design_system.py
- `Shell()` --indirect_call--> `Dashboard()`  [INFERRED]
  apps/desktop/src/App.tsx → apps/desktop/src/pages/Dashboard.tsx
- `getClientCloudDocuments()` --calls--> `isOwnedDocumentObject()`  [EXTRACTED]
  services/backend/routes/clients.js → services/backend/lib/documentStorage.js
- `hasClaimedClientPortalAccount()` --calls--> `isClientAccount()`  [EXTRACTED]
  services/backend/routes/clientPortal.js → services/backend/lib/accountRoles.js

## Import Cycles
- 1-file cycle: `apps/desktop/src-tauri/src/lib.rs -> apps/desktop/src-tauri/src/lib.rs`

## Communities (77 total, 18 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.06
Nodes (69): BILLS, CHECKS, CLIENTS, DOCS, FILES, GEN, INITIAL_LOG, REMINDERS (+61 more)

### Community 1 - "Community 1"
Cohesion: 0.07
Nodes (52): fetchAllClients(), fs, main(), migrateDocument(), MIME_TYPES, parseLegacyCloudReference(), path, resolveLegacyVaultRoot() (+44 more)

### Community 2 - "Community 2"
Cohesion: 0.07
Nodes (59): DocumentItem, fetchClientDocuments(), generateNoticeResponse(), processDocumentExtraction(), uploadDocument(), EXTRACTION_SCHEMAS, extractionPrompt(), extractWithOpenRouter() (+51 more)

### Community 3 - "Community 3"
Cohesion: 0.07
Nodes (30): express, { createClient }, SUPABASE_SERVER_KEY, SUPABASE_URL, app, cors, express, configurationError() (+22 more)

### Community 4 - "Community 4"
Cohesion: 0.06
Nodes (43): cancelTelegramSchedule(), createTelegramLink(), createTelegramSchedule(), deleteTemplate(), fetchSupportedCountryTimezones(), fetchTelegramSchedules(), fetchTemplates(), fetchWhatsAppStatus() (+35 more)

### Community 5 - "Community 5"
Cohesion: 0.08
Nodes (45): FileArtifactCard(), FileArtifactCardProps, fileExtension(), fileIconName(), fileTypeLabel(), deleteCloudDocument(), DocumentTreeEntry, DocumentVersionItem (+37 more)

### Community 6 - "Community 6"
Cohesion: 0.07
Nodes (13): _button_outline_text_color(), _contrast_ratio(), _derive_dark_palette(), _detect_page_type(), format_master_md(), format_page_override_md(), generate_design_system(), _generate_intelligent_overrides() (+5 more)

### Community 7 - "Community 7"
Cohesion: 0.11
Nodes (32): _catalog_date(), _check_app_interface_contract(), _check_catalog_contract(), _check_catalog_summary(), _check_color_contract(), _check_core_data_contract(), _check_file(), _check_font_catalog() (+24 more)

### Community 8 - "Community 8"
Cohesion: 0.11
Nodes (36): deriveTelegramPortalInviteToken(), getClientPortalInvitationLink(), botToken(), configureWebhook(), createTelegramPortalAccessMessage(), createTelegramWelcome(), crypto, databaseSetupWarning() (+28 more)

### Community 9 - "Community 9"
Cohesion: 0.07
Nodes (14): delete(), delete_openrouter_api_key(), get_openrouter_api_key(), has_openrouter_api_key(), open_file_with_default_app(), OPENROUTER_CREDENTIAL_TARGET, openrouter_key_validation_rejects_empty_or_unrecognized_keys(), read() (+6 more)

### Community 10 - "Community 10"
Cohesion: 0.09
Nodes (17): ACCOUNT_ROLE, getAccountRole(), isClientAccount(), requireAuth(), requireClientPortalAuth(), ALLOWED_PRACTICE_TYPES, buildUserResponse(), { createClient } (+9 more)

### Community 11 - "Community 11"
Cohesion: 0.10
Nodes (8): _domain_keywords(), _file_signature(), _load_csv(), _load_csv_snapshot(), _load_product_keywords(), read_rows(), read_rows(), TestTextLayoutDataContracts

### Community 12 - "Community 12"
Cohesion: 0.08
Nodes (32): dependencies, react@^18.3.1, react-dom@^18.3.1, @tauri-apps/api@^2.12.2, @tauri-apps/plugin-deep-link@^2.6.1, @tauri-apps/plugin-dialog@^2.8.1, devDependencies, @tauri-apps/cli@^2.12.1 (+24 more)

### Community 13 - "Community 13"
Cohesion: 0.09
Nodes (24): createClientPortalInvite(), crypto, decryptPortalInviteToken(), encryptPortalInviteToken(), getActiveClientPortalInvite(), getOrCreateClientPortalInvite(), getPortalInviteEncryptionKey(), hashInviteToken() (+16 more)

### Community 14 - "Community 14"
Cohesion: 0.10
Nodes (8): _exact_stack_identifier(), _project_row(), search_stack(), _valid_max_results(), _rows(), TestNativeDesktopStackFreshness, _rows(), TestWebStackFreshness

### Community 15 - "Community 15"
Cohesion: 0.14
Nodes (22): createNotification(), inMemoryNotifications, listNotifications(), markNotificationsRead(), escapeHtml(), getResendClient(), isResendConfigured(), { Resend } (+14 more)

### Community 16 - "Community 16"
Cohesion: 0.17
Nodes (24): App(), AuthDeepLinkHandler(), Shell(), AppTour(), markTourWelcomeSeen(), shouldShowTourWelcome(), TOUR_FALLBACKS, TOUR_SELECTORS (+16 more)

### Community 17 - "Community 17"
Cohesion: 0.09
Nodes (17): formatValue(), sanitize(), write(), router, router, assert, express, test (+9 more)

### Community 18 - "Community 18"
Cohesion: 0.11
Nodes (22): localDateParts(), localDateTimeParts(), localDateTimeToUtc(), nextDailyRun(), parseLocalDateTime(), scheduledLocalTimeToUtc(), deliverSchedule(), finishSchedule() (+14 more)

### Community 19 - "Community 19"
Cohesion: 0.11
Nodes (5): _load_rows_or_empty(), search(), _style_search_destination(), TestSearchDomains, TestStyleTaxonomy

### Community 20 - "Community 20"
Cohesion: 0.10
Nodes (12): ansi_ljust(), format_ascii_box(), add_wrapped(), wrap_text(), format_markdown(), hex_to_ansi(), _mode_support_labels(), _query_wants_dark() (+4 more)

### Community 21 - "Community 21"
Cohesion: 0.13
Nodes (21): BrandLogo(), BrandLogoProps, ThemeToggle(), ThemeToggleProps, SEARCH_PAGES, Titlebar(), loadNotifications(), WorkspaceSearchResult (+13 more)

### Community 22 - "Community 22"
Cohesion: 0.08
Nodes (23): debugApplicationIdSuffix, app, security, windows, build, beforeBuildCommand, beforeDevCommand, devUrl (+15 more)

### Community 23 - "Community 23"
Cohesion: 0.12
Nodes (16): getClientPortalBaseUrl(), CHAT_LIMITS, consume(), enforceChatRateLimit(), RateLimiterUnavailableError, claimPortalInvite(), consumeInvitationRateLimit(), crypto (+8 more)

### Community 24 - "Community 24"
Cohesion: 0.16
Nodes (5): BM25, _get_bm25(), _suggest_identities(), TestBm25CoreBehavior, TestTokenizer

### Community 25 - "Community 25"
Cohesion: 0.10
Nodes (4): CatalogSummaryLineEndingsTest, _load_generator(), TestFixtureValidation, TestThresholdGate

### Community 26 - "Community 26"
Cohesion: 0.16
Nodes (10): read_rows(), TestAccessibilityGuidance, TestChartsTypographyAndIcons, TestCurrentReactGuidance, TestSemanticColors, _check_chart_contract(), _check_typography_contract(), _configured_font_names() (+2 more)

### Community 27 - "Community 27"
Cohesion: 0.09
Nodes (22): API_ORIGIN, AuthResponse, Client, ClientPortalAccess, ComplianceTask, createTemplate(), DocumentTreeResponse, DocumentUploadResponse (+14 more)

### Community 28 - "Community 28"
Cohesion: 0.22
Nodes (11): analyze_track(), _as_float(), _compact_times(), _dedupe_cues(), _feature_at(), _finite_round(), _format_cue(), _local_contrast() (+3 more)

### Community 29 - "Community 29"
Cohesion: 0.14
Nodes (16): collectStorageFiles(), deleteAccountStorage(), deleteAccountVaultSecrets(), fetchAllPages(), EXTRACTION_SCHEMAS, getExtractionPrompt(), GST_LINE_ITEM_SCHEMA, matchesSchema() (+8 more)

### Community 30 - "Community 30"
Cohesion: 0.22
Nodes (19): loadUnread(), apiGetMe(), authHeaders(), authRequest(), fetchClients(), fetchComplianceTasks(), fetchDocuments(), fetchTelegramJson() (+11 more)

### Community 31 - "Community 31"
Cohesion: 0.13
Nodes (18): cors, dotenv, resend, @supabase/supabase-js, author, dependencies, cors@^2.8.6, dotenv@^18.0.6 (+10 more)

### Community 32 - "Community 32"
Cohesion: 0.13
Nodes (12): clientsCache, clientsCacheVersions, express, fallbackClients, getClientCloudDocuments(), router, router, assert (+4 more)

### Community 33 - "Community 33"
Cohesion: 0.18
Nodes (3): DesignSystemGenerator, TestReasoningMatch, TestLightResultOutputCoherence

### Community 34 - "Community 34"
Cohesion: 0.18
Nodes (12): ClientFormCard(), ClientFormCardProps, ClientFormValues, DocumentPreviewDialog(), resolveMimeType(), apiCompleteOnboarding(), createClient(), ClientDraft (+4 more)

### Community 35 - "Community 35"
Cohesion: 0.15
Nodes (16): deleteClient(), fetchClientPortalAccess(), fetchStorageCleanupJobs(), inviteClientToPortal(), revokeClientPortalAccess(), sendClientPortalLinkToTelegram(), updateClient(), updateClientPortalAccess() (+8 more)

### Community 36 - "Community 36"
Cohesion: 0.11
Nodes (17): compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib, module, moduleResolution, noEmit (+9 more)

### Community 37 - "Community 37"
Cohesion: 0.13
Nodes (8): _exact_match_diagnostic(), _exact_row_identity(), _legacy_successor_guidance(), _normalize(), _row_identities(), _stack_query_requests_legacy(), _stack_row_filter(), _style_identity()

### Community 38 - "Community 38"
Cohesion: 0.17
Nodes (4): _palette_is_dark(), _relative_luminance(), TestEndToEndCoherence, TestLuminance

### Community 39 - "Community 39"
Cohesion: 0.19
Nodes (5): apply_decision_rules(), _object_without_duplicates(), parse_decision_rules(), _validate_action(), _check_reasoning_contract()

### Community 41 - "Community 41"
Cohesion: 0.19
Nodes (3): read_rows(), TestLandingAndStackContract, TestReasoningContract

### Community 42 - "Community 42"
Cohesion: 0.14
Nodes (7): _contains_phrase(), _passes_threshold(), _query_coverage(), _rewrite_query_for_domain(), _search_csv(), _search_csv_detailed(), _suggest_terms()

### Community 45 - "Community 45"
Cohesion: 0.24
Nodes (10): approveInvoiceReview(), InvoiceReviewError, verifyDocumentExtraction(), differs(), ExtractionReviewPage(), approve(), JSON_FIELDS, labelFor() (+2 more)

### Community 46 - "Community 46"
Cohesion: 0.16
Nodes (8): pg, fs, path, { Pool }, fs, path, { Pool }, pg@^8.23.1

### Community 47 - "Community 47"
Cohesion: 0.18
Nodes (11): PATCH_FIELDS, TASK_STATUSES, validateTaskPatch(), captureWhatsAppWebhookBody(), crypto, verifyWhatsAppWebhookSignature(), assert, crypto (+3 more)

### Community 48 - "Community 48"
Cohesion: 0.31
Nodes (11): Chat(), ask(), escapeHtml(), Msg, SUGG, sendChatMessage(), isPageNavigationCommand(), normalize() (+3 more)

### Community 49 - "Community 49"
Cohesion: 0.36
Nodes (10): calc(), docTotal(), sum(), GeneratePage(), content(), isRecommended(), run(), generatorTypeFromFiling() (+2 more)

### Community 50 - "Community 50"
Cohesion: 0.25
Nodes (8): getSupabaseConfigurationMessage(), express, router, assert, createSupabaseMock(), express, test, withRouter()

### Community 51 - "Community 51"
Cohesion: 0.20
Nodes (5): backend, backendDir, desktopDir, vite, viteEntry

### Community 52 - "Community 52"
Cohesion: 0.31
Nodes (9): FilingTypePicker(), load(), FilingTypePickerProps, fetchFilingTypes(), fetchSupportedCountries(), FilingType, metadataRequest(), SupportedCountry (+1 more)

### Community 53 - "Community 53"
Cohesion: 0.33
Nodes (8): apiConfirmAccountDeletion(), apiUpdateProfile(), apiVerifyAccountDeletionPassword(), saveSessionTokens(), ProfilePage(), confirmDeleteAccount(), save(), verifyDeleteAccountPassword()

### Community 54 - "Community 54"
Cohesion: 0.22
Nodes (8): media, autoProxy, paths, assets, blocks, components, registry, $schema

### Community 56 - "Community 56"
Cohesion: 0.25
Nodes (6): countries, countryId, { createClient }, db, filingTypes, specs

### Community 58 - "Community 58"
Cohesion: 0.38
Nodes (3): resolve(), shipped_invocations(), SkillScriptPathsTest

### Community 59 - "Community 59"
Cohesion: 0.29
Nodes (7): scripts, dev, migrate:notifications, migrate:storage, migrate:telegram, start, test

### Community 60 - "Community 60"
Cohesion: 0.33
Nodes (5): interface, display_name, short_description, policy, allow_implicit_invocation

### Community 61 - "Community 61"
Cohesion: 0.47
Nodes (3): split_values(), style_identities(), TestStyleIdentityContract

### Community 63 - "Community 63"
Cohesion: 0.33
Nodes (5): description, identifier, permissions, $schema, windows

### Community 64 - "Community 64"
Cohesion: 0.33
Nodes (5): assert, fs, migrationDirectory, path, test

## Knowledge Gaps
- **3 isolated node(s):** `app`, `brag`, `OPENROUTER_CREDENTIAL_TARGET`
  These have ≤1 connection - possible missing edges. (Counts symbols only; 519 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **18 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `search()` connect `Community 19` to `Community 67`, `Community 37`, `Community 6`, `Community 69`, `Community 70`, `Community 42`, `Community 43`, `Community 11`, `Community 44`, `Community 14`, `Community 24`, `Community 26`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._
- **What connects `app`, `brag`, `OPENROUTER_CREDENTIAL_TARGET` to the rest of the system?**
  _3 weakly-connected nodes found - possible missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.06037000973709834 - nodes in this community are weakly interconnected._
- **Why does `DesignSystemGenerator` connect `Community 33` to `Community 67`, `Community 6`, `Community 39`, `Community 38`, `Community 41`, `Community 44`, `Community 20`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.06965174129353234 - nodes in this community are weakly interconnected._
- **Why does `express` connect `Community 3` to `Community 32`, `Community 1`, `Community 8`, `Community 10`, `Community 13`, `Community 15`, `Community 17`, `Community 18`, `Community 50`, `Community 23`, `Community 31`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.06586538461538462 - nodes in this community are weakly interconnected._