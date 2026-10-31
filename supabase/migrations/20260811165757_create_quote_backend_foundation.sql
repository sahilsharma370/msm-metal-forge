-- MSM Scrap — Quote backend foundation
--
-- Scope (per the read-only data-contract/threat-model audit): leads,
-- lead_files, owner_profiles, lead_activities, notification_deliveries.
-- Explicitly NOT in scope: contacts, notes, follow-ups, quotations, Storage
-- buckets, authenticated-owner RLS policies, server endpoints, seed users.
--
-- Security posture: RLS is enabled (and FORCEd) on every table with ZERO
-- policies — this is intentional default-deny, not an oversight. Nothing is
-- reachable via anon/authenticated. Only service_role (the future secure
-- server) receives explicit, minimal, per-table GRANTs — RLS bypass alone is
-- never assumed to imply SQL privileges (service_role gets BYPASSRLS from
-- the platform, but table/column GRANTs are still enforced independently).
--
-- No hard-delete workflow: DELETE is not granted to service_role on any
-- table in this migration. Leads/files/profiles are archived via a status
-- or is_active flag, never removed. lead_activities and notification_deliveries
-- are additionally append-only (no UPDATE granted on lead_activities).
--
-- Timestamps are timestamptz throughout (Postgres always stores these as
-- UTC internally). The business timezone (Asia/Dubai) is only used inside
-- generate_lead_reference() to compute a Dubai-local calendar date for the
-- human-facing reference code — it never changes how timestamps are stored.

-- Explicit even though the platform's default project bootstrap already
-- grants this — "do not assume ... grant only required privileges
-- explicitly" applies here too. Schema-level USAGE on `public` for
-- anon/authenticated is deliberately left untouched: revoking it would be a
-- schema-wide change affecting objects entirely outside this migration's scope.
grant usage on schema public to service_role;

-- ---------------------------------------------------------------------------
-- Shared helper functions
-- ---------------------------------------------------------------------------

-- Generic "is this a small, safe JSON object" guard, reused by
-- leads.submission_snapshot and lead_activities.metadata. Deliberately
-- IMMUTABLE/pure (input-only, no table access) so it's safe to use inside a
-- CHECK constraint. This is a defense-in-depth backstop, NOT the primary
-- control: the primary control is that the server must construct these JSON
-- objects field-by-field from already-validated input (an explicit
-- allowlist), never passthrough an arbitrary client-supplied object. In
-- particular this function cannot know the full QuoteFormValues shape, so it
-- cannot catch every unexpected key — it only rejects the specific dangerous
-- shapes called out in the audit (embedded File-like blobs, browser-local
-- preview/object URLs, anything credential-shaped), at ANY nesting depth via
-- the `$.**` recursive jsonpath descent below, plus unbounded size/key-count/
-- key-shape at the top level.
--
-- Written as a CASE expression (not a flat AND-chain) so evaluation is
-- guaranteed to short-circuit: Postgres does NOT guarantee left-to-right
-- evaluation of a plain AND-chain when set-returning functions/subqueries
-- are involved, and jsonb_object_keys()/jsonb_each() raise an error when
-- called on a non-object jsonb value. CASE WHEN branches are guaranteed to
-- stop at the first matching branch, so the type check below always runs
-- before anything that would error on a non-object payload — a malformed
-- array/scalar/null payload safely returns false instead of raising.
create or replace function public.is_safe_json_object(payload jsonb)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when payload is null then false
    when jsonb_typeof(payload) is distinct from 'object' then false
    when pg_column_size(payload) > 65536 then false -- 64 KB cap
    when (select count(*) from jsonb_each(payload)) > 60 then false
    when exists (
      select 1 from jsonb_each(payload) as kv(key, value)
      where key !~ '^[a-zA-Z0-9_]{1,60}$'
    ) then false
    -- Recursive: `$.**` descends into every nested value (objects and
    -- arrays, any depth), so this also covers the root's own top-level
    -- keys. jsonb_path_exists runs in lax mode by default, which never
    -- raises on a structural mismatch (e.g. indexing into a scalar) — it
    -- just yields no match, so this stays safe for any shape.
    when
      jsonb_path_exists(payload, '$.**."file"')
      or jsonb_path_exists(payload, '$.**."files"')
      or jsonb_path_exists(payload, '$.**."sellerPhotos"')
      or jsonb_path_exists(payload, '$.**."buyerDocuments"')
      or jsonb_path_exists(payload, '$.**."previewUrl"')
      or jsonb_path_exists(payload, '$.**."preview_url"')
      or jsonb_path_exists(payload, '$.**."objectUrl"')
      or jsonb_path_exists(payload, '$.**."object_url"')
      or jsonb_path_exists(payload, '$.**."password"')
      or jsonb_path_exists(payload, '$.**."secret"')
      or jsonb_path_exists(payload, '$.**."token"')
      or jsonb_path_exists(payload, '$.**."apiKey"')
      or jsonb_path_exists(payload, '$.**."api_key"')
      or jsonb_path_exists(payload, '$.**."serviceRoleKey"')
      or jsonb_path_exists(payload, '$.**."service_role"')
      or jsonb_path_exists(payload, '$.**."authorization"')
    then false
    else true
  end
$$;

revoke execute on function public.is_safe_json_object(jsonb) from public;
grant execute on function public.is_safe_json_object(jsonb) to service_role;

comment on function public.is_safe_json_object(jsonb) is
  'Defense-in-depth shape guard for stored JSON blobs. Does not replace '
  'server-side construction of the JSON from already-validated fields.';

-- Shared updated_at maintenance trigger. SECURITY INVOKER (default) is
-- sufficient — it only ever touches the row already being written by the
-- caller's own UPDATE, so no privilege escalation is needed.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.set_updated_at() from public;
grant execute on function public.set_updated_at() to service_role;

-- Customer-facing lead reference generator: MSM-YYMMDD-XXXXXX, where YYMMDD
-- is the Asia/Dubai business date and XXXXXX is a random (non-sequential,
-- non-enumerable) 6-character hex suffix. Called exclusively from the
-- leads_assign_reference BEFORE INSERT trigger below — NOT a column
-- DEFAULT (a DEFAULT is skipped whenever the caller supplies its own value
-- for the column, which would let a client-supplied reference survive; a
-- BEFORE INSERT trigger unconditionally overwrites NEW.reference every
-- time, regardless of what was supplied). A small retry loop guards
-- against the (extremely unlikely) same-day suffix collision; the column's
-- own UNIQUE constraint remains the final authority if a collision somehow
-- still occurs (the INSERT will fail with unique_violation and the caller
-- is expected to retry the whole insert).
create or replace function public.generate_lead_reference()
returns text
language plpgsql
volatile
set search_path = pg_catalog, public
as $$
declare
  day_code text := to_char(now() at time zone 'Asia/Dubai', 'YYMMDD');
  candidate text;
  attempt int := 0;
begin
  loop
    candidate := 'MSM-' || day_code || '-' || upper(substr(md5(gen_random_uuid()::text), 1, 6));
    exit when not exists (select 1 from public.leads where reference = candidate);
    attempt := attempt + 1;
    if attempt >= 20 then
      -- Vanishingly unlikely (6 hex chars = 16.7M combinations per day); if it
      -- ever happens, fail loudly rather than loop forever or return a dud.
      raise exception 'generate_lead_reference: exhausted retry attempts';
    end if;
  end loop;
  return candidate;
end;
$$;

revoke execute on function public.generate_lead_reference() from public;
grant execute on function public.generate_lead_reference() to service_role;

comment on function public.generate_lead_reference() is
  'Server/DB-generated only. A client-supplied reference must never be '
  'accepted — this function is the single source of truth for the format.';

-- Unconditionally overwrites NEW.reference on every insert, regardless of
-- what (if anything) the caller supplied — this is what actually makes a
-- client-supplied reference unable to survive INSERT, not just discouraged
-- by convention. A plain column DEFAULT would NOT achieve this: DEFAULT is
-- only applied when the column is omitted from the INSERT's column list,
-- so an attacker (or a buggy server layer) that explicitly includes
-- `reference` in the INSERT would otherwise have their value accepted.
create or replace function public.leads_assign_reference()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.reference := public.generate_lead_reference();
  return new;
end;
$$;

revoke execute on function public.leads_assign_reference() from public;
grant execute on function public.leads_assign_reference() to service_role;

-- ---------------------------------------------------------------------------
-- leads
-- ---------------------------------------------------------------------------

create table public.leads (
  -- Identity ---------------------------------------------------------------
  id uuid primary key default gen_random_uuid(),
  -- Internal chronological ordering only — never expose to clients or use
  -- as a lookup key; use `reference` for anything customer-facing.
  sequence_number bigint generated always as identity unique,
  -- No DEFAULT here on purpose — reference is assigned unconditionally by
  -- the leads_assign_reference BEFORE INSERT trigger below, so a
  -- client-supplied value (even non-null) is always overwritten.
  reference text not null unique
    check (reference ~ '^MSM-[0-9]{6}-[0-9A-F]{6}$'),

  -- Idempotency / submission integrity --------------------------------------
  idempotency_key uuid not null unique,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  submission_schema_version smallint not null default 1
    check (submission_schema_version >= 1),

  -- Enquiry framing ----------------------------------------------------------
  intent text not null check (intent in ('sell', 'buy')),
  -- How this lead entered the system. 'website' is the existing Quote
  -- Experience flow; the other four support the future owner Quick Add path
  -- (phone/whatsapp/walk_in captured live, or a backfilled manual entry).
  capture_channel text not null default 'website'
    check (capture_channel in ('website', 'phone', 'whatsapp', 'walk_in', 'owner_manual')),
  -- Website CTA origin — required for website leads, must be null for every
  -- other channel (a phone/walk-in/manual lead has no CTA to attribute).
  -- See leads_source_matches_channel below.
  source text
    check (source in ('header', 'hero', 'final_cta', 'services', 'materials', 'direct')),

  -- Material (shared) --------------------------------------------------------
  material text not null
    check (material in ('copper', 'aluminium', 'steel_iron', 'lead', 'other')),
  -- Value set and material-family membership are enforced together by
  -- leads_material_subtype_family below (not here), so the two rules can
  -- never drift apart.
  material_subtype text,
  material_subtype_other_text text check (length(material_subtype_other_text) <= 200),
  material_other_text text check (length(material_other_text) <= 200),
  material_spec text check (length(material_spec) <= 300), -- buyer only

  -- Seller-branch fields -------------------------------------------------
  seller_quantity_value numeric(12, 3) check (seller_quantity_value is null or seller_quantity_value > 0),
  seller_quantity_unit text check (seller_quantity_unit in ('kg', 'tonnes', 'pieces', 'load', 'other')),
  seller_quantity_unit_other text check (length(seller_quantity_unit_other) <= 60),
  seller_quantity_unsure boolean not null default false,
  seller_condition text check (seller_condition in ('clean_separated', 'mixed', 'used_surplus', 'not_sure')),
  seller_description text check (length(seller_description) <= 2000),
  seller_emirate text check (seller_emirate in (
    'abu_dhabi', 'dubai', 'sharjah', 'ajman', 'umm_al_quwain', 'ras_al_khaimah', 'fujairah'
  )),
  seller_area text check (length(seller_area) <= 150),
  -- Server validation (canonical Google Maps host/path shape, per
  -- isValidMapLink in quote-schema.ts) is the primary control and happens
  -- before insert — this column's CHECK only enforces the http(s) shape as
  -- a backstop; it does not itself validate the domain. There is no
  -- separate verified flag: a non-null value here means the server already
  -- validated it.
  seller_map_link text check (seller_map_link is null or seller_map_link ~* '^https?://'),
  seller_pickup_required text check (seller_pickup_required in ('yes', 'no', 'not_sure')),
  seller_pickup_date date,
  seller_access_note text check (length(seller_access_note) <= 500),
  seller_name text check (length(seller_name) <= 120),
  seller_phone text check (seller_phone ~ '^\+[1-9][0-9]{7,14}$'), -- canonical E.164-style form only
  seller_company text check (length(seller_company) <= 150),
  seller_email text check (
    seller_email is null or (seller_email = lower(seller_email) and seller_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
  ),
  seller_preferred_contact text check (seller_preferred_contact in ('whatsapp', 'call', 'email')),
  seller_notes text check (length(seller_notes) <= 2000),

  -- Buyer-branch fields --------------------------------------------------
  buyer_quantity_value numeric(12, 3) check (buyer_quantity_value is null or buyer_quantity_value > 0),
  buyer_quantity_unit text check (buyer_quantity_unit in ('kg', 'tonnes', 'pieces', 'load', 'other')),
  buyer_quantity_unit_other text check (length(buyer_quantity_unit_other) <= 60),
  buyer_trade_requirement text check (buyer_trade_requirement in ('local', 'import', 'export')),
  buyer_required_by_date date,
  buyer_additional_spec text check (length(buyer_additional_spec) <= 2000),
  buyer_destination_emirate text check (buyer_destination_emirate in (
    'abu_dhabi', 'dubai', 'sharjah', 'ajman', 'umm_al_quwain', 'ras_al_khaimah', 'fujairah'
  )),
  buyer_destination_area text check (length(buyer_destination_area) <= 150),
  -- Same invariant as seller_map_link: server validation is primary and
  -- happens before insert; this CHECK only enforces the http(s) shape as a
  -- backstop, it does not itself validate the domain. No separate verified
  -- flag — non-null means already server-validated.
  buyer_destination_map_link text check (buyer_destination_map_link is null or buyer_destination_map_link ~* '^https?://'),
  buyer_fulfilment text check (buyer_fulfilment in ('delivery', 'collection', 'discuss')),
  buyer_destination_country text check (length(buyer_destination_country) <= 120),
  buyer_destination_city_port text check (length(buyer_destination_city_port) <= 120),
  buyer_preferred_port text check (buyer_preferred_port in ('jebel_ali', 'khalifa_port', 'other', 'no_preference')),
  buyer_preferred_port_other text check (length(buyer_preferred_port_other) <= 120),
  buyer_origin_country_preference text check (length(buyer_origin_country_preference) <= 120),
  buyer_logistics_requirement text check (buyer_logistics_requirement in ('delivery', 'collection', 'discuss')),
  buyer_logistics_note text check (length(buyer_logistics_note) <= 2000),
  buyer_company text check (length(buyer_company) <= 150),
  buyer_contact_person text check (length(buyer_contact_person) <= 120),
  buyer_phone text check (buyer_phone ~ '^\+[1-9][0-9]{7,14}$'),
  buyer_email text check (
    buyer_email is null or (buyer_email = lower(buyer_email) and buyer_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
  ),
  buyer_preferred_contact text check (buyer_preferred_contact in ('whatsapp', 'call', 'email')),
  buyer_notes text check (length(buyer_notes) <= 2000),

  -- Lifecycle ---------------------------------------------------------------
  -- Evolvable text+check rather than a Postgres enum (enum value changes
  -- require ALTER TYPE and are awkward to roll out; this set is expected to
  -- change as the owner dashboard is designed).
  status text not null default 'new'
    check (status in (
      'new', 'needs_information', 'contacted', 'inspection', 'quote_sent',
      'pickup_delivery', 'completed', 'lost', 'archived'
    )),
  -- Aggregate, lead-level view of file upload outcome — distinct from each
  -- individual lead_files.upload_status row. The server must set 'partial'
  -- whenever at least one file failed while others succeeded, and 'failed'
  -- only when every attempted file failed — never round up to 'complete'.
  file_upload_status text not null default 'none'
    check (file_upload_status in ('none', 'pending', 'complete', 'partial', 'failed')),
  -- Closure metadata — two-way tied to status, see
  -- leads_lost_reason_matches_status / leads_closed_at_matches_status.
  lost_reason text check (length(lost_reason) <= 300),
  closed_at timestamptz,

  -- Immutable original submission ------------------------------------------
  submission_snapshot jsonb not null
    check (public.is_safe_json_object(submission_snapshot)),

  -- Timestamps (UTC) ---------------------------------------------------------
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Cross-field integrity ----------------------------------------------------
  constraint leads_source_matches_channel check (
    (capture_channel = 'website' and source is not null)
    or (capture_channel <> 'website' and source is null)
  ),
  -- Branch isolation: mirrors the frontend's own SELLER_ONLY_FIELDS /
  -- BUYER_ONLY_FIELDS clearing behaviour (IntentStep.selectIntent) as a hard
  -- DB-level guarantee, not just a UI convention. Applies to every lead
  -- regardless of capture_channel — see leads_website_requiredness below
  -- for the separate, channel-gated *completeness* rules.
  constraint leads_branch_field_isolation check (
    (
      intent = 'sell'
      and buyer_quantity_value is null and buyer_quantity_unit is null and buyer_quantity_unit_other is null
      and buyer_trade_requirement is null and buyer_required_by_date is null and buyer_additional_spec is null
      and buyer_destination_emirate is null and buyer_destination_area is null and buyer_destination_map_link is null
      and buyer_fulfilment is null and buyer_destination_country is null and buyer_destination_city_port is null
      and buyer_preferred_port is null and buyer_preferred_port_other is null and buyer_origin_country_preference is null
      and buyer_logistics_requirement is null and buyer_logistics_note is null and buyer_company is null
      and buyer_contact_person is null and buyer_phone is null and buyer_email is null
      and buyer_preferred_contact is null and buyer_notes is null and material_spec is null
    )
    or
    (
      intent = 'buy'
      and seller_quantity_value is null and seller_quantity_unit is null and seller_quantity_unit_other is null
      and seller_quantity_unsure = false
      and seller_condition is null and seller_description is null and seller_emirate is null
      and seller_area is null and seller_map_link is null and seller_pickup_required is null
      and seller_pickup_date is null and seller_access_note is null and seller_name is null
      and seller_phone is null and seller_company is null and seller_email is null
      and seller_preferred_contact is null and seller_notes is null
    )
  ),
  -- Buyer trade-route isolation — the DB-layer guard against the audited
  -- buyerPreferredPortOther stale-state bug (frontend clears
  -- buyer_preferred_port on a route change away from "import" but not
  -- buyer_preferred_port_other; the frontend bug itself is NOT fixed here,
  -- but the server's active-branch normalizer MUST null out route-irrelevant
  -- fields before insert, and this constraint makes that mandatory rather
  -- than optional).
  --
  -- Per-route field ownership, matched exactly against LogisticsStep.tsx's
  -- three rendered branches:
  --   local:  destination emirate/area/map link + fulfilment
  --   import: destination emirate + preferred port/origin/logistics
  --   export: destination country/city + logistics
  -- buyer_destination_map_link is local-only in the frontend (the import and
  -- export branches never render that field) — the original version of this
  -- constraint missed nulling it for import/export, and missed nulling
  -- buyer_logistics_requirement/buyer_logistics_note for local (local uses
  -- buyer_fulfilment instead); both are corrected here.
  constraint leads_buyer_route_field_isolation check (
    (
      buyer_trade_requirement is null
      and buyer_destination_emirate is null and buyer_destination_area is null
      and buyer_destination_map_link is null and buyer_fulfilment is null
      and buyer_destination_country is null and buyer_destination_city_port is null
      and buyer_preferred_port is null and buyer_preferred_port_other is null
      and buyer_origin_country_preference is null
      and buyer_logistics_requirement is null and buyer_logistics_note is null
    )
    or (
      buyer_trade_requirement = 'local'
      and buyer_preferred_port is null and buyer_preferred_port_other is null
      and buyer_origin_country_preference is null
      and buyer_logistics_requirement is null and buyer_logistics_note is null
      and buyer_destination_country is null and buyer_destination_city_port is null
    )
    or (
      buyer_trade_requirement = 'import'
      and buyer_destination_area is null and buyer_destination_map_link is null and buyer_fulfilment is null
      and buyer_destination_country is null and buyer_destination_city_port is null
    )
    or (
      buyer_trade_requirement = 'export'
      and buyer_destination_area is null and buyer_destination_map_link is null and buyer_fulfilment is null
      and buyer_destination_emirate is null
      and buyer_preferred_port is null and buyer_preferred_port_other is null
      and buyer_origin_country_preference is null
    )
  ),
  constraint leads_material_other_text_requires_other check (
    material_other_text is null or material = 'other'
  ),
  -- Value set AND material-family membership in one place (replaces the
  -- earlier flat closed-set check, which allowed e.g. material='lead' with
  -- material_subtype='wire_cable' — a copper-only subtype). 'other' and
  -- 'not_sure' remain valid for every named family, matching
  -- MATERIAL_FAMILIES in quote-options.ts exactly. The 'other' material
  -- itself has no subtype family at all in the frontend (MaterialStep
  -- renders no subtype UI when family.subtypes.length === 0), so
  -- material_subtype must be null whenever material = 'other'.
  constraint leads_material_subtype_family check (
    material_subtype is null
    or (material = 'copper' and material_subtype in ('wire_cable', 'pipes_coils', 'radiators', 'sheets', 'other', 'not_sure'))
    or (material = 'aluminium' and material_subtype in ('profiles_frames', 'sheets_panels', 'cast_aluminium', 'aluminium_cable', 'other', 'not_sure'))
    or (material = 'steel_iron' and material_subtype in ('rebar_beams', 'plates_pipes', 'machinery_scrap', 'sheet_metal', 'other', 'not_sure'))
    or (material = 'lead' and material_subtype in ('sheets_pipes', 'cable_sheathing', 'wheel_weights', 'industrial_lead', 'other', 'not_sure'))
  ),
  constraint leads_material_subtype_other_requires_other check (
    material_subtype_other_text is null or material_subtype = 'other'
  ),
  constraint leads_seller_quantity_unit_other_requires_other check (
    seller_quantity_unit_other is null or seller_quantity_unit = 'other'
  ),
  constraint leads_buyer_quantity_unit_other_requires_other check (
    buyer_quantity_unit_other is null or buyer_quantity_unit = 'other'
  ),
  constraint leads_buyer_port_other_requires_other check (
    buyer_preferred_port_other is null or buyer_preferred_port = 'other'
  ),
  constraint leads_seller_quantity_unsure_clears_value check (
    not seller_quantity_unsure
    or (seller_quantity_value is null and seller_quantity_unit is null and seller_quantity_unit_other is null)
  ),
  constraint leads_seller_pickup_fields_require_yes check (
    (seller_pickup_date is null and seller_access_note is null) or seller_pickup_required = 'yes'
  ),
  -- Two-way: status = 'lost' REQUIRES a reason (not just permits one), and
  -- any other status REQUIRES no reason — no auto-generation here, the
  -- future server/dashboard must set/clear this atomically with status.
  constraint leads_lost_reason_matches_status check (
    (status = 'lost' and nullif(btrim(lost_reason), '') is not null)
    or (status <> 'lost' and lost_reason is null)
  ),
  -- Two-way: every closed status REQUIRES closed_at, every open status
  -- REQUIRES it to be null — same "DB enforces consistency, doesn't
  -- generate the value" stance as lost_reason above.
  constraint leads_closed_at_matches_status check (
    (status in ('completed', 'lost', 'archived') and closed_at is not null)
    or (status not in ('completed', 'lost', 'archived') and closed_at is null)
  ),
  -- Website completeness gate — re-derived field-by-field from the LOCKED
  -- frontend Continue-button schemas (quote-schema.ts): materialStepSchema,
  -- sellerDetailsStepSchema/buyerDetailsStepSchema,
  -- sellerLogisticsStepSchema/buyerLogisticsStepSchema (per buyer route),
  -- sellerContactStepSchema/buyerContactStepSchema. Nothing here is an
  -- invented requirement — every clause traces to an existing frontend
  -- `required`/superRefine rule. Deliberately NOT required, because the
  -- frontend never requires them either: company (either side), email
  -- unless preferred contact is "email", notes/descriptions, seller map
  -- link/pickup date/access note, buyer needed-by date/additional spec/
  -- logistics note/origin preference.
  --
  -- Gated on capture_channel = 'website' only — non-website/manual leads
  -- (future owner Quick Add) may be incomplete and can sit in
  -- status = 'needs_information' until an owner fills the rest in; this
  -- gate never applies to them, and it never weakens the unconditional
  -- branch-isolation constraints above (a Quick Add "buy" lead still can't
  -- carry seller fields, it just doesn't have to carry every buyer field yet).
  constraint leads_website_requiredness check (
    capture_channel <> 'website'
    or (
      (
        intent = 'sell'
        and seller_condition is not null
        and (seller_quantity_unsure or (seller_quantity_value is not null and seller_quantity_unit is not null))
        and seller_emirate is not null
        and seller_area is not null and length(trim(seller_area)) >= 2
        and seller_pickup_required is not null
        and seller_name is not null and length(trim(seller_name)) >= 1
        and seller_phone is not null
        and seller_preferred_contact is not null
        and (seller_preferred_contact <> 'email' or seller_email is not null)
        and (seller_quantity_unit <> 'other' or nullif(btrim(seller_quantity_unit_other), '') is not null)
        and (material <> 'other' or nullif(btrim(material_other_text), '') is not null)
        and (material_subtype <> 'other' or nullif(btrim(material_subtype_other_text), '') is not null)
      )
      or (
        intent = 'buy'
        and buyer_quantity_value is not null and buyer_quantity_unit is not null
        and buyer_trade_requirement is not null
        and buyer_contact_person is not null and length(trim(buyer_contact_person)) >= 1
        and buyer_phone is not null
        and buyer_preferred_contact is not null
        and (buyer_preferred_contact <> 'email' or buyer_email is not null)
        and (buyer_quantity_unit <> 'other' or nullif(btrim(buyer_quantity_unit_other), '') is not null)
        and (material <> 'other' or nullif(btrim(material_other_text), '') is not null)
        and (material_subtype <> 'other' or nullif(btrim(material_subtype_other_text), '') is not null)
        and (
          (
            buyer_trade_requirement = 'local'
            and buyer_destination_emirate is not null
            and buyer_destination_area is not null and length(trim(buyer_destination_area)) >= 2
            and buyer_fulfilment is not null
          )
          or (
            buyer_trade_requirement = 'import'
            and buyer_destination_emirate is not null
            and buyer_logistics_requirement is not null
            and (buyer_preferred_port <> 'other' or nullif(btrim(buyer_preferred_port_other), '') is not null)
          )
          or (
            buyer_trade_requirement = 'export'
            and buyer_destination_country is not null and length(trim(buyer_destination_country)) >= 2
            and buyer_destination_city_port is not null and length(trim(buyer_destination_city_port)) >= 2
            and buyer_logistics_requirement is not null
          )
        )
      )
    )
  )
);

alter table public.leads enable row level security;
alter table public.leads force row level security;

comment on table public.leads is
  'One row per lead — either a website Quote Experience submission '
  '(capture_channel = ''website'') or an owner Quick Add entry (phone/'
  'whatsapp/walk-in/manual). submission_snapshot is the immutable original '
  'answer set (website leads only in practice); the structured columns are '
  'a derived, active-branch-normalized view for search/filter. No '
  'hard-delete: use status = ''archived'' instead.';
comment on column public.leads.reference is
  'Customer-facing identifier. Random suffix, not sequential/enumerable, '
  'unconditionally assigned by the leads_assign_reference BEFORE INSERT '
  'trigger (see generate_lead_reference()) — never a plain column default, '
  'so a client-supplied value cannot survive INSERT.';
comment on column public.leads.idempotency_key is
  'One key per submission attempt from the client. A future server should: '
  'same key + same payload_hash -> return the existing reference; same key '
  '+ different payload_hash -> reject as a conflict. Never overwrite a row '
  'on idempotency replay (enforced by the leads_immutable_core trigger below).';
comment on column public.leads.submission_snapshot is
  'Immutable original submission, sanitized and validated at write time '
  '(see is_safe_json_object). Must exclude File objects, previewUrl/'
  'objectUrl blob-URLs and anything secret-shaped.';

-- Idempotency conflicts must never overwrite a lead: the core identity and
-- submission-integrity columns are immutable after insert. Status/timestamps
-- and structured business columns may still be updated by later workflow.
create or replace function public.leads_prevent_immutable_field_changes()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.id is distinct from old.id
    or new.reference is distinct from old.reference
    or new.idempotency_key is distinct from old.idempotency_key
    or new.payload_hash is distinct from old.payload_hash
    or new.submission_snapshot is distinct from old.submission_snapshot
    or new.submission_schema_version is distinct from old.submission_schema_version
    or new.created_at is distinct from old.created_at
  then
    raise exception 'leads: id, reference, idempotency_key, payload_hash, submission_snapshot, submission_schema_version and created_at are immutable after insert';
  end if;
  return new;
end;
$$;

revoke execute on function public.leads_prevent_immutable_field_changes() from public;
grant execute on function public.leads_prevent_immutable_field_changes() to service_role;

create trigger leads_assign_reference
  before insert on public.leads
  for each row
  execute function public.leads_assign_reference();

create trigger leads_immutable_core
  before update on public.leads
  for each row
  execute function public.leads_prevent_immutable_field_changes();

create trigger leads_set_updated_at
  before update on public.leads
  for each row
  execute function public.set_updated_at();

revoke all on public.leads from public, anon, authenticated;
grant select, insert, update on public.leads to service_role;
-- No delete grant anywhere, by design — see "no hard-delete workflow" above.

-- Identity-sequence privilege decision (explicit, not assumed): Postgres
-- tracks sequence privileges (USAGE/SELECT/UPDATE) independently of the
-- owning table's privileges — a role's UPDATE on public.leads does NOT
-- imply UPDATE on this sequence, and vice versa. UPDATE on a sequence
-- grants setval(), which this migration has no use for: service_role only
-- ever needs to read the current value (SELECT) and consume nextval() via
-- the identity column's own insert path (USAGE). Least privilege therefore
-- means USAGE + SELECT only, with UPDATE explicitly revoked from every
-- role including service_role, not retained on the assumption that it's
-- harmless or table-inherited.
revoke all on sequence public.leads_sequence_number_seq
  from public, anon, authenticated, service_role;
grant usage, select on sequence public.leads_sequence_number_seq to service_role;

create index leads_created_at_idx on public.leads (created_at desc);
create index leads_status_idx on public.leads (status);
create index leads_intent_idx on public.leads (intent);
create index leads_material_idx on public.leads (material);
create index leads_seller_phone_idx on public.leads (seller_phone) where seller_phone is not null;
create index leads_buyer_phone_idx on public.leads (buyer_phone) where buyer_phone is not null;
-- Supports an owner-dashboard "open leads needing attention, oldest first"
-- view without scanning archived/closed leads.
create index leads_open_dashboard_idx on public.leads (status, created_at)
  where status not in ('completed', 'lost', 'archived');
-- `reference` and `idempotency_key` already have an implicit unique btree
-- index from their UNIQUE constraints above — no separate index needed.

-- ---------------------------------------------------------------------------
-- owner_profiles
-- ---------------------------------------------------------------------------

create table public.owner_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'staff')),
  is_active boolean not null default true,
  display_name text check (length(display_name) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.owner_profiles enable row level security;
alter table public.owner_profiles force row level security;

comment on table public.owner_profiles is
  'Maps a Supabase Auth user to an MSM owner/staff identity. No '
  'owner-facing RLS policies yet (deliberately deferred) — only '
  'service_role can read/write this table in this migration. '
  'Deactivate via is_active = false; never hard-delete.';

create trigger owner_profiles_set_updated_at
  before update on public.owner_profiles
  for each row
  execute function public.set_updated_at();

revoke all on public.owner_profiles from public, anon, authenticated;
grant select, insert, update on public.owner_profiles to service_role;

-- ---------------------------------------------------------------------------
-- lead_files
-- ---------------------------------------------------------------------------

create table public.lead_files (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  kind text not null check (kind in ('seller_photo', 'buyer_document', 'owner_attachment')),

  -- Storage reference only — never a File object, blob/object URL, or a
  -- signed URL (signed URLs are minted on demand at read time, not stored).
  -- Unique: two lead_files rows must never point at the same object.
  storage_path text not null unique
    check (length(storage_path) between 1 and 500 and storage_path !~* '^https?://'),
  -- Path traversal / control-character guard, written with strpos()/chr()
  -- rather than a backslash-in-bracket-expression regex to avoid any
  -- ambiguity from standard_conforming_strings escaping rules.
  original_filename text not null
    check (
      length(original_filename) between 1 and 255
      and original_filename !~ '[[:cntrl:]]'
      and strpos(original_filename, '/') = 0
      and strpos(original_filename, chr(92)) = 0
    ),
  -- Server-detected (magic-number sniffed) MIME type, never the
  -- client-declared File.type. Matches the frontend's accepted-type set
  -- (QuotePhotoPicker.ACCEPTED_TYPES_WITH_PDF); PDF is buyer-document only,
  -- matching the frontend's allowPdf flag being buyer-only.
  detected_mime_type text not null
    check (detected_mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  byte_size bigint not null check (byte_size > 0 and byte_size <= 8388608), -- matches MAX_FILE_SIZE_BYTES (8 MB)
  checksum_sha256 text check (checksum_sha256 ~ '^[0-9a-f]{64}$'),

  upload_status text not null default 'pending' check (upload_status in ('pending', 'complete', 'failed')),
  uploaded_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint lead_files_pdf_requires_buyer_document check (
    detected_mime_type <> 'application/pdf' or kind = 'buyer_document'
  ),
  -- A failed or still-pending upload must never be silently reported as
  -- complete: 'complete' requires both a checksum and an upload timestamp;
  -- 'pending'/'failed' must NOT carry an upload timestamp (they never
  -- finished). This is the single source of truth for what each
  -- upload_status value means — no other combination is valid.
  constraint lead_files_status_consistency check (
    (upload_status = 'complete' and checksum_sha256 is not null and uploaded_at is not null)
    or (upload_status in ('pending', 'failed') and uploaded_at is null)
  )
);

alter table public.lead_files enable row level security;
alter table public.lead_files force row level security;

comment on table public.lead_files is
  'Storage metadata only — private bucket path, never a public URL. No '
  'public read/write access; files are served via short-lived signed URLs '
  'minted server-side (Storage bucket itself is out of scope for this migration).';
comment on column public.lead_files.storage_path is
  'Private bucket-relative path. The check that this is not an http(s) URL '
  'is a guard against accidentally storing a public link instead of a path.';

create trigger lead_files_set_updated_at
  before update on public.lead_files
  for each row
  execute function public.set_updated_at();

revoke all on public.lead_files from public, anon, authenticated;
grant select, insert, update on public.lead_files to service_role;
-- No delete grant here either. A future orphaned-upload cleanup job will
-- need a narrowly scoped delete path (e.g. a dedicated function or role) —
-- deliberately not designed in this migration; see report for this
-- open concern.

create index lead_files_lead_id_idx on public.lead_files (lead_id);
create index lead_files_kind_idx on public.lead_files (kind);

-- ---------------------------------------------------------------------------
-- lead_activities (append-only)
-- ---------------------------------------------------------------------------

create table public.lead_activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  actor_type text not null check (actor_type in ('system', 'owner')),
  actor_owner_id uuid references public.owner_profiles (id),
  event_type text not null check (length(event_type) between 1 and 60 and event_type ~ '^[a-z0-9_]+$'),
  metadata jsonb not null default '{}'::jsonb check (public.is_safe_json_object(metadata)),
  created_at timestamptz not null default now(),

  constraint lead_activities_actor_consistency check (
    (actor_type = 'owner' and actor_owner_id is not null)
    or (actor_type = 'system' and actor_owner_id is null)
  )
);

alter table public.lead_activities enable row level security;
alter table public.lead_activities force row level security;

comment on table public.lead_activities is
  'Append-only audit/timeline log. No UPDATE or DELETE is granted to '
  'service_role (or anyone else) in this migration — owners must not later '
  'rewrite or delete historical events; this is enforced at the SQL '
  'privilege layer, not just left as a convention.';

revoke all on public.lead_activities from public, anon, authenticated;
grant select, insert on public.lead_activities to service_role;
-- Deliberately no update/delete grant — see table comment.

create index lead_activities_lead_id_created_at_idx on public.lead_activities (lead_id, created_at);

-- ---------------------------------------------------------------------------
-- notification_deliveries
-- ---------------------------------------------------------------------------

create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  channel text not null check (channel in ('email', 'whatsapp', 'sms')),
  -- Deliberately NOT the full recipient address/number. The actual
  -- notification recipient (MSM owner/staff) is resolved from secure
  -- server configuration / owner settings, not from the related customer
  -- lead — the lead's own contact fields are the customer's details, not
  -- who gets notified. This is a minimal, non-PII-duplicating hint only
  -- (e.g. a masked form), per the audit's "don't duplicate full
  -- recipient PII" guidance.
  recipient_hint text check (length(recipient_hint) <= 120),
  status text not null default 'queued'
    check (status in ('queued', 'sent', 'delivered', 'failed', 'bounced')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  provider_message_id text check (length(provider_message_id) <= 200),
  -- Bounded length and a best-effort screen against obviously-leaked secret
  -- material. This is NOT a guarantee of secret-free content — the server
  -- must never write raw exception messages containing credentials/keys
  -- into this column in the first place.
  last_error text check (
    length(last_error) <= 500
    and last_error !~* '(service_role|secret|api[_-]?key|bearer\s)'
  ),
  last_attempted_at timestamptz,
  -- When the next retry should be attempted (queued/failed only in
  -- practice; the server owns that logic, not a DB constraint here).
  next_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.notification_deliveries enable row level security;
alter table public.notification_deliveries force row level security;

comment on table public.notification_deliveries is
  'Outbound owner-notification delivery attempts (email/WhatsApp/SMS to '
  'MSM staff about a lead) — not the customer-facing WhatsApp deep link, '
  'which remains fully client-side and needs no backend record.';

create trigger notification_deliveries_set_updated_at
  before update on public.notification_deliveries
  for each row
  execute function public.set_updated_at();

revoke all on public.notification_deliveries from public, anon, authenticated;
grant select, insert, update on public.notification_deliveries to service_role;
-- No delete grant — retains the delivery/audit trail.

create index notification_deliveries_lead_id_idx on public.notification_deliveries (lead_id);
-- 'sent' and 'delivered' are the two success states; queued/failed/bounced
-- all still need attention (retry, investigation, or a bounce follow-up).
create index notification_deliveries_needs_attention_idx on public.notification_deliveries (status)
  where status not in ('sent', 'delivered');
