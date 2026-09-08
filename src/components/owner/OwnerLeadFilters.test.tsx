// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { OwnerLeadFilters } from "./OwnerLeadFilters";
import type { OwnerLeadListFilters } from "./use-owner-lead-list";

/**
 * CHECKPOINT OWNER DESKTOP CORRECTION — Radix Select requires pointer-
 * capture/scrollIntoView APIs jsdom does not implement, polyfilled here the
 * same way OwnerLeadStatusControl.test.tsx already does for its own Select
 * usage, so real open/select interactions can be exercised.
 */
beforeEach(() => {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => {
  cleanup();
});

function renderFilters(draftFilters: OwnerLeadListFilters = {}, view: "inbox" | "archived" | "trash" = "inbox") {
  const setDraftFilters = vi.fn<(updater: (previous: OwnerLeadListFilters) => OwnerLeadListFilters) => void>();
  const onApply = vi.fn();
  const onClear = vi.fn();
  render(
    <OwnerLeadFilters
      draftFilters={draftFilters}
      setDraftFilters={setDraftFilters}
      onApply={onApply}
      onClear={onClear}
      hasActiveFilters={Object.keys(draftFilters).length > 0}
      isBusy={false}
      view={view}
    />,
  );
  return { setDraftFilters, onApply, onClear };
}

describe("OwnerLeadFilters — Status select (matte dropdown, not a native <select>)", () => {
  it("opens a real popover with every status option, not OS-native chrome", async () => {
    const user = userEvent.setup();
    renderFilters();
    const trigger = screen.getByRole("combobox", { name: /status/i });
    expect(trigger.tagName).not.toBe("SELECT");

    await user.click(trigger);
    expect(await screen.findByRole("option", { name: "New" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "All statuses" })).toBeInTheDocument();
  });

  it("selecting a status updates the draft filter to that status", async () => {
    const user = userEvent.setup();
    const { setDraftFilters } = renderFilters();

    await user.click(screen.getByRole("combobox", { name: /status/i }));
    await user.click(await screen.findByRole("option", { name: "Contacted" }));

    expect(setDraftFilters).toHaveBeenCalled();
    const updater = setDraftFilters.mock.calls.at(-1)![0];
    expect(updater({})).toEqual({ status: "contacted" });
  });

  it("selecting 'All statuses' clears the filter key entirely (never an empty-string value)", async () => {
    const user = userEvent.setup();
    const { setDraftFilters } = renderFilters({ status: "contacted" });

    await user.click(screen.getByRole("combobox", { name: /status/i }));
    await user.click(await screen.findByRole("option", { name: "All statuses" }));

    const updater = setDraftFilters.mock.calls.at(-1)![0];
    expect(updater({ status: "contacted" })).toEqual({});
  });
});

describe("OwnerLeadFilters — CHECKPOINT OWNER DESKTOP CORRECTION (compact filters pass)", () => {
  it("never renders an Apply button", () => {
    renderFilters();
    expect(screen.queryByRole("button", { name: /^apply$/i })).not.toBeInTheDocument();
  });

  it("selecting a dropdown value applies immediately, computed against the current draftFilters", async () => {
    const user = userEvent.setup();
    const { onApply } = renderFilters({ material: "copper" });

    await user.click(screen.getByRole("combobox", { name: /status/i }));
    await user.click(await screen.findByRole("option", { name: "Contacted" }));

    expect(onApply).toHaveBeenCalledWith({ material: "copper", status: "contacted" });
  });

  it("selecting 'All statuses' applies immediately with the key removed entirely", async () => {
    const user = userEvent.setup();
    const { onApply } = renderFilters({ status: "contacted" });

    await user.click(screen.getByRole("combobox", { name: /status/i }));
    await user.click(await screen.findByRole("option", { name: "All statuses" }));

    expect(onApply).toHaveBeenCalledWith({});
  });

  it("Reset is not rendered at all when no filter is active", () => {
    renderFilters({});
    expect(screen.queryByRole("button", { name: /reset/i })).not.toBeInTheDocument();
  });

  it("Reset appears once a filter is active and calls onClear when clicked", async () => {
    const user = userEvent.setup();
    const setDraftFilters = vi.fn();
    const onApply = vi.fn();
    const onClear = vi.fn();
    render(
      <OwnerLeadFilters
        draftFilters={{ status: "contacted" }}
        setDraftFilters={setDraftFilters}
        onApply={onApply}
        onClear={onClear}
        hasActiveFilters
        isBusy={false}
      />,
    );
    const resetButton = screen.getByRole("button", { name: /reset/i });
    await user.click(resetButton);
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("debounces the search input, applying only once typing pauses", () => {
    vi.useFakeTimers();
    try {
      const { onApply } = renderFilters({ material: "copper" });
      const search = screen.getByLabelText(/search/i);

      fireEvent.change(search, { target: { value: "A" } });
      vi.advanceTimersByTime(200);
      fireEvent.change(search, { target: { value: "Ahmed" } }); // resets the pending debounce
      expect(onApply).not.toHaveBeenCalled();

      vi.advanceTimersByTime(400);
      expect(onApply).toHaveBeenCalledTimes(1);
      expect(onApply).toHaveBeenLastCalledWith({ material: "copper", q: "Ahmed" });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("OwnerLeadFilters — Inbox status filter cleanup (CHECKPOINT OWNER DESKTOP CORRECTION)", () => {
  it("hides 'Archived' from the Status options in the Inbox view (default), since Archived already has its own tab", async () => {
    const user = userEvent.setup();
    renderFilters({}, "inbox");
    await user.click(screen.getByRole("combobox", { name: /status/i }));
    expect(await screen.findByRole("option", { name: "New" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Archived" })).not.toBeInTheDocument();
  });

  it("still offers 'Archived' as a Status option in the Archived view", async () => {
    const user = userEvent.setup();
    renderFilters({}, "archived");
    await user.click(screen.getByRole("combobox", { name: /status/i }));
    expect(await screen.findByRole("option", { name: "Archived" })).toBeInTheDocument();
  });

  it("caps the Status popover height and makes it internally scrollable", async () => {
    const user = userEvent.setup();
    renderFilters({}, "inbox");
    await user.click(screen.getByRole("combobox", { name: /status/i }));
    const listbox = await screen.findByRole("listbox");
    expect(listbox.className).toMatch(/max-h-\[min\(260px/);
  });
});

describe("OwnerLeadFilters — disabled while busy", () => {
  it("disables every Select trigger and the search input while isBusy", () => {
    const setDraftFilters = vi.fn();
    render(
      <OwnerLeadFilters
        draftFilters={{}}
        setDraftFilters={setDraftFilters}
        onApply={vi.fn()}
        onClear={vi.fn()}
        hasActiveFilters={false}
        isBusy
      />,
    );
    expect(screen.getByRole("combobox", { name: /status/i })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: /type/i })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: /material/i })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: /channel/i })).toBeDisabled();
    expect(screen.getByLabelText(/search/i)).toBeDisabled();
  });
});
