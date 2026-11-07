/**
 * CHECKPOINT (approved email designs) — shared, pure, table-safe HTML
 * building blocks for both transactional email templates
 * (owner-notification-email.ts / customer-receipt-email.ts). No I/O, no
 * Supabase, no provider — every export here is a plain function from
 * already-validated strings to an HTML/text fragment, matching this
 * module family's own "pure, deps-free" convention.
 *
 * Email-client-safe by construction: table-based layout only (no flexbox/
 * grid, no external stylesheet — every rule is inlined), no SVG (Outlook
 * desktop has zero SVG support), a single raster PNG logo with explicit
 * width/height attributes and alt text (so a client that blocks remote
 * images — the common default — still shows a readable fallback instead
 * of a broken-image icon or a collapsed layout).
 */

/** The exact two-color brand system both approved designs use — never a third accent color, never a CSS variable (email clients do not support `var()`). */
export const EMAIL_NAVY = "#080A1D";
export const EMAIL_COPPER = "#BA5D2D";
export const EMAIL_GRAY_LABEL = "#6B7280";
export const EMAIL_GRAY_HAIRLINE = "#E5E7EB";
export const EMAIL_GRAY_FOOTER = "#9CA3AF";
export const EMAIL_OUTER_BG = "#F0F1F3";
export const EMAIL_CARD_BG = "#FFFFFF";

/** Standard email body width — both approved designs use a single-column card at this width. */
export const EMAIL_WIDTH_PX = 600;

/** Standard HTML entity escaping — the only thing standing between a customer-controlled string and the html body. Shared by both templates so there is exactly one escaping implementation, never two that could drift. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Strips CR/LF so a customer-controlled value can never inject a second email header — applied to every value that ends up in subject/from/to/reply-to anywhere in this pipeline. */
export function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

/** Renders a block of free-text as escaped, paragraph-broken HTML — the only place customer newlines become markup, and only ever inside the body, never a header. */
export function escapeMultilineHtml(value: string): string {
  return escapeHtml(value)
    .split(/\r?\n/)
    .map((line) => line || "&nbsp;")
    .join("<br>");
}

export function humanizeCode(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Deliberately compact, lowercase display form ("50 kg", never "50 Kg") —
 * matches the approved designs and this schema's own QUOTE_UNITS/
 * UNIT_LABELS convention (src/components/site/quote/quote-options.ts)
 * without importing that client-only module from this deps-free email
 * path. humanizeCode's title-casing is correct for snake_case codes like
 * "clean_separated" but wrong for a unit abbreviation — shared here so
 * both templates' quantity formatting agree, rather than each keeping its
 * own copy.
 */
const EMAIL_UNIT_LABELS: Record<string, string> = {
  kg: "kg",
  tonnes: "tonnes",
  pieces: "pieces",
  load: "load",
  other: "other",
};

export function unitLabel(unit: string): string {
  return EMAIL_UNIT_LABELS[unit] ?? humanizeCode(unit);
}

/**
 * The real repository logo asset (src/assets/msm-logo.svg), recolored
 * navy-on-white and rasterized to a compact transparent PNG (see
 * public/email-logo-msm.png — generated from a navy/white-swapped copy of
 * that exact SVG's own paths via sharp: every path's geometry is
 * byte-identical to the source file, only the two fill colors are
 * swapped — the same "ink" vs "background-matching cutout" structure the
 * original white-on-navy mark already uses, just inverted for a white
 * email card instead of the site's navy surfaces. Never a crop of either
 * approved mockup, never a redrawn mark.
 */
export const EMAIL_LOGO_URL = "https://msmscrap.com/email-logo-msm.png";
export const EMAIL_LOGO_DISPLAY_WIDTH = 260;
export const EMAIL_LOGO_DISPLAY_HEIGHT = 93;
export const EMAIL_LOGO_ALT = "MSM Scrap";

/**
 * The logo header row — the navy logo on the card's own white background,
 * matching both approved designs. `eyebrowHtml`, when supplied (the owner
 * design's right-aligned "ENQUIRY / {date}" eyebrow), renders in the same
 * row as the logo via a two-column table; omitted entirely for the
 * customer design, whose eyebrow is its own row further down. If the
 * recipient's client blocks remote images, the `alt` text "MSM Scrap"
 * renders in the logo's place, so the header never collapses to an empty
 * or broken-image box.
 */
export function logoHeaderHtml(eyebrowHtml?: string): string {
  // height:auto is load-bearing, not decorative: the HTML height="93"
  // attribute otherwise wins over a shrunken rendered width (from
  // max-width:100%, e.g. when the sibling nowrap eyebrow cell claims
  // space at a narrow viewport), vertically squashing the logo. With
  // height:auto the browser derives height from the (possibly shrunken)
  // rendered width instead, preserving the original PNG's aspect ratio at
  // any width — the image never renders wider or taller than its own
  // intrinsic 520x185 asset, only smaller, proportionally.
  const logoImg = `<img src="${EMAIL_LOGO_URL}" width="${EMAIL_LOGO_DISPLAY_WIDTH}" height="${EMAIL_LOGO_DISPLAY_HEIGHT}" alt="${EMAIL_LOGO_ALT}" style="display:block;border:0;outline:none;text-decoration:none;max-width:100%;height:auto;" />`;
  const inner = eyebrowHtml
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
      `<td align="left" valign="middle" style="width:${EMAIL_LOGO_DISPLAY_WIDTH}px;">${logoImg}</td>` +
      `<td align="right" valign="middle">${eyebrowHtml}</td>` +
      `</tr></table>`
    : logoImg;
  return `<tr><td style="padding:32px 32px 0;" align="left">${inner}</td></tr>`;
}

/** One label/value row inside a hairline-separated table, matching the owner design's sentence-case label style. `last` omits the bottom hairline. */
export function tableRowHtml(label: string, value: string, last = false): string {
  const borderStyle = last ? "" : `border-bottom:1px solid ${EMAIL_GRAY_HAIRLINE};`;
  return (
    `<tr>` +
    `<td style="padding:10px 0;${borderStyle}color:${EMAIL_GRAY_LABEL};font-size:13px;vertical-align:top;width:42%;">${escapeHtml(label)}</td>` +
    `<td style="padding:10px 0;${borderStyle}color:${EMAIL_NAVY};font-size:14px;font-weight:700;vertical-align:top;">${value}</td>` +
    `</tr>`
  );
}

/** Same row shape, but with the customer design's uppercase letter-spaced label style ("REQUEST", "MATERIAL") instead of the owner design's sentence case. */
export function tableRowHtmlUppercaseLabel(label: string, value: string, last = false): string {
  const borderStyle = last ? "" : `border-bottom:1px solid ${EMAIL_GRAY_HAIRLINE};`;
  return (
    `<tr>` +
    `<td style="padding:12px 0;${borderStyle}color:${EMAIL_GRAY_LABEL};font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;vertical-align:top;width:46%;">${escapeHtml(label)}</td>` +
    `<td style="padding:12px 0;${borderStyle}color:${EMAIL_NAVY};font-size:15px;font-weight:700;vertical-align:top;">${value}</td>` +
    `</tr>`
  );
}

/** The reference-number block: a copper left-border accent, an eyebrow label, and the bold reference value — identical treatment in both approved designs. */
export function referenceBlockHtml(reference: string): string {
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td style="border-left:3px solid ${EMAIL_COPPER};padding:4px 0 4px 14px;">` +
    `<div style="color:${EMAIL_GRAY_LABEL};font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">REFERENCE</div>` +
    `<div style="color:${EMAIL_NAVY};font-size:20px;font-weight:800;margin-top:2px;">${escapeHtml(reference)}</div>` +
    `</td></tr></table>`
  );
}

/** A section heading ("MATERIAL & LOGISTICS" / "CUSTOMER CONTACT") — bold, uppercase, navy, matching the owner design. */
export function sectionHeadingHtml(label: string): string {
  return `<div style="color:${EMAIL_NAVY};font-size:12px;font-weight:800;letter-spacing:0.05em;text-transform:uppercase;margin:24px 0 8px;">${escapeHtml(label)}</div>`;
}

/**
 * Shared outer document chrome: the full HTML wrapper, outer background
 * table, and the single inner 600px white card table both templates
 * render their own content inside. `bodyRowsHtml` is everything between
 * the logo header and the footer, already-composed `<tr>` markup.
 */
export function emailDocumentHtml(title: string, bodyRowsHtml: string, footerHtml: string, headerHtml: string = logoHeaderHtml()): string {
  return (
    `<!doctype html><html lang="en"><head><meta charSet="utf-8"/>` +
    `<meta name="viewport" content="width=device-width, initial-scale=1"/>` +
    `<title>${escapeHtml(title)}</title></head>` +
    `<body style="margin:0;padding:0;background-color:${EMAIL_OUTER_BG};font-family:Helvetica,Arial,sans-serif;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${EMAIL_OUTER_BG};">` +
    `<tr><td align="center" style="padding:32px 16px;">` +
    `<table role="presentation" width="${EMAIL_WIDTH_PX}" cellpadding="0" cellspacing="0" border="0" style="max-width:${EMAIL_WIDTH_PX}px;width:100%;background-color:${EMAIL_CARD_BG};border-radius:12px;overflow:hidden;">` +
    headerHtml +
    `<tr><td style="padding:32px;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${bodyRowsHtml}</table>` +
    `</td></tr>` +
    `<tr><td style="padding:0 32px 28px;">${footerHtml}</td></tr>` +
    `</table>` +
    `</td></tr>` +
    `</table>` +
    `</body></html>`
  );
}

/** The shared footer block: a hairline rule, "MSM Scrap · Sharjah, UAE", and a secondary line stacked beneath it — the owner design's own treatment (second line e.g. "Owner notification"). */
export function footerHtml(secondLineHtml: string): string {
  return (
    `<div style="border-top:1px solid ${EMAIL_GRAY_HAIRLINE};padding-top:16px;">` +
    `<div style="color:${EMAIL_NAVY};font-size:13px;font-weight:700;">MSM Scrap <span style="color:${EMAIL_GRAY_FOOTER};font-weight:400;">&middot; Sharjah, UAE</span></div>` +
    secondLineHtml +
    `</div>`
  );
}

/** The customer design's own footer treatment: "MSM Scrap · Sharjah, UAE" and a right-aligned second element share one line (a two-column table, not a stacked div — the only email-safe way to right-align a sibling against left-aligned text at a fixed width). */
export function footerHtmlInline(rightHtml: string): string {
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${EMAIL_GRAY_HAIRLINE};">` +
    `<tr>` +
    `<td style="padding-top:16px;color:${EMAIL_NAVY};font-size:13px;font-weight:700;" align="left" valign="middle">MSM Scrap <span style="color:${EMAIL_GRAY_FOOTER};font-weight:400;">&middot; Sharjah, UAE</span></td>` +
    `<td style="padding-top:16px;" align="right" valign="middle">${rightHtml}</td>` +
    `</tr></table>`
  );
}
