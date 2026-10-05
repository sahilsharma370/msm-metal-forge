import { Check, MessageCircle } from "lucide-react";
import type { QuoteFormValues } from "../quote-schema";
import { COMPANY_WHATSAPP_NUMBER } from "@/lib/site";
import { buildSmartBrief, buildWhatsAppUrl } from "../quote-summary";
import { PREFERRED_CONTACT_LABELS } from "../quote-options";

interface QuoteConfirmationProps {
  values: QuoteFormValues;
  /** The server's own authoritative reference (create_website_quote_v1 / complete_website_quote_v1) — never fabricated, never a client-generated preview id. */
  reference: string;
  onReturnToWebsite: () => void;
}

/**
 * CHECKPOINT C2F-E/F: the genuine post-submission confirmation screen —
 * reachable only from the submission engine's own `success` outcome (see
 * QuoteExperience.tsx). Renamed from the former ConfirmationPreview (a
 * dev-only, no-request-sent mockup gated behind import.meta.env.DEV) now
 * that this reflects a real, completed server-side submission. Shows only
 * the authoritative reference and honest, already-approved copy — no price,
 * availability or response-time promise beyond what the existing Review
 * step already states, and no claim about which files were uploaded.
 */
export function QuoteConfirmation({
  values,
  reference,
  onReturnToWebsite,
}: QuoteConfirmationProps) {
  const whatsappUrl = buildWhatsAppUrl(
    COMPANY_WHATSAPP_NUMBER,
    `Hello MSM Scrap, I’ve submitted an enquiry. My reference is ${reference}.`,
  );

  return (
    <div className="flex flex-col items-center text-center">
      {/* Batch C (confirmation cleanup) — the "Enquiry received" caption
          and the second "Request Confirmed" eyebrow are gone: the header
          progress rail (QuoteProgress, complete=true) already shows
          "Request Confirmed" once, so repeating it here (plus a third
          near-duplicate "received" caption) only added vertical noise for
          the same single fact. The summary card and reference card are
          now one combined receipt panel (divider between the two
          sections) instead of two separate boxes. Gaps below are
          rebalanced for this shorter, calmer stack — still comfortably
          inside the ~499px available height (md:h-[min(74dvh,620px)]
          minus header, no footer on this stage) with room to spare; no
          copy, font size, or modal dimension touched. */}
      <span className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-copper/60 text-copper-bright">
        <Check aria-hidden="true" strokeWidth={2.5} className="h-5 w-5" />
      </span>
      <h2 className="font-display mt-4 text-2xl font-bold text-foreground sm:text-3xl">
        Thanks — your enquiry is in
      </h2>

      <div className="mt-4 w-full max-w-md rounded-2xl border border-white/10 bg-navy-deep/95 px-5 py-4">
        <p className="font-display text-sm font-semibold text-foreground/90">
          {buildSmartBrief(values)}
        </p>
        <div className="my-3 h-px w-full bg-white/10" aria-hidden="true" />
        <p className="text-[0.68rem] font-semibold tracking-[0.1em] text-foreground/50 uppercase">
          Your reference
        </p>
        <p className="font-display mt-1 text-base font-bold tracking-[0.06em] text-copper-bright">
          {reference}
        </p>
      </div>

      <div className="mt-4 max-w-md space-y-1">
        <p className="text-xs leading-relaxed text-foreground/55">
          {/* Batch A (buyer copy fix) — same rationale as ReviewStep's
              identical disclaimer: seller's wording is unchanged, buyer's
              drops "condition" (never collected from a buyer) for an
              accurate equivalent, same hedged tone, no new promise. */}
          {values.intent === "buy"
            ? "Final price or availability is confirmed after MSM reviews the material details, quantity, specification and logistics."
            : "Final price or availability is confirmed after MSM reviews the material details, grade, weight or quantity, condition and logistics."}
        </p>

        {/* Batch B (buyer confirmation clarity) — buyer-only, seller
            unchanged. Explains the actions below: WhatsApp is one
            optional way to reach MSM, not the confirmed contact channel.
            States the submitted preference as a fact, not an operational
            promise of when/how MSM will respond — so "Chat on WhatsApp"
            can't be mistaken for a required next step when Call or Email
            was chosen instead. */}
        {values.intent === "buy" && values.buyerPreferredContact && (
          <p className="text-[0.7rem] font-medium text-foreground/50">
            Preferred contact: {PREFERRED_CONTACT_LABELS[values.buyerPreferredContact]}
          </p>
        )}
      </div>

      <div className="mt-4 flex w-full max-w-md flex-col gap-3 sm:flex-row">
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noreferrer"
          className="font-display inline-flex flex-1 items-center justify-center gap-2 rounded-full border border-[#25D366]/50 px-6 py-3 text-xs font-bold tracking-[0.1em] text-[#25D366] uppercase transition-colors hover:border-[#25D366] hover:bg-[#25D366]/10"
        >
          <MessageCircle aria-hidden="true" className="h-4 w-4" />
          {/* Batch A — buyer-only label change ("Chat on WhatsApp", an
              obviously optional action) so it never reads as a required
              continuation when the buyer's actual preferred contact was
              Call or Email; seller keeps its exact existing label and
              this is still the exact same link/action either way. */}
          {values.intent === "buy" ? "Chat on WhatsApp" : "Continue on WhatsApp"}
        </a>
        <button
          type="button"
          onClick={onReturnToWebsite}
          className="font-display inline-flex flex-1 items-center justify-center gap-2 rounded-full border border-white/15 px-6 py-3 text-xs font-bold tracking-[0.1em] text-foreground/85 uppercase transition-colors hover:border-white/35 hover:text-foreground"
        >
          Return to website
        </button>
      </div>
    </div>
  );
}
