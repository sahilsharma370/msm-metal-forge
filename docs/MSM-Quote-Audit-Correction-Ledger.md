# MSM Unified Get Quote — Audit & Correction Ledger

Canonical source of truth for all screenshot-batch findings before implementation.

## Workflow

- Audit all desktop seller and buyer states batch-by-batch.
- Record every issue here before requesting code changes.
- Do not treat an item as fixed until the relevant screenshot/state is re-tested.
- Statuses: `HIGH-PRIORITY BUG`, `LOCKED` (approved correction), `PARTIAL`, `VERIFY` (requires another state/code check), `PASS`, `DEFERRED`.

## Global desktop shell

| ID | Status | Finding / requirement | Acceptance check |
|---|---|---|---|
| G-01 | PASS | Quote frame geometry must not change between steps, seller/buyer branches, or validation states. | Outer width and height remain identical across all desktop states. |
| G-02 | PASS | Left rail is fixed and smaller than the flexible right workspace. | Rail remains fixed while only right content scrolls. |
| G-03 | PASS | Clean MSM background; no homepage/image bleed or watermark. | Quote workspace uses `#080A1D`; homepage remains mounted behind overlay. |
| G-04 | VERIFY | Hovered option must remain visually distinct from a selected option. | Hover never looks selected without selection semantics. |
| G-05 | VERIFY | Start Over currently risks looking disabled. | Once the form contains progress, action is visibly available but remains secondary. |
| G-06 | VERIFY | Close control hit target/accessibility. | Visible focus, adequate target size, Escape/backdrop behavior unchanged. |

## Batch A — Entry, routing, opening states, readiness

| ID | Status | Finding / correction | Acceptance check |
|---|---|---|---|
| A-01 | PASS | Header CTA source is `header`. | Masked quote route opens and homepage stays mounted. |
| A-02 | PASS | Hero CTA source is `hero`. | Masked quote route opens and homepage stays mounted. |
| A-03 | PASS | Final CTA source is `final_cta`. | Masked quote route opens and homepage stays mounted. |
| A-04 | PASS | Direct `/quote` hard refresh works. | Standalone route renders without 404/error. |
| A-05 | LOCKED | Untouched current required item must say `Required`, not `Needs attention`. | Initial screen contains no premature error-state language. |
| A-06 | LOCKED | `Needs attention` is reserved for a touched/failed validation state. | Appears only after attempted continuation or equivalent validation trigger. |
| A-07 | LOCKED | Future required information uses `Not added yet`. | Future steps are neutral, not errors. |
| A-08 | LOCKED | Valid required information uses `Complete`. | State updates only when the relevant branch is valid. |
| A-09 | LOCKED | Missing optional seller photos and buyer documents use `Recommended`; they never block continuation/submission. | Optional evidence remains optional in schema and navigation. |
| A-10 | LOCKED | Added optional evidence should report a useful count such as `1 added`, not generic `Complete`. | Rail conveys evidence quantity accurately. |

### Readiness state contract

| Situation | Label |
|---|---|
| Current required item, untouched | `Required` |
| Required item after failed validation | `Needs attention` |
| Future required item | `Not added yet` |
| Required item valid | `Complete` |
| Optional evidence absent | `Recommended` |
| Optional evidence present | `1 added`, `2 added`, etc. |

## Batch B — Material and seller material-details states

| ID | Status | Finding / correction | Acceptance check |
|---|---|---|---|
| B-01 | LOCKED | Known material subtypes stay in the primary left group. `Other` and `Not sure` form a fallback group at the right; `Not sure` is always last. | Desktop shows `[known types…]  [Other] [Not sure]`; fallback controls stay together when wrapping. |
| B-02 | LOCKED | `Other` and `Not sure` remain separate because they carry different data meaning. | `Other` = known but unlisted; `Not sure` = intentionally unidentified; blank = skipped. |
| B-03 | LOCKED | Change `Material type (optional)` to `Material type (if known)`. | Label reads naturally with explicit `Not sure`. |
| B-04 | VERIFY | Selecting subtype `Other` must reveal a compact `Describe the material type` input. | Value persists and appears in review/WhatsApp brief. |
| B-05 | PASS | Main `Other / Not listed` material reveals `Describe the material`; custom value can make Material complete. | Custom material persists across navigation and draft restore. |
| B-06 | LOCKED | Do not use `|` inside condition option labels. Use plain-language sentence case. | No pipe separators; labels remain readable and consistent. |
| B-07 | LOCKED | Final condition copy: `Clean and separated`, `Mixed or unsorted`, `Used or surplus`, `Not sure`. | UI, schema labels, summary and WhatsApp copy use the same labels. |
| B-08 | LOCKED | Explicit `I'm not sure of the quantity` is a valid answer and completes material details when condition is valid. | Quantity/unit are not required in this state; rail does not show `Needs attention`. |
| B-09 | LOCKED | Quantity validation must not emit two premature errors. | No quantity + unsure unchecked: only `Enter an approximate quantity or choose Not sure.` |
| B-10 | LOCKED | Unit is conditionally required only when numeric quantity exists. | Numeric quantity + no unit: `Select a unit.`; unsure selected: unit error cleared. |
| B-11 | LOCKED | Rename seller rail item `Quantity` to `Material details`. | Rail label accurately covers quantity, unit, condition and related description. |
| B-12 | VERIFY | Toggling quantity uncertainty must not preserve conflicting stale numeric/unit values. | Selecting unsure clears or safely ignores old quantity/unit; toggling back behaves predictably. |
| B-13 | PASS | Material cards and subtype controls remain visually consistent across Copper, Aluminium, Steel & Iron, Lead and Other. | Frame and selection geometry remain stable. |

## Batch C — Seller location, pickup, photos and contact

| ID | Status | Finding / correction | Acceptance check |
|---|---|---|---|
| C-01 | PASS | All seven UAE emirates are present and fit the seller location branch. | Abu Dhabi, Dubai, Sharjah, Ajman, Umm Al Quwain, Ras Al Khaimah and Fujairah remain available. |
| C-02 | LOCKED | Changing Emirate can leave stale dependent location data. Screenshot state showed `Abu Dhabi` with Area `Dubai` while Location was `Complete`. | When Emirate changes after Area/Maps data exists, clear the dependent Area and Maps link (or force explicit reconfirmation); Location cannot remain complete on stale values. |
| C-03 | VERIFY | Optional Google Maps input needs safe, useful validation without rejecting valid Google short/share links. | Blank is valid; accepted Google Maps full/short URLs persist; malformed/non-URL text shows a specific error only after validation. |
| C-04 | VERIFY | Bare pickup option `No` is operationally vague. Preferred copy is `No — I'll arrange transport` if that matches MSM's process. | Customer and owner can distinguish MSM pickup from customer-arranged delivery/transport. |
| C-05 | LOCKED | Pickup `Not sure` is an explicit valid response and must not block progress. | Rail Pickup becomes complete after `Not sure`; no Yes-only fields are required. |
| C-06 | PASS | Pickup `Yes` reveals preferred date and access/loading information; both are optional. | Conditional panel appears only for Yes and does not make these fields mandatory. |
| C-07 | LOCKED | Preferred pickup date must not imply a confirmed booking. Add helper `Subject to MSM confirmation.`; if supplied, it cannot be an invalid/past date. | Future/valid date accepted; blank accepted; past/invalid date rejected; summary says preferred/requested, never confirmed. |
| C-08 | LOCKED | Replace `Access / loading note` with `Access and loading notes`; add a useful prompt for gate access, equipment, timing or site restrictions. | Copy is plain language and captured value persists into review/owner brief. |
| C-09 | VERIFY | Switching Pickup from Yes to No/Not sure must not submit hidden stale date/access data. | Hidden Yes-only fields are cleared or explicitly excluded from validation, summary, storage and WhatsApp brief. |
| C-10 | LOCKED | Contact validation must distinguish blank from malformed phone input and accept realistic international numbers. | Blank: `Enter your phone or WhatsApp number.` Invalid: `Enter a valid phone or WhatsApp number.` Normalize spaces/dashes; accept valid international format rather than hard-requiring UAE only. |
| C-11 | LOCKED | Selecting preferred contact `Email` while Email is empty/invalid is contradictory. | Email remains optional generally, but becomes required and valid when Email is the preferred contact method. |
| C-12 | LOCKED | WhatsApp/Call preference requires a valid phone; preferred-contact selection remains explicit rather than silently defaulted. | Each preference has a usable matching contact channel. |
| C-13 | LOCKED | Seller photos are optional/recommended, but current imperative heading/instructions can read as mandatory. | Label the evidence area `Photos (recommended)` or state `Recommended, not required`; use copy such as `For a faster review...`; skipping photos remains valid. |
| C-14 | LOCKED | Once photos are added, the large empty uploader consumes excessive space and does not show progress toward the limit. | After first upload, provide a compact `Add more photos` affordance and visible count such as `4 of 5 photos added`; preserve drag/drop/camera access. |
| C-15 | LOCKED | Rail must report photo count, not generic `Complete`. | `Recommended` at zero; `1 added` through `5 added` after uploads. |
| C-16 | VERIFY | File handling edge cases require regression checks. | Max 5 enforced; JPG/PNG/WebP and size rules work; invalid/oversized/sixth files get specific feedback; removal decrements count; object URLs are revoked. |
| C-17 | LOCKED | Invalid contact controls need consistent visual and accessible error state, not only red text or whichever input currently has focus. | Every invalid input/group sets `aria-invalid`, connects error text with `aria-describedby`, and uses the same error border/state; focus remains distinct. |
| C-18 | VERIFY | Fixed bottom navigation may obscure the final Notes field at some scroll positions. | At maximum scroll the full Notes field and its error/helper text clear the navigation bar with comfortable bottom space. |
| C-19 | PASS | Desktop outer frame, rail width and right-workspace split remain stable between Steps 4 and 5 and between pickup branches. | Only inner right content scrolls; outer geometry does not respond to content height. |
| C-20 | PASS | Existing photo guidance about wide shot, close-up, markings/cut ends and non-final grade/weight/price is operationally useful and truthful. | Preserve the substance while clarifying that photos are recommended. |
| C-21 | PASS | Maximum-five guard is present and prevents additional photos from being added. | Five previews remain; excess selections are rejected without deleting accepted files. |
| C-22 | LOCKED | Max-file feedback should state the exact outcome instead of generic `some files were not added`. | At full capacity: `You can upload up to 5 photos. Remove one to add another.` For partial multi-select, report how many were accepted/rejected. |
| C-23 | VERIFY | Native file chooser filtering is not a complete invalid-file test. Unsupported types can arrive through drag/drop and valid image types can exceed the size limit. | Drag/drop PDF/ZIP produces unsupported-type feedback; accepted image over 8 MB produces size feedback; neither is added. |
| C-24 | LOCKED | Review is reachable while rail says Quantity `Needs attention` even though quantity is explicitly `Not sure`. This is the previously identified uncertainty-state defect surfacing in the final step. | Explicit uncertainty makes Material details complete in rail, review readiness and CTA gating; no contradictory final state. |
| C-25 | LOCKED | Smart brief shows only the Emirate while detailed review/WhatsApp exposes stale `Area, Emirate` data (`Dubai, Abu Dhabi`). | One normalized location formatter is used in readiness, smart brief, review and WhatsApp; dependent-field reset from C-02 prevents contradictions. |
| C-26 | LOCKED | Review does not currently display every entered detail. Notes are omitted; conditional pickup date/access notes and Maps link also require inclusion when present. | Review displays every customer-entered non-empty value, including Notes, email, Maps link, preferred date and access/loading notes; empty optional rows stay hidden. |
| C-27 | LOCKED | Review only shows photo count, so customer cannot confirm which files are attached. | Photos & Contact review includes compact removable/read-only thumbnails plus count; Edit returns to Step 5 without losing files. |
| C-28 | LOCKED | WhatsApp brief omits useful entered contact/operational data. | Include entered phone, email, notes, Maps link, requested pickup date and access/loading notes where applicable. Do not include empty fields. |
| C-29 | LOCKED | WhatsApp photo handoff should carry count and truthful instruction. | Use `Photos: 3 selected — I will attach them here.` (dynamic count); omit the line when zero photos. |
| C-30 | PASS | WhatsApp message structure is readable and clearly states seller intent, material, quantity, condition, location, pickup and preferred contact. | Preserve concise heading and line-separated/bulleted structure. |
| C-31 | LOCKED | WhatsApp correctly does not claim photos transfer automatically. | Preserve the review-page warning and the message's attach-again instruction. |
| C-32 | VERIFY | WhatsApp handoff works and resolves to a WhatsApp Business Account. Confirm that the configured number/account is MSM's approved primary recipient; replace it only if it is not. | Owner confirms the exact number/account and receives one real test message before launch. |
| C-33 | PASS | Desktop tab behavior is correct: the original Get a Quote tab remains open, the WhatsApp share gateway opens separately, and WhatsApp Web opens separately. | Preserve the existing new-tab behavior and safe external-link attributes. |
| C-34 | VERIFY | Every Review `Edit` control must return to the correct step, preserve all fields/files and allow a predictable return to Review. | Test Enquiry Type, Material, Material Details, Location & Logistics and Photos & Contact Edit actions. |
| C-35 | VERIFY | `Preview confirmation (dev only)` must never appear in a production build and must not simulate a real submission. | Production review contains no dev preview/fake success; development preview remains clearly labeled and gated by valid readiness. |
| C-36 | PASS | Frontend prototype uses `Continue on WhatsApp` rather than falsely claiming the enquiry was submitted. | Preserve truthful CTA until the backend submission path exists. |

## Batch D — Buyer material, quantity, trade route and destination branches

| ID | Status | Finding / correction | Acceptance check |
|---|---|---|---|
| D-01 | PASS | Buyer wording correctly changes the material question to `What material do you require?` and keeps the same core material categories. | Buyer and seller intent remain visibly distinct while sharing the material model. |
| D-02 | LOCKED | Batch B fallback treatment also applies to buyer material subtypes. | Known subtypes remain left; `Other` and `Not sure` are grouped at the end; `Other` reveals a custom subtype field. |
| D-03 | LOCKED | The `Specification / grade` example is not material-aware: `insulated only` is inappropriate for the selected Aluminium Profiles & Frames state. | Use a safe generic example (`alloy/grade, dimensions, coating or purity`) or material-specific examples. |
| D-04 | LOCKED | Step 2 `Specification / grade` and Step 3 `Additional specification` overlap and can collect duplicate/conflicting text. | Keep Step 2 for grade/specification; rename Step 3 to `Additional requirements` with a distinct example such as dimensions, packing, acceptable alternatives or application. Both values remain separately labelled in review. |
| D-05 | PASS | Buyer requires a numeric quantity and unit, which is appropriate for an availability/commercial enquiry. | Valid quantity and unit make Quantity complete. |
| D-06 | LOCKED | `Import enquiry` and `Export enquiry` are perspective-dependent. | Use explicit customer-facing labels: `UAE local supply`, `Import into UAE`, `Export from UAE`; summary and WhatsApp use the same terminology. |
| D-07 | LOCKED | `Required-by date` can sound guaranteed. | Use `Needed by (optional)` or preserve label with helper `Subject to availability and logistics confirmation.` Blank is valid; past/invalid date is rejected; review never calls it confirmed. |
| D-08 | HIGH-PRIORITY BUG | Unit `other` is accepted and Quantity becomes complete without asking what the unit is. | Selecting Other reveals `Specify unit`; value is required for that branch, persisted and shown in review/WhatsApp; switching away clears/excludes it. |
| D-09 | VERIFY | Buyer quantity numeric edge cases are not shown. | Reject zero, negative, non-numeric and unreasonable formatting; allow appropriate decimal quantities; trim leading zeros safely. |
| D-10 | LOCKED | Local destination can repeat the seller stale-location problem (screenshot showed Abu Dhabi with Area `Al Quoz`). | Emirate changes clear/reconfirm Area and optional Maps link; one normalized `Area, Emirate` formatter is used everywhere. |
| D-11 | LOCKED | Add optional Google Maps link for UAE local delivery, consistent with seller pickup. | Link appears for local destination, is optional, safely validated and included in review/WhatsApp when provided. |
| D-12 | PASS | Local fulfilment covers delivery, buyer collection and discussion with MSM. | Preserve the three operational outcomes. |
| D-13 | LOCKED | Fulfilment/logistics option copy should identify who arranges transport consistently across local/import/export branches. | Preferred wording: `MSM-arranged delivery`, `Buyer-arranged collection`, `Discuss with MSM` (subject to owner confirmation). |
| D-14 | PASS | Manual route-switch test confirmed local/import/export destination values do not appear in the wrong branch. | Preserve current branch isolation; regression-test draft, review and WhatsApp after future schema edits. |
| D-15 | LOCKED | In the import branch, `Destination emirate` is actually the final UAE delivery destination after port arrival. | Rename to `Final delivery emirate` so it is not confused with arrival port. |
| D-16 | VERIFY | Import port list may omit the most relevant Sharjah option for MSM. | Confirm with owner whether Hamriyah Port should join Jebel Ali and Khalifa Port before launch. |
| D-17 | LOCKED | `Preferred UAE port` currently has no `(optional)` marker and produces no error when empty. | Make semantics explicit: `Preferred UAE arrival port (optional)` if no preference is acceptable; otherwise validate it as required. Current recommended V1 is optional. |
| D-18 | LOCKED | Import port option `Other / Not sure` combines known-unlisted and unknown answers. | Separate `Other` (opens port-name field) from `No preference / Not sure`. |
| D-19 | PASS | Optional origin-country preference is useful and clearly allows an open requirement. | Preserve optional behavior and include supplied value in review/WhatsApp. |
| D-20 | LOCKED | Import logistics choices are ambiguous about what happens after arrival. | Use the consistent actor-based fulfilment copy from D-13 and retain a logistics-notes field for Incoterm, container/packing and delivery details. |
| D-21 | PASS | Export branch correctly asks for destination country and destination city/port. | Both required values are retained in review and WhatsApp. |
| D-22 | VERIFY | Export destination fields need input-quality checks. | Trim whitespace; reject empty/whitespace-only values; preserve international characters; avoid over-restrictive country/city validation. |
| D-23 | LOCKED | Buyer Review and WhatsApp must use branch-aware summaries. | Local shows destination/fulfilment/maps; import shows final emirate, port, origin preference and logistics; export shows country, city/port and logistics. No hidden route data appears. |
| D-24 | PASS | Import missing-destination validation correctly marks Destination `Needs attention` after attempted continuation. | Preserve touched/attempted-validation timing and accessible error state. |
| D-25 | PARTIAL | Buyer Step 3 and local Step 4 correctly validate their required fields. Export validates country and city/port, but does not validate its unselected logistics requirement. | Preserve working errors; fix D-27 so all required export fields share the same validation contract. |
| D-26 | PASS | Outer frame and rail geometry remain stable across buyer Material, Details, Local, Import and Export states. | Branch content changes only within the right scroller. |
| D-27 | HIGH-PRIORITY BUG | Export Step 4 allows Logistics requirement to remain blank after Continue; label has no optional marker and owner needs responsibility clarified. | Require a logistics choice across local/import/export. `Discuss with MSM` is the valid fallback for an unsure customer; missing selection shows accessible error and Destination remains incomplete. |
| D-28 | PASS | Empty buyer Step 3 correctly reports missing required quantity, unit and trade route and updates both readiness rows to `Needs attention`. | Preserve specific messages and attempted-validation timing. |
| D-29 | PASS | Empty local-supply destination correctly reports missing Emirate, Area and Fulfilment and marks Destination `Needs attention`. | Preserve behavior, subject to copy/actor refinements in D-10 to D-13. |
| D-30 | PASS | Empty export destination correctly reports missing country and city/port. | Preserve these errors and add missing logistics validation from D-27. |

### Batch D missing-state capture list

1. Buyer Step 3 empty validation: quantity, unit and trade route.
2. Buyer Step 3 `Unit = Other` with custom-unit field.
3. Buyer Step 3 past required-by date error.
4. Local Step 4 blank validation.
5. Local Step 4 Buyer-arranged collection and Discuss-with-MSM states.
6. Import Step 4 Other-port and No-preference/Not-sure behavior (after correction if currently combined).
7. Export Step 4 blank validation.
8. Route-switch test after entering route-specific destination values.

Buyer Documents & Contact, buyer Review and buyer WhatsApp are a separate following batch rather than missing screenshots from this branch batch.

## Batch E — Buyer documents, contact, review and WhatsApp

| ID | Status | Finding / correction | Acceptance check |
|---|---|---|---|
| E-01 | PASS | Buyer evidence intentionally accepts `PDF, JPG, PNG or WebP` up to 3 files. PDF acceptance is correct for specifications, purchase references and supporting documents. | Buyer accepts the four declared types; seller remains image-only with a separate five-photo limit. |
| E-02 | LOCKED | Seller and buyer evidence contracts must stay explicitly separate in code, copy, validation and summaries. | Seller: photos only, max 5. Buyer: PDFs/images, max 3. Shared picker configuration cannot accidentally broaden seller uploads. |
| E-03 | VERIFY | Buyer invalid-file tests remain outstanding. | Drag/drop ZIP/DOCX is rejected; PDF/image over 8 MB is rejected; existing files remain; no object URL/resource leak. |
| E-04 | LOCKED | Buyer Documents can display `Complete` while the uploader shows zero attached previews. Readiness must be derived from currently available files, not stale draft metadata. | Zero live files = `Recommended`; restored drafts that cannot restore File objects display a re-attach notice and do not claim completion. |
| E-05 | LOCKED | Buyer rail should report useful document count. | Zero = `Recommended`; one through three = `1 attached`, `2 attached`, `3 attached`. |
| E-06 | LOCKED | Supporting files are optional/recommended but the evidence area does not explicitly say so. | Label/copy states `Supporting files (recommended)` or `Recommended, not required`; skipping files remains valid. |
| E-07 | LOCKED | Company has no optional marker but blank Company does not produce validation. | Keep lead capture non-blocking and label `Company (optional, recommended)` unless owner explicitly makes it mandatory; heading/copy must not imply it is required. |
| E-08 | HIGH-PRIORITY BUG | An overlength UAE mobile number (`+971 50 000 00000`) passes validation, marks Contact complete and reaches Review. Another screenshot also shows an apparently underlength UAE value accepted. | A UAE number normalizes to `+971` plus exactly 9 national digits; over/underlength variants are rejected before Review. |
| E-09 | LOCKED | Broad digit-count regex is insufficient because buyer enquiries can be international while UAE numbers have known length rules. | Use country-aware phone parsing/validation (preferred) or an explicit UAE rule plus standards-based E.164 fallback for other country codes; reject impossible lengths without blocking legitimate international numbers. |
| E-10 | LOCKED | Phone UX must normalize spaces, parentheses and hyphens while preserving a canonical international value. | Display can remain human-readable; stored/review/WhatsApp value is normalized consistently; blank and malformed errors remain distinct. |
| E-11 | LOCKED | Preferred Email requires a valid Email even though Email is otherwise optional/recommended; phone remains required if that is the approved business rule. | Email preference cannot reach Review with blank/invalid email; WhatsApp/Call require valid phone. |
| E-12 | LOCKED | Buyer Notes entered on Step 5 are omitted from Review, violating the editable-summary promise. | Non-empty Notes appear in Documents & Contact review and in WhatsApp; empty Notes row is hidden. |
| E-13 | LOCKED | Buyer Review only shows `3 attached`, not which files are attached. | Review shows image thumbnails plus a PDF/file chip with safe filename, count and Edit action; no document contents are embedded unsafely. |
| E-14 | VERIFY | Long filenames and duplicate filenames are not shown. | Filename truncates visually without losing accessible full name; duplicate files have stable unique IDs; removal targets the correct file. |
| E-15 | LOCKED | Review renders raw ISO date (`2026-09-24`) instead of a customer-friendly date. | Use one locale-stable formatter such as `24 Sep 2026` in Review and WhatsApp; stored value may remain ISO. |
| E-16 | LOCKED | Quote content scroller shows a large bright native scrollbar that clashes with the navy interface. | Style a thin, dark, accessible scrollbar with restrained copper thumb (or equivalent) without hiding scrollability or breaking keyboard use. |
| E-17 | HIGH-PRIORITY BUG | One-character local Area (`G`) is accepted as a complete destination and appears in smart summary/review. | Trim input and require a minimally meaningful value; reject whitespace-only and one-character placeholders while allowing legitimate short alphanumeric area names. |
| E-18 | HIGH-PRIORITY BUG | One-character export country and city/port (`B`, `B`) are accepted as a complete destination. | Trim and require meaningful country and city/port text; preserve international characters and avoid over-restrictive English-only validation. |
| E-19 | LOCKED | Import smart brief is awkward: `destination: Abu Dhabi, UAE (import arrival)` and can omit useful branch context. | Use explicit route language from D-06 and a clean summary such as `Import into UAE · Final delivery: Abu Dhabi`; include selected arrival port when present. |
| E-20 | LOCKED | Buyer Review must show every non-empty route-specific field, including arrival port, origin preference, local Maps link, required/needed-by date and all logistics notes. | Import/local/export Review sections are branch-aware and contain no hidden stale values. |
| E-21 | PASS | Buyer Review architecture, Edit actions, readiness rail and truthful WhatsApp-only continuation are consistent with seller Review. | Preserve shared visual structure and fixed geometry. |
| E-22 | PASS | Visible buyer WhatsApp message correctly carries buyer intent, material, quantity, export route and destination. | Preserve concise branch-aware structure. |
| E-23 | LOCKED | Buyer WhatsApp document handoff must state count and require manual attachment, just like seller photos. | Dynamic line: `Supporting files: 3 selected — I will attach them here.`; omit at zero. |
| E-24 | VERIFY | Full lower portion of buyer WhatsApp message was not captured. | Verify phone, email, Notes, needed-by date, additional requirements, logistics note and document-count instruction appear when provided; empty fields are absent. |
| E-25 | VERIFY | Review Edit actions and route-switch preservation need buyer-specific regression. | Editing any section preserves valid common fields/files, updates summary/WhatsApp and does not resurrect stale route-specific values. |
| E-26 | PASS | Desktop frame remains fixed across buyer Step 5, validation, import/local/export Review and internal scrolling. | Preserve geometry; only right content scrolls. |

## Batch F — Close, draft restore, invalid state, keyboard and development preview

| ID | Status | Finding / correction | Acceptance check |
|---|---|---|---|
| F-01 | PASS | `Keep editing` dismisses the close confirmation and preserves the current step and entered values. | Preserve current behavior; focus returns predictably to the quote experience. |
| F-02 | PASS | `Save and close` stores the serializable draft, closes the experience and allows the user to resume at the exact saved step with saved answers. | Reopening restores the same intent, branch, step and serializable values without claiming that files were retained. |
| F-03 | LOCKED | In the close flow, an action labelled `Discard and start over` exits to the homepage. That behavior conflicts with the label because `Start over` conventionally means remain in the quote at a fresh Step 1. | Keep the current exit behavior but rename this close-modal action to `Discard and close`. Reserve `Discard and start over` for the separate Start Over confirmation that stays in the quote. |
| F-04 | PASS | The dedicated Start Over flow clears the draft/form and presents a fresh Step 1. | All shared and branch-specific values, touched/errors, files and persisted draft metadata are cleared; source/routing behavior remains safe. |
| F-05 | PASS | A draft containing uploaded evidence restores the text answers but not the browser `File` objects, and the UI gives a visible re-attachment notice. | Zero restored live files reports `Recommended`; no stale file count or phantom attachment is submitted. |
| F-06 | LOCKED | The restored-file notice is not branch-specific: seller copy says `photos or documents` even though the seller uploader accepts photos only. | Seller: `We restored your saved answers. Uploaded photos aren't included in saved drafts, so please add them again.` Buyer uses `uploaded files` or `documents and images`. Show only when the saved draft previously contained evidence. |
| F-07 | HIGH-PRIORITY BUG | Contact readiness is derived inconsistently from validation. Screenshot shows invalid phone `123` and invalid email with visible field errors while the rail still says `Contact details — Complete`. | One shared contact-validity function/schema drives Step 5 validation, readiness, Review gating and restored-draft state. Any invalid required/preferred contact channel prevents `Complete`. |
| F-08 | HIGH-PRIORITY BUG | Invalid contact values can be saved/restored and then appear without field errors while Contact details remains `Complete`; this violates safe restored-draft handling. | Partial drafts may preserve raw user input, but restored malformed phone/email never becomes complete. Revalidate on restore, safely normalize known values, and expose `Needs attention` when the invalid step is current/previously attempted. Invalid/corrupt unknown draft shapes fall back safely. |
| F-09 | PASS | Correctly opened invalid quote search values fall back to the neutral `/quote` experience and do not crash or preselect nonsense values. | Test with the full URL `http://localhost:8080/quote?source=nonsense&intent=nonsense&material=nonsense`; values are discarded/sanitized and no `file://` navigation is involved. |
| F-10 | PASS | A visible focus ring moving between the close control, cards and other interactive controls when Tab is pressed is expected keyboard-accessibility behavior. | Do not remove the focus indicator. Final regression verifies logical forward/backward order, focus trap within the open Dialog, Enter/Space activation and focus restoration after close. Copper/near-white styling may replace framework blue only if contrast remains strong. |
| F-11 | LOCKED | `Preview confirmation (dev only)` is disabled in the captured ready seller flow because the shared readiness logic incorrectly treats explicit quantity uncertainty as incomplete; the button itself is not proven dead. This is the final-step manifestation of B-08/C-24. | After B-08/C-24 are fixed, a valid `Not sure` quantity state makes readiness true and enables the development preview. The preview must still be unavailable for genuinely invalid requests. |
| F-12 | VERIFY | Development confirmation content remains uncaptured because F-11 blocks entry. | After readiness correction, capture top, summary, disclaimer and actions; confirm unmistakable `no request was sent` copy and verify the control/screen are excluded from production. |
| F-13 | LOCKED | Draft lifecycle needs an explicit retention rule even though save/restore works. | Add a versioned draft with a reasonable expiry, clear it on dedicated discard/start-over and successful future backend submission, and fail safely when stored JSON/schema/version is invalid. Do not persist `File` objects or object URLs. |

## Final manual regression — behavior not provable from screenshots

Run this checklist only after the correction passes. Record `Pass` or the exact observed failure; screenshots are not required.

| ID | Status | Manual action | Pass condition |
|---|---|---|---|
| M-01 | VERIFY | With entered progress, press Escape. | Uses the same guarded close confirmation as the visible X; it does not silently lose work. |
| M-02 | VERIFY | With entered progress, click outside the overlay panel. | Uses the same guarded close confirmation as X/Escape. |
| M-03 | VERIFY | Open the masked quote overlay from the homepage, then press the browser Back button. | Returns to the prior homepage history entry without a blank page, wrong route or duplicate history jump. |
| M-04 | VERIFY | Scroll the homepage to a recognisable lower section, open quote, then close/back. | Homepage returns to the same approximate scroll position rather than jumping to the top. |
| M-05 | VERIFY | After closing quote, use Header Materials, About and Contact links. | Every anchor still scrolls to the correct homepage section. |
| M-06 | VERIFY | Note a visible Hero/ScrollStack state, open and close quote. | Homepage/GSAP state was never remounted or reset; animation remains stable and no duplicate/stuck animation appears. |
| M-07 | VERIFY | Upload two clearly different files, remove the second preview. | Only the selected file is removed; the first remains, count decrements and the correct object URL is revoked. |
| M-08 | VERIFY | Enter seller-only conditional data, switch to Buy, then inspect steps/review/WhatsApp; repeat with buyer-only data before switching to Sell. | Incompatible hidden values are cleared or excluded everywhere and never leak into the opposite branch. |
| M-09 | VERIFY | On Review, use each Edit action one by one. | Each opens its correct step, preserves compatible answers/files, and supports a predictable return to Review. |
| M-10 | VERIFY | Scroll Review downward, click an Edit action. | Target step opens at the top of its right-side scroller. |
| M-11 | VERIFY | Scroll a long step downward, then use Continue or Back. | Destination step opens at the top of the right-side scroller; outer frame/rail remain fixed. |
| M-12 | VERIFY | Open `http://localhost:8080/quote` directly and use X/close. | Navigates safely to `/`; no attempt is made to go back to a missing homepage history entry. |
| M-13 | VERIFY | Open quote through a homepage CTA so the displayed URL is masked as `/quote?...`, then close it. | Returns to the exact previous homepage history entry and preserves its scroll/state. |

## Locked implementation strategy

Do **not** send one uncontrolled giant change request. Finish the screenshot audit first, then implement from this ledger in bounded passes:

1. **Data, schema and branching logic** — validation, uncertainty, conditional values, persistence.
2. **Copy and option semantics** — labels, fallback grouping, summaries and WhatsApp text.
3. **Visual/state refinement** — rail states, hover/focus, spacing, fixed geometry.
4. **Regression pass** — seller and buyer happy paths, invalid paths, back/edit, draft restore, direct route and masked route.

Every pass must reference ledger IDs and report each ID as fixed, unchanged, blocked or not applicable. A final screenshot re-audit is required before an item moves from `LOCKED`/`VERIFY` to `PASS`.
