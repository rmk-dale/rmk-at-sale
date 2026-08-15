/**
 * Renders every email into `email-preview/` for eyeballing in a browser.
 *
 *   npm run preview:emails
 *
 * Sends nothing. The transport in lib/email.ts is created at import time
 * but never connected, so this runs with no SMTP credentials and cannot
 * mail anybody by accident.
 *
 * The point of it is that it renders the *real* templates. Reviewing an
 * email by reading its template literal does not work — you cannot see a
 * broken table or a colour that lost its contrast — and reviewing a copy
 * pasted into a preview page only proves the copy is fine. This imports
 * the module the app actually sends from, monkey-patching `sendMail` to
 * capture the payload instead of transmitting it.
 *
 * `cid:` references are rewritten to the files in public/ so the images
 * appear. Every other byte is what the recipient gets.
 *
 * The import is relative and carries its `.ts` extension so this runs
 * under `node --experimental-strip-types`. Same convention as
 * scripts/check-gate.ts and scripts/check-bundles.ts.
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "fs";
import path from "path";

process.env.SMTP_HOST ||= "localhost";
process.env.SMTP_USER ||= "orders@example.com";
process.env.SMTP_PASS ||= "not-used";

const nodemailer = (await import("nodemailer")).default;

interface Captured {
  subject: string;
  from: string;
  to: string;
  text: string;
  html: string;
  attachments: { filename: string; cid: string; path: string }[];
}

const captured: Captured[] = [];

// Patched before lib/email.ts is imported, so the transporter it builds at
// module scope is already the fake one.
const realCreateTransport = nodemailer.createTransport;
// @ts-expect-error — deliberately replacing the factory for this process only.
nodemailer.createTransport = (...args: unknown[]) => {
  // @ts-expect-error — args are passed straight through.
  const transport = realCreateTransport.apply(nodemailer, args);
  // Cast rather than build a full `SentMessageInfo`: nothing downstream
  // reads the return value, and fabricating an envelope to satisfy the
  // type would be pretending this preview sent something.
  transport.sendMail = (async (options: Captured) => {
    captured.push(options);
    return { messageId: "preview" };
  }) as unknown as typeof transport.sendMail;
  return transport;
};

const {
  sendOTPEmail,
  sendReceiptEmail,
  sendAdminInviteEmail,
  sendAdminPasswordResetEmail,
} = await import("../lib/email.ts");

// ---------------------------------------------------------------------------

const SITE = "https://rmk-at-sale.vercel.app";

await sendOTPEmail("shopper@rgoc.com.ph", "482915");

await sendReceiptEmail(
  "shopper@rgoc.com.ph",
  5912.5,
  [
    {
      name: "Voyager Duffel 45L",
      brand: "American Tourister",
      quantity: 3,
      price: 1450,
      color: "Sporty Blue",
      size: "55cm",
      bundled: true,
    },
    {
      name: "Trail Pack Mini",
      brand: "American Tourister",
      quantity: 2,
      price: 890,
      color: "Deep Red",
      bundled: false,
    },
  ],
  "RMK-2026-000042",
  {
    subtotal: 6130,
    bundleDiscount: 217.5,
    bundledNames: ["Voyager Duffel 45L"],
  },
);

// The same receipt with nothing qualifying, so the totals block is checked
// in both of its shapes.
await sendReceiptEmail(
  "shopper@rgoc.com.ph",
  1780,
  [
    {
      name: "Trail Pack Mini",
      brand: "American Tourister",
      quantity: 2,
      price: 890,
      color: "Deep Red",
      bundled: false,
    },
  ],
  "RMK-2026-000043",
  { subtotal: 1780, bundleDiscount: 0, bundledNames: [] },
);

await sendAdminInviteEmail(
  "newadmin@rgoc.com.ph",
  `${SITE}/admin/accept-invite?token=a7f3c9e1b2d4`,
  "carlsdaleescalo@gmail.com",
);

await sendAdminPasswordResetEmail(
  "admin@rgoc.com.ph",
  `${SITE}/admin/reset-password?token=9e4b1f7a3c8d`,
);

// ---------------------------------------------------------------------------

const outDir = path.join(process.cwd(), "email-preview");
mkdirSync(outDir, { recursive: true });

const slugs = ["otp", "receipt-with-bundle", "receipt-no-bundle", "admin-invite", "admin-reset"];
let missingAssets = 0;

const escape = (v: string) =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

captured.forEach((mail, i) => {
  let html = mail.html;

  for (const attachment of mail.attachments ?? []) {
    if (!existsSync(attachment.path)) {
      console.error(`  MISSING ASSET  ${attachment.path}`);
      missingAssets++;
      continue;
    }
    const ext = path.extname(attachment.path).toLowerCase();
    const mime = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";
    const data = readFileSync(attachment.path).toString("base64");
    html = html.split(`cid:${attachment.cid}`).join(`data:${mime};base64,${data}`);
  }

  const slug = slugs[i] ?? `email-${i}`;
  writeFileSync(path.join(outDir, `${slug}.html`), html);
  writeFileSync(path.join(outDir, `${slug}.txt`), mail.text);

  const kb = (Buffer.byteLength(mail.html) / 1024).toFixed(0);
  const attachKb = (mail.attachments ?? []).reduce(
    (sum, a) => sum + (existsSync(a.path) ? readFileSync(a.path).length : 0),
    0,
  );
  // Gmail truncates a message and shows "[Message clipped]" past ~102 KB
  // of HTML. Attachments do not count toward that, but they do count
  // toward what the recipient downloads.
  const clipped = Number(kb) > 102;
  console.log(
    `  ${slug.padEnd(20)} html ${kb.padStart(3)} KB${clipped ? "  ⚠ over Gmail's 102 KB clip threshold" : ""}   attachments ${(attachKb / 1024).toFixed(0)} KB   "${mail.subject}"`,
  );
});

const index = `<!doctype html><meta charset="utf-8"><title>Email preview</title>
<body style="font-family:system-ui;background:#fff8f0;color:#1c1512;padding:40px;">
<h1>Email preview</h1>
<p>Rendered from the live templates in <code>lib/email.ts</code>. Regenerate with <code>npm run preview:emails</code>.</p>
<ul style="line-height:2;">
${slugs.map((s) => `<li><a href="./${s}.html">${s}</a> &nbsp; <a href="./${s}.txt" style="font-size:13px;color:#7a6153;">plain text</a></li>`).join("\n")}
</ul>
<p style="color:#7a6153;font-size:13px;">${escape("Images are inlined as data URLs here; in a real send they are cid: attachments.")}</p>
</body>`;
writeFileSync(path.join(outDir, "index.html"), index);

console.log(
  missingAssets === 0
    ? `\n${captured.length} emails written to email-preview/. Open email-preview/index.html.\n`
    : `\n${missingAssets} attachment(s) could not be found — the emails will send with broken images.\n`,
);
process.exit(missingAssets === 0 ? 0 : 1);
