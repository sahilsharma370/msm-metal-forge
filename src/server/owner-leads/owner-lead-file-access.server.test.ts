import { describe, expect, it, vi } from "vitest";
import { getOwnerLeadFileAccess, type LeadFileAccessRow, type OwnerLeadFileAccessServiceDeps } from "./owner-lead-file-access.server";

const LEAD_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_LEAD_ID = "99999999-9999-9999-9999-999999999999";
const FILE_ID = "22222222-2222-2222-2222-222222222222";

function fakeFileRow(overrides: Partial<LeadFileAccessRow> = {}): LeadFileAccessRow {
  return { id: FILE_ID, lead_id: LEAD_ID, storage_path: "leads/11111111-1111-1111-1111-111111111111/slot-0-abc", upload_status: "complete", ...overrides };
}

function fakeDeps(overrides: Partial<OwnerLeadFileAccessServiceDeps> = {}): OwnerLeadFileAccessServiceDeps {
  return {
    queryLeadIsCompleted: vi.fn().mockResolvedValue(true),
    queryLeadFile: vi.fn().mockResolvedValue(fakeFileRow()),
    createSignedUrl: vi.fn().mockResolvedValue("https://example.test/storage/v1/object/sign/lead-files/leads/x?token=abc"),
    ...overrides,
  };
}

describe("getOwnerLeadFileAccess — happy path", () => {
  it("mints a signed URL for a completed lead's own complete-status file", async () => {
    const deps = fakeDeps();
    const result = await getOwnerLeadFileAccess(LEAD_ID, FILE_ID, deps);
    expect(result).toEqual({ ok: true, url: "https://example.test/storage/v1/object/sign/lead-files/leads/x?token=abc", expiresInSeconds: 60 });
  });

  it("passes the file's own storage_path (from the DB row, never caller input) and a 60s TTL to createSignedUrl", async () => {
    const deps = fakeDeps();
    await getOwnerLeadFileAccess(LEAD_ID, FILE_ID, deps);
    expect(deps.createSignedUrl).toHaveBeenCalledWith("leads/11111111-1111-1111-1111-111111111111/slot-0-abc", 60);
  });
});

describe("getOwnerLeadFileAccess — generic not_found collapsing", () => {
  it("a nonexistent lead returns not_found", async () => {
    const deps = fakeDeps({ queryLeadIsCompleted: vi.fn().mockResolvedValue(null) });
    const result = await getOwnerLeadFileAccess(LEAD_ID, FILE_ID, deps);
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("an incomplete lead returns the identical not_found", async () => {
    // PERF — queryLeadIsCompleted and queryLeadFile now run in parallel
    // (both are genuinely independent reads, neither depends on the
    // other's result), so queryLeadFile DOES still fire even when the
    // lead turns out to be incomplete — a deliberate trade-off: a little
    // extra (cheap, bounded) query work on this uncommon failure path in
    // exchange for real latency savings on the common, successful one.
    // createSignedUrl is the one step that must still never fire here —
    // it depends on queryLeadFile's own result (storage_path) and is only
    // reached after both parallel reads resolve and pass every check.
    const deps = fakeDeps({ queryLeadIsCompleted: vi.fn().mockResolvedValue(false) });
    const result = await getOwnerLeadFileAccess(LEAD_ID, FILE_ID, deps);
    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(deps.createSignedUrl).not.toHaveBeenCalled();
  });

  it("queryLeadIsCompleted and queryLeadFile run in parallel, not sequentially (PERF)", async () => {
    const order: string[] = [];
    const deps = fakeDeps({
      queryLeadIsCompleted: vi.fn().mockImplementation(async () => {
        order.push("isCompleted:start");
        await Promise.resolve();
        order.push("isCompleted:end");
        return true;
      }),
      queryLeadFile: vi.fn().mockImplementation(async () => {
        order.push("file:start");
        await Promise.resolve();
        order.push("file:end");
        return fakeFileRow();
      }),
    });
    await getOwnerLeadFileAccess(LEAD_ID, FILE_ID, deps);
    // Both start before either finishes — proof they're concurrent, not
    // one awaited start-to-finish before the other begins.
    expect(order.indexOf("file:start")).toBeLessThan(order.indexOf("isCompleted:end"));
  });

  it("a missing file returns the identical not_found", async () => {
    const deps = fakeDeps({ queryLeadFile: vi.fn().mockResolvedValue(null) });
    const result = await getOwnerLeadFileAccess(LEAD_ID, FILE_ID, deps);
    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(deps.createSignedUrl).not.toHaveBeenCalled();
  });

  it("a file belonging to a different lead returns the identical not_found — proves file.lead_id === requested leadId", async () => {
    const deps = fakeDeps({ queryLeadFile: vi.fn().mockResolvedValue(fakeFileRow({ lead_id: OTHER_LEAD_ID })) });
    const result = await getOwnerLeadFileAccess(LEAD_ID, FILE_ID, deps);
    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(deps.createSignedUrl).not.toHaveBeenCalled();
  });

  it.each(["pending", "failed"])("a file with upload_status=%s returns the identical not_found", async (uploadStatus) => {
    const deps = fakeDeps({ queryLeadFile: vi.fn().mockResolvedValue(fakeFileRow({ upload_status: uploadStatus as "pending" | "failed" })) });
    const result = await getOwnerLeadFileAccess(LEAD_ID, FILE_ID, deps);
    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(deps.createSignedUrl).not.toHaveBeenCalled();
  });
});

describe("getOwnerLeadFileAccess — Storage failure", () => {
  it("a null signedUrl from Storage maps to a distinct storage_error reason (never leaked to caller as not_found)", async () => {
    const deps = fakeDeps({ createSignedUrl: vi.fn().mockResolvedValue(null) });
    const result = await getOwnerLeadFileAccess(LEAD_ID, FILE_ID, deps);
    expect(result).toEqual({ ok: false, reason: "storage_error" });
  });
});
