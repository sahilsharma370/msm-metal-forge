/**
 * CHECKPOINT C2H-B1 — the one notification dispatcher: claims a durable
 * outbox row (see supabase/migrations/20260816170000_notification_delivery_outbox_lifecycle.sql
 * and .../20260816203000_notification_delivery_operator_recovery.sql),
 * loads its lead, sends the owner email via an injected EmailProvider, and
 * resolves the row's lifecycle accordingly. `.server.ts` suffix — see
 * env.server.ts for why that's sufficient import protection on its own.
 *
 * NOT wired to anything yet in this checkpoint — no Cloudflare Queue
 * consumer, no scheduled/Cron handler, no HTTP route calls this. C2H-B2
 * wires dispatchOwnerNotification into both. Calling it (targeted, by
 * delivery ID, or fallback, for the oldest due row) is entirely manual/
 * test-only until then.
 *
 * The lead row is NEVER written to here — this module only ever SELECTs
 * from public.leads (via deps.loadLead) and writes to
 * public.notification_deliveries (via the four RPCs). An email/provider
 * failure therefore cannot roll back or alter the already-completed lead
 * by construction, not by convention: there is no code path in this file
 * that could even attempt such a write.
 */
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/server/supabase-admin.server";
import { getEmailConfig, type EmailConfig } from "@/server/env.server";
import { createResendEmailProvider } from "./resend-email-provider.server";
import { renderOwnerNotificationEmail, type OwnerNotificationLeadData } from "./owner-notification-email";
import type { EmailProvider } from "./notification-email-types";

// ---------------------------------------------------------------------------
// Retry policy — deterministic, bounded, compatible with C2H-A's 1s–24h range
// ---------------------------------------------------------------------------

/**
 * Index i is the delay used after the (i+1)-th attempt fails transiently:
 * attempt 1 -> 60s, attempt 2 -> 5min, attempt 3 -> 15min, attempt 4 -> 60min.
 * A 5th transient failure still calls reschedule with the attempt-4 delay,
 * but notification_delivery_max_attempts() (5, see the C2H-A migration)
 * means the database itself overrides that into dead_letter regardless of
 * what delay was requested — this array never needs a 5th entry.
 */
const RETRY_DELAYS_SECONDS = [60, 300, 900, 3600] as const;

export function computeRetryDelaySeconds(attemptCount: number): number {
  const index = Math.min(Math.max(attemptCount, 1), RETRY_DELAYS_SECONDS.length) - 1;
  return RETRY_DELAYS_SECONDS[index] ?? RETRY_DELAYS_SECONDS[RETRY_DELAYS_SECONDS.length - 1]!;
}

// ---------------------------------------------------------------------------
// RPC client contract — defensively re-validated, never trusted blindly,
// matching this codebase's own established CompleteQuoteRpcClient pattern
// ---------------------------------------------------------------------------

export interface NotificationDispatchRpcClient {
  rpc(
    fn: "claim_notification_delivery_v1",
    args: { p_claim_token: string; p_delivery_id: string | null; p_lease_seconds: number },
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  rpc(
    fn: "mark_notification_delivery_sent_v1",
    args: { p_delivery_id: string; p_claim_token: string; p_provider: string; p_provider_message_id: string },
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  rpc(
    fn: "reschedule_notification_delivery_v1",
    args: { p_delivery_id: string; p_claim_token: string; p_error_code: string; p_retry_after_seconds: number },
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  rpc(
    fn: "dead_letter_notification_delivery_v1",
    args: { p_delivery_id: string; p_claim_token: string; p_error_code: string },
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export function toNotificationDispatchRpcClient(client: SupabaseClient): NotificationDispatchRpcClient {
  return client as unknown as NotificationDispatchRpcClient;
}

const CLAIM_LOST_FRAGMENT = "no matching active claim";

/** Matches claim_notification_delivery_v1's exact return shape (see the C2H-A migration). */
const claimResultSchema = z.object({
  delivery_id: z.string().uuid(),
  lead_id: z.string().uuid(),
  event_type: z.string(),
  channel: z.string(),
  attempt_count: z.number().int(),
  claim_token: z.string().uuid(),
  claimed_at: z.string(),
  lease_expires_at: z.string(),
});

const markSentResultSchema = z.object({
  delivery_id: z.string().uuid(),
  status: z.literal("sent"),
  sent_at: z.string(),
  provider: z.string(),
  provider_message_id: z.string(),
});

const rescheduleResultSchema = z.object({
  delivery_id: z.string().uuid(),
  status: z.enum(["retry_wait", "dead_letter"]),
  attempt_count: z.number().int(),
  next_attempt_at: z.string().nullable(),
  last_error_code: z.string(),
});

const deadLetterResultSchema = z.object({
  delivery_id: z.string().uuid(),
  status: z.literal("dead_letter"),
  attempt_count: z.number().int(),
  last_error_code: z.string(),
});

// ---------------------------------------------------------------------------
// Lead lookup — explicit column allowlist, never `select('*')`, matching
// this schema's own "explicit allowlist" philosophy (see
// create_website_quote_v1's jsonb key allowlist for the same reasoning)
// ---------------------------------------------------------------------------

export const LEAD_EMAIL_COLUMNS =
  "reference, intent, material, material_subtype, material_subtype_other_text, material_other_text, material_spec, " +
  "seller_quantity_value, seller_quantity_unit, seller_quantity_unit_other, seller_quantity_unsure, seller_condition, seller_description, " +
  "seller_emirate, seller_area, seller_map_link, seller_pickup_required, seller_pickup_date, seller_access_note, " +
  "seller_name, seller_phone, seller_company, seller_email, seller_preferred_contact, seller_notes, " +
  "buyer_quantity_value, buyer_quantity_unit, buyer_quantity_unit_other, buyer_trade_requirement, buyer_required_by_date, buyer_additional_spec, " +
  "buyer_destination_emirate, buyer_destination_area, buyer_destination_map_link, buyer_fulfilment, buyer_destination_country, buyer_destination_city_port, " +
  "buyer_preferred_port, buyer_preferred_port_other, buyer_origin_country_preference, buyer_logistics_requirement, buyer_logistics_note, " +
  "buyer_company, buyer_contact_person, buyer_phone, buyer_email, buyer_preferred_contact, buyer_notes, " +
  "file_upload_status, submitted_at";

const leadRowSchema = z.object({
  reference: z.string(),
  intent: z.enum(["sell", "buy"]),
  material: z.string(),
  material_subtype: z.string().nullable(),
  material_subtype_other_text: z.string().nullable(),
  material_other_text: z.string().nullable(),
  material_spec: z.string().nullable(),
  seller_quantity_value: z.string().nullable(),
  seller_quantity_unit: z.string().nullable(),
  seller_quantity_unit_other: z.string().nullable(),
  seller_quantity_unsure: z.boolean(),
  seller_condition: z.string().nullable(),
  seller_description: z.string().nullable(),
  seller_emirate: z.string().nullable(),
  seller_area: z.string().nullable(),
  seller_map_link: z.string().nullable(),
  seller_pickup_required: z.string().nullable(),
  seller_pickup_date: z.string().nullable(),
  seller_access_note: z.string().nullable(),
  seller_name: z.string().nullable(),
  seller_phone: z.string().nullable(),
  seller_company: z.string().nullable(),
  seller_email: z.string().nullable(),
  seller_preferred_contact: z.string().nullable(),
  seller_notes: z.string().nullable(),
  buyer_quantity_value: z.string().nullable(),
  buyer_quantity_unit: z.string().nullable(),
  buyer_quantity_unit_other: z.string().nullable(),
  buyer_trade_requirement: z.string().nullable(),
  buyer_required_by_date: z.string().nullable(),
  buyer_additional_spec: z.string().nullable(),
  buyer_destination_emirate: z.string().nullable(),
  buyer_destination_area: z.string().nullable(),
  buyer_destination_map_link: z.string().nullable(),
  buyer_fulfilment: z.string().nullable(),
  buyer_destination_country: z.string().nullable(),
  buyer_destination_city_port: z.string().nullable(),
  buyer_preferred_port: z.string().nullable(),
  buyer_preferred_port_other: z.string().nullable(),
  buyer_origin_country_preference: z.string().nullable(),
  buyer_logistics_requirement: z.string().nullable(),
  buyer_logistics_note: z.string().nullable(),
  buyer_company: z.string().nullable(),
  buyer_contact_person: z.string().nullable(),
  buyer_phone: z.string().nullable(),
  buyer_email: z.string().nullable(),
  buyer_preferred_contact: z.string().nullable(),
  buyer_notes: z.string().nullable(),
  file_upload_status: z.string(),
  submitted_at: z.string(),
});

export type LeadEmailRow = z.infer<typeof leadRowSchema>;

function toOwnerNotificationLeadData(row: LeadEmailRow): OwnerNotificationLeadData {
  return {
    reference: row.reference,
    intent: row.intent,
    material: row.material,
    materialSubtype: row.material_subtype,
    materialSubtypeOtherText: row.material_subtype_other_text,
    materialOtherText: row.material_other_text,
    materialSpec: row.material_spec,
    sellerQuantityValue: row.seller_quantity_value,
    sellerQuantityUnit: row.seller_quantity_unit,
    sellerQuantityUnitOther: row.seller_quantity_unit_other,
    sellerQuantityUnsure: row.seller_quantity_unsure,
    sellerCondition: row.seller_condition,
    sellerDescription: row.seller_description,
    sellerEmirate: row.seller_emirate,
    sellerArea: row.seller_area,
    sellerMapLink: row.seller_map_link,
    sellerPickupRequired: row.seller_pickup_required,
    sellerPickupDate: row.seller_pickup_date,
    sellerAccessNote: row.seller_access_note,
    sellerName: row.seller_name,
    sellerPhone: row.seller_phone,
    sellerCompany: row.seller_company,
    sellerEmail: row.seller_email,
    sellerPreferredContact: row.seller_preferred_contact,
    sellerNotes: row.seller_notes,
    buyerQuantityValue: row.buyer_quantity_value,
    buyerQuantityUnit: row.buyer_quantity_unit,
    buyerQuantityUnitOther: row.buyer_quantity_unit_other,
    buyerTradeRequirement: row.buyer_trade_requirement,
    buyerRequiredByDate: row.buyer_required_by_date,
    buyerAdditionalSpec: row.buyer_additional_spec,
    buyerDestinationEmirate: row.buyer_destination_emirate,
    buyerDestinationArea: row.buyer_destination_area,
    buyerDestinationMapLink: row.buyer_destination_map_link,
    buyerFulfilment: row.buyer_fulfilment,
    buyerDestinationCountry: row.buyer_destination_country,
    buyerDestinationCityPort: row.buyer_destination_city_port,
    buyerPreferredPort: row.buyer_preferred_port,
    buyerPreferredPortOther: row.buyer_preferred_port_other,
    buyerOriginCountryPreference: row.buyer_origin_country_preference,
    buyerLogisticsRequirement: row.buyer_logistics_requirement,
    buyerLogisticsNote: row.buyer_logistics_note,
    buyerCompany: row.buyer_company,
    buyerContactPerson: row.buyer_contact_person,
    buyerPhone: row.buyer_phone,
    buyerEmail: row.buyer_email,
    buyerPreferredContact: row.buyer_preferred_contact,
    buyerNotes: row.buyer_notes,
    submittedAt: row.submitted_at,
  };
}

// ---------------------------------------------------------------------------
// Dependency injection
// ---------------------------------------------------------------------------

export interface DispatchNotificationDeps {
  readonly rpc: NotificationDispatchRpcClient;
  /** Resolves one lead row for the email — null when not found (defensively unreachable given the lead_id foreign key, but never assumed). */
  readonly loadLead: (leadId: string) => Promise<LeadEmailRow | null>;
  /** Count of declared quote_upload_slots rows for the lead — never a filename or path. */
  readonly countLeadFiles: (leadId: string) => Promise<number>;
  /** Throws (any error) when email configuration is missing/invalid — never called until after a delivery is already claimed, so a throw here always has a valid claim to dead-letter against. */
  readonly getEmailConfig: () => EmailConfig;
  readonly createEmailProvider: (config: EmailConfig) => EmailProvider;
  /** Injectable for deterministic tests; defaults to crypto.randomUUID. */
  readonly generateClaimToken?: () => string;
  /** Seconds; defaults to 120, bounded by claim_notification_delivery_v1's own [30, 900] range. */
  readonly leaseSeconds?: number;
}

/** Production wiring — never called from a unit test, which always injects its own fakes for every field above. */
export function createDispatchNotificationDeps(): DispatchNotificationDeps {
  const rpc = toNotificationDispatchRpcClient(createSupabaseAdminClient());
  return {
    rpc,
    async loadLead(leadId) {
      const admin = createSupabaseAdminClient();
      const { data, error } = await admin.from("leads").select(LEAD_EMAIL_COLUMNS).eq("id", leadId).maybeSingle();
      if (error || !data) return null;
      const parsed = leadRowSchema.safeParse(data);
      return parsed.success ? parsed.data : null;
    },
    async countLeadFiles(leadId) {
      const admin = createSupabaseAdminClient();
      const { count } = await admin
        .from("quote_upload_slots")
        .select("id", { count: "exact", head: true })
        .eq("lead_id", leadId);
      return count ?? 0;
    },
    getEmailConfig,
    createEmailProvider: (config) => createResendEmailProvider({ apiKey: config.resendApiKey }),
  };
}

// ---------------------------------------------------------------------------
// Public result type — no customer PII, no provider payloads, ever
// ---------------------------------------------------------------------------

export type DispatchResult =
  | { readonly kind: "no_work" }
  | { readonly kind: "sent"; readonly deliveryId: string; readonly providerMessageId: string }
  | { readonly kind: "retry_scheduled"; readonly deliveryId: string; readonly nextAttemptAt: string | null }
  | { readonly kind: "dead_lettered"; readonly deliveryId: string; readonly errorCode: string }
  /** The claim's lease expired (or was otherwise stolen) between claiming and finalizing — a rare race, not a bug in the caller. The row itself is left exactly as whichever RPC call discovered this left it (still processing under someone else's newer claim, or already resolved by them). */
  | { readonly kind: "claim_lost"; readonly deliveryId: string }
  | { readonly kind: "internal_error" };

export interface DispatchNotificationInput {
  /** Present for a targeted Queue-message dispatch; absent for a scheduled fallback sweep of the oldest due row. */
  readonly deliveryId?: string;
}

function isClaimLostError(message: string): boolean {
  return message.includes(CLAIM_LOST_FRAGMENT);
}

/**
 * Core orchestration, independent of any Queue/Cron transport so it can be
 * unit tested directly against fake deps. Claims at most one delivery per
 * call — a caller (C2H-B2's Queue consumer or scheduled handler) is
 * responsible for calling this once per message/sweep tick, not looping
 * internally.
 */
export async function dispatchOwnerNotification(
  input: DispatchNotificationInput,
  deps: DispatchNotificationDeps,
): Promise<DispatchResult> {
  const claimToken = (deps.generateClaimToken ?? (() => crypto.randomUUID()))();
  const leaseSeconds = deps.leaseSeconds ?? 120;

  let claimResponse: { data: unknown; error: { message: string } | null };
  try {
    claimResponse = await deps.rpc.rpc("claim_notification_delivery_v1", {
      p_claim_token: claimToken,
      p_delivery_id: input.deliveryId ?? null,
      p_lease_seconds: leaseSeconds,
    });
  } catch {
    return { kind: "internal_error" };
  }
  if (claimResponse.error) {
    return { kind: "internal_error" };
  }
  if (claimResponse.data === null) {
    return { kind: "no_work" };
  }
  const parsedClaim = claimResultSchema.safeParse(claimResponse.data);
  if (!parsedClaim.success) {
    // Malformed claim JSON is rejected safely: never trusted enough to act
    // on its delivery_id/claim_token — the row is left exactly as the
    // database returned it (its lease will simply expire and be reclaimed
    // normally by a later call).
    return { kind: "internal_error" };
  }
  const claim = parsedClaim.data;

  if (claim.event_type !== "submission_completed" || claim.channel !== "email") {
    // Structurally unreachable given this table's own CHECK constraints
    // today, but never assumed — the provider must never be called for a
    // delivery shape this dispatcher doesn't know how to handle, and the
    // claim must still be resolved rather than left stranded.
    return finalizeDeadLetter(deps, claim.delivery_id, claim.claim_token, "UNSUPPORTED_DELIVERY");
  }

  const lead = await deps.loadLead(claim.lead_id);
  if (!lead) {
    return finalizeDeadLetter(deps, claim.delivery_id, claim.claim_token, "LEAD_NOT_FOUND");
  }

  let emailConfig: EmailConfig;
  let emailProvider: EmailProvider;
  try {
    emailConfig = deps.getEmailConfig();
    emailProvider = deps.createEmailProvider(emailConfig);
  } catch {
    return finalizeDeadLetter(deps, claim.delivery_id, claim.claim_token, "CONFIGURATION_ERROR");
  }

  const fileCount = await deps.countLeadFiles(claim.lead_id);
  const idempotencyKey = `submission_completed/${claim.delivery_id}`;
  const rendered = renderOwnerNotificationEmail(
    toOwnerNotificationLeadData(lead),
    { count: fileCount, status: lead.file_upload_status },
    emailConfig.ownerDashboardUrl ? { dashboardUrl: emailConfig.ownerDashboardUrl } : {},
  );

  const sendResult = await emailProvider.send({
    from: emailConfig.emailFrom,
    to: emailConfig.ownerNotificationEmail,
    ...(emailConfig.emailReplyTo ? { replyTo: emailConfig.emailReplyTo } : {}),
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
    idempotencyKey,
  });

  if (sendResult.ok) {
    let markSentResponse: { data: unknown; error: { message: string } | null };
    try {
      markSentResponse = await deps.rpc.rpc("mark_notification_delivery_sent_v1", {
        p_delivery_id: claim.delivery_id,
        p_claim_token: claim.claim_token,
        p_provider: sendResult.provider,
        p_provider_message_id: sendResult.providerMessageId,
      });
    } catch {
      return { kind: "internal_error" };
    }
    if (markSentResponse.error) {
      if (isClaimLostError(markSentResponse.error.message)) {
        return { kind: "claim_lost", deliveryId: claim.delivery_id };
      }
      return { kind: "internal_error" };
    }
    const parsedMarkSent = markSentResultSchema.safeParse(markSentResponse.data);
    if (!parsedMarkSent.success) {
      return { kind: "internal_error" };
    }
    return {
      kind: "sent",
      deliveryId: parsedMarkSent.data.delivery_id,
      providerMessageId: parsedMarkSent.data.provider_message_id,
    };
  }

  if (sendResult.retryable) {
    const retryAfterSeconds = computeRetryDelaySeconds(claim.attempt_count);
    let rescheduleResponse: { data: unknown; error: { message: string } | null };
    try {
      rescheduleResponse = await deps.rpc.rpc("reschedule_notification_delivery_v1", {
        p_delivery_id: claim.delivery_id,
        p_claim_token: claim.claim_token,
        p_error_code: sendResult.code,
        p_retry_after_seconds: retryAfterSeconds,
      });
    } catch {
      return { kind: "internal_error" };
    }
    if (rescheduleResponse.error) {
      if (isClaimLostError(rescheduleResponse.error.message)) {
        return { kind: "claim_lost", deliveryId: claim.delivery_id };
      }
      return { kind: "internal_error" };
    }
    const parsedReschedule = rescheduleResultSchema.safeParse(rescheduleResponse.data);
    if (!parsedReschedule.success) {
      return { kind: "internal_error" };
    }
    if (parsedReschedule.data.status === "dead_letter") {
      return { kind: "dead_lettered", deliveryId: parsedReschedule.data.delivery_id, errorCode: parsedReschedule.data.last_error_code };
    }
    return {
      kind: "retry_scheduled",
      deliveryId: parsedReschedule.data.delivery_id,
      nextAttemptAt: parsedReschedule.data.next_attempt_at,
    };
  }

  return finalizeDeadLetter(deps, claim.delivery_id, claim.claim_token, sendResult.code);
}

async function finalizeDeadLetter(
  deps: DispatchNotificationDeps,
  deliveryId: string,
  claimToken: string,
  errorCode: string,
): Promise<DispatchResult> {
  let response: { data: unknown; error: { message: string } | null };
  try {
    response = await deps.rpc.rpc("dead_letter_notification_delivery_v1", {
      p_delivery_id: deliveryId,
      p_claim_token: claimToken,
      p_error_code: errorCode,
    });
  } catch {
    return { kind: "internal_error" };
  }
  if (response.error) {
    if (isClaimLostError(response.error.message)) {
      return { kind: "claim_lost", deliveryId };
    }
    return { kind: "internal_error" };
  }
  const parsed = deadLetterResultSchema.safeParse(response.data);
  if (!parsed.success) {
    return { kind: "internal_error" };
  }
  return { kind: "dead_lettered", deliveryId: parsed.data.delivery_id, errorCode: parsed.data.last_error_code };
}
