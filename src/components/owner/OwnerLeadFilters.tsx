import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  OWNER_LEAD_STATUS_VALUES,
  OWNER_LEAD_INTENT_VALUES,
  OWNER_LEAD_MATERIAL_VALUES,
  OWNER_LEAD_CAPTURE_CHANNEL_VALUES,
} from "@/lib/owner/owner-leads-contract";
import {
  OWNER_LEAD_STATUS_LABELS,
  OWNER_LEAD_INTENT_LABELS,
  OWNER_LEAD_MATERIAL_LABELS,
  OWNER_LEAD_CAPTURE_CHANNEL_LABELS,
} from "./owner-lead-format";
import type { OwnerLeadListFilters } from "./use-owner-lead-list";

/**
 * CHECKPOINT C2J-D — the inbox filter/search toolbar. Plain native
 * `<select>`/`<input>` elements rather than the Radix-based Select
 * primitive in src/components/ui/select.tsx: that component is unused
 * elsewhere in this codebase and has no jsdom polyfills configured for its
 * portal/pointer-capture behavior, while a native select needs none and is
 * fully keyboard/screen-reader accessible for free — no new design-system
 * dependency either way.
 *
 * Deliberately an explicit Apply/Search action (a real <form onSubmit>,
 * so Enter in the search box also applies) rather than firing a request on
 * every keystroke or select change — steadier under real typing, and each
 * click is a single, easy-to-reason-about request.
 */

const SELECT_CLASS_NAME =
  "flex h-9 w-full min-w-0 cursor-pointer rounded-md border border-input bg-transparent px-2.5 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

export interface OwnerLeadFiltersProps {
  readonly draftFilters: OwnerLeadListFilters;
  readonly setDraftFilters: (updater: (previous: OwnerLeadListFilters) => OwnerLeadListFilters) => void;
  readonly onApply: () => void;
  readonly onClear: () => void;
  readonly hasActiveFilters: boolean;
  readonly resultCount: number;
  readonly isBusy: boolean;
}

/** `exactOptionalPropertyTypes` makes `{ ...previous, key: undefined }` a type error (the field type is e.g. `OwnerLeadStatus`, never `| undefined`) — this removes the key entirely instead of setting it to undefined, which is also the semantically correct "no filter" representation. */
function setFilterValue<K extends keyof OwnerLeadListFilters>(
  setDraftFilters: OwnerLeadFiltersProps["setDraftFilters"],
  key: K,
  value: OwnerLeadListFilters[K] | "",
) {
  setDraftFilters((previous) => {
    const next = { ...previous };
    if (value) {
      next[key] = value;
    } else {
      delete next[key];
    }
    return next;
  });
}

export function OwnerLeadFilters({
  draftFilters,
  setDraftFilters,
  onApply,
  onClear,
  hasActiveFilters,
  resultCount,
  isBusy,
}: OwnerLeadFiltersProps) {
  return (
    <form
      role="search"
      aria-label="Filter enquiries"
      onSubmit={(event) => {
        event.preventDefault();
        onApply();
      }}
      className="flex flex-col gap-3 border-b border-border bg-card/40 px-4 py-3"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="flex min-w-[200px] flex-1 flex-col gap-1.5">
          <Label htmlFor="owner-lead-search">Search</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              id="owner-lead-search"
              type="search"
              placeholder="Reference, name or phone"
              value={draftFilters.q ?? ""}
              onChange={(event) => setFilterValue(setDraftFilters, "q", event.target.value)}
              className="pl-8"
              maxLength={60}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="owner-lead-status">Status</Label>
          <select
            id="owner-lead-status"
            className={SELECT_CLASS_NAME}
            value={draftFilters.status ?? ""}
            onChange={(event) => setFilterValue(setDraftFilters, "status", event.target.value as OwnerLeadListFilters["status"] | "")}
          >
            <option value="">All statuses</option>
            {OWNER_LEAD_STATUS_VALUES.map((status) => (
              <option key={status} value={status}>
                {OWNER_LEAD_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="owner-lead-intent">Type</Label>
          <select
            id="owner-lead-intent"
            className={SELECT_CLASS_NAME}
            value={draftFilters.intent ?? ""}
            onChange={(event) => setFilterValue(setDraftFilters, "intent", event.target.value as OwnerLeadListFilters["intent"] | "")}
          >
            <option value="">Selling &amp; buying</option>
            {OWNER_LEAD_INTENT_VALUES.map((intent) => (
              <option key={intent} value={intent}>
                {OWNER_LEAD_INTENT_LABELS[intent]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="owner-lead-material">Material</Label>
          <select
            id="owner-lead-material"
            className={SELECT_CLASS_NAME}
            value={draftFilters.material ?? ""}
            onChange={(event) => setFilterValue(setDraftFilters, "material", event.target.value as OwnerLeadListFilters["material"] | "")}
          >
            <option value="">All materials</option>
            {OWNER_LEAD_MATERIAL_VALUES.map((material) => (
              <option key={material} value={material}>
                {OWNER_LEAD_MATERIAL_LABELS[material]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="owner-lead-channel">Channel</Label>
          <select
            id="owner-lead-channel"
            className={SELECT_CLASS_NAME}
            value={draftFilters.captureChannel ?? ""}
            onChange={(event) =>
              setFilterValue(setDraftFilters, "captureChannel", event.target.value as OwnerLeadListFilters["captureChannel"] | "")
            }
          >
            <option value="">All channels</option>
            {OWNER_LEAD_CAPTURE_CHANNEL_VALUES.map((channel) => (
              <option key={channel} value={channel}>
                {OWNER_LEAD_CAPTURE_CHANNEL_LABELS[channel]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex gap-2">
          <Button type="submit" disabled={isBusy} className="gap-1.5">
            <Search className="size-4" aria-hidden="true" />
            Apply
          </Button>
          <Button type="button" variant="outline" onClick={onClear} disabled={isBusy || !hasActiveFilters} className="gap-1.5">
            <X className="size-4" aria-hidden="true" />
            Clear
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground" aria-live="polite">
        Showing {resultCount} loaded {resultCount === 1 ? "enquiry" : "enquiries"}
      </p>
    </form>
  );
}
