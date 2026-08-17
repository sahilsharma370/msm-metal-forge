// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { OwnerLeadStatusControl } from "./OwnerLeadStatusControl";

/**
 * Radix Select requires pointer-capture/scrollIntoView APIs jsdom does not
 * implement — polyfilled here (a well-established pattern for testing
 * Radix primitives under jsdom) so real open/select interactions can be
 * exercised rather than only testing around the dropdown.
 */
beforeEach(() => {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => {
  cleanup();
});

function renderControl(overrides: Partial<Parameters<typeof OwnerLeadStatusControl>[0]> = {}) {
  const onChangeStatus = vi.fn().mockResolvedValue({ ok: true });
  const onClearError = vi.fn();
  render(
    <OwnerLeadStatusControl
      currentStatus="new"
      isSaving={false}
      error={null}
      onChangeStatus={onChangeStatus}
      onClearError={onClearError}
      {...overrides}
    />,
  );
  return { onChangeStatus, onClearError };
}

describe("OwnerLeadStatusControl — initial state", () => {
  it("shows the current status and a disabled Save button (no pending change)", () => {
    renderControl({ currentStatus: "contacted" });
    expect(screen.getByRole("combobox")).toHaveTextContent("Contacted");
    expect(screen.getByRole("button", { name: /save status/i })).toBeDisabled();
  });

  it("does not show the lost-reason field when the current status isn't lost", () => {
    renderControl({ currentStatus: "new" });
    expect(screen.queryByLabelText(/reason lead was lost/i)).not.toBeInTheDocument();
  });
});

describe("OwnerLeadStatusControl — selecting a new status", () => {
  it("enables Save and calls onChangeStatus with the expected/new status on save", async () => {
    const user = userEvent.setup();
    const { onChangeStatus } = renderControl({ currentStatus: "new" });

    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Contacted" }));

    const saveButton = screen.getByRole("button", { name: /save status/i });
    await waitFor(() => expect(saveButton).toBeEnabled());
    await user.click(saveButton);

    expect(onChangeStatus).toHaveBeenCalledWith({ expectedStatus: "new", newStatus: "contacted", lostReason: null });
  });

  it("shows a reason field only after selecting 'Lost', and blocks Save until a reason is entered", async () => {
    const user = userEvent.setup();
    const { onChangeStatus } = renderControl({ currentStatus: "new" });

    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Lost" }));

    const reasonField = await screen.findByLabelText(/reason lead was lost/i);
    const saveButton = screen.getByRole("button", { name: /save status/i });
    expect(saveButton).toBeDisabled();

    await user.type(reasonField, "Went with a competitor");
    await waitFor(() => expect(saveButton).toBeEnabled());
    await user.click(saveButton);

    expect(onChangeStatus).toHaveBeenCalledWith({ expectedStatus: "new", newStatus: "lost", lostReason: "Went with a competitor" });
  });
});

describe("OwnerLeadStatusControl — saving/error/success feedback", () => {
  it("disables the Select and Save button while isSaving", () => {
    renderControl({ isSaving: true });
    expect(screen.getByRole("combobox")).toBeDisabled();
    expect(screen.getByRole("button", { name: /saving/i })).toBeDisabled();
  });

  it("renders a server-provided error message", () => {
    renderControl({ error: "This lead was already updated. Please refresh and try again." });
    expect(screen.getByText(/already updated/i)).toBeInTheDocument();
  });

  it("resets its pending selection to a new currentStatus prop (e.g. after a conflict refetch)", () => {
    const { rerender } = render(
      <OwnerLeadStatusControl currentStatus="new" isSaving={false} error={null} onChangeStatus={vi.fn()} onClearError={vi.fn()} />,
    );
    rerender(<OwnerLeadStatusControl currentStatus="quote_sent" isSaving={false} error={null} onChangeStatus={vi.fn()} onClearError={vi.fn()} />);
    expect(screen.getByRole("combobox")).toHaveTextContent("Quote sent");
    expect(screen.getByRole("button", { name: /save status/i })).toBeDisabled();
  });
});
