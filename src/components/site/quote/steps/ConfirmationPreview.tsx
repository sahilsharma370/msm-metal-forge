import { CircleAlert, MessageCircle } from "lucide-react";
import type { QuoteFormValues } from "../quote-schema";
import { QUOTE_WHATSAPP_NUMBER_PROVISIONAL } from "../quote-options";
import { buildSmartBrief, buildWhatsAppMessage, buildWhatsAppUrl } from "../quote-summary";

interface ConfirmationPreviewProps {
  values: QuoteFormValues;
  reference: string;
  onReturnToWebsite: () => void;
}

/** Dev-only "what the confirmation screen will look like" preview. No request is ever sent. */
export function ConfirmationPreview({
  values,
  reference,
  onReturnToWebsite,
}: ConfirmationPreviewProps) {
  const whatsappUrl = buildWhatsAppUrl(
    QUOTE_WHATSAPP_NUMBER_PROVISIONAL,
    buildWhatsAppMessage(values),
  );

  return (
    <div>
      <div className="flex items-center gap-2 rounded-full border border-copper/30 bg-[oklch(0.583_0.135_45.5/0.08)] px-4 py-2">
        <CircleAlert aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-copper-bright" />
        <p className="text-[0.7rem] font-semibold text-foreground/85">
          Prototype preview — no request was sent.
        </p>
      </div>

      <p className="label-eyebrow mt-8 text-copper-bright">Request Preview</p>
      <h2 className="font-display mt-3 text-2xl font-bold text-foreground sm:text-3xl">
        Your request is ready
      </h2>
      <p className="font-display mt-4 rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-4 text-sm font-semibold text-foreground/90">
        {buildSmartBrief(values)}
      </p>

      <div className="mt-6 flex items-center justify-between rounded-2xl border border-white/10 px-5 py-4">
        <span className="text-sm text-foreground/60">Preview reference</span>
        <span className="font-display text-sm font-bold tracking-[0.06em] text-copper-bright">
          {reference}
        </span>
      </div>

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
