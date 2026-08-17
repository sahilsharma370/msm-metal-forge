import { describe, expect, it, vi } from "vitest";
import {
  getOwnerLeadDetail,
  isValidUuid,
  type LeadDetailRow,
  type LeadFileRow,
  type LeadActivityRow,
  type NotificationDeliveryRow,
  type OwnerLeadDetailServiceDeps,
} from "./owner-lead-detail.server";

function fakeLeadRow(overrides: Partial<LeadDetailRow> = {}): LeadDetailRow {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    reference: "MSM-260101-ABCDEF",
    status: "new",
    intent: "sell",
    capture_channel: "website",
    material: "copper",
    material_subtype: "wire_cable",
    material_subtype_other_text: null,
    material_other_text: null,
    material_spec: null,
    created_at: "2026-01-01T00:00:00.000Z",
    submission_completed_at: "2026-01-01T00:05:00.000Z",
    file_upload_status: "complete",
    seller_quantity_value: 100,
    seller_quantity_unit: "kg",
    seller_quantity_unit_other: null,
    seller_quantity_unsure: false,
    seller_condition: "clean_separated",
    seller_description: null,
    seller_emirate: "dubai",
    seller_area: "Al Quoz",
    seller_map_link: null,
    seller_pickup_required: "yes",
    seller_pickup_date: null,
    seller_access_note: null,
    seller_name: "Ahmed Seller",
    seller_phone: "+971501234567",
    seller_company: null,
    seller_email: null,
    seller_preferred_contact: "whatsapp",
    seller_notes: null,
    buyer_quantity_value: null,
    buyer_quantity_unit: null,
    buyer_quantity_unit_other: null,
    buyer_trade_requirement: null,
    buyer_required_by_date: null,
    buyer_additional_spec: null,
    buyer_destination_emirate: null,
    buyer_destination_area: null,
    buyer_destination_map_link: null,
    buyer_fulfilment: null,
    buyer_destination_country: null,
    buyer_destination_city_port: null,
    buyer_preferred_port: null,
    buyer_preferred_port_other: null,
    buyer_origin_country_preference: null,
    buyer_logistics_requirement: null,
    buyer_logistics_note: null,
    buyer_company: null,
    buyer_contact_person: null,
    buyer_phone: null,
    buyer_email: null,
    buyer_preferred_contact: null,
    buyer_notes: null,
    ...overrides,
  };
}

function fakeFileRow(overrides: Partial<LeadFileRow> = {}): LeadFileRow {
  return {
    id: "22222222-2222-2222-2222-222222222222",
    kind: "seller_photo",
    original_filename: "scrap.jpg",
    detected_mime_type: "image/jpeg",
    byte_size: 1024,
    uploaded_at: "2026-01-01T00:01:00.000Z",
    upload_status: "complete",
    created_at: "2026-01-01T00:00:30.000Z",
    ...overrides,
  };
}

function fakeActivityRow(overrides: Partial<LeadActivityRow> = {}): LeadActivityRow {
  return {
    id: "33333333-3333-3333-3333-333333333333",
    event_type: "submission_completed",
    actor_type: "system",
    metadata: {},
    created_at: "2026-01-01T00:05:00.000Z",
    ...overrides,
  };
}

function fakeDeps(overrides: Partial<OwnerLeadDetailServiceDeps> = {}): OwnerLeadDetailServiceDeps {
  return {
    queryLeadById: vi.fn().mockResolvedValue(fakeLeadRow()),
    queryLeadFiles: vi.fn().mockResolvedValue([]),
    queryLeadActivities: vi.fn().mockResolvedValue([]),
    queryNotificationDelivery: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

describe("isValidUuid", () => {
  it("accepts a well-formed UUID", () => {
    expect(isValidUuid("11111111-1111-1111-1111-111111111111")).toBe(true);
  });
  it.each(["not-a-uuid", "", "11111111-1111-1111-1111-11111111111", "'; DROP TABLE leads; --"])(
    "rejects %s",
    (value) => {
      expect(isValidUuid(value)).toBe(false);
    },
  );
});

describe("getOwnerLeadDetail — not-found collapsing", () => {
  it("a nonexistent lead returns not_found", async () => {
    const deps = fakeDeps({ queryLeadById: vi.fn().mockResolvedValue(null) });
    const result = await getOwnerLeadDetail("11111111-1111-1111-1111-111111111111", deps);
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("an incomplete lead (submission_completed_at null) returns the identical not_found", async () => {
    const deps = fakeDeps({ queryLeadById: vi.fn().mockResolvedValue(fakeLeadRow({ submission_completed_at: null })) });
    const result = await getOwnerLeadDetail("11111111-1111-1111-1111-111111111111", deps);
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("does not query files/activities/notifications for a not-found lead (no unnecessary round trips)", async () => {
    const deps = fakeDeps({ queryLeadById: vi.fn().mockResolvedValue(null) });
    await getOwnerLeadDetail("11111111-1111-1111-1111-111111111111", deps);
    expect(deps.queryLeadFiles).not.toHaveBeenCalled();
    expect(deps.queryLeadActivities).not.toHaveBeenCalled();
    expect(deps.queryNotificationDelivery).not.toHaveBeenCalled();
  });
});

describe("getOwnerLeadDetail — seller/buyer branch isolation", () => {
  it("a sell lead maps only seller fields, with intent-tagged enquiry", async () => {
    const deps = fakeDeps();
    const result = await getOwnerLeadDetail("11111111-1111-1111-1111-111111111111", deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lead.intent).toBe("sell");
    expect(result.lead.contact).toEqual({ name: "Ahmed Seller", phone: "+971501234567", email: null, company: null });
    expect(result.lead.location).toEqual({ emirate: "dubai", area: "Al Quoz", mapLink: null });
    if (result.lead.intent === "sell") {
      expect(result.lead.enquiry.quantityValue).toBe(100);
      expect(result.lead.enquiry.condition).toBe("clean_separated");
    }
    expect(JSON.stringify(result.lead)).not.toMatch(/tradeRequirement|logisticsRequirement|destinationCountry/);
  });

  it("a buy lead maps only buyer fields, with intent-tagged enquiry", async () => {
    const row = fakeLeadRow({
      intent: "buy",
      seller_name: null, seller_phone: null, seller_emirate: null, seller_area: null,
      seller_quantity_value: null, seller_quantity_unit: null, seller_condition: null, seller_pickup_required: null, seller_preferred_contact: null,
      buyer_contact_person: "Fatima Buyer", buyer_phone: "+971509999999",
      buyer_destination_emirate: "sharjah", buyer_destination_area: "Industrial 3",
      buyer_quantity_value: 500, buyer_quantity_unit: "kg", buyer_trade_requirement: "local",
      buyer_fulfilment: "delivery", buyer_logistics_requirement: "delivery", buyer_preferred_contact: "whatsapp",
    });
    const deps = fakeDeps({ queryLeadById: vi.fn().mockResolvedValue(row) });
    const result = await getOwnerLeadDetail("11111111-1111-1111-1111-111111111111", deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lead.intent).toBe("buy");
    expect(result.lead.contact).toEqual({ name: "Fatima Buyer", phone: "+971509999999", email: null, company: null });
    expect(result.lead.location).toEqual({ emirate: "sharjah", area: "Industrial 3", mapLink: null });
    if (result.lead.intent === "buy") {
      expect(result.lead.enquiry.quantityValue).toBe(500);
      expect(result.lead.enquiry.tradeRequirement).toBe("local");
    }
    expect(JSON.stringify(result.lead)).not.toMatch(/"condition"|"pickupRequired"|"accessNote"/);
  });
});

describe("getOwnerLeadDetail — files/activities pass through with deterministic ordering delegated to the query layer", () => {
  it("returns files/activities exactly as the deps returned them, mapped to the sanitized shape", async () => {
    const files = [fakeFileRow({ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }), fakeFileRow({ id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" })];
    const activities = [fakeActivityRow({ id: "cccccccc-cccc-cccc-cccc-cccccccccccc" }), fakeActivityRow({ id: "dddddddd-dddd-dddd-dddd-dddddddddddd" })];
    const deps = fakeDeps({ queryLeadFiles: vi.fn().mockResolvedValue(files), queryLeadActivities: vi.fn().mockResolvedValue(activities) });
    const result = await getOwnerLeadDetail("11111111-1111-1111-1111-111111111111", deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files.map((f) => f.id)).toEqual(["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"]);
    expect(result.activities.map((a) => a.id)).toEqual(["cccccccc-cccc-cccc-cccc-cccccccccccc", "dddddddd-dddd-dddd-dddd-dddddddddddd"]);
  });

  it("file items never carry storage_path/checksum/lead_id", async () => {
    const deps = fakeDeps({ queryLeadFiles: vi.fn().mockResolvedValue([fakeFileRow()]) });
    const result = await getOwnerLeadDetail("11111111-1111-1111-1111-111111111111", deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const serialized = JSON.stringify(result.files);
    expect(serialized).not.toMatch(/storage_path|checksum|lead_id/i);
  });

  it("activity items never carry raw metadata or actor_owner_id", async () => {
    const deps = fakeDeps({ queryLeadActivities: vi.fn().mockResolvedValue([fakeActivityRow()]) });
    const result = await getOwnerLeadDetail("11111111-1111-1111-1111-111111111111", deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const serialized = JSON.stringify(result.activities);
    expect(serialized).not.toMatch(/metadata|actor_owner_id/i);
  });
});

describe("getOwnerLeadDetail — CHECKPOINT C2J-E: statusChange/noteBody narrow projection", () => {
  it("projects statusChange only for a status_changed activity, from its metadata", async () => {
    const row = fakeActivityRow({
      event_type: "status_changed",
      actor_type: "owner",
      metadata: { from_status: "new", to_status: "contacted", reason: null },
    });
    const deps = fakeDeps({ queryLeadActivities: vi.fn().mockResolvedValue([row]) });
    const result = await getOwnerLeadDetail("11111111-1111-1111-1111-111111111111", deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.activities[0]?.statusChange).toEqual({ from: "new", to: "contacted", reason: null });
    expect(result.activities[0]?.noteBody).toBeNull();
  });

  it("includes the reason when present (a transition to lost)", async () => {
    const row = fakeActivityRow({
      event_type: "status_changed",
      actor_type: "owner",
      metadata: { from_status: "new", to_status: "lost", reason: "Price too low" },
    });
    const deps = fakeDeps({ queryLeadActivities: vi.fn().mockResolvedValue([row]) });
    const result = await getOwnerLeadDetail("11111111-1111-1111-1111-111111111111", deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.activities[0]?.statusChange).toEqual({ from: "new", to: "lost", reason: "Price too low" });
  });

  it("projects noteBody only for a note_added activity, from its metadata", async () => {
    const row = fakeActivityRow({ event_type: "note_added", actor_type: "owner", metadata: { note: "Customer called twice." } });
    const deps = fakeDeps({ queryLeadActivities: vi.fn().mockResolvedValue([row]) });
    const result = await getOwnerLeadDetail("11111111-1111-1111-1111-111111111111", deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.activities[0]?.noteBody).toBe("Customer called twice.");
    expect(result.activities[0]?.statusChange).toBeNull();
  });

  it("a non-status/non-note event (e.g. submission_completed) carries neither field, even with unrelated metadata", async () => {
    const row = fakeActivityRow({ event_type: "submission_completed", metadata: { something: "unexpected" } });
    const deps = fakeDeps({ queryLeadActivities: vi.fn().mockResolvedValue([row]) });
    const result = await getOwnerLeadDetail("11111111-1111-1111-1111-111111111111", deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.activities[0]?.statusChange).toBeNull();
    expect(result.activities[0]?.noteBody).toBeNull();
  });

  it("malformed status_changed metadata (missing/invalid keys) yields null instead of throwing", async () => {
    const row = fakeActivityRow({ event_type: "status_changed", metadata: { unexpected: "shape" } });
    const deps = fakeDeps({ queryLeadActivities: vi.fn().mockResolvedValue([row]) });
    const result = await getOwnerLeadDetail("11111111-1111-1111-1111-111111111111", deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.activities[0]?.statusChange).toBeNull();
  });

  it("non-string note_added metadata.note yields null instead of throwing or coercing", async () => {
    const row = fakeActivityRow({ event_type: "note_added", metadata: { note: 12345 } });
    const deps = fakeDeps({ queryLeadActivities: vi.fn().mockResolvedValue([row]) });
    const result = await getOwnerLeadDetail("11111111-1111-1111-1111-111111111111", deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.activities[0]?.noteBody).toBeNull();
  });
});

describe("getOwnerLeadDetail — notification status mapping", () => {
  function notificationRow(overrides: Partial<NotificationDeliveryRow> = {}): NotificationDeliveryRow {
    return { status: "pending", attempt_count: 0, manual_requeue_count: 0, last_error_code: null, last_error_at: null, sent_at: null, ...overrides };
  }

  it("sent -> sent", async () => {
    const deps = fakeDeps({ queryNotificationDelivery: vi.fn().mockResolvedValue(notificationRow({ status: "sent", sent_at: "2026-01-01T00:06:00.000Z" })) });
    const result = await getOwnerLeadDetail("11111111-1111-1111-1111-111111111111", deps);
    expect(result.ok && result.notification.status).toBe("sent");
  });

  it.each(["pending", "processing", "retry_wait"])("%s -> pending", async (status) => {
    const deps = fakeDeps({ queryNotificationDelivery: vi.fn().mockResolvedValue(notificationRow({ status })) });
    const result = await getOwnerLeadDetail("11111111-1111-1111-1111-111111111111", deps);
    expect(result.ok && result.notification.status).toBe("pending");
  });

  it("dead_letter -> attention", async () => {
    const deps = fakeDeps({ queryNotificationDelivery: vi.fn().mockResolvedValue(notificationRow({ status: "dead_letter", last_error_code: "PROVIDER_TIMEOUT" })) });
    const result = await getOwnerLeadDetail("11111111-1111-1111-1111-111111111111", deps);
    expect(result.ok && result.notification.status).toBe("attention");
  });

  it("a missing delivery row on a WEBSITE lead -> attention, with zeroed counters and null timestamps", async () => {
    const deps = fakeDeps({
      queryLeadById: vi.fn().mockResolvedValue(fakeLeadRow({ capture_channel: "website" })),
      queryNotificationDelivery: vi.fn().mockResolvedValue(null),
    });
    const result = await getOwnerLeadDetail("11111111-1111-1111-1111-111111111111", deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notification).toEqual({ status: "attention", attemptCount: 0, manualRequeueCount: 0, lastErrorCode: null, lastErrorAt: null, sentAt: null });
  });

  it.each(["phone", "whatsapp", "walk_in", "owner_manual"])(
    "a missing delivery row on a %s (non-website / Quick Add) lead -> not_required, never attention",
    async (channel) => {
      const deps = fakeDeps({
        queryLeadById: vi.fn().mockResolvedValue(fakeLeadRow({ capture_channel: channel as LeadDetailRow["capture_channel"] })),
        queryNotificationDelivery: vi.fn().mockResolvedValue(null),
      });
      const result = await getOwnerLeadDetail("11111111-1111-1111-1111-111111111111", deps);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.notification).toEqual({ status: "not_required", attemptCount: 0, manualRequeueCount: 0, lastErrorCode: null, lastErrorAt: null, sentAt: null });
    },
  );
});

describe("getOwnerLeadDetail — never leaks forbidden fields", () => {
  it("the fully serialized result never contains a forbidden internal field", async () => {
    const deps = fakeDeps({
      queryLeadFiles: vi.fn().mockResolvedValue([fakeFileRow()]),
      queryLeadActivities: vi.fn().mockResolvedValue([fakeActivityRow()]),
      queryNotificationDelivery: vi.fn().mockResolvedValue({ status: "sent", attempt_count: 1, manual_requeue_count: 0, last_error_code: null, last_error_at: null, sent_at: "2026-01-01T00:06:00.000Z" }),
    });
    const result = await getOwnerLeadDetail("11111111-1111-1111-1111-111111111111", deps);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(
      /submission_snapshot|payload_hash|idempotency_key|storage_path|upload_object_path|checksum_sha256|claim_token|provider_message_id|service_role|SUPABASE_SECRET_KEY/i,
    );
  });
});
