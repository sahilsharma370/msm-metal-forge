-- ---------------------------------------------------------------------------
-- Owner "Edit enquiry" — one new SECURITY INVOKER RPC, update_lead_details_v1,
-- following change_lead_status_v1's own established shape exactly (row
-- lock, RAISE EXCEPTION 'function_name: reason' for distinguishable
-- failures, jsonb_build_object for structured returns, revoke from
-- public / grant to service_role only, first-statement owner_accounts
-- recheck regardless of the caller's own verification).
--
-- No new table and no new column. leads.updated_at (already maintained by
-- the existing leads_set_updated_at trigger) is reused, unchanged, as the
-- optimistic-concurrency token — the caller's last-known value is passed as
-- p_expected_updated_at and a mismatch is rejected the same way
-- change_lead_status_v1 rejects a stale p_expected_status.
--
-- Editable field set (the ONE canonical shape for both seller and buyer
-- leads, browser-side too — see owner-lead-detail-contract.ts's
-- ownerLeadEditRequestSchema): contactName, contactPhone, material (+
-- materialOtherText when material = 'other'), quantityValue/quantityUnit
-- (+ quantityUnitOther when unit = 'other'), notes, and — seller branch
-- only — emirate/area. Buyer-branch destination location is deliberately
-- excluded, matching create_owner_quick_add_lead_v1's own established
-- precedent exactly (see 20260817213951_owner_quick_add_lead.sql's header
-- comment): every buyer destination field is gated behind
-- buyer_trade_requirement via leads_buyer_route_field_isolation, which this
-- checkpoint's edit form has no way to satisfy (trade requirement itself is
-- immutable here, not on the form) — forcing a route choice just to correct
-- a name or quantity is exactly the invented-requirement trap Quick Add's
-- own precedent already rejected.
--
-- material_subtype / material_subtype_other_text are not on the edit form
-- either, but a material-family change (e.g. copper -> aluminium) can leave
-- the lead's existing subtype invalid for the new family
-- (leads_material_subtype_family) — so this function clears both exactly
-- when the submitted material differs from the lead's current material,
-- and leaves them completely untouched otherwise. This is the same
-- "set/clear whatever a changing field requires to keep an existing
-- constraint satisfied" posture change_lead_status_v1 already established
-- for closed_at/lost_reason.
--
-- seller_quantity_unsure is likewise not on the form: whenever the owner
-- submits a real quantityValue, it is forced to false (a definite value and
-- "unsure" cannot both be true under leads_seller_quantity_unsure_clears_value);
-- when quantityValue is left blank, the lead's existing unsure flag is
-- preserved untouched.
--
-- Idempotent no-op: if, after validation, every submitted field equals the
-- lead's current value, nothing is updated and no activity row is inserted
-- — deterministic, matching change_lead_status_v1's own same-status no-op
-- precedent. Otherwise exactly one owner-attributed
-- lead_activities('lead_details_updated') row is inserted, with metadata
-- limited to the list of changed field LABELS only (never old/new values —
-- per this checkpoint's own "never duplicate sensitive values unnecessarily"
-- requirement).
-- ---------------------------------------------------------------------------

create or replace function public.update_lead_details_v1(
  p_lead_id uuid,
  p_owner_user_id uuid,
  p_expected_updated_at timestamptz,
  p_submission jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_lead public.leads%rowtype;
  v_contact_name text;
  v_contact_phone text;
  v_material text;
  v_material_other_text text;
  v_quantity_value numeric(12, 3);
  v_quantity_unit text;
  v_quantity_unit_other text;
  v_emirate text;
  v_area text;
  v_notes text;
  v_material_subtype text;
  v_material_subtype_other_text text;
  v_seller_quantity_unsure boolean;
  v_old_contact_name text;
  v_old_contact_phone text;
  v_old_notes text;
  v_old_quantity_value numeric(12, 3);
  v_old_quantity_unit text;
  v_old_quantity_unit_other text;
  v_changed_fields text[] := array[]::text[];
  v_activity_id uuid;
begin
  -- 1. Owner authorization — re-checked here regardless of the caller's own
  --    verification (see header comment).
  if not exists (
    select 1 from public.owner_accounts
    where user_id = p_owner_user_id and role = 'owner' and is_active = true
  ) then
    raise exception 'update_lead_details_v1: owner not authorized';
  end if;

  select * into v_lead from public.leads where id = p_lead_id for update;

  if not found then
    raise exception 'update_lead_details_v1: lead not found';
  end if;
  if v_lead.submission_completed_at is null then
    raise exception 'update_lead_details_v1: lead not found';
  end if;

  -- 2. Archived/trashed enquiries stay read-only until restored/reopened —
  --    a distinguishable failure, never silently accepted.
  if v_lead.deleted_at is not null then
    raise exception 'update_lead_details_v1: lead not editable';
  end if;
  if v_lead.status = 'archived' then
    raise exception 'update_lead_details_v1: lead not editable';
  end if;

  -- 3. Stale-update protection — leads.updated_at is the optimistic-
  --    concurrency token, exactly matching change_lead_status_v1's own use
  --    of the status column itself for the same purpose.
  if v_lead.updated_at is distinct from p_expected_updated_at then
    raise exception 'update_lead_details_v1: stale update';
  end if;

  -- 4. Submission shape: a JSON object containing only known keys, every
  --    one explicitly extracted by name below — never a dynamic passthrough.
  if jsonb_typeof(p_submission) is distinct from 'object' then
    raise exception 'update_lead_details_v1: submission must be a JSON object';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_submission) k
    where k not in (
      'contactName', 'contactPhone', 'material', 'materialOtherText',
      'quantityValue', 'quantityUnit', 'quantityUnitOther',
      'emirate', 'area', 'notes'
    )
  ) then
    raise exception 'update_lead_details_v1: submission contains an unexpected key';
  end if;

  v_contact_name := nullif(btrim(p_submission ->> 'contactName'), '');
  if v_contact_name is null then
    raise exception 'update_lead_details_v1: contact name required';
  end if;
  if length(v_contact_name) > 120 then
    raise exception 'update_lead_details_v1: contact name too long';
  end if;

  v_contact_phone := p_submission ->> 'contactPhone';
  if v_contact_phone is null or v_contact_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'update_lead_details_v1: invalid phone number';
  end if;

  v_material := p_submission ->> 'material';
  if v_material not in ('copper', 'aluminium', 'steel_iron', 'lead', 'other') then
    raise exception 'update_lead_details_v1: invalid material';
  end if;
  v_material_other_text := nullif(btrim(p_submission ->> 'materialOtherText'), '');
  if v_material = 'other' and v_material_other_text is null then
    raise exception 'update_lead_details_v1: material description required';
  end if;
  if v_material <> 'other' and v_material_other_text is not null then
    raise exception 'update_lead_details_v1: material description only valid when material is other';
  end if;
  if v_material_other_text is not null and length(v_material_other_text) > 200 then
    raise exception 'update_lead_details_v1: material description too long';
  end if;

  v_quantity_value := nullif(p_submission ->> 'quantityValue', '')::numeric(12, 3);
  if v_quantity_value is not null and v_quantity_value <= 0 then
    raise exception 'update_lead_details_v1: quantity must be positive';
  end if;
  v_quantity_unit := p_submission ->> 'quantityUnit';
  if v_quantity_unit is not null and v_quantity_unit not in ('kg', 'tonnes', 'pieces', 'load', 'other') then
    raise exception 'update_lead_details_v1: invalid quantity unit';
  end if;
  v_quantity_unit_other := nullif(btrim(p_submission ->> 'quantityUnitOther'), '');
  if v_quantity_unit = 'other' and v_quantity_unit_other is null then
    raise exception 'update_lead_details_v1: quantity unit description required';
  end if;
  if v_quantity_unit is distinct from 'other' and v_quantity_unit_other is not null then
    raise exception 'update_lead_details_v1: quantity unit description only valid when unit is other';
  end if;
  if v_quantity_unit_other is not null and length(v_quantity_unit_other) > 60 then
    raise exception 'update_lead_details_v1: quantity unit description too long';
  end if;

  v_emirate := p_submission ->> 'emirate';
  if v_emirate is not null and v_emirate not in (
    'abu_dhabi', 'dubai', 'sharjah', 'ajman', 'umm_al_quwain', 'ras_al_khaimah', 'fujairah'
  ) then
    raise exception 'update_lead_details_v1: invalid emirate';
  end if;
  v_area := nullif(btrim(p_submission ->> 'area'), '');
  if v_area is not null and length(v_area) > 150 then
    raise exception 'update_lead_details_v1: area too long';
  end if;
  if (v_emirate is not null or v_area is not null) and v_lead.intent <> 'sell' then
    raise exception 'update_lead_details_v1: location does not apply to a buyer enquiry';
  end if;

  v_notes := nullif(btrim(p_submission ->> 'notes'), '');
  if v_notes is not null and length(v_notes) > 2000 then
    raise exception 'update_lead_details_v1: notes too long';
  end if;

  -- A website-sourced sell lead's own leads_website_requiredness constraint
  -- requires seller_emirate/seller_area (>=2 chars) and, whenever a
  -- concrete quantity is on the row (not "unsure"), both
  -- seller_quantity_value AND seller_quantity_unit — all completeness the
  -- original public submission already satisfied. This form can null any
  -- of them out (emirate/area are plainly optional here; quantity has no
  -- "unsure" control at all), which would otherwise surface as a raw
  -- constraint-violation 500 at the UPDATE below. Caught here instead as a
  -- clear, sanitized validation failure — never a silent partial write.
  if v_lead.capture_channel = 'website' and v_lead.intent = 'sell' then
    if v_emirate is null then
      raise exception 'update_lead_details_v1: emirate required for a website-submitted enquiry';
    end if;
    if v_area is null or length(trim(v_area)) < 2 then
      raise exception 'update_lead_details_v1: area required for a website-submitted enquiry';
    end if;
    if not (v_lead.seller_quantity_unsure and v_quantity_value is null)
       and (v_quantity_value is null or v_quantity_unit is null)
    then
      raise exception 'update_lead_details_v1: quantity value and unit required for a website-submitted enquiry';
    end if;
  end if;

  -- material_subtype: not on the edit form — cleared exactly when the
  -- material family actually changes (see header comment), untouched
  -- otherwise.
  if v_material = v_lead.material then
    v_material_subtype := v_lead.material_subtype;
    v_material_subtype_other_text := v_lead.material_subtype_other_text;
  else
    v_material_subtype := null;
    v_material_subtype_other_text := null;
  end if;

  if v_lead.intent = 'sell' then
    v_old_contact_name := v_lead.seller_name;
    v_old_contact_phone := v_lead.seller_phone;
    v_old_notes := v_lead.seller_notes;
    v_old_quantity_value := v_lead.seller_quantity_value;
    v_old_quantity_unit := v_lead.seller_quantity_unit;
    v_old_quantity_unit_other := v_lead.seller_quantity_unit_other;
  else
    v_old_contact_name := v_lead.buyer_contact_person;
    v_old_contact_phone := v_lead.buyer_phone;
    v_old_notes := v_lead.buyer_notes;
    v_old_quantity_value := v_lead.buyer_quantity_value;
    v_old_quantity_unit := v_lead.buyer_quantity_unit;
    v_old_quantity_unit_other := v_lead.buyer_quantity_unit_other;
  end if;

  -- 5. Changed-field labels — computed before the write, compared against
  --    the branch-appropriate current columns. Never records old/new
  --    values, only which fields changed (see header comment).
  --
  --    array_append(...), never `v_changed_fields || 'Label'`: with a bare
  --    text-literal right-hand side, Postgres resolves `||` against the
  --    anyarray || anyarray overload before anyarray || anyelement and then
  --    tries to parse the literal itself as an array, raising
  --    'malformed array literal' (confirmed directly against this
  --    project's own local Postgres) — array_append is unambiguous.
  if v_contact_name is distinct from v_old_contact_name then
    v_changed_fields := array_append(v_changed_fields, 'Contact name');
  end if;
  if v_contact_phone is distinct from v_old_contact_phone then
    v_changed_fields := array_append(v_changed_fields, 'Phone number');
  end if;
  if v_material is distinct from v_lead.material or v_material_other_text is distinct from v_lead.material_other_text then
    v_changed_fields := array_append(v_changed_fields, 'Material');
  end if;
  if v_quantity_value is distinct from v_old_quantity_value
     or v_quantity_unit is distinct from v_old_quantity_unit
     or v_quantity_unit_other is distinct from v_old_quantity_unit_other
  then
    v_changed_fields := array_append(v_changed_fields, 'Quantity');
  end if;
  if v_lead.intent = 'sell' and v_emirate is distinct from v_lead.seller_emirate then
    v_changed_fields := array_append(v_changed_fields, 'Emirate');
  end if;
  if v_lead.intent = 'sell' and v_area is distinct from v_lead.seller_area then
    v_changed_fields := array_append(v_changed_fields, 'Area');
  end if;
  if v_notes is distinct from v_old_notes then
    v_changed_fields := array_append(v_changed_fields, 'Notes');
  end if;

  if array_length(v_changed_fields, 1) is null then
    -- Deterministic no-op — nothing actually changed. No UPDATE, no
    -- activity row, current state returned as-is.
    return jsonb_build_object('updated', false, 'updatedAt', v_lead.updated_at, 'changedFields', '[]'::jsonb);
  end if;

  if v_lead.intent = 'sell' then
    v_seller_quantity_unsure := case when v_quantity_value is not null then false else v_lead.seller_quantity_unsure end;

    update public.leads
    set
      material = v_material,
      material_other_text = v_material_other_text,
      material_subtype = v_material_subtype,
      material_subtype_other_text = v_material_subtype_other_text,
      seller_name = v_contact_name,
      seller_phone = v_contact_phone,
      seller_notes = v_notes,
      seller_quantity_value = v_quantity_value,
      seller_quantity_unit = v_quantity_unit,
      seller_quantity_unit_other = v_quantity_unit_other,
      seller_quantity_unsure = v_seller_quantity_unsure,
      seller_emirate = v_emirate,
      seller_area = v_area
    where id = p_lead_id;
  else
    update public.leads
    set
      material = v_material,
      material_other_text = v_material_other_text,
      material_subtype = v_material_subtype,
      material_subtype_other_text = v_material_subtype_other_text,
      buyer_contact_person = v_contact_name,
      buyer_phone = v_contact_phone,
      buyer_notes = v_notes,
      buyer_quantity_value = v_quantity_value,
      buyer_quantity_unit = v_quantity_unit,
      buyer_quantity_unit_other = v_quantity_unit_other
    where id = p_lead_id;
  end if;

  insert into public.owner_profiles (id) values (p_owner_user_id) on conflict (id) do nothing;

  insert into public.lead_activities (lead_id, actor_type, actor_owner_id, event_type, metadata)
  values (
    p_lead_id, 'owner', p_owner_user_id, 'lead_details_updated',
    jsonb_build_object('changedFields', to_jsonb(v_changed_fields))
  )
  returning id into v_activity_id;

  select * into v_lead from public.leads where id = p_lead_id;

  return jsonb_build_object(
    'updated', true,
    'updatedAt', v_lead.updated_at,
    'changedFields', to_jsonb(v_changed_fields),
    'activityId', v_activity_id
  );
end;
$$;

revoke execute on function public.update_lead_details_v1(uuid, uuid, timestamptz, jsonb) from public;
grant execute on function public.update_lead_details_v1(uuid, uuid, timestamptz, jsonb) to service_role;

comment on function public.update_lead_details_v1(uuid, uuid, timestamptz, jsonb) is
  'Rejects a p_owner_user_id without an active public.owner_accounts row '
  'before anything else. Locks the lead, treats a missing/incomplete lead '
  'as not found, rejects a trashed or archived lead as not editable, '
  'rejects a stale p_expected_updated_at as a conflict. Validates and '
  'writes contactName/contactPhone/material(+materialOtherText)/'
  'quantityValue+quantityUnit(+quantityUnitOther)/notes into the '
  'seller_*/buyer_* columns matching the lead''s own (immutable) intent, '
  'plus seller-only emirate/area. Clears material_subtype(+otherText) only '
  'when the material family actually changes; forces '
  'seller_quantity_unsure false only when a real quantity is submitted. '
  'No-ops deterministically when nothing actually changed (no UPDATE, no '
  'activity row), otherwise inserts exactly one owner-attributed '
  'lead_activities(''lead_details_updated'') row whose metadata lists '
  'changed field LABELS only, never old/new values. SECURITY INVOKER, '
  'service_role only.';
