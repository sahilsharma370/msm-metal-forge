// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { OwnerLeadQuickAddForm } from "./OwnerLeadQuickAddForm";

/**
 * MEASURED ROOT CAUSE (full-suite flake: timeouts + scrambled typed values,
 * e.g. "Ahmed" -> "5A6h7med") — confirmed via an isolated vitest probe that
 * a test timing out does NOT cancel its own in-flight async work: the
 * orphaned continuation keeps running and can fire real DOM events during
 * whichever test runs next in the same file. `userEvent.setup()`'s default
 * `type()` inserts a real per-keystroke `setTimeout` delay between
 * characters; under full-suite parallel CPU contention, an 18-character
 * two-field sequence (name + phone) can legitimately exceed the 5000ms
 * default `testTimeout`, and once one test times out this way, its still-
 * pending keystroke timers land on the NEXT test's freshly focused input —
 * exactly the interleaved-digit corruption observed. `{ delay: null }`
 * removes the artificial real-timer delay between keystrokes (the
 * documented `@testing-library/user-event` option for this), which both
 * keeps every test here comfortably under the timeout and removes the
 * window during which an abandoned test's typing could still be in flight
 * when the next one starts. No application code or product behavior
 * changed — this is scoped entirely to this file's own `userEvent.setup()`
 * calls.
 *
 * CHECKPOINT C2M-A — the form's selects moved from native `<select>` to the
 * repository's Radix-based Select primitive. Radix requires pointer-capture/
 * scrollIntoView APIs jsdom does not implement — same established polyfill
 * pattern already used for every other Radix Select test in this codebase.
 */
beforeEach(() => {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => {
  cleanup();
});

/** Opens a labelled Radix Select combobox and clicks the option with the given accessible name — the click-trigger/click-option replacement for `userEvent.selectOptions`, which only works on a native `<select>`. */
async function selectRadixOption(user: ReturnType<typeof userEvent.setup>, labelText: RegExp, optionName: string) {
  await user.click(screen.getByLabelText(labelText));
  await user.click(await screen.findByRole("option", { name: optionName }));
}

function renderForm(overrides: Partial<Parameters<typeof OwnerLeadQuickAddForm>[0]> = {}) {
  const onSubmit = vi.fn().mockResolvedValue({ ok: true, leadId: "11111111-1111-1111-1111-111111111111", reference: "MSM-260101-ABCDEF" });
  const onClearError = vi.fn();
  const onOpenLead = vi.fn();
  const onCancel = vi.fn();
  render(
    <OwnerLeadQuickAddForm
      isSubmitting={false}
      error={null}
      onSubmit={onSubmit}
      onClearError={onClearError}
      onOpenLead={onOpenLead}
      onCancel={onCancel}
      {...overrides}
    />,
  );
  return { onSubmit, onClearError, onOpenLead, onCancel };
}

async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/contact name/i), "Ahmed");
  await user.type(screen.getByLabelText(/phone \/ whatsapp/i), "+971501234567");
}

describe("OwnerLeadQuickAddForm — contact name field (CHECKPOINT OWNER DESKTOP CORRECTION — capitalization pass)", () => {
  it("hints mobile keyboards to auto-capitalize each word, without changing the submission contract", () => {
    renderForm();
    expect(screen.getByLabelText(/contact name/i)).toHaveAttribute("autoCapitalize", "words");
  });
});

describe("OwnerLeadQuickAddForm — required-field gating", () => {
  it("disables Save enquiry until contact name and phone are entered", () => {
    renderForm();
    expect(screen.getByRole("button", { name: /save enquiry/i })).toBeDisabled();
  });

  it("enables Save enquiry once the required fields are valid", async () => {
    const user = userEvent.setup({ delay: null });
    renderForm();
    await fillRequiredFields(user);
    await waitFor(() => expect(screen.getByRole("button", { name: /save enquiry/i })).toBeEnabled());
  });

  it("rejects an invalid phone number", async () => {
    const user = userEvent.setup({ delay: null });
    renderForm();
    await user.type(screen.getByLabelText(/contact name/i), "Ahmed");
    await user.type(screen.getByLabelText(/phone \/ whatsapp/i), "not-a-phone");
    expect(screen.getByRole("button", { name: /save enquiry/i })).toBeDisabled();
  });

  it("requires a description when material is 'other'", async () => {
    const user = userEvent.setup({ delay: null });
    renderForm();
    await fillRequiredFields(user);
    await selectRadixOption(user, /^material$/i, "Other");
    expect(screen.getByRole("button", { name: /save enquiry/i })).toBeDisabled();
    await user.type(screen.getByLabelText(/describe the material/i), "Mixed cable scrap");
    await waitFor(() => expect(screen.getByRole("button", { name: /save enquiry/i })).toBeEnabled());
  });
});

describe("OwnerLeadQuickAddForm — seller/buyer branching", () => {
  it("shows seller location fields for a sell-intent enquiry by default", () => {
    renderForm();
    expect(screen.getByLabelText(/emirate/i)).toBeInTheDocument();
  });

  it("hides seller location fields when intent is switched to buying", async () => {
    const user = userEvent.setup({ delay: null });
    renderForm();
    await selectRadixOption(user, /enquiry type/i, "Buying");
    expect(screen.queryByLabelText(/emirate/i)).not.toBeInTheDocument();
  });
});

describe("OwnerLeadQuickAddForm — Select primitive (CHECKPOINT C2M-A)", () => {
  it("uses the accessible Select primitive, never a native <select>, for enquiry type/channel/material", () => {
    renderForm();
    expect(screen.getByLabelText(/enquiry type/i).tagName).not.toBe("SELECT");
    expect(screen.getByLabelText(/how it came in/i).tagName).not.toBe("SELECT");
    expect(screen.getByLabelText(/^material$/i).tagName).not.toBe("SELECT");
  });

  it("shows the concise note helper text", () => {
    renderForm();
    expect(screen.getByText(/specifications, logistics or other details collected during the conversation/i)).toBeInTheDocument();
  });
});

describe("OwnerLeadQuickAddForm — submit", () => {
  it("submits the parsed, validated values", async () => {
    const user = userEvent.setup({ delay: null });
    const { onSubmit } = renderForm();
    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: /save enquiry/i }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ intent: "sell", channel: "phone", material: "copper", contactName: "Ahmed", contactPhone: "+971501234567" }),
    );
  });

  it("disables the submit control while isSubmitting", () => {
    renderForm({ isSubmitting: true });
    expect(screen.getByRole("button", { name: /saving/i })).toBeDisabled();
  });

  it("renders a server-provided error message", () => {
    renderForm({ error: "Something went wrong. Please try again." });
    expect(screen.getByText("Something went wrong. Please try again.")).toBeInTheDocument();
  });
});

describe("OwnerLeadQuickAddForm — failure preserves entered input", () => {
  it("a failed submission leaves the typed fields untouched", async () => {
    const user = userEvent.setup({ delay: null });
    const onSubmit = vi.fn().mockResolvedValue({ ok: false, message: "Something went wrong. Please try again." });
    renderForm({ onSubmit });
    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: /save enquiry/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect((screen.getByLabelText(/contact name/i) as HTMLInputElement).value).toBe("Ahmed");
    expect((screen.getByLabelText(/phone \/ whatsapp/i) as HTMLInputElement).value).toBe("+971501234567");
  });
});

describe("OwnerLeadQuickAddForm — success shows the genuine reference and an open-lead action", () => {
  it("shows the reference and calls onOpenLead with the created lead id", async () => {
    const user = userEvent.setup({ delay: null });
    const { onOpenLead } = renderForm();
    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: /save enquiry/i }));
    await waitFor(() => expect(screen.getByText("MSM-260101-ABCDEF")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /open enquiry/i }));
    expect(onOpenLead).toHaveBeenCalledWith("11111111-1111-1111-1111-111111111111");
  });

  it("'Add another enquiry' returns to a blank form", async () => {
    const user = userEvent.setup({ delay: null });
    renderForm();
    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: /save enquiry/i }));
    await waitFor(() => expect(screen.getByText("MSM-260101-ABCDEF")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /add another enquiry/i }));
    expect(screen.getByLabelText(/contact name/i)).toBeInTheDocument();
    expect((screen.getByLabelText(/contact name/i) as HTMLInputElement).value).toBe("");
  });
});

describe("OwnerLeadQuickAddForm — cancel (OWNER DESKTOP REFINEMENT)", () => {
  it("calls onCancel when the footer Cancel button is clicked", async () => {
    const user = userEvent.setup({ delay: null });
    const { onCancel } = renderForm();
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when the Back to enquiries control is clicked", async () => {
    const user = userEvent.setup({ delay: null });
    const { onCancel } = renderForm();
    await user.click(screen.getByRole("button", { name: /back to enquiries/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
