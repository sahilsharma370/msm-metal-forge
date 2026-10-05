import { AlertCircle } from "lucide-react";
import { QUOTE_FIELD_LABELS } from "./quote-options";
import type { QuoteFormValues } from "./quote-schema";

export interface QuoteValidationSummaryItem {
  field: keyof QuoteFormValues;
  message: string;
}

interface QuoteValidationSummaryProps {
  items: QuoteValidationSummaryItem[];
  onFocusField: (field: keyof QuoteFormValues) => void;
}

/**
 * Batch A — a concise top-of-panel error summary shown alongside (never
 * instead of) each field's own inline error, so a Continue/Review Request/
 * Submit Request attempt that fails is visible immediately even if the
 * scroll body is already scrolled past the invalid field(s). Lives in the
 * header's own static grid row in QuoteExperience.tsx (never inside
 * `.quote-scroll`), so it stays on screen regardless of scroll position —
 * this is deliberately not a floating/sticky overlay, since the header row
 * is already a plain static sibling of the scroll body.
 *
 * `items` is populated exclusively from the Zod issues of the ONE schema
 * that was just re-validated (see QuoteExperience's applyStageValidationIssues)
 * — never from a raw scan of `form.formState.errors` — so a hidden,
 * optional, or inactive-branch field can never appear here: the schema
 * itself only ever reports on the fields relevant to the current stage
 * and the current seller/buyer branch.
 */
/** A single message is short enough to read naturally beside its field
 * label in the one compact row (e.g. "Material — Select a material.");
 * anything longer, or a 2+ field summary, falls back to field names only
 * — the actual instruction still lives beside the field itself (its own
 * inline error), never duplicated at length here. Threshold picked to
 * comfortably cover this schema's typical short messages ("Select a
 * material.", "Enter a valid phone or WhatsApp number.") while still
 * deferring to label-only for the rare longer one. */
const INLINE_MESSAGE_MAX_LENGTH = 48;

export function QuoteValidationSummary({ items, onFocusField }: QuoteValidationSummaryProps) {
  if (items.length === 0) return null;

  const countLabel =
    items.length === 1 ? "1 field needs attention" : `${items.length} fields need attention`;
  const singleShortMessage =
    items.length === 1 && items[0]!.message.length <= INLINE_MESSAGE_MAX_LENGTH
      ? items[0]!.message
      : null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      className="mt-3 flex min-h-[44px] flex-wrap items-center gap-x-1.5 gap-y-1 rounded-lg border px-3 py-2"
      style={{
        borderColor: "rgba(201, 101, 90, 0.32)",
        backgroundColor: "rgba(104, 45, 49, 0.14)",
        boxShadow: "inset 0 1px 0 rgba(227, 148, 139, 0.035)",
      }}
    >
      <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-foreground/90">
        <AlertCircle aria-hidden="true" className="h-3.5 w-3.5 shrink-0" style={{ color: "#C9655A" }} />
        {countLabel}
      </span>
      {singleShortMessage ? (
        <button
          type="button"
          onClick={() => onFocusField(items[0]!.field)}
          className="rounded text-left text-xs font-medium text-foreground/75 underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-copper"
        >
          · {QUOTE_FIELD_LABELS[items[0]!.field] ?? items[0]!.field} — {singleShortMessage}
        </button>
      ) : (
        items.map((item) => (
          <button
            key={item.field}
            type="button"
            onClick={() => onFocusField(item.field)}
            className="rounded text-left text-xs font-medium text-foreground/75 underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-copper"
          >
            · {QUOTE_FIELD_LABELS[item.field] ?? item.field}
          </button>
        ))
      )}
    </div>
  );
}
