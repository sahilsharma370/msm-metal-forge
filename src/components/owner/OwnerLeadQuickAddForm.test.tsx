// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { OwnerLeadQuickAddForm } from "./OwnerLeadQuickAddForm";

afterEach(() => {
  cleanup();
});

function renderForm(overrides: Partial<Parameters<typeof OwnerLeadQuickAddForm>[0]> = {}) {
  const onSubmit = vi.fn().mockResolvedValue({ ok: true, leadId: "11111111-1111-1111-1111-111111111111", reference: "MSM-260101-ABCDEF" });
  const onClearError = vi.fn();
  const onOpenLead = vi.fn();
  render(
    <OwnerLeadQuickAddForm isSubmitting={false} error={null} onSubmit={onSubmit} onClearError={onClearError} onOpenLead={onOpenLead} {...overrides} />,
  );
  return { onSubmit, onClearError, onOpenLead };
}

async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/contact name/i), "Ahmed");
  await user.type(screen.getByLabelText(/phone \/ whatsapp/i), "+971501234567");
}

describe("OwnerLeadQuickAddForm — required-field gating", () => {
  it("disables Save enquiry until contact name and phone are entered", () => {
    renderForm();
    expect(screen.getByRole("button", { name: /save enquiry/i })).toBeDisabled();
  });

  it("enables Save enquiry once the required fields are valid", async () => {
    const user = userEvent.setup();
    renderForm();
    await fillRequiredFields(user);
    await waitFor(() => expect(screen.getByRole("button", { name: /save enquiry/i })).toBeEnabled());
  });

  it("rejects an invalid phone number", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText(/contact name/i), "Ahmed");
    await user.type(screen.getByLabelText(/phone \/ whatsapp/i), "not-a-phone");
    expect(screen.getByRole("button", { name: /save enquiry/i })).toBeDisabled();
  });

  it("requires a description when material is 'other'", async () => {
    const user = userEvent.setup();
    renderForm();
    await fillRequiredFields(user);
    await user.selectOptions(screen.getByLabelText(/^material$/i), "other");
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
    const user = userEvent.setup();
    renderForm();
    await user.selectOptions(screen.getByLabelText(/enquiry type/i), "buy");
    expect(screen.queryByLabelText(/emirate/i)).not.toBeInTheDocument();
  });
});

describe("OwnerLeadQuickAddForm — submit", () => {
  it("submits the parsed, validated values", async () => {
    const user = userEvent.setup();
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
    const user = userEvent.setup();
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
    const user = userEvent.setup();
    const { onOpenLead } = renderForm();
    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: /save enquiry/i }));
    await waitFor(() => expect(screen.getByText("MSM-260101-ABCDEF")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /open enquiry/i }));
    expect(onOpenLead).toHaveBeenCalledWith("11111111-1111-1111-1111-111111111111");
  });

  it("'Add another enquiry' returns to a blank form", async () => {
    const user = userEvent.setup();
    renderForm();
    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: /save enquiry/i }));
    await waitFor(() => expect(screen.getByText("MSM-260101-ABCDEF")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /add another enquiry/i }));
    expect(screen.getByLabelText(/contact name/i)).toBeInTheDocument();
    expect((screen.getByLabelText(/contact name/i) as HTMLInputElement).value).toBe("");
  });
});
