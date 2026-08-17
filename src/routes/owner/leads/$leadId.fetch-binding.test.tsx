// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

/**
 * CHECKPOINT C2J-D2 — the detail route's equivalent of
 * ../index.fetch-binding.test.tsx: OwnerLeadDetailBody had the identical
 * unbound `fetchImpl: fetch` construction, and OwnerLeadDetailPage ->
 * OwnerLeadDetailView -> OwnerLeadFileViewer all reuse the same `deps`
 * object for the private signed-file access call — so this one test
 * proves both lead detail AND file access are fixed by the same change.
 * See that file's own header comment for the full "Illegal invocation"
 * mechanism and why a receiver-checking fetch double (not a plain mock)
 * is required to make this a genuine regression test.
 */
vi.mock("@/components/owner/owner-auth-client", () => ({
  createOwnerAuthClient: () => ({
    getAccessToken: async () => "fake-access-token-for-test",
    setSession: async () => undefined,
    signOut: async () => undefined,
  }),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
      <a href={to} {...props}>
        {children}
      </a>
    ),
  };
});

const { OwnerLeadDetailBody } = await import("./$leadId");

function receiverCheckingFetch(responseInit: { status: number; body: unknown }): typeof fetch {
  function impl(this: unknown, ..._args: Parameters<typeof fetch>): Promise<Response> {
    if (this !== globalThis) {
      throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
    }
    return Promise.resolve(
      new Response(JSON.stringify(responseInit.body), {
        status: responseInit.status,
        headers: { "content-type": "application/json; charset=utf-8" },
      }),
    );
  }
  return impl as unknown as typeof fetch;
}

// Same shape as the real local demo seller lead this checkpoint verified
// (one completed sell/copper enquiry with one uploaded photo).
const DEMO_SHAPED_DETAIL_RESPONSE = {
  ok: true,
  data: {
    lead: {
      id: "11111111-1111-1111-1111-111111111111",
      reference: "MSM-260817-6F6026",
      status: "new",
      intent: "sell",
      captureChannel: "website",
      material: "copper",
      materialSubtype: null,
      materialSubtypeOtherText: null,
      materialOtherText: null,
      createdAt: "2026-08-17T14:07:31.952Z",
      submissionCompletedAt: "2026-08-17T14:07:31.952Z",
      fileUploadStatus: "complete",
      contact: { name: "Demo Seller (C2J-D1 Local Test)", phone: "+971501112222", email: null, company: null },
      location: { emirate: "sharjah", area: "Industrial Area 12 (Demo)", mapLink: null },
      enquiry: {
        quantityValue: 250,
        quantityUnit: "kg",
        quantityUnitOther: null,
        quantityUnsure: false,
        condition: "clean_separated",
        description: null,
        pickupRequired: "yes",
        pickupDate: null,
        accessNote: null,
        preferredContact: "whatsapp",
        notes: null,
      },
    },
    files: [
      {
        id: "33333333-3333-3333-3333-333333333333",
        kind: "seller_photo",
        originalFilename: "demo-scrap-copper.jpg",
        mimeType: "image/jpeg",
        byteSize: 128,
        uploadedAt: "2026-08-17T14:07:31.952Z",
        uploadStatus: "complete",
      },
    ],
    activities: [],
    notification: { status: "pending", attemptCount: 0, manualRequeueCount: 0, lastErrorCode: null, lastErrorAt: null, sentAt: null },
  },
};

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

describe("OwnerLeadDetailBody — real fetch-binding regression (C2J-D2)", () => {
  it("loads the demo seller lead's detail (and its file) successfully when fetchImpl is properly bound", async () => {
    globalThis.fetch = receiverCheckingFetch({ status: 200, body: DEMO_SHAPED_DETAIL_RESPONSE });
    render(<OwnerLeadDetailBody leadId="11111111-1111-1111-1111-111111111111" onUnauthorized={vi.fn()} registerRefresh={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole("heading", { name: /demo seller/i })).toBeInTheDocument());
    expect(screen.getByText(/demo-scrap-copper\.jpg/i)).toBeInTheDocument();
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/couldn't be found/i)).not.toBeInTheDocument();
  });
});
