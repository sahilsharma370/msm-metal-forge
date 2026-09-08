-- Permanent pgTAP regression suite for
-- supabase/migrations/20260811165757_create_quote_backend_foundation.sql
--
-- Run with: npx supabase test db --local
--
-- Everything runs inside a single transaction that is rolled back at the
-- end, so this file never leaves persistent data behind.

create extension if not exists pgtap with schema extensions;

begin;

set search_path = public, extensions;

select plan(97);

-- ---------------------------------------------------------------------------
-- A. Required tables, functions, sequence and triggers exist
-- ---------------------------------------------------------------------------

select has_table('public', 'leads', 'table public.leads exists');
select has_table('public', 'owner_profiles', 'table public.owner_profiles exists');
select has_table('public', 'lead_files', 'table public.lead_files exists');
select has_table('public', 'lead_activities', 'table public.lead_activities exists');
select has_table('public', 'notification_deliveries', 'table public.notification_deliveries exists');

select has_function('public', 'is_safe_json_object', 'function public.is_safe_json_object exists');
select has_function('public', 'set_updated_at', 'function public.set_updated_at exists');
select has_function('public', 'generate_lead_reference', 'function public.generate_lead_reference exists');
select has_function('public', 'leads_assign_reference', 'function public.leads_assign_reference exists');
select has_function('public', 'leads_prevent_immutable_field_changes', 'function public.leads_prevent_immutable_field_changes exists');

select has_sequence('public', 'leads_sequence_number_seq', 'sequence public.leads_sequence_number_seq exists');

select has_trigger('public', 'leads', 'leads_assign_reference', 'trigger leads_assign_reference exists on leads');
select has_trigger('public', 'leads', 'leads_immutable_core', 'trigger leads_immutable_core exists on leads');
select has_trigger('public', 'leads', 'leads_set_updated_at', 'trigger leads_set_updated_at exists on leads');
select has_trigger('public', 'owner_profiles', 'owner_profiles_set_updated_at', 'trigger owner_profiles_set_updated_at exists');
select has_trigger('public', 'lead_files', 'lead_files_set_updated_at', 'trigger lead_files_set_updated_at exists');
select has_trigger('public', 'notification_deliveries', 'notification_deliveries_set_updated_at', 'trigger notification_deliveries_set_updated_at exists');

-- ---------------------------------------------------------------------------
-- B. RLS enabled + forced on every business table
-- ---------------------------------------------------------------------------

select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.leads'::regclass),
  'RLS is enabled and forced on public.leads'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.owner_profiles'::regclass),
  'RLS is enabled and forced on public.owner_profiles'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.lead_files'::regclass),
  'RLS is enabled and forced on public.lead_files'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.lead_activities'::regclass),
  'RLS is enabled and forced on public.lead_activities'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.notification_deliveries'::regclass),
  'RLS is enabled and forced on public.notification_deliveries'
);

-- ---------------------------------------------------------------------------
-- C. anon / authenticated have no direct business-table access
-- ---------------------------------------------------------------------------

select ok(
  not has_table_privilege('anon', 'public.leads', 'SELECT')
  and not has_table_privilege('anon', 'public.leads', 'INSERT')
  and not has_table_privilege('anon', 'public.leads', 'UPDATE')
  and not has_table_privilege('anon', 'public.leads', 'DELETE'),
  'anon has no privileges on public.leads'
);
select ok(
  not has_table_privilege('anon', 'public.owner_profiles', 'SELECT')
  and not has_table_privilege('anon', 'public.owner_profiles', 'INSERT')
  and not has_table_privilege('anon', 'public.owner_profiles', 'UPDATE')
  and not has_table_privilege('anon', 'public.owner_profiles', 'DELETE'),
  'anon has no privileges on public.owner_profiles'
);
select ok(
  not has_table_privilege('anon', 'public.lead_files', 'SELECT')
  and not has_table_privilege('anon', 'public.lead_files', 'INSERT')
  and not has_table_privilege('anon', 'public.lead_files', 'UPDATE')
  and not has_table_privilege('anon', 'public.lead_files', 'DELETE'),
  'anon has no privileges on public.lead_files'
);
select ok(
  not has_table_privilege('anon', 'public.lead_activities', 'SELECT')
  and not has_table_privilege('anon', 'public.lead_activities', 'INSERT')
  and not has_table_privilege('anon', 'public.lead_activities', 'UPDATE')
  and not has_table_privilege('anon', 'public.lead_activities', 'DELETE'),
  'anon has no privileges on public.lead_activities'
);
select ok(
  not has_table_privilege('anon', 'public.notification_deliveries', 'SELECT')
  and not has_table_privilege('anon', 'public.notification_deliveries', 'INSERT')
  and not has_table_privilege('anon', 'public.notification_deliveries', 'UPDATE')
  and not has_table_privilege('anon', 'public.notification_deliveries', 'DELETE'),
  'anon has no privileges on public.notification_deliveries'
);

select ok(
  not has_table_privilege('authenticated', 'public.leads', 'SELECT')
  and not has_table_privilege('authenticated', 'public.leads', 'INSERT')
  and not has_table_privilege('authenticated', 'public.leads', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.leads', 'DELETE'),
  'authenticated has no privileges on public.leads'
);
select ok(
  not has_table_privilege('authenticated', 'public.owner_profiles', 'SELECT')
  and not has_table_privilege('authenticated', 'public.owner_profiles', 'INSERT')
  and not has_table_privilege('authenticated', 'public.owner_profiles', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.owner_profiles', 'DELETE'),
  'authenticated has no privileges on public.owner_profiles'
);
select ok(
  not has_table_privilege('authenticated', 'public.lead_files', 'SELECT')
  and not has_table_privilege('authenticated', 'public.lead_files', 'INSERT')
  and not has_table_privilege('authenticated', 'public.lead_files', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.lead_files', 'DELETE'),
  'authenticated has no privileges on public.lead_files'
);
select ok(
  not has_table_privilege('authenticated', 'public.lead_activities', 'SELECT')
  and not has_table_privilege('authenticated', 'public.lead_activities', 'INSERT')
  and not has_table_privilege('authenticated', 'public.lead_activities', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.lead_activities', 'DELETE'),
  'authenticated has no privileges on public.lead_activities'
);
select ok(
  not has_table_privilege('authenticated', 'public.notification_deliveries', 'SELECT')
  and not has_table_privilege('authenticated', 'public.notification_deliveries', 'INSERT')
  and not has_table_privilege('authenticated', 'public.notification_deliveries', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.notification_deliveries', 'DELETE'),
  'authenticated has no privileges on public.notification_deliveries'
);

-- ---------------------------------------------------------------------------
-- D. service_role has only the intended privileges (no more, no less)
-- ---------------------------------------------------------------------------

select ok(
  has_table_privilege('service_role', 'public.leads', 'SELECT')
  and has_table_privilege('service_role', 'public.leads', 'INSERT')
  and has_table_privilege('service_role', 'public.leads', 'UPDATE')
  and not has_table_privilege('service_role', 'public.leads', 'DELETE'),
  'service_role has exactly select/insert/update on public.leads (no delete)'
);
select ok(
  has_table_privilege('service_role', 'public.owner_profiles', 'SELECT')
  and has_table_privilege('service_role', 'public.owner_profiles', 'INSERT')
  and has_table_privilege('service_role', 'public.owner_profiles', 'UPDATE')
  and not has_table_privilege('service_role', 'public.owner_profiles', 'DELETE'),
  'service_role has exactly select/insert/update on public.owner_profiles (no delete)'
);
select ok(
  has_table_privilege('service_role', 'public.lead_files', 'SELECT')
  and has_table_privilege('service_role', 'public.lead_files', 'INSERT')
  and has_table_privilege('service_role', 'public.lead_files', 'UPDATE')
  and not has_table_privilege('service_role', 'public.lead_files', 'DELETE'),
  'service_role has exactly select/insert/update on public.lead_files (no delete)'
);
select ok(
  has_table_privilege('service_role', 'public.lead_activities', 'SELECT')
  and has_table_privilege('service_role', 'public.lead_activities', 'INSERT')
  and not has_table_privilege('service_role', 'public.lead_activities', 'UPDATE')
  and not has_table_privilege('service_role', 'public.lead_activities', 'DELETE'),
  'service_role has exactly select/insert (append-only, no update/delete) on public.lead_activities'
);
select ok(
  has_table_privilege('service_role', 'public.notification_deliveries', 'SELECT')
  and has_table_privilege('service_role', 'public.notification_deliveries', 'INSERT')
  and has_table_privilege('service_role', 'public.notification_deliveries', 'UPDATE')
  and not has_table_privilege('service_role', 'public.notification_deliveries', 'DELETE'),
  'service_role has exactly select/insert/update on public.notification_deliveries (no delete)'
);

select ok(
  not has_sequence_privilege('anon', 'public.leads_sequence_number_seq', 'USAGE')
  and not has_sequence_privilege('anon', 'public.leads_sequence_number_seq', 'SELECT'),
  'anon has no privileges on leads_sequence_number_seq'
);
select ok(
  not has_sequence_privilege('authenticated', 'public.leads_sequence_number_seq', 'USAGE')
  and not has_sequence_privilege('authenticated', 'public.leads_sequence_number_seq', 'SELECT'),
  'authenticated has no privileges on leads_sequence_number_seq'
);
select ok(
  has_sequence_privilege('service_role', 'public.leads_sequence_number_seq', 'USAGE')
  and has_sequence_privilege('service_role', 'public.leads_sequence_number_seq', 'SELECT')
  and not has_sequence_privilege('service_role', 'public.leads_sequence_number_seq', 'UPDATE'),
  'service_role has exactly usage/select (no update/setval) on leads_sequence_number_seq'
);

-- ---------------------------------------------------------------------------
-- E. Valid website seller lead succeeds
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ insert into public.leads (
       idempotency_key, payload_hash, intent, capture_channel, source,
       material, seller_condition, seller_quantity_value, seller_quantity_unit,
       seller_emirate, seller_area, seller_pickup_required, seller_name,
       seller_phone, seller_preferred_contact, submission_snapshot
     ) values (
       'a0000000-0000-0000-0000-000000000001',
       encode(digest('seller-website-valid', 'sha256'), 'hex'),
       'sell', 'website', 'hero',
       'copper', 'clean_separated', 100, 'kg',
       'dubai', 'Al Quoz Industrial 3', 'no', 'Ahmed Seller',
       '+971501234567', 'whatsapp', '{"channel":"quote_form"}'::jsonb
     ) $$,
  'valid website seller lead insert succeeds'
);
select ok(
  (select reference from public.leads where idempotency_key = 'a0000000-0000-0000-0000-000000000001')
    ~ '^MSM-[0-9]{6}-[0-9A-F]{6}$',
  'seller lead reference matches MSM-YYMMDD-XXXXXX format'
);

-- ---------------------------------------------------------------------------
-- F. Valid website buyer local / import / export branches succeed
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ insert into public.leads (
       idempotency_key, payload_hash, intent, capture_channel, source,
       material, buyer_quantity_value, buyer_quantity_unit, buyer_trade_requirement,
       buyer_contact_person, buyer_phone, buyer_preferred_contact,
       buyer_destination_emirate, buyer_destination_area, buyer_fulfilment,
       submission_snapshot
     ) values (
       'a0000000-0000-0000-0000-000000000002',
       encode(digest('buyer-local-valid', 'sha256'), 'hex'),
       'buy', 'website', 'materials',
       'aluminium', 500, 'kg', 'local',
       'Fatima Buyer', '+971502345678', 'whatsapp',
       'dubai', 'Business Bay area', 'delivery',
       '{"channel":"quote_form"}'::jsonb
     ) $$,
  'valid website buyer local-branch lead insert succeeds'
);
select is(
  (select buyer_fulfilment from public.leads where idempotency_key = 'a0000000-0000-0000-0000-000000000002'),
  'delivery',
  'buyer local-branch fulfilment persisted correctly'
);

select lives_ok(
  $$ insert into public.leads (
       idempotency_key, payload_hash, intent, capture_channel, source,
       material, buyer_quantity_value, buyer_quantity_unit, buyer_trade_requirement,
       buyer_contact_person, buyer_phone, buyer_preferred_contact,
       buyer_destination_emirate, buyer_logistics_requirement, buyer_preferred_port,
       submission_snapshot
     ) values (
       'a0000000-0000-0000-0000-000000000003',
       encode(digest('buyer-import-valid', 'sha256'), 'hex'),
       'buy', 'website', 'services',
       'steel_iron', 2, 'tonnes', 'import',
       'Omar Buyer', '+971503456789', 'call',
       'abu_dhabi', 'collection', 'jebel_ali',
       '{"channel":"quote_form"}'::jsonb
     ) $$,
  'valid website buyer import-branch lead insert succeeds'
);
select is(
  (select buyer_preferred_port from public.leads where idempotency_key = 'a0000000-0000-0000-0000-000000000003'),
  'jebel_ali',
  'buyer import-branch preferred_port persisted correctly'
);

select lives_ok(
  $$ insert into public.leads (
       idempotency_key, payload_hash, intent, capture_channel, source,
       material, buyer_quantity_value, buyer_quantity_unit, buyer_trade_requirement,
       buyer_contact_person, buyer_phone, buyer_preferred_contact,
       buyer_destination_country, buyer_destination_city_port, buyer_logistics_requirement,
       submission_snapshot
     ) values (
       'a0000000-0000-0000-0000-000000000004',
       encode(digest('buyer-export-valid', 'sha256'), 'hex'),
       'buy', 'website', 'header',
       'lead', 10, 'load', 'export',
       'Sara Buyer', '+971504567890', 'whatsapp',
       'India', 'Mumbai Port', 'discuss',
       '{"channel":"quote_form"}'::jsonb
     ) $$,
  'valid website buyer export-branch lead insert succeeds'
);
select is(
  (select buyer_destination_country from public.leads where idempotency_key = 'a0000000-0000-0000-0000-000000000004'),
  'India',
  'buyer export-branch destination_country persisted correctly'
);

-- ---------------------------------------------------------------------------
-- G. Invalid seller/buyer mixed-branch values fail
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.leads (
       idempotency_key, payload_hash, intent, capture_channel, source,
       material, seller_condition, seller_quantity_value, seller_quantity_unit,
       seller_emirate, seller_area, seller_pickup_required, seller_name,
       seller_phone, seller_preferred_contact, submission_snapshot,
       buyer_quantity_value
     ) values (
       'b0000000-0000-0000-0000-000000000001',
       encode(digest('seller-with-buyer-field', 'sha256'), 'hex'),
       'sell', 'website', 'hero',
       'copper', 'clean_separated', 100, 'kg',
       'dubai', 'Al Quoz Industrial 3', 'no', 'Ahmed Seller',
       '+971501234567', 'whatsapp', '{"channel":"quote_form"}'::jsonb,
       50
     ) $$,
  '23514',
  NULL,
  'sell-intent lead carrying a buyer field violates leads_branch_field_isolation'
);

select throws_ok(
  $$ insert into public.leads (
       idempotency_key, payload_hash, intent, capture_channel, source,
       material, buyer_quantity_value, buyer_quantity_unit, buyer_trade_requirement,
       buyer_contact_person, buyer_phone, buyer_preferred_contact,
       buyer_destination_emirate, buyer_destination_area, buyer_fulfilment,
       buyer_preferred_port, submission_snapshot
     ) values (
       'b0000000-0000-0000-0000-000000000002',
       encode(digest('buyer-local-with-port', 'sha256'), 'hex'),
       'buy', 'website', 'materials',
       'aluminium', 500, 'kg', 'local',
       'Fatima Buyer', '+971502345678', 'whatsapp',
       'dubai', 'Business Bay area', 'delivery',
       'jebel_ali', '{"channel":"quote_form"}'::jsonb
     ) $$,
  '23514',
  NULL,
  'local-route buyer lead carrying import-only field violates leads_buyer_route_field_isolation'
);

-- ---------------------------------------------------------------------------
-- H. Website required-field rules fail safely
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.leads (
       idempotency_key, payload_hash, intent, capture_channel, source,
       material, seller_condition, seller_quantity_value, seller_quantity_unit,
       seller_emirate, seller_area, seller_pickup_required,
       seller_phone, seller_preferred_contact, submission_snapshot
     ) values (
       'b0000000-0000-0000-0000-000000000003',
       encode(digest('seller-missing-name', 'sha256'), 'hex'),
       'sell', 'website', 'hero',
       'copper', 'clean_separated', 100, 'kg',
       'dubai', 'Al Quoz Industrial 3', 'no',
       '+971501234567', 'whatsapp', '{"channel":"quote_form"}'::jsonb
     ) $$,
  '23514',
  NULL,
  'website seller lead missing required seller_name fails leads_website_requiredness'
);

select throws_ok(
  $$ insert into public.leads (
       idempotency_key, payload_hash, intent, capture_channel, source,
       material, buyer_quantity_value, buyer_quantity_unit, buyer_trade_requirement,
       buyer_phone, buyer_preferred_contact,
       buyer_destination_emirate, buyer_destination_area, buyer_fulfilment,
       submission_snapshot
     ) values (
       'b0000000-0000-0000-0000-000000000004',
       encode(digest('buyer-missing-contact-person', 'sha256'), 'hex'),
       'buy', 'website', 'materials',
       'aluminium', 500, 'kg', 'local',
       '+971502345678', 'whatsapp',
       'dubai', 'Business Bay area', 'delivery',
       '{"channel":"quote_form"}'::jsonb
     ) $$,
  '23514',
  NULL,
  'website buyer lead missing required buyer_contact_person fails leads_website_requiredness'
);

-- ---------------------------------------------------------------------------
-- I. owner_manual/phone/whatsapp/walk_in incomplete leads can use needs_information
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ insert into public.leads (idempotency_key, payload_hash, intent, capture_channel, material, status, submission_snapshot)
     values ('a0000000-0000-0000-0000-000000000005', encode(digest('phone-1', 'sha256'), 'hex'), 'sell', 'phone', 'copper', 'needs_information', '{}'::jsonb) $$,
  'incomplete phone lead can use status needs_information'
);
select lives_ok(
  $$ insert into public.leads (idempotency_key, payload_hash, intent, capture_channel, material, status, submission_snapshot)
     values ('a0000000-0000-0000-0000-000000000006', encode(digest('whatsapp-1', 'sha256'), 'hex'), 'buy', 'whatsapp', 'aluminium', 'needs_information', '{}'::jsonb) $$,
  'incomplete whatsapp lead can use status needs_information'
);
select lives_ok(
  $$ insert into public.leads (idempotency_key, payload_hash, intent, capture_channel, material, status, submission_snapshot)
     values ('a0000000-0000-0000-0000-000000000007', encode(digest('walk-in-1', 'sha256'), 'hex'), 'sell', 'walk_in', 'steel_iron', 'needs_information', '{}'::jsonb) $$,
  'incomplete walk_in lead can use status needs_information'
);
select lives_ok(
  $$ insert into public.leads (idempotency_key, payload_hash, intent, capture_channel, material, status, submission_snapshot)
     values ('a0000000-0000-0000-0000-000000000008', encode(digest('owner-manual-1', 'sha256'), 'hex'), 'buy', 'owner_manual', 'lead', 'needs_information', '{}'::jsonb) $$,
  'incomplete owner_manual lead can use status needs_information'
);

-- ---------------------------------------------------------------------------
-- J. "other" material/unit fields require nonblank explanatory text (website)
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.leads (
       idempotency_key, payload_hash, intent, capture_channel, source,
       material, seller_condition, seller_quantity_value, seller_quantity_unit,
       seller_emirate, seller_area, seller_pickup_required, seller_name,
       seller_phone, seller_preferred_contact, submission_snapshot
     ) values (
       'b0000000-0000-0000-0000-000000000005',
       encode(digest('material-other-blank', 'sha256'), 'hex'),
       'sell', 'website', 'hero',
       'other', 'clean_separated', 100, 'kg',
       'dubai', 'Al Quoz Industrial 3', 'no', 'Ahmed Seller',
       '+971501234567', 'whatsapp', '{"channel":"quote_form"}'::jsonb
     ) $$,
  '23514',
  NULL,
  'website lead with material=other and blank material_other_text fails requiredness'
);
select lives_ok(
  $$ insert into public.leads (
       idempotency_key, payload_hash, intent, capture_channel, source,
       material, material_other_text, seller_condition, seller_quantity_value, seller_quantity_unit,
       seller_emirate, seller_area, seller_pickup_required, seller_name,
       seller_phone, seller_preferred_contact, submission_snapshot
     ) values (
       'a0000000-0000-0000-0000-000000000009',
       encode(digest('material-other-filled', 'sha256'), 'hex'),
       'sell', 'website', 'hero',
       'other', 'Brass fittings mix', 'clean_separated', 100, 'kg',
       'dubai', 'Al Quoz Industrial 3', 'no', 'Ahmed Seller',
       '+971501234567', 'whatsapp', '{"channel":"quote_form"}'::jsonb
     ) $$,
  'website lead with material=other and nonblank material_other_text succeeds'
);

select throws_ok(
  $$ insert into public.leads (
       idempotency_key, payload_hash, intent, capture_channel, source,
       material, seller_condition, seller_quantity_value, seller_quantity_unit,
       seller_emirate, seller_area, seller_pickup_required, seller_name,
       seller_phone, seller_preferred_contact, submission_snapshot
     ) values (
       'b0000000-0000-0000-0000-000000000006',
       encode(digest('seller-unit-other-blank', 'sha256'), 'hex'),
       'sell', 'website', 'hero',
       'copper', 'clean_separated', 100, 'other',
       'dubai', 'Al Quoz Industrial 3', 'no', 'Ahmed Seller',
       '+971501234567', 'whatsapp', '{"channel":"quote_form"}'::jsonb
     ) $$,
  '23514',
  NULL,
  'website seller lead with seller_quantity_unit=other and blank unit_other fails requiredness'
);

select throws_ok(
  $$ insert into public.leads (
       idempotency_key, payload_hash, intent, capture_channel, source,
       material, buyer_quantity_value, buyer_quantity_unit, buyer_trade_requirement,
       buyer_contact_person, buyer_phone, buyer_preferred_contact,
       buyer_destination_emirate, buyer_logistics_requirement, buyer_preferred_port,
       submission_snapshot
     ) values (
       'b0000000-0000-0000-0000-000000000007',
       encode(digest('buyer-port-other-blank', 'sha256'), 'hex'),
       'buy', 'website', 'services',
       'steel_iron', 2, 'tonnes', 'import',
       'Omar Buyer', '+971503456789', 'call',
       'abu_dhabi', 'collection', 'other',
       '{"channel":"quote_form"}'::jsonb
     ) $$,
  '23514',
  NULL,
  'website buyer import-branch with buyer_preferred_port=other and blank port_other fails requiredness'
);

-- ---------------------------------------------------------------------------
-- K. Reference generation format and uniqueness
-- ---------------------------------------------------------------------------

select ok(
  (select reference from public.leads where idempotency_key = 'a0000000-0000-0000-0000-000000000001')
    <> (select reference from public.leads where idempotency_key = 'a0000000-0000-0000-0000-000000000002'),
  'generated references are unique across distinct leads'
);

select lives_ok(
  $$ insert into public.leads (idempotency_key, payload_hash, intent, capture_channel, material, submission_snapshot, reference)
     values ('a0000000-0000-0000-0000-00000000000a', encode(digest('ref-overwrite', 'sha256'), 'hex'), 'sell', 'phone', 'copper', '{}'::jsonb, 'client-supplied-should-be-ignored') $$,
  'insert with client-supplied reference still succeeds (trigger overwrites it)'
);
select ok(
  (select reference from public.leads where idempotency_key = 'a0000000-0000-0000-0000-00000000000a') <> 'client-supplied-should-be-ignored'
  and (select reference from public.leads where idempotency_key = 'a0000000-0000-0000-0000-00000000000a') ~ '^MSM-[0-9]{6}-[0-9A-F]{6}$',
  'client-supplied reference is unconditionally overwritten by leads_assign_reference trigger'
);

-- ---------------------------------------------------------------------------
-- L. Idempotency key uniqueness
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ insert into public.leads (idempotency_key, payload_hash, intent, capture_channel, material, submission_snapshot)
     values ('a0000000-0000-0000-0000-000000000010', encode(digest('idem-1', 'sha256'), 'hex'), 'sell', 'phone', 'copper', '{}'::jsonb) $$,
  'first insert with a fresh idempotency_key succeeds'
);
select throws_ok(
  $$ insert into public.leads (idempotency_key, payload_hash, intent, capture_channel, material, submission_snapshot)
     values ('a0000000-0000-0000-0000-000000000010', encode(digest('idem-2', 'sha256'), 'hex'), 'buy', 'phone', 'aluminium', '{}'::jsonb) $$,
  '23505',
  NULL,
  'second insert reusing the same idempotency_key fails unique_violation'
);

-- ---------------------------------------------------------------------------
-- M. Immutable lead fields cannot be changed after creation
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ insert into public.leads (idempotency_key, payload_hash, intent, capture_channel, material, submission_snapshot)
     values ('a0000000-0000-0000-0000-00000000000c', encode(digest('immutable-test', 'sha256'), 'hex'), 'sell', 'phone', 'copper', '{}'::jsonb) $$,
  'base row for immutability tests inserts successfully'
);

select throws_ok(
  $$ update public.leads set id = gen_random_uuid() where idempotency_key = 'a0000000-0000-0000-0000-00000000000c' $$,
  'P0001',
  NULL,
  'updating leads.id after insert is rejected'
);
select throws_ok(
  $$ update public.leads set reference = 'MSM-000000-FFFFFF' where idempotency_key = 'a0000000-0000-0000-0000-00000000000c' $$,
  'P0001',
  NULL,
  'updating leads.reference after insert is rejected'
);
select throws_ok(
  $$ update public.leads set idempotency_key = gen_random_uuid() where idempotency_key = 'a0000000-0000-0000-0000-00000000000c' $$,
  'P0001',
  NULL,
  'updating leads.idempotency_key after insert is rejected'
);
select throws_ok(
  $$ update public.leads set payload_hash = encode(digest('changed', 'sha256'), 'hex') where idempotency_key = 'a0000000-0000-0000-0000-00000000000c' $$,
  'P0001',
  NULL,
  'updating leads.payload_hash after insert is rejected'
);
select throws_ok(
  $$ update public.leads set submission_snapshot = '{"changed":true}'::jsonb where idempotency_key = 'a0000000-0000-0000-0000-00000000000c' $$,
  'P0001',
  NULL,
  'updating leads.submission_snapshot after insert is rejected'
);
select throws_ok(
  $$ update public.leads set submission_schema_version = 2 where idempotency_key = 'a0000000-0000-0000-0000-00000000000c' $$,
  'P0001',
  NULL,
  'updating leads.submission_schema_version after insert is rejected'
);
select throws_ok(
  $$ update public.leads set created_at = now() - interval '1 day' where idempotency_key = 'a0000000-0000-0000-0000-00000000000c' $$,
  'P0001',
  NULL,
  'updating leads.created_at after insert is rejected'
);
select lives_ok(
  $$ update public.leads set status = 'contacted' where idempotency_key = 'a0000000-0000-0000-0000-00000000000c' $$,
  'updating a mutable field (status) after insert succeeds'
);

-- ---------------------------------------------------------------------------
-- N. Valid status updates work
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ update public.leads set status = 'inspection' where idempotency_key = 'a0000000-0000-0000-0000-00000000000c' $$,
  'status transition to inspection succeeds'
);
select lives_ok(
  $$ update public.leads set status = 'completed', closed_at = now() where idempotency_key = 'a0000000-0000-0000-0000-00000000000c' $$,
  'status transition to completed with closed_at succeeds'
);

-- ---------------------------------------------------------------------------
-- O. lost_reason and closed_at remain consistent with status
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ insert into public.leads (idempotency_key, payload_hash, intent, capture_channel, material, submission_snapshot)
     values ('a0000000-0000-0000-0000-00000000000e', encode(digest('lost-test', 'sha256'), 'hex'), 'sell', 'phone', 'copper', '{}'::jsonb) $$,
  'base row for lost_reason/closed_at tests inserts successfully'
);
select throws_ok(
  $$ update public.leads set status = 'lost' where idempotency_key = 'a0000000-0000-0000-0000-00000000000e' $$,
  '23514',
  NULL,
  'setting status=lost without lost_reason fails leads_lost_reason_matches_status'
);
select throws_ok(
  $$ update public.leads set status = 'completed', closed_at = null where idempotency_key = 'a0000000-0000-0000-0000-00000000000e' $$,
  '23514',
  NULL,
  'setting status=completed without closed_at fails leads_closed_at_matches_status'
);
select lives_ok(
  $$ update public.leads set status = 'lost', lost_reason = 'No longer needed', closed_at = now() where idempotency_key = 'a0000000-0000-0000-0000-00000000000e' $$,
  'setting status=lost with both lost_reason and closed_at succeeds'
);

-- ---------------------------------------------------------------------------
-- P. Child-table foreign keys and intended delete behavior
-- ---------------------------------------------------------------------------

select lives_ok(
  $$ insert into public.leads (idempotency_key, payload_hash, intent, capture_channel, material, submission_snapshot)
     values ('a0000000-0000-0000-0000-00000000000f', encode(digest('child-fk-test', 'sha256'), 'hex'), 'sell', 'phone', 'copper', '{}'::jsonb) $$,
  'parent lead for child-table FK tests inserts successfully'
);
select lives_ok(
  $$ insert into public.lead_files (lead_id, kind, storage_path, original_filename, detected_mime_type, byte_size)
     select id, 'seller_photo', 'leads/child-fk-test/photo1.jpg', 'photo1.jpg', 'image/jpeg', 1024
     from public.leads where idempotency_key = 'a0000000-0000-0000-0000-00000000000f' $$,
  'lead_files insert referencing a valid lead_id succeeds'
);
select lives_ok(
  $$ insert into public.lead_activities (lead_id, actor_type, event_type)
     select id, 'system', 'lead_created'
     from public.leads where idempotency_key = 'a0000000-0000-0000-0000-00000000000f' $$,
  'lead_activities insert referencing a valid lead_id succeeds'
);
select lives_ok(
  $$ insert into public.notification_deliveries (lead_id, event_type, channel)
     select id, 'submission_completed', 'email'
     from public.leads where idempotency_key = 'a0000000-0000-0000-0000-00000000000f' $$,
  'notification_deliveries insert referencing a valid lead_id succeeds'
);
select throws_ok(
  $$ insert into public.lead_files (lead_id, kind, storage_path, original_filename, detected_mime_type, byte_size)
     values ('00000000-0000-0000-0000-000000000000', 'seller_photo', 'leads/bogus/photo.jpg', 'photo.jpg', 'image/jpeg', 1024) $$,
  '23503',
  NULL,
  'lead_files insert referencing a nonexistent lead_id fails foreign_key_violation'
);
select lives_ok(
  $$ delete from public.leads where idempotency_key = 'a0000000-0000-0000-0000-00000000000f' $$,
  'deleting the parent lead succeeds'
);
select ok(
  (select count(*) from public.lead_files) = 0
  and (select count(*) from public.lead_activities) = 0
  and (select count(*) from public.notification_deliveries) = 0,
  'deleting the parent lead cascades to lead_files, lead_activities, and notification_deliveries'
);

-- ---------------------------------------------------------------------------
-- Q. Invalid JSON objects fail safely
-- ---------------------------------------------------------------------------

select ok(public.is_safe_json_object('{"a":1}'::jsonb), 'is_safe_json_object accepts a small plain object');
select ok(not public.is_safe_json_object('[1,2,3]'::jsonb), 'is_safe_json_object rejects a JSON array');
select ok(not public.is_safe_json_object(null), 'is_safe_json_object rejects null');
select ok(not public.is_safe_json_object('{"password":"leak"}'::jsonb), 'is_safe_json_object rejects a top-level dangerous key');
select ok(not public.is_safe_json_object('{"a":{"b":{"file":"x"}}}'::jsonb), 'is_safe_json_object rejects a nested dangerous key at any depth');
select ok(
  not public.is_safe_json_object(jsonb_build_object('ok', repeat('a', 70000))),
  'is_safe_json_object rejects a payload over the 64KB size cap'
);
select ok(
  not public.is_safe_json_object((select jsonb_object_agg('k' || g::text, g) from generate_series(1, 61) g)),
  'is_safe_json_object rejects an object with more than 60 keys'
);
select ok(
  public.is_safe_json_object((select jsonb_object_agg('k' || g::text, g) from generate_series(1, 60) g)),
  'is_safe_json_object accepts an object with exactly 60 keys'
);
select ok(not public.is_safe_json_object('{"bad key!":1}'::jsonb), 'is_safe_json_object rejects a malformed key name');

select throws_ok(
  $$ insert into public.leads (idempotency_key, payload_hash, intent, capture_channel, material, submission_snapshot)
     values ('a0000000-0000-0000-0000-000000000011', encode(digest('unsafe-snapshot', 'sha256'), 'hex'), 'sell', 'phone', 'copper', '{"password":"leak"}'::jsonb) $$,
  '23514',
  NULL,
  'lead insert with a dangerous-shaped submission_snapshot fails the is_safe_json_object check'
);

select * from finish();

rollback;
