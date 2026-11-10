// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { createGoToLogin } from "./owner";

/**
 * CHECKPOINT — isolation: every unauthenticated/unauthorized redirect must
 * clear the shared owner data cache first, whichever call site triggered
 * it. OwnerShell.tsx's own bootstrap guard already covered its own two
 * call sites (no local token; a rejected/expired session) and
 * handleLogout; this is the ONE additional call site those didn't cover —
 * a child route's own data call (lead list/detail/overview) failing with
 * 401 after the shell already confirmed authorization at mount, which
 * reaches here via useOwnerShellContext().onUnauthorized() ->
 * goToLogin("unauthorized"). Before this fix, that path redirected without
 * clearing anything.
 */
describe("createGoToLogin — isolation: an in-app API 401 clears the owner cache before redirecting", () => {
  it("clears every cached owner query before navigating to /owner/login", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["owner", "leads", "list", "inbox", {}], { items: ["stale"] });
    queryClient.setQueryData(["owner", "leads", "overview"], { kpis: "stale" });
    queryClient.setQueryData(["owner", "leads", "detail", "lead-1"], { stale: true });

    const navigate = vi.fn();
    const goToLogin = createGoToLogin(queryClient, navigate);

    goToLogin("unauthorized");

    expect(queryClient.getQueryData(["owner", "leads", "list", "inbox", {}])).toBeUndefined();
    expect(queryClient.getQueryData(["owner", "leads", "overview"])).toBeUndefined();
    expect(queryClient.getQueryData(["owner", "leads", "detail", "lead-1"])).toBeUndefined();
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("clears the cache for an unauthenticated redirect too (no local token at all)", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["owner", "leads", "list", "inbox", {}], { items: ["stale"] });

    const navigate = vi.fn();
    createGoToLogin(queryClient, navigate)("unauthenticated");

    expect(queryClient.getQueryData(["owner", "leads", "list", "inbox", {}])).toBeUndefined();
  });

  it("navigates with the current path as the redirect target and the given reason", () => {
    const queryClient = new QueryClient();
    const navigate = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, pathname: "/owner/leads/lead-1", search: "?foo=bar" },
    });

    try {
      createGoToLogin(queryClient, navigate)("unauthorized");
      expect(navigate).toHaveBeenCalledWith({
        to: "/owner/login",
        search: { redirect: "/owner/leads/lead-1?foo=bar", reason: "unauthorized" },
      });
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
    }
  });
});
