# MSM Quote Frontend — Correction Report

**Branch:** `quote-frontend-finalization`
**Checkpoint SHA (pre-correction, full working-tree snapshot):** `a056576106ad7491605f086308f777b5e5d7e25a`
**Correction changes are left uncommitted for review**, as instructed.

Only ledger items whose status was **not already `PASS`** are listed below (`PASS` items were left untouched and are not repeated here).

---

## Global desktop shell

| ID | Result | Files changed | Evidence |
|---|---|---|---|
| G-04 | Already satisfied | — | `QuoteOptionCard`/`QuotePillGroup` hover (`hover:border-copper/45` / `/40`, border only) is visually distinct from selected (`border-copper/70` + tinted background + shadow, plus a checkmark on cards). Code-level confidence; not visually re-audited in a browser. |
| G-05 | Fixed | `QuoteExperience.tsx` | "Start over" contrast raised `text-foreground/45→/60`, hover `/75→/85`, so it no longer reads as disabled while remaining visually secondary. |
| G-06 | Fixed | `QuoteExperience.tsx` | Close buttons were already 40×40px from a prior pass; this pass added explicit `focus-visible:outline focus-visible:outline-2 focus-visible:outline-copper` to both (rail + mobile) for a visible, on-brand focus ring. Escape/backdrop handling untouched. |

## Batch A — Readiness contract

| ID | Result | Files changed | Evidence |
|---|---|---|---|
| A-05 | Fixed | `quote-summary.ts`, `QuoteReadiness.tsx` | New `"required"` state: an empty field on the *current* step that has never failed validation now resolves to `required`, not `needs_attention`. |
| A-06 | Fixed | `quote-summary.ts` | `needs_attention` now only appears once a step's Continue has failed (`attemptedSteps`) or the field holds an invalid value (`hasValue`). |
| A-07 | Fixed | `quote-summary.ts` | `not_added_yet` unchanged in spirit, now computed alongside the new `required`/`needs_attention` split (`step > furthestStepReached`). |
| A-08 | Fixed | `quote-summary.ts` | `complete` resolution now routed through shared validity predicates (`isSellerContactComplete`, `isBuyerContactComplete`, `isMaterialComplete`) instead of ad-hoc truthy checks. |
| A-09 | Fixed | `quote-summary.ts` | `isReadyForReview` treats `recommended` as non-blocking (`raw !== "incomplete"`); photos/documents never gate Review or dev-preview. |
| A-10 | Fixed | `quote-summary.ts`, `QuoteReadiness.tsx` | `stateLabelOverride` renders `"1 added"`…`"5 added"` (seller photos) / `"1 attached"`…`"3 attached"` (buyer documents) instead of generic `Complete`. |

## Batch B — Material / seller details

| ID | Result | Files changed | Evidence |
|---|---|---|---|
| B-01 | Fixed | `MaterialStep.tsx` | Known subtypes render first; a vertical divider separates them from the `Other`/`Not sure` fallback pair, which stays grouped together with `Not sure` last. |
| B-02 | Fixed | `MaterialStep.tsx` | `Other` and `Not sure` remain distinct enum values (`subtype: "other" | "not_sure"`), never merged. |
| B-03 | Fixed | `MaterialStep.tsx` | Label changed to `Material type (if known)`. |
| B-04 | Fixed | `quote-schema.ts`, `MaterialStep.tsx`, `quote-summary.ts` | New `subtypeOtherText` field, revealed input "Describe the material type", validated via `materialStepSchema.superRefine`, and folded into `materialLine()` so it appears in Review/WhatsApp. |
| B-06 | Already satisfied | — | Condition labels never used `|`; confirmed after B-07's rewrite too. |
| B-07 | Fixed | `quote-options.ts` | `Clean and separated`, `Mixed or unsorted`, `Used or surplus`, `Not sure` — applied in the options file, `condLabel()` in `quote-summary.ts`, and Review via `CONDITION_LABELS`. |
| B-08 | Fixed | `quote-summary.ts` | `sellerMaterialDetailsComplete()` treats `sellerQuantityUnsure` as satisfying the quantity portion; "Material details" now reports `complete` when condition is also set. |
| B-09 | Fixed | `quote-schema.ts` | `sellerDetailsStepSchema.superRefine` now `return`s immediately after the missing-quantity issue, so the unit error never fires alongside it. Message updated to `"Enter an approximate quantity or choose Not sure."` |
| B-10 | Fixed | `quote-schema.ts` | Unit error only raised when a quantity value is present. |
| B-11 | Fixed | `quote-summary.ts` | Seller rail row renamed `key: "materialDetails"`, `label: "Material details"`. |
| B-12 | Already satisfied | — | Checking "unsure" clears value/unit/unit-other immediately; unchecking leaves them empty for fresh entry — no stale-conflict path exists. |

## Batch C — Seller location, pickup, photos, contact, review, WhatsApp

| ID | Result | Files changed | Evidence |
|---|---|---|---|
| C-02 | Fixed | `LogisticsStep.tsx` | Changing `sellerEmirate` clears `sellerArea`/`sellerMapLink` when the new value differs from the previous one. |
| C-03 | Fixed | `quote-schema.ts` | `optionalMapLinkSchema`: blank valid, entered value must match `^https?:\/\/\S+\.\S+/i` — accepts any Google short/share URL shape, rejects non-URL text. |
| C-04 | **Blocked — owner/configuration** | — | Whether MSM's process is "pickup only" vs "customer may also arrange transport" is an operational-process decision; `PICKUP_CHOICE_LABELS.no` left as `"No"` rather than guessing MSM's fulfilment model. |
| C-05 | Already satisfied | — | `sellerPickupRequired: "not_sure"` was already a valid enum value satisfying the pickup readiness row; confirmed unaffected by this pass. |
| C-07 | Fixed | `quote-schema.ts`, `LogisticsStep.tsx` | `optionalFutureDateSchema` rejects unparsable/past dates; helper text `"Subject to MSM confirmation."` added under the field. |
| C-08 | Fixed | `LogisticsStep.tsx` | Relabelled `Access and loading notes`; placeholder now `"Gate access, equipment needed, timing or site restrictions"`. |
| C-09 | Fixed | `LogisticsStep.tsx` | Switching pickup away from `"yes"` clears `sellerPickupDate`/`sellerAccessNote` and their errors. |
| C-10 | Fixed | `quote-schema.ts` | `phoneSchema`: blank → `"Enter your phone or WhatsApp number."`; malformed → `"Enter a valid phone or WhatsApp number."`; `isValidPhoneNumber` accepts normalized international numbers, not UAE-only. |
| C-11 | Fixed | `quote-schema.ts` | `sellerContactStepSchema.superRefine` requires a valid email when `sellerPreferredContact === "email"`. |
| C-12 | Already satisfied | — | `sellerPhone`/`buyerPhone` were already unconditionally required; now additionally validity-checked via `isValidPhoneNumber`. |
| C-13 | Fixed | `ContactEvidenceStep.tsx` | Added `Photos (recommended, not required)` heading above the picker. |
| C-14 | Fixed | `QuotePhotoPicker.tsx` | Drop-area compacts to an `Add more` affordance once files exist; live `"{n} of {max} {countLabel}"` count always shown. |
| C-15 | Fixed | `quote-summary.ts` | Covered by A-10 (`stateLabelOverride`). |
| C-16 | Fixed (code-level); **Manual Verification Required** for full regression | `QuotePhotoPicker.tsx` | Max-5 enforced, type/size rejection, decrementing count and URL revocation all present in code; a live click-through regression wasn't run (no browser per instructions). |
| C-17 | Fixed | `LogisticsStep.tsx`, `ContactEvidenceStep.tsx`, `MaterialStep.tsx`, `DetailsStep.tsx` | `aria-invalid`/`aria-describedby` added to every field that gained (or already had) a manual error: contact fields, Area/Country/City fields, Maps links, unit-other fields, subtype-other field. |
| C-18 | Already satisfied | — | The bottom nav is a normal-flow flex sibling (`shrink-0`), never `fixed`/`sticky` — it structurally cannot overlap the scrollable content above it. |
| C-22 | Fixed | `QuotePhotoPicker.tsx` | At capacity: `"You can upload up to {max} {noun}s. Remove one to add another."` Partial multi-select reports accepted/rejected-by-type/rejected-by-size/rejected-by-capacity counts explicitly. |
| C-23 | Fixed | `QuotePhotoPicker.tsx` | Real `onDragOver`/`onDragLeave`/`onDrop` handlers added, routed through the same `handleFiles` validation as the file picker (previously drag-and-drop wasn't wired at all). |
| C-24 | Fixed | `quote-summary.ts` | Resolved via B-08 — `isReadyForReview` no longer contradicts the rail for an explicit "Not sure" quantity. |
| C-25 | Fixed | `quote-summary.ts` | `naturalLocation()` (`Area, Emirate`) used consistently in `buildSmartBrief`, Review and WhatsApp for seller location. |
| C-26 | Fixed | `ReviewStep.tsx` | Added Maps link, preferred pickup date (formatted, Yes-only), access/loading notes and Notes rows to seller Review. |
| C-27 | Fixed | `ReviewStep.tsx` | New `FileThumbnails` renders a compact read-only thumbnail/chip grid per section; Edit still returns to Step 5 without losing files (unchanged state model). |
| C-28 | Fixed | `quote-summary.ts` | WhatsApp seller message now includes Maps link, pickup date, access/loading notes and Notes when present. |
| C-29 | Fixed | `quote-summary.ts` | `"- Photos: {n} selected — I will attach them here."`, omitted at zero. |
| C-31 | Already satisfied | — | Message and Review disclaimer already avoid claiming automatic transfer; unchanged. |
| C-32 | **Blocked — owner/configuration** | — | `QUOTE_WHATSAPP_NUMBER_PROVISIONAL` left unchanged; owner must confirm the approved recipient and receive a real test message before launch. |
| C-34 | **Manual Verification Required** | — | Edit-per-section navigation logic (`onEditStep` → `setStep`) is unchanged and structurally correct, but the click-through across all five sections needs a live pass. |
| C-35 | Fixed, with a noted nuance | `ReviewStep.tsx` | Verified empirically: `import.meta.env.DEV` compiles to the literal `false` in the production client bundle (`Ll=!1`), so `{isDev && <button>}` renders nothing at runtime — the control is functionally absent from production. **Nuance:** the literal button text `"Preview confirmation (dev only)"` still exists as unreachable dead code inside the shipped JS file (esbuild doesn't cross-component-fold `isDev` into the child `ReviewStep`'s conditional) — it is never rendered or reachable, but it is technically present in the bundle's source text. |

## Batch D — Buyer material, quantity, trade route, destination

| ID | Result | Files changed | Evidence |
|---|---|---|---|
| D-02 | Fixed | `MaterialStep.tsx` | Same shared component as B-01/B-02 — applies to both intents automatically. |
| D-03 | Fixed | `MaterialStep.tsx` | Placeholder changed to the material-agnostic `"e.g. alloy/grade, dimensions, coating or purity"`. |
| D-04 | Fixed | `DetailsStep.tsx` | Step 3 label renamed `Additional requirements`, example `"Dimensions, packing, acceptable alternatives or application"`; Step 2's `materialSpec` untouched, so the two no longer read as duplicates. |
| D-06 | Fixed | `quote-options.ts` | `TRADE_REQUIREMENT_LABELS`: `Import into UAE`, `Export from UAE` (local unchanged). Used everywhere via the shared label map. |
| D-07 | Fixed | `DetailsStep.tsx`, `quote-schema.ts` | Label `Needed by (optional)`, helper `"Subject to availability and logistics confirmation."`, `optionalFutureDateSchema` rejects past/invalid dates. |
| D-08 | **Fixed (HIGH-PRIORITY BUG)** | `quote-schema.ts`, `DetailsStep.tsx` | `buyerQuantityUnit === "other"` now requires `buyerQuantityUnitOther` (`superRefine`); UI reveals "Specify unit"; value persists into Review/WhatsApp via `unitLabel`/`compactQuantity`. Applied the same fix to the seller side (`sellerQuantityUnitOther`) for consistency, beyond the ledger's buyer-only wording. |
| D-09 | Fixed | `quote-schema.ts` | Both seller and buyer quantity schemas now reject non-numeric/zero/negative values (`Number(...)` check); decimals and leading zeros work via native `Number()` coercion. |
| D-10 | Fixed | `LogisticsStep.tsx` | Buyer-local `buyerDestinationEmirate` change clears `buyerDestinationArea`/`buyerDestinationMapLink` when the value changes. |
| D-11 | Fixed | `quote-schema.ts`, `LogisticsStep.tsx`, `quote-summary.ts`, `ReviewStep.tsx` | New `buyerDestinationMapLink` field (local branch only), same validation/copy pattern as seller, included in Review and WhatsApp. |
| D-13 | Fixed, subject to confirmation | `quote-options.ts` | `FULFILMENT_LABELS`: `MSM-arranged delivery`, `Buyer-arranged collection`, `Discuss with MSM` — applied consistently local/import/export; comment flags it as subject to owner confirmation of exact wording. |
| D-15 | Fixed | `LogisticsStep.tsx`, `ReviewStep.tsx` | Import branch label renamed `Final delivery emirate`; Review row renamed to match. |
| D-16 | **Blocked — owner/configuration** | — | Port options intentionally left as `Jebel Ali` / `Khalifa Port` / `Other` / `No preference` — no Hamriyah Port added without owner confirmation; `Other` lets a customer type it manually as an interim workaround. |
| D-17 | Fixed | `LogisticsStep.tsx` | Visible label now `Preferred UAE arrival port (optional)`; remains genuinely optional in the schema. |
| D-18 | Fixed | `quote-options.ts`, `quote-schema.ts`, `LogisticsStep.tsx` | `PREFERRED_PORTS` split into `jebel_ali | khalifa_port | other | no_preference`; `other` reveals a `buyerPreferredPortOther` text field, validated when selected. |
| D-20 | Fixed | `quote-options.ts` | Covered by D-13's shared label map; `buyerLogisticsNote` field unchanged/preserved. |
| D-22 | Fixed | `quote-schema.ts` | `meaningfulText()` (min 2 trimmed chars) applied to `buyerDestinationCountry`/`buyerDestinationCityPort`; preserves non-Latin/international characters (no character-class restriction, only a length/whitespace check). |
| D-23 | Fixed | `ReviewStep.tsx`, `quote-summary.ts` | `buyerDestinationRows`/`buyerDestinationLine` fully branch-aware (local/import/export), each showing only its own fields. |
| D-25 / D-27 | **Fixed (D-27 is HIGH-PRIORITY BUG)** | `quote-schema.ts`, `LogisticsStep.tsx` | `buyerLogisticsStepSchema` now requires `buyerLogisticsRequirement` for both import and export branches (`"Discuss with MSM"` remains the safe fallback); UI wires `error={errors.buyerLogisticsRequirement?.message}` on both pill groups, previously missing entirely. |

## Batch E — Buyer documents, contact, review, WhatsApp

| ID | Result | Files changed | Evidence |
|---|---|---|---|
| E-02 | Already satisfied | — | Seller/buyer picker contracts remain separate via explicit `maxFiles`/`allowPdf` props passed per call site; no shared default that could broaden seller uploads. |
| E-03 | Fixed | `QuotePhotoPicker.tsx` | Same drag-drop + type/size rejection logic now covers the buyer picker (`allowPdf` branch) identically to seller. |
| E-04 | **Fixed (root cause of the described defect)** | `quote-summary.ts` | Buyer evidence row renamed `key:"documents"`, raw completeness now derived **only** from `values.buyerDocuments.length`, decoupled from `buyerAdditionalSpec`/`materialSpec` text — a filled specification text field can no longer make "Documents" read as complete with zero live files. |
| E-05 | Fixed | `quote-summary.ts` | `"{n} attached"` via `stateLabelOverride`. |
| E-06 | Fixed | `ContactEvidenceStep.tsx` | `Supporting files (recommended, not required)` heading added. |
| E-07 | Fixed | `ContactEvidenceStep.tsx` | Buyer Company label now `(optional, recommended)` for the local branch (still unmarked/required for import/export). |
| E-08 | **Fixed (HIGH-PRIORITY BUG)** | `quote-schema.ts` | `isValidPhoneNumber` requires an exact 9-digit UAE national number after the country/trunk prefix is stripped — both the over-length and under-length examples from the ledger are now rejected. |
| E-09 | Fixed | `quote-schema.ts` | UAE numbers checked by exact length; anything else falls back to an 8–15 digit bounded international check — legitimate overseas numbers aren't blocked. |
| E-10 | Fixed | `quote-summary.ts` | `formatPhoneForDisplay` now used in both Review **and** WhatsApp (previously WhatsApp used the raw unformatted value); canonical stored value is never mutated. |
| E-11 | Fixed | `quote-schema.ts` | Covered by C-11's buyer-side mirror (`buyerContactStepSchema.superRefine`). |
| E-12 | Fixed | `ReviewStep.tsx` | `buyerNotes` row added to Documents & Contact review. |
| E-13 | Fixed | `ReviewStep.tsx` | Same `FileThumbnails` component as C-27, shared across both branches. |
| E-14 | Fixed | `QuotePhotoPicker.tsx` | `title` attribute added to the filename chip (full name on hover) alongside existing `line-clamp-2`; IDs already included a random suffix so duplicate same-name files remain independently removable. |
| E-15 | Fixed | `quote-summary.ts`, `ReviewStep.tsx` | `formatDateForDisplay` renders `24 Sep 2026`-style dates in Review and WhatsApp; stored value stays ISO. |
| E-16 | Fixed | `styles.css`, `QuoteExperience.tsx` | `.quote-scroll` utility (thin, dark track, copper-tinted thumb) applied to the right-content scroller only. |
| E-17 | **Fixed (HIGH-PRIORITY BUG)** | `quote-schema.ts` | `sellerArea` now uses `meaningfulText()` — rejects the one-character `"G"` case from the ledger. |
| E-18 | **Fixed (HIGH-PRIORITY BUG)** | `quote-schema.ts` | `buyerDestinationCountry`/`buyerDestinationCityPort` same fix — rejects the `"B"`/`"B"` case. |
| E-19 | Fixed | `quote-summary.ts` | Import smart brief now reads `Import into UAE · Final delivery: Abu Dhabi` instead of the parenthetical form. |
| E-20 | Fixed | `ReviewStep.tsx` | Arrival port (incl. custom "Other" text), origin preference, local Maps link, needed-by date and all logistics notes included per branch. |
| E-23 | Fixed | `quote-summary.ts` | `"- Supporting files: {n} selected — I will attach them here."` |
| E-24 | Fixed | `quote-summary.ts` | Buyer WhatsApp closing block now includes phone, email, Notes; body includes needed-by date, additional requirements, logistics note and the document-count instruction — all previously partially or fully missing. |
| E-25 | **Manual Verification Required** | — | Edit/route-switch preservation logic is unchanged structurally (form state persists across `setStep`); a live click-through wasn't run. |

## Batch F — Close, draft, invalid state, keyboard, dev preview

| ID | Result | Files changed | Evidence |
|---|---|---|---|
| F-03 | Fixed | `QuoteExperience.tsx` | Close-modal action renamed `Discard and close`. *(Note: the ledger also reserves a separate `Discard and start over` action for a distinct in-quote "Start Over" confirmation flow that doesn't currently exist — today's rail "Start over" button acts immediately with no confirmation step. Building that second confirmation flow wasn't listed as its own ID and was treated as out of scope for this pass; flagged here for visibility.)* |
| F-06 | Fixed | `ContactEvidenceStep.tsx`, `QuoteExperience.tsx` | `restoredFilesNotice` is now computed per-intent (`hadBuyerDocuments` vs `hadSellerPhotos`); copy is branch-specific ("photos" vs "files") and only shows when that branch's evidence was actually present in the saved draft. |
| F-07 | **Fixed (HIGH-PRIORITY BUG)** | `quote-schema.ts`, `quote-summary.ts` | `isSellerContactComplete`/`isBuyerContactComplete` in `quote-schema.ts` are the single source of truth, imported directly by both the zod step schemas' `superRefine` calls and the readiness engine — the exact contradiction described (invalid phone `"123"` marked rail-Complete) is now structurally impossible since both paths call the same function. |
| F-08 | **Fixed (HIGH-PRIORITY BUG)**, one caveat noted | `quote-schema.ts`, `quote-summary.ts` | A restored draft with an invalid phone/email now correctly resolves to `needs_attention` (never `complete`) because `hasValue: true` + failed validity always wins in `resolveState`. **Caveat:** this fixes the readiness *rail*; it does not retroactively populate an inline red field error the instant a draft is restored — that still only appears after the user attempts Continue on that step (or edits the field). Corrupt/unknown draft shapes already failed safely pre-existing (`draftEnvelopeSchema.safeParse`), now also enforced by the new `version` literal and 24h expiry. |
| F-11 | Fixed | `quote-summary.ts` | Resolved via B-08 — `isReadyForReview` no longer disagrees with an explicit "Not sure" seller quantity, so the dev-preview button correctly enables. |
| F-12 | **Manual Verification Required** (visual capture is browser-only) | — | Code confirms the disclaimer copy (`"Prototype preview — no request was sent."`), the summary, and that both the control and screen are `isDev`-gated (see C-35's empirical bundle check). |
| F-13 | Fixed | `quote-storage.ts` | Added `version: z.literal(1)` (mismatched/missing version → safe `null` via `safeParse` failure) and a 24-hour `savedAt` expiry that clears the draft on load. `File`/object-URL fields were already excluded from persistence (destructured out before serialization) — confirmed unchanged. |

## Manual regression checklist (M-01 – M-13)

Per instructions, none of these are claimed as passed from code inspection — all require a live browser pass:

| ID | Result | Note |
|---|---|---|
| M-01 | Manual Verification Required | Escape-close guard path is unchanged code (`onOpenChange` → `requestClose`); needs live confirmation. |
| M-02 | Manual Verification Required | Backdrop-click path shares the same `onOpenChange` handler as M-01. |
| M-03 | Manual Verification Required | `router.history.back()` in `routes/index.tsx` is unchanged this pass. |
| M-04 | Manual Verification Required | Relies on TanStack Router's `scrollRestoration: true` (unchanged, in `router.tsx` — not touched). |
| M-05 | Manual Verification Required | Header anchor logic (`Header.tsx`) untouched this pass. |
| M-06 | Manual Verification Required | GSAP/ScrollStack/TrustBar untouched this pass (confirmed via diff below). |
| M-07 | Manual Verification Required | `removeFile` targets by unique `id`; logic unchanged besides messaging. |
| M-08 | Manual Verification Required | No explicit cross-intent field-clearing was added in this pass (out of the LOCKED scope); branch-gated display already prevents cross-branch data from being *shown*, but same-branch data isn't proactively wiped on an intent round-trip. Flagged as a residual limitation, not a regression. |
| M-09 / M-10 / M-11 | Manual Verification Required | Edit/Continue/Back all route through the same `setStep` + scroll-reset `useEffect`; logic unchanged this pass besides new fields feeding the same rows. |
| M-12 / M-13 | Manual Verification Required | Standalone-close (`navigate({ to: "/" })`) and masked-close (`history.back()`) paths unchanged this pass. |

---

## Validation / readiness architecture

- **Single source of truth for contact validity:** `isValidPhoneNumber`, `isValidEmailAddress`, `isSellerContactComplete`, `isBuyerContactComplete` live in `quote-schema.ts` and are imported by both the zod step schemas (`superRefine`) and `quote-summary.ts`'s readiness engine — verified via grep that no duplicate truthy-only contact check remains anywhere.
- **Readiness state machine** (`quote-summary.ts`): raw completeness (`complete`/`incomplete`/`recommended`) is resolved into 5 UI states (`complete`, `required`, `needs_attention`, `not_added_yet`, `recommended`) via `resolveState`, driven by `hasValue` (has the user entered something, even if invalid) and UI-only timing (`currentStep`, `furthestStepReached`, `attemptedSteps`).
- **Review/dev-preview gating** (`isReadyForReview`) is a separate, simpler function that ignores UI timing entirely and only checks raw completeness — this is what F-11 needed and what keeps Review gating honest regardless of how the user navigated there.

## Seller flow

Quantity/unit/condition validation, phone/email validity, Emirate-change stale-data clearing, pickup Yes/No/Not-sure branch clearing, Maps-link validation, and Review/WhatsApp completeness (Notes, Maps link, access notes, pickup date, photo thumbnails) all updated per the tables above.

## Buyer flow

Local/Import/Export are now fully isolated in validation (`buyerLogisticsStepSchema`), stale-data clearing (`DetailsStep.tsx`'s route-switch handler, unchanged from a prior pass but still verified compatible), Review (`buyerDestinationRows`), and WhatsApp (`buyerDestinationLine` + branch-specific bullets). Unit "Other", Port "Other", and required import/export logistics choice are now all enforced.

## Draft / file behavior

- Draft now versioned (`version: 1`) and expires after 24 hours; corrupt/mismatched-version JSON fails safely to `null` (no crash, no partial-invalid restore).
- `File`/object-URL data was already excluded from `sessionStorage` (confirmed unchanged); restored-file notice is now branch-specific and only shown when that branch actually had evidence.
- Drag-and-drop is now functional (previously the drop zone had no `onDrop` handler at all); capacity/type/size rejection messaging is exact per C-22.

## Review / WhatsApp behavior

Both are now branch-aware end-to-end, show every non-empty entered value (including previously-missing Notes, Maps links, access/loading notes, pickup dates, arrival port, origin preference), use one shared compact-quantity/natural-location formatter, format dates and phones for display without mutating stored values, and never claim automatic file transfer or a real submission.

## Routing preservation

Confirmed via diff: `src/routes/index.tsx`, `src/routes/quote.tsx`, `src/router.tsx`, `src/components/ui/dialog.tsx` are **unchanged** since the checkpoint. Masked overlay, direct `/quote` fallback, homepage-stays-mounted architecture, typed search validation and guarded close were not touched.

## Command results

| Command | Result |
|---|---|
| `tsc --noEmit` | Clean, no errors |
| `eslint` on all 12 modified TS/TSX files | Clean, no errors (one unrelated informational warning: `styles.css` has no ESLint config, expected) |
| `npm run build` (client + SSR + Nitro) | Succeeded |
| Route generation | `src/routeTree.gen.ts` includes `/quote` (`QuoteRouteImport`, `path: '/quote'`) |
| Production dev-preview search | `isDev` compiles to `false` in the client bundle (`Ll=!1`); button does not render at runtime (see C-35 nuance) |
| Stale-copy search | Zero matches for old condition/fulfilment/trade-route/port copy across `src/components/site/quote/` |
| Conflicting readiness/contact-validity search | Zero duplicate truthy-only contact checks found; single shared predicate confirmed |
| Diff vs checkpoint | 13 files changed, all within `src/components/site/quote/` + `src/styles.css` (scoped scrollbar utility only) |

## Protected files — confirmed unchanged since checkpoint

`package.json`, `package-lock.json`, `src/components/site/ScrollStack.tsx`, `src/components/site/TrustBar.tsx`, `src/components/site/Header.tsx`, `src/components/site/Hero.tsx`, `src/components/site/ContactFooter.tsx`, `src/router.tsx` — zero diff against the checkpoint commit. No global font or colour tokens changed (`styles.css` diff is purely an additive `.quote-scroll` utility using an existing token value). No mobile-specific classes touched. No backend/database/email/analytics/AI code added.

## Owner blockers

- **C-32**: exact WhatsApp recipient number/account needs owner confirmation + one real test message before launch.
- **C-04**: whether "No pickup" should read "No — I'll arrange transport" depends on MSM's actual operational process.
- **D-16**: whether Hamriyah Port should be added to the port list.
- **D-13** (not blocked, but flagged): actor-based fulfilment copy ("MSM-arranged delivery" etc.) was applied as the ledger's own recommended text, but is explicitly marked "subject to owner confirmation" there.

## Unresolved limitations

- F-03's mention of a distinct in-quote "Start Over confirmation" (as opposed to the close-modal's "Discard and close") doesn't exist as a built flow — Start Over currently acts immediately with no confirmation step. Not separately ticketed in the ledger as its own ID, so left as-is rather than building new UI beyond the requested scope.
- F-08 fix covers the readiness *rail* correctly; it does not add an inline field error the instant a draft restores (only the rail flags it until the user touches that step).
- M-08: no proactive cross-intent field clearing was added; branch-gated display already prevents cross-branch leakage in what's shown, but toggling intent back and forth doesn't wipe same-branch data from an earlier session.
- All M-01–M-13 and several VERIFY items (C-16 full regression, C-34, E-25, F-12 visual capture) genuinely require a live browser pass — explicitly not claimed as passed here.
