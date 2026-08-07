import nodemailer from "nodemailer";
import path from "path";
import { escapeHtml } from "@/lib/validation";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || "587"),
  secure: process.env.SMTP_PORT === "465", // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
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
 * @param to - The recipient's email address.
 * @param totalAmount - The calculated final total.
 * @param items - The list of purchased items.
 */
export async function sendReceiptEmail(
  to: string,
  totalAmount: number,
  items: Array<{ name: string; quantity: number; price: number; color?: string; size?: string }>,
  orderNumber: string,
): Promise<void> {
  // `name`, `color` and `size` are escaped before interpolation. This
  // template is a raw HTML string, so it gets none of React's automatic
  // escaping, and colour/size originate from the shopper's request body.
  const itemsHtml = items
    .map(
      (item) => {
        const parts = [];
        if (item.color) parts.push(escapeHtml(item.color));
        if (item.size) parts.push(`Size ${escapeHtml(item.size)}`);
        const variantInfo = parts.length > 0 ? ` (${parts.join(", ")})` : "";
        return `<li>${item.quantity}x ${escapeHtml(item.name)}${variantInfo} - ₱${(item.price * item.quantity).toFixed(2)}</li>`;
      }
    )
    .join("");

  const safeOrderNumber = escapeHtml(orderNumber);

  const mailOptions = {
    from: `"rmk-at-sale" <${process.env.SMTP_USER}>`,
    to,
    subject: `Your rmk-at-sale receipt — ${orderNumber}`,
    text: `Thank you for your purchase!\n\nOrder reference: ${orderNumber}\nTotal: ₱${totalAmount.toFixed(2)}\n\nQuote your order reference if you contact us about this order.`,
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
        <ul style="background: #f4f4f5; padding: 20px; border-radius: 8px;">${itemsHtml}</ul>
        <h3>Total: ₱${totalAmount.toFixed(2)}</h3>
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
        <p><strong>${invitedByEmail}</strong> invited you to help manage rmk-at-sale.</p>
        <p><a href="${inviteUrl}" style="color: #4f46e5;">Set up your account</a> to choose a password and enable two-factor authentication.</p>
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
        <p><a href="${resetUrl}" style="color: #4f46e5;">Choose a new password</a></p>
        <p style="color: #71717a; font-size: 14px;">This link expires in 1 hour. If you didn't request this, you can ignore it.</p>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
}
