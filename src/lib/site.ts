import { buildWhatsAppUrl } from "@/components/site/quote/quote-summary";

/**
 * The one canonical company WhatsApp number — every public/company WhatsApp
 * destination (Hero, ContactFooter, the post-submission quote confirmation)
 * reads from this single source, never a second hardcoded copy. Owner
 * Dashboard lead-contact WhatsApp links are unrelated and unaffected: those
 * always target the customer's own submitted phone number, never this one.
 */
export const COMPANY_WHATSAPP_NUMBER = "971508491233";
/** Display-only formatted form of COMPANY_WHATSAPP_NUMBER. */
export const COMPANY_WHATSAPP_DISPLAY = "+971 50 849 1233";

const GENERAL_WHATSAPP_MESSAGE =
  "Hello MSM Scrap, I’d like to enquire about buying or selling scrap metal.";

/** General-purpose company WhatsApp link with a prefilled enquiry message — used by every non-quote-specific "Chat on WhatsApp" control. */
export const WHATSAPP_URL = buildWhatsAppUrl(COMPANY_WHATSAPP_NUMBER, GENERAL_WHATSAPP_MESSAGE);

export const PHONE_PRIMARY = "+971 55 841 4459";
export const PHONE_SECONDARY = "+971 50 987 6543";
export const EMAIL = "ms.scrap80@gmail.com";
export const ADDRESS = "Industrial Area 10, Sharjah, UAE";

export const NAV_LINKS = [
  { label: "Home", href: "#home" },
  { label: "Services", href: "#services" },
  { label: "About", href: "#about" },
  { label: "Contact", href: "#contact" },
];
