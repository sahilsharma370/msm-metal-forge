// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

/**
 * CHECKPOINT OWNER ENQUIRIES SIX-CIRCLE PASS — OwnerNav computes its own
 * active-section state from `useRouterState`'s pathname directly (not
 * Link's own activeProps/exact matching — see OwnerNav.tsx's own header
 * comment for why). `useRouterState` is mocked per test to a fixed
 * pathname here, exactly like OwnerLeadInbox.test.tsx stubs `Link` for the
 * identical reason (no real router context in these renders).
 */
let currentPathname = "/owner";
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
      <a href={to} {...props}>
        {children}
      </a>
    ),
    useRouterState: () => currentPathname,
  };
});

const { OwnerNav } = await import("./OwnerNav");

afterEach(() => {
  cleanup();
});

function renderAt(pathname: string) {
  currentPathname = pathname;
  render(<OwnerNav />);
}

/** Both the mobile pill nav and the desktop underline nav render an identical-text Enquiries/Overview link — `getAllByRole` always returns 2 (one per breakpoint-gated <nav>, only one of which is ever visually shown); checking both stay consistent is the point, not redundant. */
function enquiriesLinks() {
  return screen.getAllByRole("link", { name: /enquiries/i });
}
function overviewLinks() {
  return screen.getAllByRole("link", { name: /overview/i });
}

describe("OwnerNav — Enquiries stays active on its detail/edit/Add-enquiry routes (CHECKPOINT OWNER ENQUIRIES SIX-CIRCLE PASS)", () => {
  it("is active on the bare Enquiries list", () => {
    renderAt("/owner");
    for (const link of enquiriesLinks()) expect(link.className).toMatch(/border-copper/);
  });

  it("is active on a lead's detail route", () => {
    renderAt("/owner/leads/11111111-1111-1111-1111-111111111111");
    for (const link of enquiriesLinks()) expect(link.className).toMatch(/border-copper/);
  });

  it("is active on a lead's edit route", () => {
    renderAt("/owner/leads/11111111-1111-1111-1111-111111111111/edit");
    for (const link of enquiriesLinks()) expect(link.className).toMatch(/border-copper/);
  });

  it("is active on Add Enquiry", () => {
    renderAt("/owner/leads/new");
    for (const link of enquiriesLinks()) expect(link.className).toMatch(/border-copper/);
  });

  it("is NOT active on Overview — the two sections stay mutually exclusive", () => {
    renderAt("/owner/overview");
    for (const link of enquiriesLinks()) expect(link.className).not.toMatch(/border-copper/);
    for (const link of overviewLinks()) expect(link.className).toMatch(/border-copper/);
  });
});
