import { CircleCheck, MessageCircle } from "lucide-react";
import type { QuoteFormValues } from "../quote-schema";
import { QUOTE_WHATSAPP_NUMBER_PROVISIONAL } from "../quote-options";
import { buildSmartBrief, buildWhatsAppMessage, buildWhatsAppUrl } from "../quote-summary";

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
    QUOTE_WHATSAPP_NUMBER_PROVISIONAL,
    buildWhatsAppMessage(values, reference),
  );

  return (
    <div>
      <div className="flex items-center gap-2 rounded-full border border-copper/30 bg-[oklch(0.583_0.135_45.5/0.08)] px-4 py-2">
        <CircleCheck aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-copper-bright" />
        <p className="text-[0.7rem] font-semibold text-foreground/85">Enquiry received</p>
      </div>

      <p className="label-eyebrow mt-8 text-copper-bright">Request Confirmed</p>
      <h2 className="font-display mt-3 text-2xl font-bold text-foreground sm:text-3xl">
        Thanks — your enquiry is in
      </h2>
      <p className="font-display mt-4 rounded-2xl border border-white/10 bg-navy-deep/95 px-5 py-4 text-sm font-semibold text-foreground/90">
        {buildSmartBrief(values)}
      </p>

      <div className="mt-6 flex items-center justify-between rounded-2xl border border-white/10 px-5 py-4">
        <span className="text-sm text-foreground/60">Your reference</span>
        <span className="font-display text-sm font-bold tracking-[0.06em] text-copper-bright">
          {reference}
        </span>
      </div>

      <p className="mt-4 text-xs leading-relaxed text-foreground/55">
        Final price or availability is confirmed after MSM reviews the material details, grade,
        weight or quantity, condition and logistics.
      </p>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noreferrer"
          className="font-display inline-flex flex-1 items-center justify-center gap-2 rounded-full border border-[#25D366]/50 px-6 py-3 text-xs font-bold tracking-[0.1em] text-[#25D366] uppercase transition-colors hover:border-[#25D366] hover:bg-[#25D366]/10"
        >
          <MessageCircle aria-hidden="true" className="h-4 w-4" />
          Continue on WhatsApp
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
