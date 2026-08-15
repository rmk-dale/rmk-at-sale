import nodemailer from "nodemailer";
import path from "path";
// Relative + explicit .ts, matching lib/rateLimit.ts and lib/checkoutGate.ts,
// so this module stays importable from `scripts/` under
// `node --experimental-strip-types` — which does not resolve the `@/` path
// alias. scripts/preview-emails.ts imports this file directly, and neither
// tsc nor eslint catches the break if someone "tidies" this back to `@/`.
import { escapeHtml } from "./validation.ts";

const SMTP_PORT = parseInt(process.env.SMTP_PORT || "587", 10);

/**
 * SMTP transport.
 *
 * Three things here are load-bearing:
 *
 * **requireTLS.** On port 587 the connection opens in the clear and is
 * upgraded with STARTTLS. Without `requireTLS`, nodemailer will carry on
 * and authenticate over the plaintext socket if the server does not offer
 * the upgrade — so a downgrade attack, or a misconfigured relay, leaks the
 * SMTP password. Setting it makes nodemailer abort instead. Ignored when
 * `secure` is true (port 465), where the socket is TLS from the start.
 *
 * **Timeouts.** Nodemailer defaults to a 2-minute connection timeout and a
 * 10-minute socket timeout. This runs on serverless functions that are
 * killed long before either, so the defaults mean a hung SMTP connection
 * burns the whole request budget while the customer waits on a spinner.
 * These are set to fail fast instead.
 *
 * **No connection pool.** Pooling is the usual advice and is wrong here:
 * each Vercel container serves one request and is then frozen or
 * recycled, so there is no long-lived process for a pool to amortise
 * across. It would add complexity and reconnect churn for no gain.
 */
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_PORT === 465,
  requireTLS: SMTP_PORT !== 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  tls: {
    // Default is already true; stated explicitly so nobody "fixes" a
    // certificate error later by turning verification off.
    rejectUnauthorized: true,
    minVersion: "TLSv1.2",
  },
  connectionTimeout: 5_000,
  greetingTimeout: 5_000,
  socketTimeout: 10_000,
});

// ---------------------------------------------------------------------------
// Brand
// ---------------------------------------------------------------------------

const SENDER_NAME = "RMK at Sale";

function fromHeader() {
  return `"${SENDER_NAME}" <${process.env.SMTP_USER}>`;
}

/**
 * Where an email points a reader who wants to get back to the shop, and
 * where they should write if something is wrong.
 *
 * Both fall back rather than throwing: an email that reaches someone with
 * a slightly wrong link is worth far more than one that never sends
 * because an environment variable is missing on a Friday.
 */
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://rmk-at-sale.vercel.app";
const CONTACT_EMAIL = process.env.EMAIL_CONTACT_ADDRESS || process.env.SMTP_USER || "";

/**
 * The storefront palette, copied from `app/globals.css`.
 *
 * Copied, not imported: an email is a standalone HTML document delivered
 * to a client that will not load a stylesheet, so every colour has to be
 * an inline literal. That makes this the one place in the codebase where
 * the palette is duplicated — if a hex changes in globals.css, change it
 * here too, and re-check the contrast pairs noted there. `muted` on
 * `paper` is 5.4:1 and is the only pairing here used for small text.
 */
const PALETTE = {
  paper: "#fff8f0",
  surface: "#ffffff",
  border: "#efe0d2",
  ink: "#1c1512",
  muted: "#7a6153",
  primary: "#c4241a",
  beacon: "#ffc72c",
  /** Reserved for money coming off a total. Not part of the storefront set. */
  positive: "#047857",
} as const;

/**
 * No webfont. Mail clients that support `@font-face` are a minority and
 * the ones that do not fall back unpredictably mid-layout, so this is the
 * system stack every client already has.
 */
const FONT = `font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;`;

// ---------------------------------------------------------------------------
// Inline images
// ---------------------------------------------------------------------------

/**
 * Images are attached and referenced by `cid:`, not linked from the site.
 *
 * The trade, stated so the next person does not have to rediscover it: a
 * CID attachment travels with the message, so it renders in clients that
 * block remote content and it works when the site is down — at the cost
 * of message size and a paperclip icon in some clients. A hosted
 * `<img src="https://…">` is the opposite bargain, and additionally tells
 * the sender when a message was opened, which is a thing to choose
 * deliberately rather than acquire by accident.
 *
 * Whichever is used, **the images must stay decorative**. Outlook and
 * Gmail both hide images until the reader allows them, so anything a
 * recipient actually needs — an order reference, a total, a link — has to
 * survive in the text around them.
 */
function asset(...segments: string[]) {
  return path.join(process.cwd(), "public", ...segments);
}

/**
 * The letterhead mark.
 *
 * NOT `public/rwithtag.png`. That file is 3000×643 and 93 KB because the
 * site uses it at whatever size a layout asks for; this renders at 132px
 * and nothing else ever, so it ships at 264px (2× for retina) and 19 KB.
 * On the receipt, which also carries the banner, that is the difference
 * between 168 KB and 93 KB of attachments on every single order.
 */
const LOGO_ATTACHMENT = {
  filename: "logo.png",
  path: asset("email", "logo.png"),
  cid: "logo",
};

/**
 * The Mega Bundeals campaign artwork, resized for email.
 *
 * NOT `public/home-image.png`. That file is 1893×831 and 2.1 MB — the
 * page can afford it behind Next's image optimiser, an email cannot,
 * because the bytes are attached to every single send. The email copy is
 * 1200×527 at JPEG quality 78, around 74 KB, which is indistinguishable
 * at the 600px width it renders at.
 *
 * Also worth knowing: the artwork states the campaign window (19 Aug –
 * 18 Sep 2026), while the bundle rules in lib/validation.ts are permanent.
 * A receipt is a document people keep, so this banner will outlive its
 * own dates in someone's archive. Regenerate or drop it when the campaign
 * changes — see `withBanner` below for the switch.
 */
const BANNER_ATTACHMENT = {
  filename: "banner.jpg",
  path: asset("email", "banner.jpg"),
  cid: "banner",
};

// ---------------------------------------------------------------------------
// The shell every email is built in
// ---------------------------------------------------------------------------

type FooterKind = "order" | "admin";

interface ShellOptions {
  /**
   * The line the inbox shows next to the subject. Without one, clients
   * take whatever the body starts with — which for a receipt is the
   * alt text of the logo.
   */
  preheader: string;
  /** The campaign banner. Never on a credentials email — see below. */
  withBanner?: boolean;
  footer: FooterKind;
  body: string;
}

/**
 * Wraps a body in the shared letterhead, and returns a complete document.
 *
 * ## Why this is built from tables
 *
 * The old templates were `<div style="max-width:600px;margin:0 auto">`.
 * Outlook on Windows renders through Word, which supports neither
 * `max-width` nor `margin:auto` — so those emails went out full-bleed and
 * left-aligned to a sizeable share of recipients, and nobody would have
 * seen it unless they used Outlook themselves. A fixed-width table with
 * `align="center"` is the shape every client agrees on, and
 * `role="presentation"` keeps it out of the accessibility tree.
 *
 * Every style is inline for the same reason: `<style>` blocks are
 * stripped by Gmail's web client among others.
 */
function renderShell({ preheader, withBanner = false, footer, body }: ShellOptions) {
  const bannerRow = withBanner
    ? `<tr>
      <td style="padding:0;line-height:0;font-size:0;">
        <a href="${escapeHtml(SITE_URL)}" style="text-decoration:none;">
          <img src="cid:banner" width="600" alt="Mega Bundeals — additional 5% off for 3-piece luggage bundles" style="width:100%;max-width:600px;height:auto;display:block;border:0;" />
        </a>
      </td>
    </tr>`
    : "";

  const footerBody =
    footer === "order"
      ? `<p style="margin:0 0 6px;${FONT}font-size:13px;color:${PALETTE.muted};line-height:1.6;">
          Questions about this order? Reply to this email${
            CONTACT_EMAIL
              ? ` or write to <a href="mailto:${escapeHtml(CONTACT_EMAIL)}" style="color:${PALETTE.primary};text-decoration:underline;">${escapeHtml(CONTACT_EMAIL)}</a>`
              : ""
          }.
        </p>`
      : `<p style="margin:0 0 6px;${FONT}font-size:13px;color:${PALETTE.muted};line-height:1.6;">
          This is an administrative message for the ${escapeHtml(SENDER_NAME)} storefront. If it reached you by mistake, reply and tell us.
        </p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>${escapeHtml(SENDER_NAME)}</title>
</head>
<body style="margin:0;padding:0;background:${PALETTE.paper};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PALETTE.paper};margin:0;padding:0;">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center" style="width:600px;max-width:600px;background:${PALETTE.surface};border:1px solid ${PALETTE.border};border-radius:16px;overflow:hidden;">
        <tr>
          <td align="center" style="padding:22px 24px 18px;border-bottom:1px solid ${PALETTE.border};">
            <img src="cid:logo" width="132" alt="${escapeHtml(SENDER_NAME)}" style="width:132px;height:auto;display:block;border:0;" />
          </td>
        </tr>
        ${bannerRow}
        <tr>
          <td style="padding:28px 32px 32px;">${body}</td>
        </tr>
        <tr>
          <td style="padding:20px 32px 26px;border-top:1px solid ${PALETTE.border};background:${PALETTE.paper};">
            ${footerBody}
            <p style="margin:0;${FONT}font-size:12px;color:${PALETTE.muted};">${escapeHtml(SENDER_NAME)} · Employee sale · Manila, Philippines</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

/**
 * A call to action.
 *
 * A table rather than a styled `<a>`, so the whole coloured area is
 * clickable in clients that do not honour `display:inline-block` on a
 * link. `bgcolor` is set on the cell as well as in CSS because Outlook
 * reads the attribute and ignores the property; the border radius is one
 * of the things Outlook will drop, which is why a square button still
 * looks deliberate.
 */
function renderButton(href: string, label: string) {
  const safeHref = escapeHtml(href);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0;">
    <tr>
      <td align="center" bgcolor="${PALETTE.primary}" style="background:${PALETTE.primary};border-radius:10px;">
        <a href="${safeHref}" style="display:inline-block;padding:14px 30px;${FONT}font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">${escapeHtml(label)}</a>
      </td>
    </tr>
  </table>`;
}

/**
 * The link, again, as selectable text.
 *
 * Corporate mail gateways rewrite hrefs, and some clients render a
 * button's link unusably. A copy the reader can select and paste is the
 * fallback that always works, and on a credentials email it is also what
 * lets a cautious person read where they are about to go.
 */
function renderFallbackLink(url: string) {
  return `<p style="margin:18px 0 0;${FONT}font-size:12.5px;color:${PALETTE.muted};line-height:1.6;">
    If the button doesn't work, paste this into your browser:<br />
    <span style="color:${PALETTE.primary};word-break:break-all;">${escapeHtml(url)}</span>
  </p>`;
}

/** A quiet panel — expiry notices, order references. */
function renderPanel(inner: string) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PALETTE.paper};border:1px solid ${PALETTE.border};border-radius:10px;">
    <tr><td style="padding:12px 16px;${FONT}font-size:13px;color:${PALETTE.ink};line-height:1.6;">${inner}</td></tr>
  </table>`;
}

/** A panel that wants to be noticed — security notices. */
function renderAlertPanel(inner: string) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:18px;border-left:3px solid ${PALETTE.primary};background:#fdf3f2;border-radius:0 8px 8px 0;">
    <tr><td style="padding:12px 16px;${FONT}font-size:13px;color:${PALETTE.ink};line-height:1.6;">${inner}</td></tr>
  </table>`;
}

// ---------------------------------------------------------------------------
// Customer: one-time checkout code
// ---------------------------------------------------------------------------

/**
 * Sends the OTP that authorises a checkout.
 *
 * Deliberately still on its own markup rather than `renderShell`: this
 * template was reviewed and kept as-is. It is the one email that has not
 * moved to the shared letterhead, so it is also the one that still looks
 * like a different brand from the rest — see the indigo below against the
 * palette above. Porting it is a small change when someone wants it.
 *
 * @param to - The recipient's email address.
 * @param otp - The one-time password to send.
 */
export async function sendOTPEmail(to: string, otp: string): Promise<void> {
  const mailOptions = {
    from: fromHeader(),
    to,
    subject: "Your Secure Checkout Code",
    text: `Your secure checkout code is: ${otp}\n\nIt will expire in 10 minutes.`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; text-align: center;">
        <img src="cid:logo" alt="RMK at Sale" style="width: 140px; margin-bottom: 24px;" />
        <h2>Secure Checkout Request</h2>
        <p>Your one-time secure checkout code is:</p>
        <h1 style="color: #4f46e5; letter-spacing: 2px;">${otp}</h1>
        <p>This code will expire in 10 minutes.</p>
        <p>If you did not request this, please ignore this email.</p>
      </div>
    `,
    attachments: [LOGO_ATTACHMENT],
  };

  await transporter.sendMail(mailOptions);
}

// ---------------------------------------------------------------------------
// Customer: order receipt
// ---------------------------------------------------------------------------

export interface ReceiptItem {
  name: string;
  brand?: string;
  quantity: number;
  price: number;
  color?: string;
  size?: string;
  /**
   * Whether this line's product earned the 3-piece bundle discount.
   *
   * Passed in rather than inferred from `quantity === 3`, because the
   * rule counts a product across every cart line: three units split over
   * two sizes qualify, and neither line on its own looks like it should.
   * The checkout route already has the grouped result and is the only
   * place that can answer this correctly.
   */
  bundled?: boolean;
}

export interface ReceiptBreakdown {
  subtotal: number;
  bundleDiscount: number;
  /** Display names of the products that earned a bundle discount. */
  bundledNames?: string[];
}

/** "A", "A and B", "A, B and C" — for naming what earned the discount. */
function listNames(names: readonly string[]): string {
  const clean = names.filter(Boolean);
  if (clean.length === 0) return "";
  if (clean.length === 1) return clean[0];
  return `${clean.slice(0, -1).join(", ")} and ${clean[clean.length - 1]}`;
}

function renderReceiptItems(items: readonly ReceiptItem[]): string {
  return items
    .map((item, index) => {
      // Escaped before interpolation: this is a raw HTML string with none
      // of React's automatic escaping, and colour, size and brand all
      // originate in data an admin typed or a shopper selected.
      const details = [item.brand, item.color, item.size]
        .filter(Boolean)
        .map((part) => escapeHtml(String(part)))
        .join(" · ");

      const badge = item.bundled
        ? `<div style="margin-top:6px;"><span style="display:inline-block;background:${PALETTE.beacon};color:${PALETTE.ink};font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;padding:3px 8px;border-radius:999px;">Bundle · 5% off</span></div>`
        : "";

      return `<tr>
      <td style="padding:${index === 0 ? "0" : "14px"} 0 14px;border-bottom:1px solid ${PALETTE.border};">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="${FONT}font-size:15px;color:${PALETTE.ink};font-weight:600;">
              ${item.quantity} × ${escapeHtml(item.name)}
              ${details ? `<div style="font-weight:400;font-size:13px;color:${PALETTE.muted};margin-top:3px;">${details}</div>` : ""}
              <div style="font-weight:400;font-size:13px;color:${PALETTE.muted};margin-top:2px;">₱${item.price.toFixed(2)} each</div>
            </td>
            <td align="right" valign="top" style="${FONT}font-size:15px;color:${PALETTE.ink};font-weight:600;white-space:nowrap;padding-left:16px;">
              ₱${(item.price * item.quantity).toFixed(2)}${badge}
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
    })
    .join("");
}

/**
 * Sends a purchase receipt.
 *
 * @param to - The recipient's email address.
 * @param totalAmount - The final total, after any bundle discount.
 * @param items - The purchased lines, priced at the variant price.
 * @param orderNumber - The order's tracking reference.
 * @param breakdown - Subtotal, bundle discount, and which products earned
 *   it. Omitted, the receipt shows a single total line — which is what an
 *   order with no qualifying bundle should look like.
 */
export async function sendReceiptEmail(
  to: string,
  totalAmount: number,
  items: ReceiptItem[],
  orderNumber: string,
  breakdown?: ReceiptBreakdown,
): Promise<void> {
  const safeOrderNumber = escapeHtml(orderNumber);

  // Only when a bundle actually fired. An order with nothing qualifying
  // would otherwise carry a "Bundle discount ₱0.00" line, which reads as
  // a discount that failed rather than one that was never earned.
  const discountApplied = !!breakdown && breakdown.bundleDiscount > 0;
  const bundledLabel = discountApplied
    ? listNames(breakdown!.bundledNames ?? [])
    : "";

  const totalsRows = discountApplied
    ? `<tr>
        <td style="${FONT}font-size:14px;color:${PALETTE.muted};padding:5px 0;">Subtotal</td>
        <td align="right" style="${FONT}font-size:14px;color:${PALETTE.muted};padding:5px 0;">₱${breakdown!.subtotal.toFixed(2)}</td>
      </tr>
      <tr>
        <td style="${FONT}font-size:14px;color:${PALETTE.positive};padding:5px 0;">Bundle discount${bundledLabel ? ` — 5% off ${escapeHtml(bundledLabel)}` : " (5% per 3-piece bundle)"}</td>
        <td align="right" style="${FONT}font-size:14px;color:${PALETTE.positive};padding:5px 0;white-space:nowrap;">−₱${breakdown!.bundleDiscount.toFixed(2)}</td>
      </tr>`
    : "";

  const body = `
      <h1 style="margin:0 0 6px;${FONT}font-size:23px;color:${PALETTE.ink};font-weight:700;letter-spacing:-0.01em;">Thank you for your order</h1>
      <p style="margin:0 0 22px;${FONT}font-size:15px;color:${PALETTE.muted};line-height:1.6;">We've reserved your items. A member of the team will contact you within one working day to confirm payment and pickup.</p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PALETTE.paper};border:1px solid ${PALETTE.border};border-radius:12px;margin-bottom:26px;">
        <tr>
          <td style="padding:14px 18px;">
            <div style="${FONT}font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:${PALETTE.muted};font-weight:700;">Order reference</div>
            <div style="font-family:ui-monospace,'SFMono-Regular',Menlo,Consolas,monospace;font-size:19px;color:${PALETTE.ink};font-weight:700;margin-top:3px;">${safeOrderNumber}</div>
            <div style="${FONT}font-size:12.5px;color:${PALETTE.muted};margin-top:4px;">Quote this if you contact us about your order.</div>
          </td>
        </tr>
      </table>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${renderReceiptItems(items)}</table>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:18px;">
        ${totalsRows}
        <tr>
          <td style="${FONT}font-size:19px;color:${PALETTE.ink};font-weight:700;padding:12px 0 0;border-top:2px solid ${PALETTE.border};">Total</td>
          <td align="right" style="${FONT}font-size:19px;color:${PALETTE.ink};font-weight:700;padding:12px 0 0;border-top:2px solid ${PALETTE.border};">₱${totalAmount.toFixed(2)}</td>
        </tr>
      </table>`;

  // The plain-text alternative used to carry only the totals. A receipt
  // whose text version cannot tell you what you bought is not a receipt,
  // and it is what a screen reader or a text-only client gets.
  const textLines = items.map((item) => {
    const details = [item.brand, item.color, item.size].filter(Boolean).join(" / ");
    return `  ${item.quantity} x ${item.name}${details ? ` (${details})` : ""} — ₱${(item.price * item.quantity).toFixed(2)} (₱${item.price.toFixed(2)} each)${item.bundled ? " [3-piece bundle, 5% off]" : ""}`;
  });

  const textTotals = discountApplied
    ? [
        `Subtotal: ₱${breakdown!.subtotal.toFixed(2)}`,
        `Bundle discount${bundledLabel ? ` (5% off ${bundledLabel})` : ""}: -₱${breakdown!.bundleDiscount.toFixed(2)}`,
        `Total: ₱${totalAmount.toFixed(2)}`,
      ]
    : [`Total: ₱${totalAmount.toFixed(2)}`];

  const text = [
    "Thank you for your order!",
    "",
    `Order reference: ${orderNumber}`,
    "",
    "Your items:",
    ...textLines,
    "",
    ...textTotals,
    "",
    "A member of the team will contact you within one working day to confirm payment and pickup.",
    "Quote your order reference if you contact us about this order.",
  ].join("\n");

  const mailOptions = {
    from: fromHeader(),
    to,
    subject: `Your ${SENDER_NAME} receipt — ${orderNumber}`,
    text,
    html: renderShell({
      preheader: `Order ${orderNumber} confirmed — ₱${totalAmount.toFixed(2)}. We'll be in touch within one working day.`,
      withBanner: true,
      footer: "order",
      body,
    }),
    attachments: [LOGO_ATTACHMENT, BANNER_ATTACHMENT],
  };

  await transporter.sendMail(mailOptions);
}

// ---------------------------------------------------------------------------
// Admin: invite and password reset
// ---------------------------------------------------------------------------

/*
 * Neither of these carries the campaign banner, and that is a decision
 * rather than an omission: a promotional strip on a message that hands
 * out credentials is exactly the shape of a phishing email, and training
 * admins to expect marketing on a security notice is training them to
 * click one. They get the letterhead and nothing else.
 */

/**
 * Invites someone to become an admin. The link carries a one-time token
 * (not a password) that lets them set their own password and enroll 2FA.
 */
export async function sendAdminInviteEmail(
  to: string,
  inviteUrl: string,
  invitedByEmail: string,
): Promise<void> {
  const safeInviter = escapeHtml(invitedByEmail);

  const body = `
      <h1 style="margin:0 0 6px;${FONT}font-size:23px;color:${PALETTE.ink};font-weight:700;">You've been invited as an admin</h1>
      <p style="margin:0 0 4px;${FONT}font-size:15px;color:${PALETTE.ink};line-height:1.65;"><strong>${safeInviter}</strong> invited you to help manage the ${escapeHtml(SENDER_NAME)} storefront — products, inventory and orders.</p>
      <p style="margin:0 0 2px;${FONT}font-size:15px;color:${PALETTE.muted};line-height:1.65;">Setting up takes a minute: you'll choose a password and enable two-factor authentication.</p>
      ${renderButton(inviteUrl, "Set up your account")}
      ${renderPanel(`<strong>This link expires in 24 hours</strong> and can be used once.`)}
      ${renderFallbackLink(inviteUrl)}
      <p style="margin:14px 0 0;${FONT}font-size:12.5px;color:${PALETTE.muted};line-height:1.6;">
        Weren't expecting this? Tell ${safeInviter} before you do anything else — an unexpected admin invite is worth a reply.
      </p>`;

  const mailOptions = {
    from: fromHeader(),
    to,
    subject: `You've been invited to ${SENDER_NAME} admin`,
    text: [
      `${invitedByEmail} invited you to help manage the ${SENDER_NAME} storefront.`,
      "",
      `Set up your account: ${inviteUrl}`,
      "",
      "This link expires in 24 hours and can be used once.",
      "",
      `Weren't expecting this? Tell ${invitedByEmail} before you do anything else.`,
    ].join("\n"),
    html: renderShell({
      preheader: `Set up your ${SENDER_NAME} admin account — the link expires in 24 hours.`,
      footer: "admin",
      body,
    }),
    attachments: [LOGO_ATTACHMENT],
  };

  await transporter.sendMail(mailOptions);
}

/**
 * Sends an admin password-reset link. Same one-time-token pattern as the invite.
 */
export async function sendAdminPasswordResetEmail(
  to: string,
  resetUrl: string,
): Promise<void> {
  const safeAccount = escapeHtml(to);

  const body = `
      <h1 style="margin:0 0 6px;${FONT}font-size:23px;color:${PALETTE.ink};font-weight:700;">Reset your admin password</h1>
      <p style="margin:0 0 2px;${FONT}font-size:15px;color:${PALETTE.muted};line-height:1.65;">
        A password reset was requested for the admin account <strong style="color:${PALETTE.ink};">${safeAccount}</strong>.
      </p>
      ${renderButton(resetUrl, "Choose a new password")}
      ${renderPanel(`<strong>This link expires in 1 hour</strong> and can be used once. Your current password stays active until you set a new one.`)}
      ${renderFallbackLink(resetUrl)}
      ${renderAlertPanel(
        `<strong>Didn't request this?</strong> Don't ignore it. Someone tried to reset an account with access to orders and inventory — tell the other admins now, and leave this link unused so it expires.`,
      )}`;

  const mailOptions = {
    from: fromHeader(),
    to,
    subject: `Reset your ${SENDER_NAME} admin password`,
    text: [
      `A password reset was requested for the admin account ${to}.`,
      "",
      `Choose a new password: ${resetUrl}`,
      "",
      "This link expires in 1 hour and can be used once. Your current password stays active until you set a new one.",
      "",
      "Didn't request this? Don't ignore it — tell the other admins, and leave this link unused so it expires.",
    ].join("\n"),
    html: renderShell({
      preheader: `Reset your ${SENDER_NAME} admin password — the link expires in 1 hour.`,
      footer: "admin",
      body,
    }),
    attachments: [LOGO_ATTACHMENT],
  };

  await transporter.sendMail(mailOptions);
}
