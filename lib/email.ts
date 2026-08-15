import nodemailer from "nodemailer";
import path from "path";
import { escapeHtml } from "@/lib/validation";

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

/**
 * Sends an email containing the OTP.
 * @param to - The recipient's email address.
 * @param otp - The one-time password to send.
 */
export async function sendOTPEmail(to: string, otp: string): Promise<void> {
  const mailOptions = {
    from: `"rmk-at-sale" <${process.env.SMTP_USER}>`,
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
    attachments: [
      {
        filename: "rwithtag.png",
        path: path.join(process.cwd(), "public", "rwithtag.png"),
        cid: "logo",
      },
    ],
  };

  await transporter.sendMail(mailOptions);
}

/**
 * Sends a purchase receipt.
 *
 * The layout here is deliberately the original one. A redesigned version —
 * a table-based shell in the storefront palette, carrying the campaign
 * banner — was written and then reverted: it read its images through a
 * variadic `path.join(process.cwd(), "public", ...segments)` helper, which
 * Next's file tracer cannot resolve statically, so it pulled the whole
 * 233 MB `public/` tree into every function importing this module and blew
 * the deployment past its function-count limit. If that work is picked up
 * again, the rule to keep is below: **every asset path must be a single
 * fully literal expression**, so the tracer resolves exactly one file.
 *
 * @param to - The recipient's email address.
 * @param totalAmount - The final total, after any bundle discount.
 * @param items - The purchased lines, priced at the variant price.
 * @param orderNumber - The order's tracking reference.
 * @param breakdown - Subtotal and bundle discount. Omitted, the receipt
 *   shows a single total line, which is what an order with no qualifying
 *   3-piece bundle should look like.
 */
export async function sendReceiptEmail(
  to: string,
  totalAmount: number,
  items: Array<{ name: string; brand?: string; quantity: number; price: number; color?: string; size?: string }>,
  orderNumber: string,
  breakdown?: { subtotal: number; bundleDiscount: number },
): Promise<void> {
  // `name`, `color` and `size` are escaped before interpolation. This
  // template is a raw HTML string, so it gets none of React's automatic
  // escaping, and colour/size originate from the shopper's request body.
  const itemsHtml = items
    .map(
      (item) => {
        const parts = [];
        if (item.color) parts.push(`Color: ${escapeHtml(item.color)}`);
        if (item.size) parts.push(`Size: ${escapeHtml(item.size)}`);
        const variantInfo = parts.length > 0 ? `<br/><span style="color:#71717a;font-size:14px;">${parts.join(" | ")}</span>` : "";
        const brandInfo = item.brand ? `<br/><span style="color:#71717a;font-size:14px;">Collection Name: ${escapeHtml(item.brand)}</span>` : "";
        return `<li style="margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid #e4e4e7; list-style: none;">
          <div style="font-weight: 500;">${item.quantity}x ${escapeHtml(item.name)} — ₱${(item.price * item.quantity).toFixed(2)} <span style="color:#71717a;font-size:14px;font-weight:normal;">(₱${item.price.toFixed(2)} ea)</span></div>
          ${brandInfo}${variantInfo}
        </li>`;
      }
    )
    .join("");

  const safeOrderNumber = escapeHtml(orderNumber);

  // Shown only when a bundle actually fired. An order with no qualifying
  // group would otherwise carry a "Bundle discount: ₱0.00" line, which
  // reads as a discount that failed rather than one that was never earned.
  const discountApplied = !!breakdown && breakdown.bundleDiscount > 0;

  const totalsHtml = discountApplied
    ? `<table style="width:100%;margin-top:16px;border-collapse:collapse;">
        <tr>
          <td style="padding:4px 0;color:#52525b;">Subtotal</td>
          <td style="padding:4px 0;text-align:right;color:#52525b;">₱${breakdown!.subtotal.toFixed(2)}</td>
        </tr>
        <tr>
          <td style="padding:4px 0;color:#047857;">Bundle discount (5% per 3-piece bundle)</td>
          <td style="padding:4px 0;text-align:right;color:#047857;">−₱${breakdown!.bundleDiscount.toFixed(2)}</td>
        </tr>
        <tr>
          <td style="padding:10px 0 0;border-top:1px solid #e4e4e7;font-size:18px;font-weight:600;">Total</td>
          <td style="padding:10px 0 0;border-top:1px solid #e4e4e7;text-align:right;font-size:18px;font-weight:600;">₱${totalAmount.toFixed(2)}</td>
        </tr>
      </table>`
    : `<h3>Total: ₱${totalAmount.toFixed(2)}</h3>`;

  const totalsText = discountApplied
    ? `Subtotal: ₱${breakdown!.subtotal.toFixed(2)}\nBundle discount: -₱${breakdown!.bundleDiscount.toFixed(2)}\nTotal: ₱${totalAmount.toFixed(2)}`
    : `Total: ₱${totalAmount.toFixed(2)}`;

  const mailOptions = {
    from: `"rmk-at-sale" <${process.env.SMTP_USER}>`,
    to,
    subject: `Your rmk-at-sale receipt — ${orderNumber}`,
    text: `Thank you for your purchase!\n\nOrder reference: ${orderNumber}\n${totalsText}\n\nQuote your order reference if you contact us about this order.`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="text-align: center; margin-bottom: 24px;">
          <img src="cid:logo" alt="RMK at Sale" style="width: 140px;" />
        </div>
        <h2>Thank You For Your Order!</h2>
        <p style="background:#f4f4f5;padding:12px 16px;border-radius:8px;">
          Order reference: <strong style="font-family:monospace;">${safeOrderNumber}</strong><br />
          <span style="color:#71717a;font-size:14px;">Quote this if you contact us about your order.</span>
        </p>
        <p>Here is your receipt:</p>
        <ul style="background: #f4f4f5; padding: 20px; border-radius: 8px; margin: 0;">${itemsHtml}</ul>
        ${totalsHtml}
        <p style="margin-top: 24px; color: #52525b;">Someone from our team will contact you shortly to finalize and confirm your order.</p>
      </div>
    `,
    attachments: [
      {
        filename: "rwithtag.png",
        path: path.join(process.cwd(), "public", "rwithtag.png"),
        cid: "logo",
      },
    ],
  };

  await transporter.sendMail(mailOptions);
}

/**
 * Invites someone to become an admin. The link carries a one-time token
 * (not a password) that lets them set their own password and enroll 2FA.
 */
export async function sendAdminInviteEmail(
  to: string,
  inviteUrl: string,
  invitedByEmail: string,
): Promise<void> {
  const mailOptions = {
    from: `"rmk-at-sale" <${process.env.SMTP_USER}>`,
    to,
    subject: "You've been invited to rmk-at-sale admin",
    text: `${invitedByEmail} invited you to manage rmk-at-sale. Set up your account: ${inviteUrl}\n\nThis link expires in 24 hours.`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>You've been invited as an admin</h2>
        <p><strong>${escapeHtml(invitedByEmail)}</strong> invited you to help manage rmk-at-sale.</p>
        <p><a href="${escapeHtml(inviteUrl)}" style="color: #4f46e5;">Set up your account</a> to choose a password and enable two-factor authentication.</p>
        <p style="color: #71717a; font-size: 14px;">This link expires in 24 hours. If you weren't expecting this, you can ignore it.</p>
      </div>
    `,
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
  const mailOptions = {
    from: `"rmk-at-sale" <${process.env.SMTP_USER}>`,
    to,
    subject: "Reset your rmk-at-sale admin password",
    text: `Reset your password: ${resetUrl}\n\nThis link expires in 1 hour. If you didn't request this, you can ignore it.`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Reset your admin password</h2>
        <p><a href="${escapeHtml(resetUrl)}" style="color: #4f46e5;">Choose a new password</a></p>
        <p style="color: #71717a; font-size: 14px;">This link expires in 1 hour. If you didn't request this, you can ignore it.</p>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
}
