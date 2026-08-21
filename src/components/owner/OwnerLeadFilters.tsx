import { useEffect, useRef } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  OWNER_LEAD_STATUS_VALUES,
  OWNER_LEAD_INTENT_VALUES,
  OWNER_LEAD_MATERIAL_VALUES,
  OWNER_LEAD_CAPTURE_CHANNEL_VALUES,
  type OwnerLeadView,
} from "@/lib/owner/owner-leads-contract";
import {
  OWNER_LEAD_STATUS_LABELS,
  OWNER_LEAD_INTENT_LABELS,
  OWNER_LEAD_MATERIAL_LABELS,
  OWNER_LEAD_CAPTURE_CHANNEL_LABELS,
} from "./owner-lead-format";
import type { OwnerLeadListFilters } from "./use-owner-lead-list";

/**
 * CHECKPOINT C2J-D / OWNER DESKTOP CORRECTION / OWNER DESKTOP CORRECTION
 * (compact pass) — the Enquiries filter/search toolbar, now a single
 * compact row with no explicit Apply step: a Select's onValueChange applies
 * immediately (computed synchronously against the current draftFilters, so
 * it never races a stale-closure `applyFilters` call), and the search box
 * applies after a short debounce so real typing doesn't fire a request per
 * keystroke. Reset/Clear only renders at all once a filter is genuinely
 * active — never a disabled no-op control taking up row space otherwise.
 *
 * Backend filtering, query semantics and the safe search-classification
 * contract are entirely unchanged — this batch only changes when
 * `onApply` fires and with what computed filters object, never what it
 * fires against.
 */

const ALL_VALUE = "__all__";
const SEARCH_DEBOUNCE_MS = 400;

/** Quote UI's current matte control recipe — solid `bg-navy-deep/95` + `border-white/15`, never a translucent glass tint, so a control stays readable on its own against the matte panel behind it. */
const SELECT_TRIGGER_CLASS_NAME =
  "h-8 w-full min-w-0 rounded-lg border-white/15 bg-navy-deep/95 px-2.5 text-sm shadow-sm transition-colors hover:border-white/25 focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50";
/** Dark matte popover — the same navy/border pairing as every other floating panel in this batch (quote-modal-matte's own recipe, referenced by token rather than duplicated as a literal colour). */
const SELECT_CONTENT_CLASS_NAME = "border-white/10 bg-navy-deep/95 text-foreground";
/** Focus/hover uses a restrained copper tint (never the bright primary-button fill); the checked item's own text turns copper-bright so the current selection reads clearly against the list. */
const SELECT_ITEM_CLASS_NAME = "text-foreground/85 focus:bg-copper/15 focus:text-foreground data-[state=checked]:font-medium data-[state=checked]:text-copper-bright";

/**
 * CHECKPOINT OWNER DESKTOP CORRECTION (Inbox status filter cleanup) — the
 * Status filter's own dropdown, distinct from SELECT_CONTENT_CLASS_NAME/
 * SELECT_ITEM_CLASS_NAME above (Type/Material/Channel are unchanged): fully
 * opaque matte navy (never a translucent/glass tint), capped + internally
 * scrollable like the detail page's own status control, and a flat matte
 * navy hover/focus (`bg-white/10`, not the copper tint used elsewhere) so
 * only the genuinely *selected* item reads copper — a keyboard-focused but
 * unselected option never competes with it.
 */
const STATUS_FILTER_CONTENT_CLASS_NAME =
  "max-h-[min(260px,var(--radix-select-content-available-height))] border-white/10 bg-navy-deep text-foreground";
const STATUS_FILTER_ITEM_CLASS_NAME =
  "text-foreground/85 focus:bg-white/10 focus:text-foreground data-[state=checked]:font-medium data-[state=checked]:text-copper-bright";

export interface OwnerLeadFiltersProps {
  readonly draftFilters: OwnerLeadListFilters;
  readonly setDraftFilters: (updater: (previous: OwnerLeadListFilters) => OwnerLeadListFilters) => void;
  readonly onApply: (overrideFilters?: OwnerLeadListFilters) => void;
  readonly onClear: () => void;
  readonly hasActiveFilters: boolean;
  readonly isBusy: boolean;
  /** Archived already has its own tab (see OwnerLeadInbox's view control) — the Inbox filter's own Status dropdown hides "Archived" only when `view` is "inbox" (the default); the Archived/Trash tabs still get the full status vocabulary. Never touches OWNER_LEAD_STATUS_VALUES itself, the detail status control, or the archive workflow. */
  readonly view?: OwnerLeadView;
}

/** `exactOptionalPropertyTypes` makes `{ ...previous, key: undefined }` a type error (the field type is e.g. `OwnerLeadStatus`, never `| undefined`) — this removes the key entirely instead of setting it to undefined, which is also the semantically correct "no filter" representation. */
function computeNextFilters<K extends keyof OwnerLeadListFilters>(
  current: OwnerLeadListFilters,
  key: K,
  value: OwnerLeadListFilters[K] | "",
): OwnerLeadListFilters {
  const next = { ...current };
  if (value) {
    next[key] = value;
  } else {
    delete next[key];
  }
  return next;
}

export function OwnerLeadFilters({
  draftFilters,
  setDraftFilters,
  onApply,
  onClear,
  hasActiveFilters,
  isBusy,
  view = "inbox",
}: OwnerLeadFiltersProps) {
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Archived already has its own tab — offering it again inside the Inbox
  // filter is redundant and confusing there. The Archived/Trash tabs still
  // get the full status vocabulary (nothing about OWNER_LEAD_STATUS_VALUES
  // itself, the enum, or any other consumer of it changes).
  const statusFilterValues = view === "inbox" ? OWNER_LEAD_STATUS_VALUES.filter((status) => status !== "archived") : OWNER_LEAD_STATUS_VALUES;

  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, []);

  /** A dropdown change is never debounced — it applies the instant it's picked, computed against the current draftFilters so it can never fire against a stale, pre-update snapshot. */
  function applySelectChange<K extends keyof OwnerLeadListFilters>(key: K, value: OwnerLeadListFilters[K] | "") {
    const next = computeNextFilters(draftFilters, key, value);
    setDraftFilters(() => next);
    onApply(next);
  }

  function handleSearchChange(value: string) {
    const next = computeNextFilters(draftFilters, "q", value);
    setDraftFilters(() => next);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => onApply(next), SEARCH_DEBOUNCE_MS);
  }

  return (
    <form
      role="search"
      aria-label="Filter enquiries"
      onSubmit={(event) => {
        event.preventDefault();
        if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
        onApply(draftFilters);
      }}
      className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[minmax(240px,1.6fr)_repeat(4,minmax(0,1fr))_auto]"
    >
      {/* CHECKPOINT OWNER DESKTOP CORRECTION (small fixes pass) — Search
          gets a genuinely wider, fluid grid column (1.6fr) instead of a
          cramped fixed 208px, so "Reference, name or phone" is no longer
          clipped; the four Selects now share the remaining width evenly
          (1fr each) instead of leaving a large unused gap on the right.
          Below `sm`, controls simply stack in one column (mobile is out of
          this batch's scope; this is purely "don't regress" preservation
          of the original flex-wrap-to-full-width behaviour). */}
      <div className="flex flex-col gap-1">
        <Label htmlFor="owner-lead-search" className="text-xs">
          Search
        </Label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            id="owner-lead-search"
            type="search"
            placeholder="Reference, name or phone"
            value={draftFilters.q ?? ""}
            onChange={(event) => handleSearchChange(event.target.value)}
            className="h-8 w-full rounded-lg border-white/15 bg-navy-deep/95 pl-8 text-sm"
            maxLength={60}
            disabled={isBusy}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="owner-lead-status" className="text-xs">
          Status
        </Label>
        <Select value={draftFilters.status ?? ALL_VALUE} onValueChange={(value) => applySelectChange("status", value === ALL_VALUE ? "" : (value as OwnerLeadListFilters["status"]))} disabled={isBusy}>
          <SelectTrigger id="owner-lead-status" className={`${SELECT_TRIGGER_CLASS_NAME} w-full`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className={STATUS_FILTER_CONTENT_CLASS_NAME}>
            <SelectItem value={ALL_VALUE} className={STATUS_FILTER_ITEM_CLASS_NAME}>
              All statuses
            </SelectItem>
            {statusFilterValues.map((status) => (
              <SelectItem key={status} value={status} className={STATUS_FILTER_ITEM_CLASS_NAME}>
                {OWNER_LEAD_STATUS_LABELS[status]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="owner-lead-intent" className="text-xs">
          Type
        </Label>
        <Select value={draftFilters.intent ?? ALL_VALUE} onValueChange={(value) => applySelectChange("intent", value === ALL_VALUE ? "" : (value as OwnerLeadListFilters["intent"]))} disabled={isBusy}>
          <SelectTrigger id="owner-lead-intent" className={`${SELECT_TRIGGER_CLASS_NAME} w-full`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className={SELECT_CONTENT_CLASS_NAME}>
            <SelectItem value={ALL_VALUE} className={SELECT_ITEM_CLASS_NAME}>
              Selling &amp; buying
            </SelectItem>
            {OWNER_LEAD_INTENT_VALUES.map((intent) => (
              <SelectItem key={intent} value={intent} className={SELECT_ITEM_CLASS_NAME}>
                {OWNER_LEAD_INTENT_LABELS[intent]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="owner-lead-material" className="text-xs">
          Material
        </Label>
        <Select value={draftFilters.material ?? ALL_VALUE} onValueChange={(value) => applySelectChange("material", value === ALL_VALUE ? "" : (value as OwnerLeadListFilters["material"]))} disabled={isBusy}>
          <SelectTrigger id="owner-lead-material" className={`${SELECT_TRIGGER_CLASS_NAME} w-full`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className={SELECT_CONTENT_CLASS_NAME}>
            <SelectItem value={ALL_VALUE} className={SELECT_ITEM_CLASS_NAME}>
              All materials
            </SelectItem>
            {OWNER_LEAD_MATERIAL_VALUES.map((material) => (
              <SelectItem key={material} value={material} className={SELECT_ITEM_CLASS_NAME}>
                {OWNER_LEAD_MATERIAL_LABELS[material]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="owner-lead-channel" className="text-xs">
          Channel
        </Label>
        <Select
          value={draftFilters.captureChannel ?? ALL_VALUE}
          onValueChange={(value) => applySelectChange("captureChannel", value === ALL_VALUE ? "" : (value as OwnerLeadListFilters["captureChannel"]))}
          disabled={isBusy}
        >
          <SelectTrigger id="owner-lead-channel" className={`${SELECT_TRIGGER_CLASS_NAME} w-full`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className={SELECT_CONTENT_CLASS_NAME}>
            <SelectItem value={ALL_VALUE} className={SELECT_ITEM_CLASS_NAME}>
              All channels
            </SelectItem>
            {OWNER_LEAD_CAPTURE_CHANNEL_VALUES.map((channel) => (
              <SelectItem key={channel} value={channel} className={SELECT_ITEM_CLASS_NAME}>
                {OWNER_LEAD_CAPTURE_CHANNEL_LABELS[channel]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Reset only exists at all once a filter/search is genuinely active — never a visible disabled no-op. */}
      {hasActiveFilters ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
            onClear();
          }}
          disabled={isBusy}
          className="h-8 gap-1.5 border-copper/40 text-copper-bright hover:bg-copper/10"
        >
          <X className="size-3.5" aria-hidden="true" />
          Reset
        </Button>
      ) : null}
    </form>
  );
}
