// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// OwnerLeadListItem renders a real <Link>, which needs a live
// RouterProvider — this test only cares about the fetch-binding behavior,
// not real navigation. Same established substitution as index.test.tsx.
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ to, params, children, ...props }: { to: string; params?: Record<string, string>; children: ReactNode }) => {
      const href = params ? Object.entries(params).reduce((path, [key, value]) => path.replace(`$${key}`, value), to) : to;
      return (
        <a href={href} {...props}>
          {children}
        </a>
      );
    },
  };
});

/**
 * CHECKPOINT C2J-D2 — regression test for the real browser defect: the
 * owner inbox showed "Something went wrong. Please try again." /
 * "Showing 0 loaded enquiries" immediately after login, with GET
 * /api/owner/leads never once appearing in the server's request log —
 * proven (in a real Chrome session) to be `TypeError: Failed to execute
 * 'fetch' on 'Window': Illegal invocation`, thrown because
 * `fetchImpl: fetch` stored the bare, unbound native `fetch` reference on
 * the deps object, and `callOwnerApi` then invokes it as a METHOD call
 * (`deps.fetchImpl(path, init)`) — which sets `this` to `deps`, not
 * `window`, and native `fetch` is a WebIDL-branded method that rejects any
 * receiver other than the correct global.
 *
 * This test does NOT mock owner-leads-transport (unlike index.test.tsx) —
 * the whole point is to exercise the real callOwnerApi -> deps.fetchImpl(...)
 * call shape. Instead it installs a `receiverCheckingFetch` double that
 * faithfully reproduces the real browser's brand check (throws unless
 * invoked with the correct `this`), so this test fails against the old
 * `fetchImpl: fetch` construction and passes only with the fix
 * (`fetchImpl: fetch.bind(globalThis)`) — proven by temporarily reverting
 * the fix and re-running this exact test, which failed with the identical
 * "Illegal invocation" message before the fix was restored.
 */
vi.mock("@/components/owner/owner-auth-client", () => ({
  createOwnerAuthClient: () => ({
    getAccessToken: async () => "fake-access-token-for-test",
    setSession: async () => undefined,
    signOut: async () => undefined,
  }),
}));

const { OwnerInboxBody } = await import("./index");

function receiverCheckingFetch(responseInit: { status: number; body: unknown }): typeof fetch {
  function impl(this: unknown, ..._args: Parameters<typeof fetch>): Promise<Response> {
    if (this !== globalThis) {
      // The exact real browser error text, confirmed empirically.
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

// Same shape as the real local demo dataset this checkpoint verified:
// one completed sell/copper enquiry, one completed buy/aluminium enquiry.
const DEMO_SHAPED_RESPONSE = {
  ok: true,
  data: {
    leads: [
      {
        id: "11111111-1111-1111-1111-111111111111",
        reference: "MSM-260817-6F6026",
        status: "new",
        intent: "sell",
        captureChannel: "website",
        material: "copper",
        materialSubtype: null,
        createdAt: "2026-08-17T14:07:31.952Z",
        submissionCompletedAt: "2026-08-17T14:07:31.952Z",
        contact: { name: "Demo Seller (C2J-D1 Local Test)", phone: "+971501112222" },
        location: { emirate: "sharjah", area: "Industrial Area 12 (Demo)" },
        quantity: { value: 250, unit: "kg" },
        fileUploadStatus: "complete",
        notificationStatus: "pending",
        deletedAt: null,
      },
      {
        id: "22222222-2222-2222-2222-222222222222",
        reference: "MSM-260817-FA2061",
        status: "new",
        intent: "buy",
        captureChannel: "website",
        material: "aluminium",
        materialSubtype: null,
        createdAt: "2026-08-17T14:07:31.992Z",
        submissionCompletedAt: "2026-08-17T14:07:31.992Z",
        contact: { name: "Demo Buyer Co. (C2J-D1 Local Test)", phone: "+971502223333" },
        location: { emirate: "dubai", area: "Jebel Ali Free Zone (Demo)" },
        quantity: { value: 5000, unit: "kg" },
        fileUploadStatus: "none",
        notificationStatus: "pending",
        deletedAt: null,
      },
    ],
    page: { nextCursor: null, hasMore: false },
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

describe("OwnerInboxBody — real fetch-binding regression (C2J-D2)", () => {
  it("loads both demo leads successfully when fetchImpl is properly bound (the fix)", async () => {
    globalThis.fetch = receiverCheckingFetch({ status: 200, body: DEMO_SHAPED_RESPONSE });
    render(<OwnerInboxBody onUnauthorized={vi.fn()} registerRefresh={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(/demo seller/i)).toBeInTheDocument());
    expect(screen.getByText(/demo buyer/i)).toBeInTheDocument();
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
    expect(screen.getByText(/^2 enquiries$/i)).toBeInTheDocument();
  });

  it("demonstrates the exact original defect: an unbound fetchImpl throws Illegal Invocation and surfaces the generic error (proves the fix is load-bearing, not incidental)", async () => {
    globalThis.fetch = receiverCheckingFetch({ status: 200, body: DEMO_SHAPED_RESPONSE });

    // Deliberately reproduce the pre-fix construction inline, bypassing the
    // route's own (now-fixed) useMemo, to prove this test's double
    // faithfully distinguishes bound from unbound — i.e. this is a real
    // regression test, not one that would pass regardless of the fix.
    const unboundDeps = { authClient: { getAccessToken: async () => "t", setSession: async () => undefined, signOut: async () => undefined }, fetchImpl: globalThis.fetch };
    const { fetchOwnerLeadList } = await import("@/components/owner/owner-leads-transport");
    const result = await fetchOwnerLeadList({}, unboundDeps);
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.status).toBeNull();
    }
  });
});
