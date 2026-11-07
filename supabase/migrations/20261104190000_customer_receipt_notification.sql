-- MSM Scrap — customer enquiry receipt: a second, independently-deduplicated
-- notification_deliveries event_type, queued in the SAME transaction as the
-- existing (unchanged) owner 'submission_completed' notification, the moment
-- complete_lead_if_ready marks a website lead complete.
--
-- Scope: widen notification_deliveries.event_type's CHECK constraint to also
-- allow 'customer_receipt', and add one additional, independently-
-- deduplicated insert for it inside complete_lead_if_ready. Explicitly NOT
-- in scope: any change to leads' own email columns/constraints (historical
-- nullable rows and owner-created enquiries stay exactly as they are — this
-- migration touches notification_deliveries and complete_lead_if_ready
-- only), any change to claim/mark-sent/reschedule/dead-letter (the C2H-A
-- outbox lifecycle's own comment already documents it as "channel/event-
-- agnostic by construction" and applies to this new event_type unchanged),
-- and any change to the Cloudflare Queue wake-up message (the existing
-- generic "some notification work is due" hint already causes the consumer
-- to claim the oldest due row regardless of event_type).

-- ---------------------------------------------------------------------------
-- A. Widen notification_deliveries.event_type — purely additive. Every
--    existing row's event_type is already 'submission_completed', which
--    remains allowed; this can never fail against historical data.
-- ---------------------------------------------------------------------------

alter table public.notification_deliveries drop constraint notification_deliveries_event_type_check;

alter table public.notification_deliveries add constraint notification_deliveries_event_type_check
  check (event_type in ('submission_completed', 'customer_receipt'));

comment on column public.notification_deliveries.event_type is
  'Which lifecycle event this delivery attempt is for: ''submission_completed'' '
  '(the owner new-enquiry-ready notification) or ''customer_receipt'' (the '
  'customer-facing enquiry-received confirmation, added by this migration). '
  'A future event type requires another explicit constraint-widening '
  'migration. The existing (lead_id, event_type, channel) UNIQUE constraint '
  'already structurally supports this — see its own migration comment.';

-- ---------------------------------------------------------------------------
-- B. complete_lead_if_ready — one additional, independently-deduplicated
--    outbox insert, in the same function invocation (and therefore the same
--    transaction) as the lead's own submission_completed_at write and the
--    existing owner-notification insert. Signature, return type, security
--    mode, search_path and grants are all unchanged — the same "minimal,
--    additive CREATE OR REPLACE across a later migration" pattern already
--    used for this function and for create_website_quote_v1.
-- ---------------------------------------------------------------------------

create or replace function public.complete_lead_if_ready(p_lead_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_lead public.leads%rowtype;
  v_status text;
begin
  select * into v_lead from public.leads where id = p_lead_id for update;

  if not found then
    return false;
  end if;
  if v_lead.submission_completed_at is not null then
    return false;
  end if;
  if v_lead.capture_channel <> 'website' then
    return false;
  end if;

  v_status := public.compute_lead_file_upload_status(p_lead_id);

  update public.leads
  set file_upload_status = v_status
  where id = p_lead_id and file_upload_status is distinct from v_status;

  if v_status not in ('none', 'complete') then
    return false;
  end if;

  update public.leads
  set submission_completed_at = now()
  where id = p_lead_id;

  insert into public.lead_activities (lead_id, actor_type, event_type)
  values (p_lead_id, 'system', 'submission_completed');

  insert into public.notification_deliveries (lead_id, event_type, channel, status)
  values (p_lead_id, 'submission_completed', 'email', 'pending')
  on conflict (lead_id, event_type, channel) do nothing;

  -- CHECKPOINT (customer receipt) — a separate event_type/row from the
  -- owner notification immediately above, never a second write to it. Same
  -- channel, same ON CONFLICT DO NOTHING idempotency guarantee, so a
  -- retried/duplicate call to this function (e.g. complete_website_quote_v1's
  -- own reconciliation path, or the last-slot-verifies trigger racing a
  -- manual reconciliation call) can never create a second receipt for the
  -- same lead — exactly the same guarantee that already protects the owner
  -- row, now extended to this one via the identical (lead_id, event_type,
  -- channel) composite key. Queued unconditionally here regardless of
  -- whether this lead actually has a seller_email/buyer_email value: this
  -- function has no reason to know that, and the dispatcher (never this
  -- function) is what resolves which address to send to and fails safe
  -- (dead-letters this one delivery, touching nothing else) if that address
  -- turns out to be null — see dispatch-notification.server.ts's
  -- RECIPIENT_EMAIL_MISSING handling. A send failure on either row can
  -- therefore never reverse this already-committed completion, and can
  -- never produce a duplicate of either row.
  insert into public.notification_deliveries (lead_id, event_type, channel, status)
  values (p_lead_id, 'customer_receipt', 'email', 'pending')
  on conflict (lead_id, event_type, channel) do nothing;

  return true;
end;
$$;

-- No revoke/grant here: CREATE OR REPLACE preserves this function's existing
-- privileges — service_role's EXECUTE is unaffected, and re-stating it would
-- be redundant, matching this same function's own prior CREATE OR REPLACE
-- (20260816170000_notification_delivery_outbox_lifecycle.sql) and
-- create_website_quote_v1's precedent before it.

comment on function public.complete_lead_if_ready(uuid) is
  'Marks a website lead complete (submission_completed_at, a '
  '''submission_completed'' lead_activities row) once its upload status is '
  '''none'' or ''complete''. As of this migration, also enqueues exactly one '
  '''customer_receipt'' notification_deliveries row alongside the existing '
  '''submission_completed'' owner row, in the same transaction — both rows '
  'independently deduplicated by (lead_id, event_type, channel), so this '
  'function can be called any number of times for the same lead (reclaim, '
  'reconciliation, trigger race) without ever creating a second row of '
  'either kind. Called by the last-slot-verifies trigger '
  '(quote_upload_slots_sync_lead_status) and, for a zero-file submission, '
  'directly from create_website_quote_v1.';
