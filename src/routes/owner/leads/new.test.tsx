// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

const navigateMock = vi.fn();

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
    Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
      <a href={to} {...props}>
        {children}
      </a>
    ),
  };
});

const submitMock = vi.fn();
const clearErrorMock = vi.fn();

vi.mock("@/components/owner/use-owner-lead-quick-add", () => ({
  useOwnerLeadQuickAdd: () => ({
    state: { isSubmitting: false, error: null },
    submit: submitMock,
    clearError: clearErrorMock,
    resetAttempt: vi.fn(),
  }),
}));

const { OwnerLeadQuickAddBody } = await import("./new");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OwnerLeadQuickAddBody — success navigates to the new lead's detail page", () => {
  it("calls navigate to /owner/leads/$leadId with the created lead's id when Open enquiry is clicked", async () => {
    const user = userEvent.setup();
    submitMock.mockResolvedValue({ ok: true, leadId: "11111111-1111-1111-1111-111111111111", reference: "MSM-260101-ABCDEF" });

    render(<OwnerLeadQuickAddBody onUnauthorized={vi.fn()} />);

    await user.type(screen.getByLabelText(/contact name/i), "Ahmed");
    await user.type(screen.getByLabelText(/phone \/ whatsapp/i), "+971501234567");
    await user.click(screen.getByRole("button", { name: /save enquiry/i }));

    await waitFor(() => expect(screen.getByText("MSM-260101-ABCDEF")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /open enquiry/i }));

    expect(navigateMock).toHaveBeenCalledWith({
      to: "/owner/leads/$leadId",
      params: { leadId: "11111111-1111-1111-1111-111111111111" },
    });
  });
});

// CHECKPOINT OWNER DESKTOP REFINEMENT — Back to enquiries/Cancel are now
// plain buttons calling a `cancel` callback (navigate({ to: "/owner" }))
// owned by this route body, not a declarative <Link>, so
// OwnerLeadQuickAddForm stays router-import-free and trivially testable —
// same destination, different mechanism.
describe("OwnerLeadQuickAddBody — back / cancel navigate to the owner inbox", () => {
  it("Back to enquiries navigates to /owner", async () => {
    const user = userEvent.setup();
    render(<OwnerLeadQuickAddBody onUnauthorized={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /back to enquiries/i }));
    expect(navigateMock).toHaveBeenCalledWith({ to: "/owner" });
  });

  it("Cancel navigates to /owner", async () => {
    const user = userEvent.setup();
    render(<OwnerLeadQuickAddBody onUnauthorized={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(navigateMock).toHaveBeenCalledWith({ to: "/owner" });
  });
});
