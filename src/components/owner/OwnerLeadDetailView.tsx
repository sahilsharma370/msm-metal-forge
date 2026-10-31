import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Archive, AlertTriangle, ChevronDown, Copy, Mail, MapPin, MessageCircle, Pencil, Phone, RotateCcw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { OwnerLeadDetailData } from "./use-owner-lead-detail";
import { OwnerLeadFileViewer } from "./OwnerLeadFileViewer";
import { OwnerLeadStatusControl } from "./OwnerLeadStatusControl";
import { OwnerLeadNoteComposer } from "./OwnerLeadNoteComposer";
import { useOwnerLeadMutations } from "./use-owner-lead-mutations";
import { OWNER_CONTAINER_CLASS } from "./OwnerPageHeader";
import type { OwnerLeadsTransportDeps } from "./owner-leads-transport";
import {
  OWNER_LEAD_STATUS_LABELS,
  OWNER_LEAD_INTENT_LABELS,
  OWNER_LEAD_MATERIAL_LABELS,
  OWNER_LEAD_CAPTURE_CHANNEL_LABELS,
  OWNER_NOTIFICATION_STATUS_LABELS,
  formatActivityEventType,
  formatSimpleVocab,
  formatQuantity,
  formatUaeDateTime,
  formatPhoneForDisplay,
  formatEmirateLabel,
  formatPersonName,
  buildTelHref,
  buildOwnerWhatsAppHref,
  buildOwnerMailtoHref,
  resolvePrimaryContactAction,
} from "./owner-lead-format";

/**
 * CHECKPOINT C2L-V2 / OWNER DESKTOP CORRECTION — the /owner/leads/:leadId
 * detail page body: a desktop 12-column composition. Main (8 cols) carries
 * identity, one merged "Enquiry details" card (material/quantity/condition/
 * trade-route/location — everything the seller or buyer branch actually
 * submitted, in one coherent place instead of three separate cards
 * including two that were often empty), files and the activity timeline.
 * The side (4 cols, sticky where the viewport allows) carries contact
 * actions, the merged status+note "workflow" card, and — only when it's
 * genuinely actionable — the notification panel.
 *
 * Every surface is now the same matte navy system as Overview/Enquiries
 * (`border-white/10 bg-navy-deep/95`), not glass-panel's glossy gradient —
 * this page was the last major visual inconsistency in the Owner Dashboard.
 *
 * Renders only the branch (seller or buyer) the discriminated-union
 * contract actually contains for this lead — there is no opposite-branch
 * data to accidentally show, because the type itself doesn't have those
 * fields on the other variant.
 */

const DETAIL_PANEL_CLASS = "rounded-2xl border border-white/10 bg-navy-deep/95";

export interface OwnerLeadDetailViewProps {
  readonly leadId: string;
  readonly data: OwnerLeadDetailData;
  readonly deps: OwnerLeadsTransportDeps;
  readonly onUnauthorized: () => void;
  readonly onMutated: () => void;
}

/** Hides entirely when the value is absent — for genuinely optional free-text fields (Notes, Description, ...) that are routinely blank and not worth flagging. */
function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{value}</dd>
    </div>
  );
}

/** Always renders — shows "Not provided" rather than silently leaving an ambiguous gap, for the handful of fields whose absence is itself operationally meaningful (what/how much/where). */
function RequiredField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{value || "Not provided"}</dd>
    </div>
  );
}

/** A quantity value without a unit must never read as self-explanatory — "2" alone says nothing. */
function quantityDisplay(value: number | null, unit: string | null): string {
  if (value === null) return "Not provided";
  const formatted = formatQuantity(value, unit);
  return unit ? (formatted ?? "Not provided") : `${formatted ?? value} · Unit not provided`;
}

function Panel({ id, title, children }: { readonly id: string; readonly title: string; readonly children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className={`${DETAIL_PANEL_CLASS} p-5`}>
      <h3 id={id} className="font-display mb-3 text-base font-semibold text-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function OwnerLeadDetailView({ leadId, data, deps, onUnauthorized, onMutated }: OwnerLeadDetailViewProps) {
  const { lead, files, activities, notification } = data;
  const mutations = useOwnerLeadMutations(leadId, deps, onMutated, onUnauthorized);
  const [trashDialogOpen, setTrashDialogOpen] = useState(false);
  const [referenceCopied, setReferenceCopied] = useState(false);

  async function handleCopyReference() {
    try {
      await navigator.clipboard.writeText(lead.reference);
      setReferenceCopied(true);
      setTimeout(() => setReferenceCopied(false), 2000);
    } catch {
      // Clipboard access can fail (permissions, insecure context) — silently no-op rather than showing a false "copied" confirmation.
    }
  }
  // CHECKPOINT C2M-A — a trashed lead's original submitted content stays
  // fully visible (nothing here changes what's rendered above the Status
  // panel), but every mutation surface — status, notes, Move to Trash — is
  // replaced with a single read-only "In Trash" state + Restore action.
  const isTrashed = lead.deletedAt !== null;
  const telHref = buildTelHref(lead.contact.phone);
  const whatsappHref = buildOwnerWhatsAppHref(lead.contact.phone);
  const mailtoHref = buildOwnerMailtoHref(lead.contact.email);
  const displayPhone = formatPhoneForDisplay(lead.contact.phone);
  const contactLabel = formatPersonName(lead.contact.name) ?? lead.reference;
  const materialLine = [OWNER_LEAD_MATERIAL_LABELS[lead.material], lead.materialSubtype, lead.materialSubtypeOtherText]
    .filter(Boolean)
    .join(" — ");
  // CHECKPOINT OWNER DESKTOP CORRECTION (capitalization pass) — the canonical
  // EMIRATE_LABELS map (via formatEmirateLabel, already used by the
  // Enquiries list) so "umm_al_quwain" reads "Umm Al Quwain" here too;
  // formatSimpleVocab's generic word-capitalization only capitalized the
  // first word of a multi-word emirate.
  const emirateLabel = formatEmirateLabel(lead.location.emirate);
  const isSafeExternalLink = (href: string) => /^https?:\/\//i.test(href);
  // CHECKPOINT C2M-A — exactly one primary (copper) contact action, chosen
  // by the customer's own stated preferred contact method whenever it has
  // a usable value, falling back to the capture channel (Quick Add leads
  // only) and finally to the existing Call-first default — never a method
  // with no underlying value. See resolvePrimaryContactAction's own header
  // comment for the full priority order.
  const primaryContactAction = resolvePrimaryContactAction({
    preferredContact: lead.enquiry.preferredContact,
    captureChannel: lead.captureChannel,
    hasPhone: telHref !== null,
    hasEmail: mailtoHref !== null,
  });
  // CHECKPOINT OWNER DESKTOP CORRECTION — the notification panel is
  // technical noise in every normal state (sent/pending/not_required): the
  // owner never needs to see "0 attempts, 0 manual requeues" for a message
  // that's working exactly as expected. It only earns a place in the UI
  // once delivery genuinely needs attention. Nothing about the underlying
  // derivation, attempt/requeue counts or audit data is deleted — this is
  // purely what the normal-state Owner UI chooses not to surface.
  const notificationNeedsAttention = notification.status === "attention";

  return (
    <div className={`${OWNER_CONTAINER_CLASS} py-6`}>
      {/* Identity header, full width above the 12-column split. */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5">
            <p className="font-mono text-xs text-muted-foreground">{lead.reference}</p>
            <button
              type="button"
              onClick={() => void handleCopyReference()}
              aria-label="Copy reference number"
              className="rounded text-foreground/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <Copy className="size-3.5" aria-hidden="true" />
            </button>
            <span aria-live="polite" className="text-xs font-medium text-copper-bright">
              {referenceCopied ? "Reference copied" : ""}
            </span>
          </div>
          <h2 className="font-display text-[28px] leading-tight font-semibold text-foreground">{contactLabel}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant={lead.intent === "sell" ? "accent" : "secondary"}>{OWNER_LEAD_INTENT_LABELS[lead.intent]}</Badge>
            <Badge variant="outline">{OWNER_LEAD_STATUS_LABELS[lead.status]}</Badge>
            <Badge variant="outline">{OWNER_LEAD_CAPTURE_CHANNEL_LABELS[lead.captureChannel]}</Badge>
            {isTrashed ? (
              <Badge variant="outline" className="inline-flex items-center gap-1 border-white/15 bg-white/5 text-foreground/60">
                <Trash2 className="size-3" aria-hidden="true" />
                In Trash
              </Badge>
            ) : null}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Submitted {formatUaeDateTime(lead.submissionCompletedAt) ?? "—"}</p>
        </div>

        {/* CHECKPOINT OWNER DESKTOP CORRECTION (discoverability pass) — a
            restrained, clearly-labelled "Actions" trigger (never a bare
            ellipsis icon a first-time owner could miss entirely), holding
            both Archive and Move to Trash. Neither is duplicated as a
            large permanent button elsewhere on the page — this menu is the
            one home for both. Hidden once already trashed (Restore lives
            in the Status panel below instead). */}
        {!isTrashed ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="sm" className="gap-1.5">
                Actions
                <ChevronDown className="size-3.5" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="border-white/10 bg-navy-deep/95 text-foreground">
              {/* "Edit enquiry" — the first item, and only offered for an
                  active, non-archived lead (the outer !isTrashed check
                  above already excludes Trash). An archived or trashed
                  enquiry stays read-only until restored/reopened; see
                  routes/owner/leads/$leadId.edit.tsx's own defense-in-depth
                  re-check of this exact rule. */}
              {lead.status !== "archived" ? (
                <DropdownMenuItem asChild className="gap-1.5">
                  <Link to="/owner/leads/$leadId/edit" params={{ leadId }}>
                    <Pencil className="size-4" aria-hidden="true" />
                    Edit enquiry
                  </Link>
                </DropdownMenuItem>
              ) : null}
              {lead.status !== "archived" ? (
                <DropdownMenuItem
                  className="gap-1.5"
                  disabled={mutations.state.isChangingStatus}
                  onSelect={() => void mutations.changeStatus({ expectedStatus: lead.status, newStatus: "archived", lostReason: null })}
                >
                  <Archive className="size-4" aria-hidden="true" />
                  Archive enquiry
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                className="gap-1.5 text-destructive focus:bg-destructive/10 focus:text-destructive"
                onSelect={() => setTrashDialogOpen(true)}
              >
                <Trash2 className="size-4" aria-hidden="true" />
                Move to Trash
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      <AlertDialog open={trashDialogOpen} onOpenChange={setTrashDialogOpen}>
        <AlertDialogContent className="border-white/10 bg-navy-deep/95 text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground">Move this enquiry to Trash?</AlertDialogTitle>
            <AlertDialogDescription className="text-foreground/70">
              {contactLabel} ({lead.reference}) will disappear from the Inbox, Overview analytics and CSV exports. It stays fully
              recoverable — you can restore it from Trash at any time, and nothing about its history is deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {mutations.state.trashError ? <p className="text-sm text-destructive">{mutations.state.trashError}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutations.state.isTrashing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive"
              disabled={mutations.state.isTrashing}
              onClick={async (event) => {
                event.preventDefault();
                const result = await mutations.trashLead();
                if (result.ok) setTrashDialogOpen(false);
              }}
            >
              {mutations.state.isTrashing ? "Moving…" : "Move to Trash"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Main — 8 columns. */}
        <div className="flex flex-col gap-5 lg:col-span-8">
          <Panel id="owner-lead-enquiry-heading" title="Enquiry details">
            {lead.intent === "sell" ? (
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <RequiredField label="Material" value={materialLine} />
                <RequiredField
                  label="Quantity"
                  value={lead.enquiry.quantityUnsure ? "Not sure" : quantityDisplay(lead.enquiry.quantityValue, lead.enquiry.quantityUnit)}
                />
                <Field label="Condition" value={formatSimpleVocab(lead.enquiry.condition)} />
                <Field label="Pickup required" value={formatSimpleVocab(lead.enquiry.pickupRequired)} />
                <Field label="Pickup date" value={lead.enquiry.pickupRequired === "yes" ? lead.enquiry.pickupDate : null} />
                <RequiredField label="Emirate" value={emirateLabel} />
                <RequiredField label="Area" value={lead.location.area} />
                <Field label="Access note" value={lead.enquiry.pickupRequired === "yes" ? lead.enquiry.accessNote : null} />
                <Field label="Description" value={lead.enquiry.description} />
                <Field label="Notes" value={lead.enquiry.notes} />
                {files.length === 0 ? <Field label="Attachments" value="None provided" /> : null}
              </dl>
            ) : (
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <RequiredField label="Material" value={materialLine} />
                <Field label="Material spec" value={lead.enquiry.materialSpec} />
                <RequiredField label="Quantity" value={quantityDisplay(lead.enquiry.quantityValue, lead.enquiry.quantityUnit)} />
                <Field label="Trade" value={formatSimpleVocab(lead.enquiry.tradeRequirement)} />
                <Field label="Required by" value={lead.enquiry.requiredByDate} />
                <Field label="Fulfilment" value={formatSimpleVocab(lead.enquiry.fulfilment)} />
                <Field label="Logistics" value={formatSimpleVocab(lead.enquiry.logisticsRequirement)} />
                <Field label="Preferred port" value={formatSimpleVocab(lead.enquiry.preferredPort) ?? lead.enquiry.preferredPortOther} />
                <RequiredField label="Emirate" value={emirateLabel} />
                <RequiredField label="Area" value={lead.location.area} />
                <Field label="Destination country" value={lead.enquiry.destinationCountry} />
                <Field label="Destination city/port" value={lead.enquiry.destinationCityPort} />
                <Field label="Origin preference" value={lead.enquiry.originCountryPreference} />
                <Field label="Additional spec" value={lead.enquiry.additionalSpec} />
                <Field label="Logistics note" value={lead.enquiry.logisticsNote} />
                <Field label="Notes" value={lead.enquiry.notes} />
                {files.length === 0 ? <Field label="Attachments" value="None provided" /> : null}
              </dl>
            )}
            {lead.location.mapLink && isSafeExternalLink(lead.location.mapLink) ? (
              <a
                href={lead.location.mapLink}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex items-center gap-1 border-t border-white/10 pt-3 text-sm text-copper-bright underline-offset-2 hover:underline"
              >
                <MapPin className="size-3.5" aria-hidden="true" />
                View on map
              </a>
            ) : null}
          </Panel>

          {/* CHECKPOINT OWNER DESKTOP CORRECTION (metadata pass) — the
              empty case no longer gets its own full-width surface at all;
              it's folded into the Enquiry details "Attachments" field
              above. Real attachments keep their existing full Files panel
              and file-viewer functionality, completely unchanged. */}
          {files.length > 0 ? (
            <Panel id="owner-lead-files-heading" title="Files">
              <ul className="flex flex-col gap-2">
                {files.map((file) => (
                  <li key={file.id}>
                    <OwnerLeadFileViewer leadId={leadId} file={file} deps={deps} onUnauthorized={onUnauthorized} />
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          <Panel id="owner-lead-activity-heading" title="Activity">
            {activities.length === 0 ? (
              <p className="text-sm text-muted-foreground">No activity recorded.</p>
            ) : (
              <ol className="flex flex-col gap-2 border-l border-white/10 pl-4">
                {activities.map((activity) => (
                  <li key={activity.id} className="text-sm">
                    <p className="text-foreground">{formatActivityEventType(activity.eventType)}</p>
                    {activity.statusChange ? (
                      <p className="text-sm text-foreground">
                        {OWNER_LEAD_STATUS_LABELS[activity.statusChange.from]} → {OWNER_LEAD_STATUS_LABELS[activity.statusChange.to]}
                        {activity.statusChange.reason ? ` — "${activity.statusChange.reason}"` : ""}
                      </p>
                    ) : null}
                    {activity.changedFields && activity.changedFields.length > 0 ? (
                      <p className="text-sm text-foreground/70">Changed: {activity.changedFields.join(", ")}</p>
                    ) : null}
                    {activity.noteBody ? (
                      <p className="whitespace-pre-wrap rounded-md border border-white/10 bg-[#080A1D]/50 px-2 py-1.5 text-sm text-foreground">
                        {activity.noteBody}
                      </p>
                    ) : null}
                    <p className="text-xs text-muted-foreground">
                      {activity.actorType === "owner" ? "Owner" : "System"} · {formatUaeDateTime(activity.createdAt) ?? "—"}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>

        {/* Side — 4 columns: contact actions, the merged status+note workflow card, and (only when actionable) notification. Sticky where the viewport is tall enough, never overlapping the header. */}
        <div className="flex flex-col gap-5 lg:sticky lg:top-[86px] lg:col-span-4 lg:h-fit lg:self-start">
          <Panel id="owner-lead-contact-heading" title="Contact">
            {telHref || whatsappHref || mailtoHref ? (
              <div className="mb-4 flex flex-wrap gap-2">
                {telHref ? (
                  <Button asChild size="sm" variant={primaryContactAction === "call" ? "brand" : "outline"} className="gap-1.5">
                    <a href={telHref} aria-label={`Call ${contactLabel}`}>
                      <Phone className="size-4" aria-hidden="true" />
                      Call
                    </a>
                  </Button>
                ) : null}
                {whatsappHref ? (
                  <Button asChild size="sm" variant={primaryContactAction === "whatsapp" ? "brand" : "outline"} className="gap-1.5">
                    <a href={whatsappHref} target="_blank" rel="noopener noreferrer" aria-label={`Message ${contactLabel} on WhatsApp`}>
                      <MessageCircle className="size-4" aria-hidden="true" />
                      WhatsApp
                    </a>
                  </Button>
                ) : null}
                {mailtoHref ? (
                  <Button asChild size="sm" variant={primaryContactAction === "email" ? "brand" : "outline"} className="gap-1.5">
                    <a href={mailtoHref} aria-label={`Email ${contactLabel}`}>
                      <Mail className="size-4" aria-hidden="true" />
                      Email
                    </a>
                  </Button>
                ) : null}
              </div>
            ) : null}
            <dl className="grid grid-cols-2 gap-4">
              <Field label="Name" value={formatPersonName(lead.contact.name)} />
              <Field label="Company" value={lead.contact.company} />
              <Field label="Phone" value={displayPhone} />
              <Field label="Email" value={lead.contact.email} />
              <Field label="Preferred contact" value={formatSimpleVocab(lead.enquiry.preferredContact)} />
            </dl>
          </Panel>

          {isTrashed ? (
            // CHECKPOINT C2M-A — a trashed lead offers exactly one action:
            // Restore. Status/note mutation controls are removed entirely
            // (not merely disabled) rather than shown inert, since neither
            // mutation is meaningful for a lead that isn't in any active
            // view right now.
            <Panel id="owner-lead-manage-heading" title="Restore">
              <p className="mb-3 text-sm text-foreground/70">
                This enquiry is in Trash and won&apos;t appear in the Inbox, Archived view, Overview analytics or CSV exports. Its status,
                notes and full history are preserved and will return exactly as they were once restored.
              </p>
              {mutations.state.restoreError ? <p className="mb-3 text-sm text-destructive">{mutations.state.restoreError}</p> : null}
              <div aria-live="polite" className="min-h-4 text-xs">
                {mutations.state.isRestoring ? <p className="text-foreground/60">Restoring…</p> : null}
              </div>
              <Button
                type="button"
                variant="brand"
                className="mt-2 gap-1.5"
                disabled={mutations.state.isRestoring}
                onClick={() => void mutations.restoreLead()}
              >
                <RotateCcw className="size-4" aria-hidden="true" />
                {mutations.state.isRestoring ? "Restoring…" : "Restore enquiry"}
              </Button>
            </Panel>
          ) : (
            <Panel id="owner-lead-manage-heading" title="Status">
              <div className="flex flex-col gap-6">
                <OwnerLeadStatusControl
                  currentStatus={lead.status}
                  isSaving={mutations.state.isChangingStatus}
                  error={mutations.state.statusError}
                  onChangeStatus={mutations.changeStatus}
                  onClearError={mutations.clearStatusError}
                />
                <OwnerLeadNoteComposer
                  isSaving={mutations.state.isAddingNote}
                  error={mutations.state.noteError}
                  onAddNote={mutations.addNote}
                  onClearError={mutations.clearNoteError}
                />
              </div>
            </Panel>
          )}

          {notificationNeedsAttention ? (
            <Panel id="owner-lead-notification-heading" title="Owner notification">
              <div className="mb-3 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2">
                <AlertTriangle className="size-4 shrink-0 text-destructive" aria-hidden="true" />
                <span className="text-sm font-medium text-foreground">{OWNER_NOTIFICATION_STATUS_LABELS[notification.status]}</span>
              </div>
              <p className="mb-3 text-xs text-foreground/70">
                This lead's notification hasn't been delivered successfully — the underlying delivery job may need a manual requeue.
              </p>
              <dl className="grid grid-cols-2 gap-4">
                <Field label="Attempts" value={String(notification.attemptCount)} />
                <Field label="Manual requeues" value={String(notification.manualRequeueCount)} />
                <Field label="Last error" value={notification.lastErrorCode} />
                <Field label="Last error at" value={formatUaeDateTime(notification.lastErrorAt)} />
              </dl>
            </Panel>
          ) : null}
        </div>
      </div>
    </div>
  );
}
