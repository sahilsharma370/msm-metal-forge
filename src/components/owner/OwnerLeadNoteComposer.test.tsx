// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { OwnerLeadNoteComposer } from "./OwnerLeadNoteComposer";

afterEach(() => {
  cleanup();
});

function renderComposer(overrides: Partial<Parameters<typeof OwnerLeadNoteComposer>[0]> = {}) {
  const onAddNote = vi.fn().mockResolvedValue({ ok: true });
  const onClearError = vi.fn();
  render(<OwnerLeadNoteComposer isSaving={false} error={null} onAddNote={onAddNote} onClearError={onClearError} {...overrides} />);
  return { onAddNote, onClearError };
}

describe("OwnerLeadNoteComposer — submit gating", () => {
  it("disables Add note while the textarea is empty", () => {
    renderComposer();
    expect(screen.getByRole("button", { name: /add note/i })).toBeDisabled();
  });

  it("disables Add note for whitespace-only input", async () => {
    const user = userEvent.setup();
    renderComposer();
    await user.type(screen.getByLabelText(/add a private note/i), "   ");
    expect(screen.getByRole("button", { name: /add note/i })).toBeDisabled();
  });

  it("enables Add note once non-whitespace text is entered, and submits the trimmed body", async () => {
    const user = userEvent.setup();
    const { onAddNote } = renderComposer();
    await user.type(screen.getByLabelText(/add a private note/i), "  Customer wants pickup Friday  ");
    const button = screen.getByRole("button", { name: /add note/i });
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
    expect(onAddNote).toHaveBeenCalledWith("Customer wants pickup Friday");
  });
});

describe("OwnerLeadNoteComposer — success clears text, failure preserves it", () => {
  it("clears the textarea and shows a success message on confirmed success", async () => {
    const user = userEvent.setup();
    const onAddNote = vi.fn().mockResolvedValue({ ok: true });
    render(<OwnerLeadNoteComposer isSaving={false} error={null} onAddNote={onAddNote} onClearError={vi.fn()} />);
    const field = screen.getByLabelText(/add a private note/i) as HTMLTextAreaElement;
    await user.type(field, "Called the customer");
    await user.click(screen.getByRole("button", { name: /add note/i }));
    await waitFor(() => expect(field.value).toBe(""));
    expect(screen.getByText(/note added/i)).toBeInTheDocument();
  });

  it("preserves the typed text when onAddNote fails", async () => {
    const user = userEvent.setup();
    const onAddNote = vi.fn().mockResolvedValue({ ok: false, conflict: false, message: "Something went wrong. Please try again." });
    render(<OwnerLeadNoteComposer isSaving={false} error={null} onAddNote={onAddNote} onClearError={vi.fn()} />);
    const field = screen.getByLabelText(/add a private note/i) as HTMLTextAreaElement;
    await user.type(field, "Called the customer");
    await user.click(screen.getByRole("button", { name: /add note/i }));
    await waitFor(() => expect(onAddNote).toHaveBeenCalled());
    expect(field.value).toBe("Called the customer");
  });
});

describe("OwnerLeadNoteComposer — saving state and error rendering", () => {
  it("disables the textarea and button while isSaving", () => {
    renderComposer({ isSaving: true });
    expect(screen.getByLabelText(/add a private note/i)).toBeDisabled();
    expect(screen.getByRole("button", { name: /saving/i })).toBeDisabled();
  });

  it("renders a server-provided error message", () => {
    renderComposer({ error: "Note is too long." });
    expect(screen.getByText("Note is too long.")).toBeInTheDocument();
  });

  it("shows the character counter and a private-note hint", async () => {
    const user = userEvent.setup();
    renderComposer();
    await user.type(screen.getByLabelText(/add a private note/i), "hi");
    expect(screen.getByText(/2\/2000/)).toBeInTheDocument();
    expect(screen.getByText(/not visible to the customer/i)).toBeInTheDocument();
  });
});
