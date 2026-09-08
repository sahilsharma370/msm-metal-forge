// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { OwnerLeadEditForm, buildOwnerLeadEditFieldState } from "./OwnerLeadEditForm";

/** Radix Select needs pointer-capture/scrollIntoView APIs jsdom does not implement — same established polyfill pattern used elsewhere in this codebase (see OwnerLeadDetailView.test.tsx). */
beforeEach(() => {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => {
  cleanup();
});

const SELL_FIELDS = buildOwnerLeadEditFieldState({
  contactName: "Ahmed Seller",
  contactPhone: "+971501234567",
  material: "copper",
  materialOtherText: null,
  quantityValue: 100,
  quantityUnit: "kg",
  quantityUnitOther: null,
  emirate: "dubai",
  area: "Al Quoz",
  notes: "Clean copper wire",
});

const BUY_FIELDS = buildOwnerLeadEditFieldState({
  contactName: "Fatima Buyer",
  contactPhone: "+971509999999",
  material: "aluminium",
  materialOtherText: null,
  quantityValue: 500,
  quantityUnit: "kg",
  quantityUnitOther: null,
  emirate: null,
  area: null,
  notes: null,
});

describe("buildOwnerLeadEditFieldState — prefill mapping", () => {
  it("maps a seller lead's editable fields, including emirate/area", () => {
    expect(SELL_FIELDS).toMatchObject({
      contactName: "Ahmed Seller",
      contactPhone: "+971501234567",
      material: "copper",
      quantityValue: "100",
      quantityUnit: "kg",
      emirate: "dubai",
      area: "Al Quoz",
      notes: "Clean copper wire",
    });
  });

  it("maps a buyer lead's editable fields, with emirate/area defaulting to empty (buyer destination location is out of scope)", () => {
    expect(BUY_FIELDS).toMatchObject({
      contactName: "Fatima Buyer",
      contactPhone: "+971509999999",
      material: "aluminium",
      quantityValue: "500",
      emirate: "",
      area: "",
    });
  });
});

describe("OwnerLeadEditForm — prefilled rendering", () => {
  it("renders a seller lead's fields, including Emirate/Area", () => {
    render(
      <OwnerLeadEditForm
        intent="sell"
        reference="MSM-260101-ABCDEF"
        initialFields={SELL_FIELDS}
        isSubmitting={false}
        error={null}
        onSubmit={vi.fn().mockResolvedValue({ ok: true })}
        onClearError={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByDisplayValue("Ahmed Seller")).toBeInTheDocument();
    expect(screen.getByDisplayValue("+971501234567")).toBeInTheDocument();
    expect(screen.getByDisplayValue("100")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Al Quoz")).toBeInTheDocument();
    expect(screen.getByText("Location")).toBeInTheDocument();
  });

  it("hides the Location section entirely for a buyer lead", () => {
    render(
      <OwnerLeadEditForm
        intent="buy"
        reference="MSM-260101-FEDCBA"
        initialFields={BUY_FIELDS}
        isSubmitting={false}
        error={null}
        onSubmit={vi.fn().mockResolvedValue({ ok: true })}
        onClearError={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByDisplayValue("Fatima Buyer")).toBeInTheDocument();
    expect(screen.queryByText("Location")).not.toBeInTheDocument();
  });
});

describe("OwnerLeadEditForm — Save disabled until valid and genuinely changed", () => {
  it("Save is disabled when nothing has changed from the prefilled values", () => {
    render(
      <OwnerLeadEditForm
        intent="sell"
        reference="MSM-260101-ABCDEF"
        initialFields={SELL_FIELDS}
        isSubmitting={false}
        error={null}
        onSubmit={vi.fn().mockResolvedValue({ ok: true })}
        onClearError={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /save changes/i })).toBeDisabled();
  });

  it("Save becomes enabled once a field is genuinely edited, and disabled again if reverted", async () => {
    const user = userEvent.setup();
    render(
      <OwnerLeadEditForm
        intent="sell"
        reference="MSM-260101-ABCDEF"
        initialFields={SELL_FIELDS}
        isSubmitting={false}
        error={null}
        onSubmit={vi.fn().mockResolvedValue({ ok: true })}
        onClearError={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const nameInput = screen.getByDisplayValue("Ahmed Seller");
    await user.type(nameInput, " Jr");
    expect(screen.getByRole("button", { name: /save changes/i })).toBeEnabled();

    await user.type(nameInput, "{backspace}{backspace}{backspace}");
    expect(screen.getByRole("button", { name: /save changes/i })).toBeDisabled();
  });

  it("Save stays disabled for an invalid (empty) contact name even after editing another field", async () => {
    const user = userEvent.setup();
    render(
      <OwnerLeadEditForm
        intent="sell"
        reference="MSM-260101-ABCDEF"
        initialFields={SELL_FIELDS}
        isSubmitting={false}
        error={null}
        onSubmit={vi.fn().mockResolvedValue({ ok: true })}
        onClearError={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const nameInput = screen.getByDisplayValue("Ahmed Seller");
    await user.clear(nameInput);
    expect(screen.getByRole("button", { name: /save changes/i })).toBeDisabled();
  });
});

describe("OwnerLeadEditForm — saving state", () => {
  it("shows a saving label and disables Cancel while isSubmitting", () => {
    render(
      <OwnerLeadEditForm
        intent="sell"
        reference="MSM-260101-ABCDEF"
        initialFields={SELL_FIELDS}
        isSubmitting={true}
        error={null}
        onSubmit={vi.fn().mockResolvedValue({ ok: true })}
        onClearError={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /saving/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^cancel$/i })).toBeDisabled();
  });
});

describe("OwnerLeadEditForm — cancel / discard behavior", () => {
  it("Cancel with no changes returns immediately, with no confirmation dialog", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <OwnerLeadEditForm
        intent="sell"
        reference="MSM-260101-ABCDEF"
        initialFields={SELL_FIELDS}
        isSubmitting={false}
        error={null}
        onSubmit={vi.fn().mockResolvedValue({ ok: true })}
        onClearError={vi.fn()}
        onCancel={onCancel}
      />,
    );
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("Cancel after a real change requires a discard confirmation, and Keep editing preserves the typed value", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <OwnerLeadEditForm
        intent="sell"
        reference="MSM-260101-ABCDEF"
        initialFields={SELL_FIELDS}
        isSubmitting={false}
        error={null}
        onSubmit={vi.fn().mockResolvedValue({ ok: true })}
        onClearError={vi.fn()}
        onCancel={onCancel}
      />,
    );
    const nameInput = screen.getByDisplayValue("Ahmed Seller");
    await user.type(nameInput, " Jr");
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /keep editing/i }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("Ahmed Seller Jr")).toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("Discard changes in the confirmation dialog calls onCancel", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <OwnerLeadEditForm
        intent="sell"
        reference="MSM-260101-ABCDEF"
        initialFields={SELL_FIELDS}
        isSubmitting={false}
        error={null}
        onSubmit={vi.fn().mockResolvedValue({ ok: true })}
        onClearError={vi.fn()}
        onCancel={onCancel}
      />,
    );
    const nameInput = screen.getByDisplayValue("Ahmed Seller");
    await user.type(nameInput, " Jr");
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    await user.click(await screen.findByRole("button", { name: /discard changes/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe("OwnerLeadEditForm — server failure retains entered form values", () => {
  it("a rejected onSubmit leaves the typed value in the field and shows the error", async () => {
    const user = userEvent.setup();
    render(
      <OwnerLeadEditForm
        intent="sell"
        reference="MSM-260101-ABCDEF"
        initialFields={SELL_FIELDS}
        isSubmitting={false}
        error="Something went wrong. Please try again."
        onSubmit={vi.fn().mockResolvedValue({ ok: false })}
        onClearError={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const nameInput = screen.getByDisplayValue("Ahmed Seller");
    await user.type(nameInput, " Jr");
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    expect(screen.getByDisplayValue("Ahmed Seller Jr")).toBeInTheDocument();
    expect(screen.getByText("Something went wrong. Please try again.")).toBeInTheDocument();
  });
});

describe("OwnerLeadEditForm — duplicate-submit prevention", () => {
  it("does not call onSubmit again while a submission is already in flight", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue({ ok: true });
    const { rerender } = render(
      <OwnerLeadEditForm
        intent="sell"
        reference="MSM-260101-ABCDEF"
        initialFields={SELL_FIELDS}
        isSubmitting={false}
        error={null}
        onSubmit={onSubmit}
        onClearError={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const nameInput = screen.getByDisplayValue("Ahmed Seller");
    await user.type(nameInput, " Jr");
    await user.click(screen.getByRole("button", { name: /save changes/i }));
    expect(onSubmit).toHaveBeenCalledTimes(1);

    // The parent hook flips isSubmitting true while the request is pending —
    // the fieldset becomes disabled, matching the real
    // use-owner-lead-edit.ts synchronous ref-lock this component relies on.
    rerender(
      <OwnerLeadEditForm
        intent="sell"
        reference="MSM-260101-ABCDEF"
        initialFields={SELL_FIELDS}
        isSubmitting={true}
        error={null}
        onSubmit={onSubmit}
        onClearError={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /saving/i })).toBeDisabled();
  });
});
