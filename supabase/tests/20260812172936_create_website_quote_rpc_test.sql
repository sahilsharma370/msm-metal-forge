-- Permanent pgTAP regression suite for
-- supabase/migrations/20260812172936_create_website_quote_rpc.sql
--
-- Run with: npx supabase test db --local
--
-- Everything runs inside a single transaction that is rolled back at the
-- end, so this file (like the two suites it extends) never leaves
-- persistent data behind.

create extension if not exists pgtap with schema extensions;

begin;

set search_path = public, extensions;

select plan(50);

-- ---------------------------------------------------------------------------
-- A. Structural existence and permissions
-- ---------------------------------------------------------------------------

select has_function(
  'public', 'create_website_quote_v1', array['uuid', 'text', 'jsonb', 'jsonb'],
  'function public.create_website_quote_v1(uuid, text, jsonb, jsonb) exists'
);
select ok(
  not has_function_privilege('anon', 'public.create_website_quote_v1(uuid, text, jsonb, jsonb)', 'EXECUTE'),
  'anon cannot execute create_website_quote_v1'
);
select ok(
  not has_function_privilege('authenticated', 'public.create_website_quote_v1(uuid, text, jsonb, jsonb)', 'EXECUTE'),
  'authenticated cannot execute create_website_quote_v1'
);
select ok(
  has_function_privilege('service_role', 'public.create_website_quote_v1(uuid, text, jsonb, jsonb)', 'EXECUTE'),
  'service_role can execute create_website_quote_v1'
);
select ok(
  (select prosecdef from pg_proc where oid = 'public.create_website_quote_v1(uuid, text, jsonb, jsonb)'::regprocedure) = false,
  'create_website_quote_v1 is SECURITY INVOKER, not SECURITY DEFINER'
);

-- ---------------------------------------------------------------------------
-- B. Valid seller with no files: one lead + one activity + zero slots
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select public.create_website_quote_v1(
       'd0000000-0000-0000-0000-000000000001'::uuid,
       encode(digest('rpc-seller-no-files', 'sha256'), 'hex'),
       '{
         "intent": "sell", "source": "hero", "material": "copper",
         "sellerCondition": "clean_separated", "sellerQuantityValue": "100", "sellerQuantityUnit": "kg",
         "sellerQuantityUnsure": false, "sellerEmirate": "dubai", "sellerArea": "Al Quoz Industrial 3",
         "sellerPickupRequired": "no", "sellerName": "Ahmed Seller", "sellerPhone": "+971501234567",
         "sellerPreferredContact": "whatsapp"
       }'::jsonb
     ) $$,
  'valid no-files seller submission succeeds'
);
select is(
  (select count(*)::int from public.leads where idempotency_key = 'd0000000-0000-0000-0000-000000000001'),
  1,
  'exactly one lead was created'
);
select ok(
  (select count(*) from public.lead_activities la join public.leads l on l.id = la.lead_id
    where l.idempotency_key = 'd0000000-0000-0000-0000-000000000001'
      and la.event_type = 'lead_created' and la.actor_type = 'system') = 1,
  'exactly one lead_created/system activity was created'
);
select is(
  (select count(*)::int from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
    where l.idempotency_key = 'd0000000-0000-0000-0000-000000000001'),
  0,
  'zero upload slots were created for a no-files submission'
);
select ok(
  (select reference from public.leads where idempotency_key = 'd0000000-0000-0000-0000-000000000001')
    ~ '^MSM-[0-9]{6}-[0-9A-F]{6}$',
  'the durably-stored reference matches the standard MSM-YYMMDD-XXXXXX format'
);

-- ---------------------------------------------------------------------------
-- C. Valid seller with photos maps all relevant seller fields
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select public.create_website_quote_v1(
       'd0000000-0000-0000-0000-000000000002'::uuid,
       encode(digest('rpc-seller-with-photos', 'sha256'), 'hex'),
       '{
         "intent": "sell", "source": "hero", "material": "other", "otherMaterialText": "Brass fittings mix",
         "sellerCondition": "mixed", "sellerQuantityValue": "250.5", "sellerQuantityUnit": "other",
         "sellerQuantityUnitOther": "drums", "sellerQuantityUnsure": false,
         "sellerDescription": "Assorted brass fittings from an old plumbing job",
         "sellerEmirate": "sharjah", "sellerArea": "Industrial Area 4",
         "sellerMapLink": "https://maps.google.com/?q=x",
         "sellerPickupRequired": "yes", "sellerPickupDate": "2026-09-01",
         "sellerAccessNote": "Gate code 4521, ask for Bilal",
         "sellerName": "Bilal Trader", "sellerPhone": "+971509876543", "sellerCompany": "Bilal Metals LLC",
         "sellerEmail": "bilal@example.com", "sellerPreferredContact": "email",
         "sellerNotes": "Available weekday mornings only"
       }'::jsonb,
       '[
         {"original_filename": "photo1.jpg", "declared_mime_type": "image/jpeg", "declared_byte_size": 1024},
         {"original_filename": "photo2.png", "declared_mime_type": "image/png", "declared_byte_size": 2048}
       ]'::jsonb
     ) $$,
  'valid seller submission with photos succeeds'
);
select ok(
  (select
     material = 'other' and material_other_text = 'Brass fittings mix' and material_subtype is null
     and seller_condition = 'mixed' and seller_quantity_value = 250.5
     and seller_quantity_unit = 'other' and seller_quantity_unit_other = 'drums'
     and seller_quantity_unsure = false
     and seller_description = 'Assorted brass fittings from an old plumbing job'
     and seller_emirate = 'sharjah' and seller_area = 'Industrial Area 4'
     and seller_map_link = 'https://maps.google.com/?q=x'
     and seller_pickup_required = 'yes' and seller_pickup_date = date '2026-09-01'
     and seller_access_note = 'Gate code 4521, ask for Bilal'
     and seller_name = 'Bilal Trader' and seller_phone = '+971509876543'
     and seller_company = 'Bilal Metals LLC' and seller_email = 'bilal@example.com'
     and seller_preferred_contact = 'email' and seller_notes = 'Available weekday mornings only'
     and capture_channel = 'website' and source = 'hero' and intent = 'sell'
   from public.leads where idempotency_key = 'd0000000-0000-0000-0000-000000000002'),
  'every mapped seller column matches the submitted value exactly'
);
select is(
  (select count(*)::int from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
    where l.idempotency_key = 'd0000000-0000-0000-0000-000000000002'),
  2,
  'two upload slots were created for the two declared photos'
);

-- ---------------------------------------------------------------------------
-- D. Valid buyer local maps all relevant local-route fields
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select public.create_website_quote_v1(
       'd0000000-0000-0000-0000-000000000003'::uuid,
       encode(digest('rpc-buyer-local', 'sha256'), 'hex'),
       '{
         "intent": "buy", "source": "materials", "material": "aluminium", "materialSpec": "Grade A extrusions only",
         "buyerQuantityValue": "500", "buyerQuantityUnit": "kg", "buyerTradeRequirement": "local",
         "buyerDestinationEmirate": "dubai", "buyerDestinationArea": "Business Bay area",
         "buyerDestinationMapLink": "https://maps.google.com/?q=y", "buyerFulfilment": "delivery",
         "buyerContactPerson": "Fatima Buyer", "buyerPhone": "+971502345678",
         "buyerCompany": "Fatima Trading", "buyerEmail": "fatima@example.com",
         "buyerPreferredContact": "email", "buyerNotes": "Call before delivery"
       }'::jsonb
     ) $$,
  'valid buyer local-route submission succeeds'
);
select ok(
  (select
     material = 'aluminium' and material_spec = 'Grade A extrusions only'
     and buyer_quantity_value = 500 and buyer_quantity_unit = 'kg' and buyer_trade_requirement = 'local'
     and buyer_destination_emirate = 'dubai' and buyer_destination_area = 'Business Bay area'
     and buyer_destination_map_link = 'https://maps.google.com/?q=y' and buyer_fulfilment = 'delivery'
     and buyer_contact_person = 'Fatima Buyer' and buyer_phone = '+971502345678'
     and buyer_company = 'Fatima Trading' and buyer_email = 'fatima@example.com'
     and buyer_preferred_contact = 'email' and buyer_notes = 'Call before delivery'
     and buyer_preferred_port is null and buyer_logistics_requirement is null
   from public.leads where idempotency_key = 'd0000000-0000-0000-0000-000000000003'),
  'every mapped buyer local-route column matches the submitted value exactly'
);

-- ---------------------------------------------------------------------------
-- E. Valid buyer import maps all relevant import-route fields
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select public.create_website_quote_v1(
       'd0000000-0000-0000-0000-000000000004'::uuid,
       encode(digest('rpc-buyer-import', 'sha256'), 'hex'),
       '{
         "intent": "buy", "source": "services", "material": "steel_iron",
         "buyerQuantityValue": "2", "buyerQuantityUnit": "tonnes", "buyerTradeRequirement": "import",
         "buyerDestinationEmirate": "abu_dhabi", "buyerLogisticsRequirement": "collection",
         "buyerPreferredPort": "jebel_ali", "buyerOriginCountryPreference": "India",
         "buyerContactPerson": "Omar Buyer", "buyerPhone": "+971503456789", "buyerPreferredContact": "call"
       }'::jsonb
     ) $$,
  'valid buyer import-route submission succeeds'
);
select ok(
  (select
     material = 'steel_iron' and buyer_quantity_value = 2 and buyer_quantity_unit = 'tonnes'
     and buyer_trade_requirement = 'import' and buyer_destination_emirate = 'abu_dhabi'
     and buyer_logistics_requirement = 'collection' and buyer_preferred_port = 'jebel_ali'
     and buyer_origin_country_preference = 'India'
     and buyer_contact_person = 'Omar Buyer' and buyer_phone = '+971503456789'
     and buyer_preferred_contact = 'call'
     and buyer_destination_area is null and buyer_fulfilment is null
     and buyer_destination_country is null and buyer_destination_city_port is null
   from public.leads where idempotency_key = 'd0000000-0000-0000-0000-000000000004'),
  'every mapped buyer import-route column matches the submitted value exactly'
);

-- ---------------------------------------------------------------------------
-- F. Valid buyer export maps all relevant export-route fields
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select public.create_website_quote_v1(
       'd0000000-0000-0000-0000-000000000005'::uuid,
       encode(digest('rpc-buyer-export', 'sha256'), 'hex'),
       '{
         "intent": "buy", "source": "header", "material": "lead",
         "buyerQuantityValue": "10", "buyerQuantityUnit": "load", "buyerTradeRequirement": "export",
         "buyerDestinationCountry": "India", "buyerDestinationCityPort": "Mumbai Port",
         "buyerLogisticsRequirement": "discuss", "buyerLogisticsNote": "Need a consolidated shipment",
         "buyerContactPerson": "Sara Buyer", "buyerPhone": "+971504567890", "buyerPreferredContact": "whatsapp"
       }'::jsonb
     ) $$,
  'valid buyer export-route submission succeeds'
);
select ok(
  (select
     material = 'lead' and buyer_quantity_value = 10 and buyer_quantity_unit = 'load'
     and buyer_trade_requirement = 'export'
     and buyer_destination_country = 'India' and buyer_destination_city_port = 'Mumbai Port'
     and buyer_logistics_requirement = 'discuss' and buyer_logistics_note = 'Need a consolidated shipment'
     and buyer_contact_person = 'Sara Buyer' and buyer_phone = '+971504567890'
     and buyer_preferred_contact = 'whatsapp'
     and buyer_destination_emirate is null and buyer_preferred_port is null
   from public.leads where idempotency_key = 'd0000000-0000-0000-0000-000000000005'),
  'every mapped buyer export-route column matches the submitted value exactly'
);

-- ---------------------------------------------------------------------------
-- G. Valid buyer documents create correctly ordered slots; kind/index/path
--    are entirely server-derived
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ select public.create_website_quote_v1(
       'd0000000-0000-0000-0000-000000000006'::uuid,
       encode(digest('rpc-buyer-documents', 'sha256'), 'hex'),
       '{
         "intent": "buy", "source": "materials", "material": "aluminium",
         "buyerQuantityValue": "500", "buyerQuantityUnit": "kg", "buyerTradeRequirement": "local",
         "buyerDestinationEmirate": "dubai", "buyerDestinationArea": "Business Bay area",
         "buyerFulfilment": "delivery",
         "buyerContactPerson": "Fatima Buyer", "buyerPhone": "+971502345678", "buyerPreferredContact": "whatsapp"
       }'::jsonb,
       '[
         {"original_filename": "invoice.pdf", "declared_mime_type": "application/pdf", "declared_byte_size": 4096},
         {"original_filename": "receipt.jpg", "declared_mime_type": "image/jpeg", "declared_byte_size": 1024},
         {"original_filename": "certificate.png", "declared_mime_type": "image/png", "declared_byte_size": 2048}
       ]'::jsonb
     ) $$,
  'valid buyer submission with three documents succeeds'
);
select ok(
  (select array_agg(qus.original_filename order by qus.slot_index)
    from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
    where l.idempotency_key = 'd0000000-0000-0000-0000-000000000006')
    = array['invoice.pdf', 'receipt.jpg', 'certificate.png'],
  'slot_index exactly preserves the input array order (derived from position, not caller-supplied)'
);
select ok(
  (select bool_and(qus.kind = 'buyer_document')
    from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
    where l.idempotency_key = 'd0000000-0000-0000-0000-000000000006'),
  'every slot kind was derived from the buy intent, never from caller input'
);
select ok(
  (select bool_and(qus.storage_path = 'leads/' || qus.lead_id::text || '/slot-' || qus.slot_index::text || '-' || qus.id::text)
    from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
    where l.idempotency_key = 'd0000000-0000-0000-0000-000000000006'),
  'every slot storage_path was generated by the existing trigger, never accepted from the caller'
);

-- ---------------------------------------------------------------------------
-- H. Idempotent replay: same key + same hash returns the same result and
--    creates no duplicates
-- ---------------------------------------------------------------------------

select ok(
  (select public.create_website_quote_v1(
     'd0000000-0000-0000-0000-000000000006'::uuid,
     encode(digest('rpc-buyer-documents', 'sha256'), 'hex'),
     '{"intent": "buy"}'::jsonb,
     '[{"original_filename": "irrelevant.jpg", "declared_mime_type": "image/jpeg", "declared_byte_size": 999}]'::jsonb
   ))
  = (select public.create_website_quote_v1(
     'd0000000-0000-0000-0000-000000000006'::uuid,
     encode(digest('rpc-buyer-documents', 'sha256'), 'hex'),
     '{"intent": "buy"}'::jsonb
   )),
  'a replay with the same key/hash returns the exact same lead_id/reference/idempotent_replay/upload_slots regardless of what (if anything) the caller resends'
);
select is(
  (select count(*)::int from public.leads where idempotency_key = 'd0000000-0000-0000-0000-000000000006'),
  1,
  'the replayed call created no duplicate lead'
);
select is(
  (select count(*)::int from public.lead_activities la join public.leads l on l.id = la.lead_id
    where l.idempotency_key = 'd0000000-0000-0000-0000-000000000006'),
  1,
  'the replayed call created no duplicate activity'
);
select is(
  (select count(*)::int from public.quote_upload_slots qus join public.leads l on l.id = qus.lead_id
    where l.idempotency_key = 'd0000000-0000-0000-0000-000000000006'),
  3,
  'the replayed call created no duplicate or additional upload slots'
);

-- ---------------------------------------------------------------------------
-- I. Same key + different hash fails
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.create_website_quote_v1(
       'd0000000-0000-0000-0000-000000000006'::uuid,
       encode(digest('a-completely-different-payload', 'sha256'), 'hex'),
       '{"intent": "buy"}'::jsonb
     ) $$,
  'P0001',
  NULL,
  'reusing an idempotency_key with a different payload_hash is rejected'
);

-- ---------------------------------------------------------------------------
-- J. File-array shape failures (all roll back cleanly — no partial rows)
-- ---------------------------------------------------------------------------

create temp table j_counts_before as
  select
    (select count(*) from public.leads) as leads_n,
    (select count(*) from public.lead_activities) as activities_n,
    (select count(*) from public.quote_upload_slots) as slots_n;

select throws_ok(
  $$ select public.create_website_quote_v1(
       'd0000000-0000-0000-0000-000000000007'::uuid,
       encode(digest('rpc-too-many-files', 'sha256'), 'hex'),
       '{"intent": "sell"}'::jsonb,
       '[
         {"original_filename": "a.jpg", "declared_mime_type": "image/jpeg", "declared_byte_size": 1},
         {"original_filename": "b.jpg", "declared_mime_type": "image/jpeg", "declared_byte_size": 1},
         {"original_filename": "c.jpg", "declared_mime_type": "image/jpeg", "declared_byte_size": 1},
         {"original_filename": "d.jpg", "declared_mime_type": "image/jpeg", "declared_byte_size": 1},
         {"original_filename": "e.jpg", "declared_mime_type": "image/jpeg", "declared_byte_size": 1},
         {"original_filename": "f.jpg", "declared_mime_type": "image/jpeg", "declared_byte_size": 1}
       ]'::jsonb
     ) $$,
  'P0001',
  NULL,
  'more than five file declarations is rejected'
);
select throws_ok(
  $$ select public.create_website_quote_v1(
       'd0000000-0000-0000-0000-000000000008'::uuid,
       encode(digest('rpc-files-not-array-object', 'sha256'), 'hex'),
       '{"intent": "sell"}'::jsonb,
       '{"not": "an array"}'::jsonb
     ) $$,
  'P0001',
  NULL,
  'a JSON object where files should be an array is rejected'
);
select throws_ok(
  $$ select public.create_website_quote_v1(
       'd0000000-0000-0000-0000-000000000009'::uuid,
       encode(digest('rpc-files-not-array-scalar', 'sha256'), 'hex'),
       '{"intent": "sell"}'::jsonb,
       '"not-an-array"'::jsonb
     ) $$,
  'P0001',
  NULL,
  'a JSON scalar where files should be an array is rejected'
);
select throws_ok(
  $$ select public.create_website_quote_v1(
       'd0000000-0000-0000-0000-00000000000a'::uuid,
       encode(digest('rpc-file-unknown-key', 'sha256'), 'hex'),
       '{"intent": "sell"}'::jsonb,
       '[{"original_filename": "x.jpg", "declared_mime_type": "image/jpeg", "declared_byte_size": 1024, "slot_index": 0}]'::jsonb
     ) $$,
  'P0001',
  NULL,
  'a file declaration carrying a caller-supplied slot_index (an unknown key) is rejected'
);
select throws_ok(
  $$ select public.create_website_quote_v1(
       'd0000000-0000-0000-0000-00000000000b'::uuid,
       encode(digest('rpc-file-storage-path-injection', 'sha256'), 'hex'),
       '{"intent": "sell"}'::jsonb,
       '[{"original_filename": "x.jpg", "declared_mime_type": "image/jpeg", "declared_byte_size": 1024, "storage_path": "leads/evil/path"}]'::jsonb
     ) $$,
  'P0001',
  NULL,
  'a file declaration carrying a caller-supplied storage_path (an unknown key) is rejected'
);

select ok(
  (select leads_n from j_counts_before) = (select count(*) from public.leads)
  and (select activities_n from j_counts_before) = (select count(*) from public.lead_activities)
  and (select slots_n from j_counts_before) = (select count(*) from public.quote_upload_slots),
  'none of the five file-shape failures above left behind any lead, activity or slot row'
);

-- ---------------------------------------------------------------------------
-- K. Invalid MIME/size/filename fails, and rolls back the lead too
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.create_website_quote_v1(
       'd0000000-0000-0000-0000-00000000000c'::uuid,
       encode(digest('rpc-bad-mime', 'sha256'), 'hex'),
       '{
         "intent": "sell", "source": "hero", "material": "copper",
         "sellerCondition": "clean_separated", "sellerQuantityValue": "100", "sellerQuantityUnit": "kg",
         "sellerQuantityUnsure": false, "sellerEmirate": "dubai", "sellerArea": "Al Quoz Industrial 3",
         "sellerPickupRequired": "no", "sellerName": "Ahmed Seller", "sellerPhone": "+971501234567",
         "sellerPreferredContact": "whatsapp"
       }'::jsonb,
       '[{"original_filename": "photo.gif", "declared_mime_type": "image/gif", "declared_byte_size": 1024}]'::jsonb
     ) $$,
  '23514',
  NULL,
  'a declared_mime_type outside the bucket allowlist fails at the quote_upload_slots CHECK'
);
select is(
  (select count(*)::int from public.leads where idempotency_key = 'd0000000-0000-0000-0000-00000000000c'),
  0,
  'the invalid-MIME failure rolled back the lead too — no partial row remains'
);

select throws_ok(
  $$ select public.create_website_quote_v1(
       'd0000000-0000-0000-0000-00000000000d'::uuid,
       encode(digest('rpc-bad-size', 'sha256'), 'hex'),
       '{
         "intent": "sell", "source": "hero", "material": "copper",
         "sellerCondition": "clean_separated", "sellerQuantityValue": "100", "sellerQuantityUnit": "kg",
         "sellerQuantityUnsure": false, "sellerEmirate": "dubai", "sellerArea": "Al Quoz Industrial 3",
         "sellerPickupRequired": "no", "sellerName": "Ahmed Seller", "sellerPhone": "+971501234567",
         "sellerPreferredContact": "whatsapp"
       }'::jsonb,
       '[{"original_filename": "photo.jpg", "declared_mime_type": "image/jpeg", "declared_byte_size": 8388609}]'::jsonb
     ) $$,
  '23514',
  NULL,
  'a declared_byte_size over 8 MiB fails at the quote_upload_slots CHECK'
);
select is(
  (select count(*)::int from public.leads where idempotency_key = 'd0000000-0000-0000-0000-00000000000d'),
  0,
  'the oversized-file failure rolled back the lead too — no partial row remains'
);

select throws_ok(
  $$ select public.create_website_quote_v1(
       'd0000000-0000-0000-0000-00000000000e'::uuid,
       encode(digest('rpc-bad-filename', 'sha256'), 'hex'),
       '{
         "intent": "sell", "source": "hero", "material": "copper",
         "sellerCondition": "clean_separated", "sellerQuantityValue": "100", "sellerQuantityUnit": "kg",
         "sellerQuantityUnsure": false, "sellerEmirate": "dubai", "sellerArea": "Al Quoz Industrial 3",
         "sellerPickupRequired": "no", "sellerName": "Ahmed Seller", "sellerPhone": "+971501234567",
         "sellerPreferredContact": "whatsapp"
       }'::jsonb,
       '[{"original_filename": "../../etc/passwd", "declared_mime_type": "image/jpeg", "declared_byte_size": 1024}]'::jsonb
     ) $$,
  '23514',
  NULL,
  'a path-traversal-shaped original_filename fails at the quote_upload_slots CHECK'
);
select is(
  (select count(*)::int from public.leads where idempotency_key = 'd0000000-0000-0000-0000-00000000000e'),
  0,
  'the invalid-filename failure rolled back the lead too — no partial row remains'
);

-- ---------------------------------------------------------------------------
-- L. Invalid branch/conditional payload fails
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.create_website_quote_v1(
       'd0000000-0000-0000-0000-00000000000f'::uuid,
       encode(digest('rpc-branch-violation', 'sha256'), 'hex'),
       '{
         "intent": "sell", "source": "hero", "material": "copper",
         "sellerCondition": "clean_separated", "sellerQuantityValue": "100", "sellerQuantityUnit": "kg",
         "sellerEmirate": "dubai", "sellerArea": "Al Quoz Industrial 3", "sellerPickupRequired": "no",
         "sellerName": "Ahmed Seller", "sellerPhone": "+971501234567", "sellerPreferredContact": "whatsapp",
         "buyerQuantityValue": "50"
       }'::jsonb
     ) $$,
  '23514',
  NULL,
  'a sell-intent submission carrying a buyer field fails leads_branch_field_isolation'
);
select throws_ok(
  $$ select public.create_website_quote_v1(
       'd0000000-0000-0000-0000-000000000010'::uuid,
       encode(digest('rpc-website-requiredness-violation', 'sha256'), 'hex'),
       '{"intent": "sell", "source": "hero", "material": "copper"}'::jsonb
     ) $$,
  '23514',
  NULL,
  'a website sell submission missing required fields fails leads_website_requiredness'
);

-- ---------------------------------------------------------------------------
-- M. Caller cannot inject server-managed fields or unexpected submission keys
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ select public.create_website_quote_v1(
       'd0000000-0000-0000-0000-000000000011'::uuid,
       encode(digest('rpc-inject-reference', 'sha256'), 'hex'),
       '{"intent": "sell", "reference": "MSM-000000-FFFFFF"}'::jsonb
     ) $$,
  'P0001',
  NULL,
  'a submission carrying a caller-supplied reference key is rejected'
);
select throws_ok(
  $$ select public.create_website_quote_v1(
       'd0000000-0000-0000-0000-000000000012'::uuid,
       encode(digest('rpc-inject-status', 'sha256'), 'hex'),
       '{"intent": "sell", "status": "completed"}'::jsonb
     ) $$,
  'P0001',
  NULL,
  'a submission carrying a caller-supplied status key is rejected'
);
select throws_ok(
  $$ select public.create_website_quote_v1(
       'd0000000-0000-0000-0000-000000000013'::uuid,
       encode(digest('rpc-inject-created-at', 'sha256'), 'hex'),
       '{"intent": "sell", "createdAt": "2020-01-01T00:00:00Z"}'::jsonb
     ) $$,
  'P0001',
  NULL,
  'a submission carrying a caller-supplied createdAt key is rejected'
);
select throws_ok(
  $$ select public.create_website_quote_v1(
       'd0000000-0000-0000-0000-000000000014'::uuid,
       encode(digest('rpc-unexpected-key', 'sha256'), 'hex'),
       '{"intent": "sell", "somethingUnexpected": "x"}'::jsonb
     ) $$,
  'P0001',
  NULL,
  'a submission carrying any wholly unexpected key is rejected'
);
select throws_ok(
  $$ select public.create_website_quote_v1(
       'd0000000-0000-0000-0000-000000000015'::uuid,
       encode(digest('rpc-submission-not-object', 'sha256'), 'hex'),
       '["not", "an", "object"]'::jsonb
     ) $$,
  'P0001',
  NULL,
  'a submission that is not a JSON object at all is rejected'
);
select throws_ok(
  $$ select public.create_website_quote_v1(
       'd0000000-0000-0000-0000-000000000016'::uuid,
       'not-a-valid-sha256-hash',
       '{"intent": "sell"}'::jsonb
     ) $$,
  'P0001',
  NULL,
  'a malformed payload_hash (not 64 lowercase hex characters) is rejected'
);

-- ---------------------------------------------------------------------------
-- N. Activity/slot failure rolls back the lead too — comprehensive check
-- ---------------------------------------------------------------------------

create temp table n_counts_before as
  select
    (select count(*) from public.leads) as leads_n,
    (select count(*) from public.lead_activities) as activities_n,
    (select count(*) from public.quote_upload_slots) as slots_n;

select throws_ok(
  $$ select public.create_website_quote_v1(
       'd0000000-0000-0000-0000-000000000017'::uuid,
       encode(digest('rpc-full-rollback-check', 'sha256'), 'hex'),
       '{
         "intent": "sell", "source": "hero", "material": "copper",
         "sellerCondition": "clean_separated", "sellerQuantityValue": "100", "sellerQuantityUnit": "kg",
         "sellerQuantityUnsure": false, "sellerEmirate": "dubai", "sellerArea": "Al Quoz Industrial 3",
         "sellerPickupRequired": "no", "sellerName": "Ahmed Seller", "sellerPhone": "+971501234567",
         "sellerPreferredContact": "whatsapp"
       }'::jsonb,
       '[{"original_filename": "bad.gif", "declared_mime_type": "image/gif", "declared_byte_size": 1024}]'::jsonb
     ) $$,
  '23514',
  NULL,
  'an otherwise-fully-valid lead submission still fails atomically when its one file declaration is invalid'
);
select ok(
  (select leads_n from n_counts_before) = (select count(*) from public.leads)
  and (select activities_n from n_counts_before) = (select count(*) from public.lead_activities)
  and (select slots_n from n_counts_before) = (select count(*) from public.quote_upload_slots),
  'the failed file insert rolled back the already-succeeded lead AND activity insert too — zero net rows of any kind'
);

select * from finish();

rollback;
