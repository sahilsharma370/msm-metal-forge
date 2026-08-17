import { AlertTriangle, CheckCircle2, Clock, MapPin, MessageCircle, MinusCircle, Phone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { OwnerLeadDetailData } from "./use-owner-lead-detail";
import { OwnerLeadFileViewer } from "./OwnerLeadFileViewer";
import { OwnerLeadStatusControl } from "./OwnerLeadStatusControl";
import { OwnerLeadNoteComposer } from "./OwnerLeadNoteComposer";
import { useOwnerLeadMutations } from "./use-owner-lead-mutations";
import type { OwnerLeadsTransportDeps } from "./owner-leads-transport";
import {
  OWNER_LEAD_STATUS_LABELS,
  OWNER_LEAD_INTENT_LABELS,
  OWNER_LEAD_MATERIAL_LABELS,
  OWNER_LEAD_CAPTURE_CHANNEL_LABELS,
  OWNER_NOTIFICATION_STATUS_LABELS,
  OWNER_LEAD_ACTIVITY_ACTOR_LABELS,
  formatActivityEventType,
  formatSimpleVocab,
  formatQuantity,
  formatUaeDateTime,
  buildTelHref,
  buildOwnerWhatsAppHref,
} from "./owner-lead-format";

/**
 * CHECKPOINT C2J-D — the /owner/leads/:leadId detail page body. Renders
 * only the branch (seller or buyer) the discriminated-union contract
 * actually contains for this lead — there is no opposite-branch data to
 * accidentally show, because the type itself doesn't have those fields on
 * the other variant.
 */

const NOTIFICATION_ICONS = { sent: CheckCircle2, pending: Clock, attention: AlertTriangle, not_required: MinusCircle } as const;

export interface OwnerLeadDetailViewProps {
  readonly leadId: string;
  readonly data: OwnerLeadDetailData;
  readonly deps: OwnerLeadsTransportDeps;
  readonly onUnauthorized: () => void;
  readonly onMutated: () => void;
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{value}</dd>
    </div>
  );
}

export function OwnerLeadDetailView({ leadId, data, deps, onUnauthorized, onMutated }: OwnerLeadDetailViewProps) {
  const { lead, files, activities, notification } = data;
  const mutations = useOwnerLeadMutations(leadId, deps, onMutated, onUnauthorized);
  const NotificationIcon = NOTIFICATION_ICONS[notification.status];
  const telHref = buildTelHref(lead.contact.phone);
  const whatsappHref = buildOwnerWhatsAppHref(lead.contact.phone);
  const contactLabel = lead.contact.name ?? lead.reference;
  const materialLine = [OWNER_LEAD_MATERIAL_LABELS[lead.material], lead.materialSubtype, lead.materialSubtypeOtherText]
    .filter(Boolean)
    .join(" — ");
  const isSafeExternalLink = (href: string) => /^https?:\/\//i.test(href);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
      {/* 1. Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs text-muted-foreground">{lead.reference}</p>
          <h2 className="text-xl font-semibold text-foreground">{contactLabel}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge variant={lead.intent === "sell" ? "default" : "secondary"}>{OWNER_LEAD_INTENT_LABELS[lead.intent]}</Badge>
            <Badge variant="outline">{OWNER_LEAD_STATUS_LABELS[lead.status]}</Badge>
            <Badge variant="outline">{OWNER_LEAD_CAPTURE_CHANNEL_LABELS[lead.captureChannel]}</Badge>
          </div>
        </div>
        <div className="flex gap-2">
          {telHref ? (
            <Button asChild size="sm" className="gap-1.5">
              <a href={telHref} aria-label={`Call ${contactLabel}`}>
                <Phone className="size-4" aria-hidden="true" />
                Call
              </a>
            </Button>
          ) : null}
          {whatsappHref ? (
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <a href={whatsappHref} target="_blank" rel="noopener noreferrer" aria-label={`Message ${contactLabel} on WhatsApp`}>
                <MessageCircle className="size-4" aria-hidden="true" />
                WhatsApp
              </a>
            </Button>
          ) : null}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Submitted {formatUaeDateTime(lead.submissionCompletedAt) ?? "—"}
      </p>

      {/* 2. Contact */}
      <section aria-labelledby="owner-lead-contact-heading" className="rounded-lg border border-border bg-card/40 p-4">
        <h3 id="owner-lead-contact-heading" className="mb-3 text-sm font-semibold text-foreground">
          Contact
        </h3>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Name" value={lead.contact.name} />
          <Field label="Phone" value={lead.contact.phone} />
          <Field label="Email" value={lead.contact.email} />
          <Field label="Company" value={lead.contact.company} />
        </dl>
      </section>

      {/* 3. Enquiry */}
      <section aria-labelledby="owner-lead-enquiry-heading" className="rounded-lg border border-border bg-card/40 p-4">
        <h3 id="owner-lead-enquiry-heading" className="mb-3 text-sm font-semibold text-foreground">
          Enquiry
        </h3>
        {lead.intent === "sell" ? (
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="Material" value={materialLine} />
            <Field label="Quantity" value={formatQuantity(lead.enquiry.quantityValue, lead.enquiry.quantityUnit) ?? (lead.enquiry.quantityUnsure ? "Not sure" : null)} />
            <Field label="Condition" value={formatSimpleVocab(lead.enquiry.condition)} />
            <Field label="Pickup required" value={formatSimpleVocab(lead.enquiry.pickupRequired)} />
            <Field label="Pickup date" value={lead.enquiry.pickupDate} />
            <Field label="Preferred contact" value={formatSimpleVocab(lead.enquiry.preferredContact)} />
            <Field label="Description" value={lead.enquiry.description} />
            <Field label="Access note" value={lead.enquiry.accessNote} />
            <Field label="Notes" value={lead.enquiry.notes} />
          </dl>
        ) : (
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="Material" value={materialLine} />
            <Field label="Material spec" value={lead.enquiry.materialSpec} />
            <Field label="Quantity" value={formatQuantity(lead.enquiry.quantityValue, lead.enquiry.quantityUnit)} />
            <Field label="Trade" value={formatSimpleVocab(lead.enquiry.tradeRequirement)} />
            <Field label="Required by" value={lead.enquiry.requiredByDate} />
            <Field label="Fulfilment" value={formatSimpleVocab(lead.enquiry.fulfilment)} />
            <Field label="Logistics" value={formatSimpleVocab(lead.enquiry.logisticsRequirement)} />
            <Field label="Preferred port" value={formatSimpleVocab(lead.enquiry.preferredPort) ?? lead.enquiry.preferredPortOther} />
            <Field label="Preferred contact" value={formatSimpleVocab(lead.enquiry.preferredContact)} />
            <Field label="Additional spec" value={lead.enquiry.additionalSpec} />
            <Field label="Logistics note" value={lead.enquiry.logisticsNote} />
            <Field label="Notes" value={lead.enquiry.notes} />
          </dl>
        )}
      </section>

      {/* 4. Location / trade route */}
      <section aria-labelledby="owner-lead-location-heading" className="rounded-lg border border-border bg-card/40 p-4">
        <h3 id="owner-lead-location-heading" className="mb-3 text-sm font-semibold text-foreground">
          {lead.intent === "sell" ? "Location" : "Trade route"}
        </h3>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Emirate" value={lead.location.emirate ? formatSimpleVocab(lead.location.emirate) ?? lead.location.emirate : null} />
          <Field label="Area" value={lead.location.area} />
          {lead.intent === "buy" ? (
            <>
              <Field label="Destination country" value={lead.enquiry.destinationCountry} />
              <Field label="Destination city/port" value={lead.enquiry.destinationCityPort} />
              <Field label="Origin preference" value={lead.enquiry.originCountryPreference} />
            </>
          ) : null}
        </dl>
        {lead.location.mapLink && isSafeExternalLink(lead.location.mapLink) ? (
          <a
            href={lead.location.mapLink}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-sm text-copper-bright underline-offset-2 hover:underline"
          >
            <MapPin className="size-3.5" aria-hidden="true" />
            View on map
          </a>
        ) : null}
      </section>

      {/* 5. Files */}
      <section aria-labelledby="owner-lead-files-heading" className="rounded-lg border border-border bg-card/40 p-4">
        <h3 id="owner-lead-files-heading" className="mb-3 text-sm font-semibold text-foreground">
          Files
        </h3>
        {files.length === 0 ? (
          <p className="text-sm text-muted-foreground">No files uploaded.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {files.map((file) => (
              <li key={file.id}>
                <OwnerLeadFileViewer leadId={leadId} file={file} deps={deps} onUnauthorized={onUnauthorized} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 6. Manage — status change + private notes (CHECKPOINT C2J-E) */}
      <section aria-labelledby="owner-lead-manage-heading" className="rounded-lg border border-border bg-card/40 p-4">
        <h3 id="owner-lead-manage-heading" className="mb-3 text-sm font-semibold text-foreground">
          Manage
        </h3>
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
      </section>

      {/* 7. Notification (rendered before activity per typical operator priority — attention-worthy state first) */}
      <section aria-labelledby="owner-lead-notification-heading" className="rounded-lg border border-border bg-card/40 p-4">
        <h3 id="owner-lead-notification-heading" className="mb-3 text-sm font-semibold text-foreground">
          Owner notification
        </h3>
        <div className="flex items-center gap-2">
          <NotificationIcon
            className={notification.status === "attention" ? "size-4 text-destructive" : "size-4 text-muted-foreground"}
            aria-hidden="true"
          />
          <span className="text-sm font-medium text-foreground">{OWNER_NOTIFICATION_STATUS_LABELS[notification.status]}</span>
        </div>
        <dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Attempts" value={String(notification.attemptCount)} />
          <Field label="Manual requeues" value={String(notification.manualRequeueCount)} />
          <Field label="Last error" value={notification.lastErrorCode} />
          <Field label="Last error at" value={formatUaeDateTime(notification.lastErrorAt)} />
        </dl>
      </section>

      {/* 6. Activity timeline */}
      <section aria-labelledby="owner-lead-activity-heading" className="rounded-lg border border-border bg-card/40 p-4">
        <h3 id="owner-lead-activity-heading" className="mb-3 text-sm font-semibold text-foreground">
          Activity
        </h3>
        {activities.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity recorded.</p>
        ) : (
          <ol className="flex flex-col gap-2 border-l border-border pl-4">
            {activities.map((activity) => (
              <li key={activity.id} className="text-sm">
                <p className="text-foreground">{formatActivityEventType(activity.eventType)}</p>
                {activity.statusChange ? (
                  <p className="text-sm text-foreground">
                    {OWNER_LEAD_STATUS_LABELS[activity.statusChange.from]} → {OWNER_LEAD_STATUS_LABELS[activity.statusChange.to]}
                    {activity.statusChange.reason ? ` — "${activity.statusChange.reason}"` : ""}
                  </p>
                ) : null}
                {activity.noteBody ? (
                  <p className="whitespace-pre-wrap rounded-md bg-muted/50 px-2 py-1.5 text-sm text-foreground">{activity.noteBody}</p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  {OWNER_LEAD_ACTIVITY_ACTOR_LABELS[activity.actorType]} · {formatUaeDateTime(activity.createdAt) ?? "—"}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
