import { useFormContext } from "react-hook-form";
import type { QuoteFormValues } from "../quote-schema";
import { PREFERRED_CONTACTS, PREFERRED_CONTACT_LABELS } from "../quote-options";
import { QuotePillGroup } from "../QuotePillGroup";
import { QuotePhotoPicker } from "../QuotePhotoPicker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface ContactEvidenceStepProps {
  restoredFilesNotice: boolean;
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

export function ContactEvidenceStep({ restoredFilesNotice }: ContactEvidenceStepProps) {
  const form = useFormContext<QuoteFormValues>();
  const intent = form.watch("intent");
  const errors = form.formState.errors;
  const isSeller = intent === "sell";
  const isImportExport = form.watch("buyerTradeRequirement") !== "local";

  return (
    <div>
      <p className="label-eyebrow text-copper-bright">
        {isSeller ? "Photos & Contact" : "Documents & Contact"}
      </p>
      <h2 className="font-display mt-3 text-2xl font-bold text-foreground sm:text-3xl">
        {isSeller ? "Add photos and contact details" : "Add company and contact details"}
      </h2>

      {restoredFilesNotice && (
        <p className="mt-3 rounded-xl border border-copper/25 bg-[oklch(0.583_0.135_45.5/0.08)] px-4 py-2.5 text-xs leading-relaxed text-foreground/75">
          We restored your saved answers, but files aren't kept between sessions — please re-add any
          photos or documents.
        </p>
      )}

      <div className="mt-8 grid gap-8 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        {/* Evidence column */}
        <div className="space-y-4">
          {isSeller ? (
            <>
              <p className="text-xs leading-relaxed text-foreground/60">
                Add one wide photo showing the approximate quantity and one close-up of the
                material. Visible markings or cut ends are also helpful.
              </p>
              <QuotePhotoPicker
                title="Add photos"
                browseLabel="Browse files or use your camera"
                acceptLine="JPG, PNG or WebP · Up to 5 photos"
                files={form.watch("sellerPhotos")}
                onChange={(files) => form.setValue("sellerPhotos", files, { shouldDirty: true })}
                maxFiles={5}
              />
              <p className="text-xs leading-relaxed text-foreground/45">
                Photos support the initial review only. Grade, weight and price are confirmed
                separately.
              </p>
            </>
          ) : (
            <>
              <p className="text-xs leading-relaxed text-foreground/60">
                A specification sheet, sample photo or purchase reference can help MSM review the
                requirement.
              </p>
              <QuotePhotoPicker
                title="Add a supporting document or image"
                browseLabel="Browse files"
                acceptLine="PDF, JPG, PNG or WebP · Up to 3 files"
                files={form.watch("buyerDocuments")}
                onChange={(files) => form.setValue("buyerDocuments", files, { shouldDirty: true })}
                maxFiles={3}
                allowPdf
              />
            </>
          )}
        </div>

        {/* Contact column */}
        <div>
          <div className="grid gap-6 sm:grid-cols-2">
            {isSeller ? (
              <>
                <div>
                  <Label htmlFor="sellerName" className="text-sm font-semibold text-foreground/90">
                    Name
                  </Label>
                  <Input
                    id="sellerName"
                    className="mt-2 h-11 rounded-xl border-white/15 bg-white/5"
                    aria-invalid={!!errors.sellerName}
                    aria-describedby={errors.sellerName ? "sellerName-error" : undefined}
                    {...form.register("sellerName", {
                      onChange: () => form.clearErrors("sellerName"),
                    })}
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
                    className="mt-2 h-11 rounded-xl border-white/15 bg-white/5"
                    placeholder="+971 5xx xxx xxx"
                    aria-invalid={!!errors.sellerPhone}
                    aria-describedby={errors.sellerPhone ? "sellerPhone-error" : undefined}
                    {...form.register("sellerPhone", {
                      onChange: () => form.clearErrors("sellerPhone"),
                    })}
                  />
                  <FieldError id="sellerPhone-error" message={errors.sellerPhone?.message} />
                </div>
                <div>
                  <Label
                    htmlFor="sellerCompany"
                    className="text-sm font-semibold text-foreground/90"
                  >
                    Company <span className="font-normal text-foreground/50">(optional)</span>
                  </Label>
                  <Input
                    id="sellerCompany"
                    className="mt-2 h-11 rounded-xl border-white/15 bg-white/5"
                    {...form.register("sellerCompany")}
                  />
                </div>
                <div>
                  <Label htmlFor="sellerEmail" className="text-sm font-semibold text-foreground/90">
                    Email <span className="font-normal text-foreground/50">(optional)</span>
                  </Label>
                  <Input
                    id="sellerEmail"
                    type="email"
                    className="mt-2 h-11 rounded-xl border-white/15 bg-white/5"
                    aria-invalid={!!errors.sellerEmail}
                    aria-describedby={errors.sellerEmail ? "sellerEmail-error" : undefined}
                    {...form.register("sellerEmail", {
                      onChange: () => form.clearErrors("sellerEmail"),
                    })}
                  />
                  <FieldError id="sellerEmail-error" message={errors.sellerEmail?.message} />
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
                    className="mt-2 h-11 rounded-xl border-white/15 bg-white/5"
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
                    className="mt-2 h-11 rounded-xl border-white/15 bg-white/5"
                    placeholder="+971 5xx xxx xxx"
                    aria-invalid={!!errors.buyerPhone}
                    aria-describedby={errors.buyerPhone ? "buyerPhone-error" : undefined}
                    {...form.register("buyerPhone", {
                      onChange: () => form.clearErrors("buyerPhone"),
                    })}
                  />
                  <FieldError id="buyerPhone-error" message={errors.buyerPhone?.message} />
                </div>
                <div>
                  <Label
                    htmlFor="buyerCompany"
                    className="text-sm font-semibold text-foreground/90"
                  >
                    Company{" "}
                    {isImportExport ? (
                      ""
                    ) : (
                      <span className="font-normal text-foreground/50">(optional)</span>
                    )}
                  </Label>
                  <Input
                    id="buyerCompany"
                    className="mt-2 h-11 rounded-xl border-white/15 bg-white/5"
                    aria-invalid={!!errors.buyerCompany}
                    aria-describedby={errors.buyerCompany ? "buyerCompany-error" : undefined}
                    {...form.register("buyerCompany", {
                      onChange: () => form.clearErrors("buyerCompany"),
                    })}
                  />
                  <FieldError id="buyerCompany-error" message={errors.buyerCompany?.message} />
                </div>
                <div>
                  <Label htmlFor="buyerEmail" className="text-sm font-semibold text-foreground/90">
                    Email{" "}
                    <span className="font-normal text-foreground/50">(optional, recommended)</span>
                  </Label>
                  <Input
                    id="buyerEmail"
                    type="email"
                    className="mt-2 h-11 rounded-xl border-white/15 bg-white/5"
                    aria-invalid={!!errors.buyerEmail}
                    aria-describedby={errors.buyerEmail ? "buyerEmail-error" : undefined}
                    {...form.register("buyerEmail", {
                      onChange: () => form.clearErrors("buyerEmail"),
                    })}
                  />
                  <FieldError id="buyerEmail-error" message={errors.buyerEmail?.message} />
                </div>
              </>
            )}
          </div>

          <div className="mt-6">
            <QuotePillGroup
              label="Preferred contact"
              options={PREFERRED_CONTACT_OPTIONS}
              value={
                isSeller
                  ? form.watch("sellerPreferredContact")
                  : form.watch("buyerPreferredContact")
              }
              onChange={(v) => {
                const field = isSeller ? "sellerPreferredContact" : "buyerPreferredContact";
                form.setValue(field, v as QuoteFormValues["sellerPreferredContact"], {
                  shouldValidate: true,
                  shouldDirty: true,
                });
                form.clearErrors(field);
              }}
              error={
                isSeller
                  ? errors.sellerPreferredContact?.message
                  : errors.buyerPreferredContact?.message
              }
            />
          </div>

          <div className="mt-6 pb-2">
            <Label htmlFor="notes" className="text-sm font-semibold text-foreground/90">
              Notes <span className="font-normal text-foreground/50">(optional)</span>
            </Label>
            <Textarea
              id="notes"
              className="mt-2 min-h-20 rounded-xl border-white/15 bg-white/5"
              {...form.register(isSeller ? "sellerNotes" : "buyerNotes")}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
