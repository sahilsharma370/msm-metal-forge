import { useState } from "react";
import { useFormContext } from "react-hook-form";
import { Plus } from "lucide-react";
import type { QuoteFormValues } from "../quote-schema";
import { PREFERRED_CONTACTS, PREFERRED_CONTACT_LABELS, getStageEyebrow } from "../quote-options";
import { QuotePillGroup } from "../QuotePillGroup";
import { QuotePhotoPicker } from "../QuotePhotoPicker";
import { QuoteOptionalSection } from "../QuoteOptionalSection";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface ContactEvidenceStepProps {
  restoredFilesNotice: boolean;
  /** Filenames the submission engine reported as still unresolved (needs_reselection/content_mismatch) — never includes an already-verified file. */
  unresolvedFilenames?: readonly string[];
}

const PREFERRED_CONTACT_OPTIONS = PREFERRED_CONTACTS.map((c) => ({
  value: c,
  label: PREFERRED_CONTACT_LABELS[c],
}));

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-1.5 text-[0.8rem] font-medium text-destructive">
      {message}
    </p>
  );
}

export function ContactEvidenceStep({
  restoredFilesNotice,
  unresolvedFilenames = [],
}: ContactEvidenceStepProps) {
  const form = useFormContext<QuoteFormValues>();
  const intent = form.watch("intent");
  const errors = form.formState.errors;
  const isSeller = intent === "sell";
  const preferredContact = isSeller
    ? form.watch("sellerPreferredContact")
    : form.watch("buyerPreferredContact");
  const emailValue = isSeller ? form.watch("sellerEmail") : form.watch("buyerEmail");
  const emailError = isSeller ? errors.sellerEmail : errors.buyerEmail;
  // Email is hidden until Email is chosen as the preferred contact — but a
  // restored draft's saved email, or a validation error on it, must always
  // reopen the field: data (or an error the customer needs to fix) can
  // never become invisible/inaccessible just because the toggle is closed.
  const showEmail = preferredContact === "email" || !!emailValue?.trim() || !!emailError;

  const evidenceFiles = isSeller ? form.watch("sellerPhotos") : form.watch("buyerDocuments");
  const hasUnresolvedFiles = unresolvedFilenames.length > 0;
  // C2L-Q5 — closed by default for a fresh form; auto-open (computed once,
  // at mount — this stage remounts fresh every time the customer navigates
  // back to it, so this always reflects the current situation) whenever
  // files already exist, an unresolved upload/recovery error exists, or
  // restored-draft guidance needs to be visible — never hide files, errors
  // or guidance behind a closed toggle.
  const [evidenceOpen, setEvidenceOpen] = useState(
    evidenceFiles.length > 0 || hasUnresolvedFiles || restoredFilesNotice,
  );

  return (
    <div>
      <p className="label-eyebrow text-copper-bright">{getStageEyebrow(4, intent)}</p>
      <h2 className="font-display mt-3 text-2xl font-bold text-foreground sm:text-3xl">
        How should we contact you?
      </h2>

      {unresolvedFilenames.length > 0 && (
        <p
          role="alert"
          className="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-xs leading-relaxed text-foreground/85"
        >
          {isSeller
            ? `Please add ${unresolvedFilenames.length === 1 ? "this photo" : "these photos"} again before submitting: `
            : `Please add ${unresolvedFilenames.length === 1 ? "this file" : "these files"} again before submitting: `}
          <span className="font-semibold">{unresolvedFilenames.join(", ")}</span>
        </p>
      )}

      {restoredFilesNotice && unresolvedFilenames.length === 0 && (
        <p className="mt-3 rounded-xl border border-copper/25 bg-[oklch(0.583_0.135_45.5/0.08)] px-3 py-2 text-xs text-foreground/70">
          Answers restored. {isSeller ? "Photos" : "Files"} aren't saved — please add them again.
        </p>
      )}

      {/* Primary block: Name/Contact person + Phone stay direct and visible. */}
      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        {isSeller ? (
          <>
            <div>
              <Label htmlFor="sellerName" className="text-sm font-semibold text-foreground/90">
                Name
              </Label>
              <Input
                id="sellerName"
                className="mt-2 h-11 rounded-xl border-white/15 bg-navy-deep/95"
                aria-invalid={!!errors.sellerName}
                aria-describedby={errors.sellerName ? "sellerName-error" : undefined}
                {...form.register("sellerName", { onChange: () => form.clearErrors("sellerName") })}
              />
              <FieldError id="sellerName-error" message={errors.sellerName?.message} />
            </div>
            <div>
              <Label htmlFor="sellerPhone" className="text-sm font-semibold text-foreground/90">
                Phone / WhatsApp
              </Label>
              <Input
                id="sellerPhone"
                type="tel"
                className="mt-2 h-11 rounded-xl border-white/15 bg-navy-deep/95"
                placeholder="+971 5xx xxx xxx"
                aria-invalid={!!errors.sellerPhone}
                aria-describedby={errors.sellerPhone ? "sellerPhone-error" : undefined}
                {...form.register("sellerPhone", {
                  onChange: () => form.clearErrors("sellerPhone"),
                })}
              />
              <FieldError id="sellerPhone-error" message={errors.sellerPhone?.message} />
              <p className="mt-1.5 text-xs text-foreground/60">
                UAE number, or international number with country code.
              </p>
            </div>
          </>
        ) : (
          <>
            <div>
              <Label
                htmlFor="buyerContactPerson"
                className="text-sm font-semibold text-foreground/90"
              >
                Contact person
              </Label>
              <Input
                id="buyerContactPerson"
                className="mt-2 h-11 rounded-xl border-white/15 bg-navy-deep/95"
                aria-invalid={!!errors.buyerContactPerson}
                aria-describedby={
                  errors.buyerContactPerson ? "buyerContactPerson-error" : undefined
                }
                {...form.register("buyerContactPerson", {
                  onChange: () => form.clearErrors("buyerContactPerson"),
                })}
              />
              <FieldError
                id="buyerContactPerson-error"
                message={errors.buyerContactPerson?.message}
              />
            </div>
            <div>
              <Label htmlFor="buyerPhone" className="text-sm font-semibold text-foreground/90">
                Phone / WhatsApp
              </Label>
              <Input
                id="buyerPhone"
                type="tel"
                className="mt-2 h-11 rounded-xl border-white/15 bg-navy-deep/95"
                placeholder="+971 5xx xxx xxx"
                aria-invalid={!!errors.buyerPhone}
                aria-describedby={errors.buyerPhone ? "buyerPhone-error" : undefined}
                {...form.register("buyerPhone", { onChange: () => form.clearErrors("buyerPhone") })}
              />
              <FieldError id="buyerPhone-error" message={errors.buyerPhone?.message} />
              <p className="mt-1.5 text-xs text-foreground/50">
                UAE number, or international number with country code.
              </p>
            </div>
          </>
        )}
      </div>

      <div className="mt-6">
        <QuotePillGroup
          label="Preferred contact"
          options={PREFERRED_CONTACT_OPTIONS}
          value={preferredContact}
          onChange={(v) => {
            const field = isSeller ? "sellerPreferredContact" : "buyerPreferredContact";
            form.setValue(field, v as QuoteFormValues["sellerPreferredContact"], {
              shouldValidate: true,
              shouldDirty: true,
            });
            form.clearErrors(field);
            if (v !== "email") form.clearErrors(isSeller ? "sellerEmail" : "buyerEmail");
          }}
          error={
            isSeller
              ? errors.sellerPreferredContact?.message
              : errors.buyerPreferredContact?.message
          }
        />
      </div>

      {/* Email reveals automatically once Email is the preferred contact —
          and stays visible whenever a restored value or an error exists, so
          data/errors can never be hidden behind a closed toggle. */}
      {showEmail && (
        <div className="mt-4 max-w-md">
          {isSeller ? (
            <>
              <Label htmlFor="sellerEmail" className="text-sm font-semibold text-foreground/90">
                Email{" "}
                <span className="font-normal text-foreground/50">
                  {preferredContact === "email" ? "(required)" : "(optional)"}
                </span>
              </Label>
              <Input
                id="sellerEmail"
                type="email"
                className="mt-2 h-11 rounded-xl border-white/15 bg-navy-deep/95"
                aria-invalid={!!errors.sellerEmail}
                aria-describedby={errors.sellerEmail ? "sellerEmail-error" : undefined}
                {...form.register("sellerEmail", {
                  onChange: () => form.clearErrors("sellerEmail"),
                })}
              />
              <FieldError id="sellerEmail-error" message={errors.sellerEmail?.message} />
            </>
          ) : (
            <>
              <Label htmlFor="buyerEmail" className="text-sm font-semibold text-foreground/90">
                Email <span className="font-normal text-foreground/50">(required)</span>
              </Label>
              <Input
                id="buyerEmail"
                type="email"
                className="mt-2 h-11 rounded-xl border-white/15 bg-navy-deep/95"
                aria-invalid={!!errors.buyerEmail}
                aria-describedby={errors.buyerEmail ? "buyerEmail-error" : undefined}
                {...form.register("buyerEmail", { onChange: () => form.clearErrors("buyerEmail") })}
              />
              <FieldError id="buyerEmail-error" message={errors.buyerEmail?.message} />
            </>
          )}
        </div>
      )}

      {/* C2L (surgical contact photo fix) — Photos/Documents now sits right
          after Preferred contact/Email, ahead of the collapsed Company/Note
          sections, so the trigger is reachable in the initial desktop
          viewport instead of being pushed down by those optional fields.
          The disclosure itself stays (collapsed/expanded/auto-reopen
          behaviour unchanged, see evidenceOpen above) — only its position
          and its expanded content's density changed: a compact tile-and-
          thumbnails row (via QuotePhotoPicker) replaces the previous
          oversized bordered panel, and the trigger now shows a plain
          heading plus one separate "Recommended" badge instead of a
          combined "Recommended · optional" string. */}
      <Collapsible open={evidenceOpen} onOpenChange={setEvidenceOpen} className="mt-6">
        <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/10 bg-navy-deep/95 px-4 py-3 text-left transition-colors hover:border-copper/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-copper">
          <span className="flex min-w-0 items-center gap-2">
            <Plus
              aria-hidden="true"
              className={`h-3.5 w-3.5 shrink-0 text-foreground/60 transition-transform ${
                evidenceOpen ? "rotate-45" : ""
              }`}
            />
            <span className="truncate text-sm font-semibold text-foreground/90">
              {isSeller ? "Photos (optional)" : "Documents (optional)"}
            </span>
          </span>
          <span className="shrink-0 rounded-full border border-copper/30 bg-[oklch(0.583_0.135_45.5/0.12)] px-2 py-0.5 text-[0.62rem] font-semibold tracking-[0.04em] text-copper-bright uppercase">
            Recommended
          </span>
        </CollapsibleTrigger>

        <CollapsibleContent className="mt-3">
          <p className="text-xs leading-relaxed text-foreground/60">
            {isSeller
              ? "Add one wide photo and one close-up."
              : "A specification sheet, sample photo or purchase reference."}
          </p>

          <div className="mt-3">
            {isSeller ? (
              <QuotePhotoPicker
                title="Add photos"
                browseLabel="Browse files or use your camera"
                acceptLine="JPG, PNG or WebP · Up to 5 photos"
                countLabel="photos added"
                files={form.watch("sellerPhotos")}
                onChange={(files) => form.setValue("sellerPhotos", files, { shouldDirty: true })}
                maxFiles={5}
              />
            ) : (
              <QuotePhotoPicker
                title="Add a supporting document or image"
                browseLabel="Browse files"
                acceptLine="PDF, JPG, PNG or WebP · Up to 3 files"
                countLabel="files attached"
                files={form.watch("buyerDocuments")}
                onChange={(files) => form.setValue("buyerDocuments", files, { shouldDirty: true })}
                maxFiles={3}
                allowPdf
              />
            )}
          </div>

          <p className="mt-2 text-[0.68rem] leading-relaxed text-foreground/45">
            Grade, weight, price and availability are confirmed separately by MSM.
          </p>
        </CollapsibleContent>
      </Collapsible>

      <QuoteOptionalSection
        label="Add company details (optional)"
        defaultOpen={!!form.watch(isSeller ? "sellerCompany" : "buyerCompany")}
      >
        {isSeller ? (
          <>
            <Label htmlFor="sellerCompany" className="text-sm font-semibold text-foreground/90">
              Company
            </Label>
            <Input
              id="sellerCompany"
              className="mt-2 h-11 rounded-xl border-white/15 bg-navy-deep/95"
              {...form.register("sellerCompany")}
            />
          </>
        ) : (
          <>
            <Label htmlFor="buyerCompany" className="text-sm font-semibold text-foreground/90">
              Company <span className="font-normal text-foreground/50">(recommended)</span>
            </Label>
            <Input
              id="buyerCompany"
              className="mt-2 h-11 rounded-xl border-white/15 bg-navy-deep/95"
              aria-invalid={!!errors.buyerCompany}
              aria-describedby={errors.buyerCompany ? "buyerCompany-error" : undefined}
              {...form.register("buyerCompany", {
                onChange: () => form.clearErrors("buyerCompany"),
              })}
            />
            <FieldError id="buyerCompany-error" message={errors.buyerCompany?.message} />
          </>
        )}
      </QuoteOptionalSection>

      <QuoteOptionalSection
        label="Add a note (optional)"
        defaultOpen={!!form.watch(isSeller ? "sellerNotes" : "buyerNotes")}
      >
        <Label htmlFor="notes" className="text-sm font-semibold text-foreground/90">
          Notes
        </Label>
        <Textarea
          id="notes"
          className="mt-2 min-h-20 rounded-xl border-white/15 bg-navy-deep/95"
          {...form.register(isSeller ? "sellerNotes" : "buyerNotes")}
        />
      </QuoteOptionalSection>
    </div>
  );
}
