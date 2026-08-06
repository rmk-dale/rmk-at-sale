# Ecommerce redesign: MongoDB-backed inventory, admin, and order tracking

## Requirements

This revises the earlier version of this plan on two points, both driven by new asks, plus a course-correction on one of them. First, this adds an admin side: a place to see current inventory, add new items, associate a product with a photo, and see the orders that have come through checkout — which also means orders need to become a real record in Mongo instead of just a one-off email, since today nothing is persisted anywhere once `sendReceiptEmail` fires. Second, photos: the previous revision moved them to Google Drive links to let admin manage photos without a deploy, but flagged that as carrying real reliability risk (unofficial hotlinking endpoints, silent breakage). This revision replaces that with what you actually described — photos stay exactly where they are today, checked into `public/items/` in the codebase, and the admin side gets a picker that lists those existing files as thumbnails so admin can *choose* which photo goes with which product, rather than typing a path or a Drive link by hand. That removes the Drive risk entirely.

Everything from the previous version still holds: `name`/`description`, `price`, and `stock` live in MongoDB Atlas keyed by Item Code, and checkout still runs as a transaction that rejects the whole order if any line item is short on stock. What's new is layered on top of that, not a replacement of it.

One more revision: admin auth upgrades from the flat email allowlist to real credentialed accounts — username, email, password, and mandatory two-factor authentication, plus an admin-management screen where an existing admin can add another one. This is a genuinely bigger piece of infrastructure than the allowlist was, and it's worth being upfront about that rather than treating it as a small addition — passwords need hashing and reset flows, 2FA needs enrollment and recovery, and "add another admin" needs a role that controls who's allowed to do that. All of it is scoped below. It also fully replaces the `ADMIN_EMAILS` allowlist idea from the previous revision; that approach is dropped, not layered under this one.

## High-level design

```
Customer-facing (unchanged shape)
Browser --GET /api/products--> products collection (Atlas)
Browser --POST /api/checkout--> transaction: decrement stock + insert order doc --> receipt email

Admin auth (new, separate from customer OTP login entirely)
Browser --POST /api/admin/auth/login {username/email, password}--> password checked
        --POST /api/admin/auth/verify-2fa {challengeToken, code}--> TOTP checked --> admin_session cookie issued
Browser --/admin (admin_session-gated)--> app/admin/* pages
        |
        |-- GET /api/admin/photos          --> list image files already in public/items/
        |-- GET/POST /api/admin/products    --> read full inventory, add a new item
        |-- PATCH /api/admin/products/:id  --> edit price/stock, or repoint image/hoverImage
        |                                       at a different file from the picker
        |-- GET /api/admin/orders          --> list orders, most recent first
        |-- PATCH /api/admin/orders/:id    --> mark an order fulfilled/cancelled
        |-- GET/POST /api/admin/admins     --> (owner role only) list admins, invite a new one
        |-- PATCH /api/admin/admins/:id    --> (owner role only) change role, disable an admin

Images (unchanged from the original plan, now admin-driven instead of migration-driven)
Mongo doc.image / doc.hoverImage = a path string into public/items/, exactly as today
Admin picks the file from a thumbnail grid instead of a path being typed or assumed by convention
```

## Deep dive: data model

```ts
// products collection
interface ProductDoc {
  _id: string;              // "AT88G01001" — Item Code
  description: string;      // "AIRCONIC SPINNER 55/20 TSA SPORTY BLUE"
  price: number;
  stock: number;
  image: string;             // path into public/items/, e.g. "/items/item1front.jpg"
  hoverImage?: string;
  createdAt: Date;
  updatedAt: Date;
}

// orders collection — new
interface OrderDoc {
  _id: ObjectId;
  buyerEmail: string;
  items: { itemCode: string; description: string; quantity: number; price: number }[];
  total: number;
  status: 'received' | 'fulfilled' | 'cancelled';
  createdAt: Date;
  updatedAt: Date;
}

// admins collection — new, entirely separate from customers (customers never get a password)
interface AdminDoc {
  _id: ObjectId;
  username: string;            // unique, used to log in
  email: string;                // unique, used for invites, resets, and notifications
  passwordHash: string;         // bcrypt/argon2, never the raw password
  role: 'owner' | 'staff';      // owner can manage other admins; staff cannot
  status: 'invited' | 'active' | 'disabled';
  twoFactorSecret?: string;     // TOTP secret, encrypted at rest; set once during enrollment
  twoFactorEnabled: boolean;
  backupCodes?: string[];       // hashed one-time recovery codes, generated at 2FA enrollment
  failedLoginAttempts: number;
  lockedUntil?: Date;
  invitedBy?: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
```

Every completed checkout writes one `OrderDoc` inside the same transaction that decrements stock, so an order and its stock impact are always consistent with each other — there's never a state where stock was taken but no order record exists, or vice versa. `status` starts at `'received'` and admin flips it to `'fulfilled'` once the item ships, or `'cancelled'` if it needs to be reversed (a cancellation should re-increment stock — call that out explicitly as part of the admin order-update handler, not something that happens automatically).

## Deep dive: photos — admin picker over files already in the repo

The Mongo document goes back to holding a plain path string, exactly like the very first version of this plan (`"/items/item1front.jpg"`), served by Next's own static file pipeline with no external dependency and no reliability risk — this removes the Drive hotlinking concern from the previous revision entirely, since nothing about how images are served changes at all.

What's new is only how that path string gets set. `GET /api/admin/photos` reads the `public/items/` directory on the server (`fs.readdirSync`) and returns the list of filenames currently sitting there. The admin "add item" / "edit item" form renders each of those as a thumbnail grid (`next/image` pointed at `/items/<filename>`, the same as the storefront already does), and clicking one sets that product's `image` (or `hoverImage`) field to the corresponding path — no typing a filename, no knowing the naming convention, no risk of a typo silently producing a broken image.

One constraint carries over from the very first version of this plan and is worth restating plainly now that admin is in the picture: this picker lets admin *choose among photos that are already deployed*, it does not let admin *add a brand-new photo file* to the running app. Getting a new image's bytes into `public/items/` still means committing that file to the repo and deploying, same as it does today — the picker changes the "which existing photo goes with which product" step, not the "how do new photo bytes enter the system" step. If you want admin to be able to upload a genuinely new photo (not just reassign existing ones) without a developer involved, that's a separate, larger piece of work: an upload endpoint needs somewhere durable to write to, and if this ever deploys to a serverless platform (Vercel and similar), the filesystem at runtime is read-only outside of a temp directory — a file an API route writes to `public/items/` at runtime would not persist past that request and would vanish entirely on the next deploy, since the deployed filesystem is rebuilt from the repo every time. Supporting real uploads would mean writing to actual object storage (S3, Vercel Blob, Cloudinary) instead, which is exactly the "photos leave the codebase" trade this revision just moved away from — worth flagging now so it's a deliberate choice later rather than a surprise if "let's also let admin upload a new photo" comes up next.

## Deep dive: admin authentication

This is deliberately a separate system from the customer OTP login (`lib/crypto.ts`, `app/api/auth/*`), not an extension of it — customers should never end up with a password, and admins should never be logged in by an email code alone. Admin auth gets its own cookie (`admin_session`, distinct from the customer `session` cookie), its own collection, and its own routes under `/api/admin/auth/*`. The signing mechanism can still reuse the existing `generateHash`/`verifyHash` HMAC helpers — no need for a new signing scheme, just a new payload shape (`{ adminId, role, expires, hash }`) and a shorter expiry than the customer session, since this cookie guards inventory and order data rather than a single checkout.

**Login.** `POST /api/admin/auth/login` takes username/email + password, looks up the `AdminDoc`, and compares the password against `passwordHash` with bcrypt (or argon2 — either is fine, bcrypt is the more common default and neither is currently a project dependency, so this is a new package either way). A correct password does not issue the real session yet — it returns a short-lived challenge token, because 2FA is mandatory, not optional. Track `failedLoginAttempts` and set a `lockedUntil` timestamp after a handful of consecutive failures (five is a reasonable default) so the login route isn't a bare password-guessing surface now that real credentials exist — this is new relative to the OTP flow, where a wrong code just fails harmlessly and there's no password to brute-force.

**Two-factor.** `POST /api/admin/auth/verify-2fa` takes the challenge token plus a 6-digit TOTP code and checks it against `twoFactorSecret` (a standard authenticator-app code — Google Authenticator, Authy, 1Password, etc. all work identically since TOTP is an open standard, no vendor lock-in). Only on a correct code does the real `admin_session` cookie get issued. Enrollment happens once, the first time an invited admin sets up their account: the server generates a secret, renders it as a QR code (an `otpauth://` URI, via a small QR-generation package), the admin scans it and enters the resulting code once to confirm before `twoFactorEnabled` flips to `true` — enrollment isn't complete until that confirmation succeeds, so a botched scan can't leave someone locked out of an account they never actually finished setting up. At the same time, generate a set of one-time backup codes, show them once, and store only their hashes — this is the self-service recovery path if someone loses their authenticator device, so losing a phone doesn't mean losing the account.

**Adding another admin.** Only `role: 'owner'` accounts can hit `POST /api/admin/admins`. That route takes a username + email, creates an `AdminDoc` with `status: 'invited'` and no password yet, and sends an invite email (reusing `lib/email.ts`'s existing nodemailer setup, just a new template) containing a signed, time-limited link. `POST /api/admin/auth/accept-invite` takes that token plus a chosen password, sets `passwordHash`, flips `status` to `'active'`, and immediately routes into the 2FA enrollment flow above — nobody becomes an active admin without 2FA enrolled, there's no path that skips it. `PATCH /api/admin/admins/:id` (also owner-only) changes a role or flips `status` to `'disabled'`; deliberately not a hard delete, so there's still a record of who had access and when, and disabling rather than deleting means an accidental removal doesn't destroy the audit trail. One guardrail worth building in explicitly: block demoting or disabling the last remaining `'owner'` account, since that's how a store ends up with zero people able to manage admins at all.

**Password reset.** `POST /api/admin/auth/forgot-password` emails a signed reset link the same way the invite link works; `POST /api/admin/auth/reset-password` consumes it. Needed as soon as real passwords exist — without it, a forgotten password is a support ticket to whoever has direct database access, which doesn't scale past one person.

## Deep dive: admin inventory and orders

`GET /api/admin/products` returns the full inventory including stock and price (the public `/api/products` route can stay as-is, or this can simply become the one source both admin and storefront read from — either is fine, the important part is both ultimately hit the same collection so there's never a second copy to keep in sync).

`POST /api/admin/products` accepts Item Code, description, price, stock, and the `image`/`hoverImage` path selected from the photo picker, and inserts the document. Item Code doubling as `_id` means Mongo itself rejects a duplicate code with a natural unique-key error, which is exactly the validation you want for free.

`PATCH /api/admin/products/:id` edits price, stock, or which existing photo the item points to — this is also the intended path for manual restocking, replacing any "reseed from the source spreadsheet" workflow.

`GET /api/admin/orders` and `PATCH /api/admin/orders/:id` list orders (most recent first, filterable by status) and update status. This is what turns "an email got sent" into "there's a record we can look back at" — right now, if a receipt email bounces or gets deleted, that sale has no trace anywhere in the system; after this change the order document is the source of truth and the email is just a courtesy notification on top of it.

All of these routes sit behind the same `admin_session` check; `role` further restricts the admin-management routes specifically, while inventory and order routes are open to both `'owner'` and `'staff'` unless you later decide restocking or order changes should also be owner-only.

## Scale and reliability

Unchanged from the previous version for the storefront and checkout path — a shared Atlas tier is plenty, and the checkout transaction's correctness doesn't depend on traffic volume. Admin traffic is low and internal, so it doesn't need caching or its own scaling story. Keeping photos on the filesystem also means this revision has no new external read-path dependency at all — no Drive outage or third-party CDN can degrade the storefront's images, which was the one new risk the Drive version would have introduced.

## Trade-offs

Keeping photos in the codebase means image management still requires a developer to get a brand-new photo's bytes in place (commit + deploy) — that constraint doesn't go away, and it's the same one the very first version of this plan already had. What the admin picker actually buys you is narrower but still real: admin can freely reassign, fix, or set which already-uploaded photo belongs to which product without touching code or opening a PR, which covers most day-to-day catalog work (a wrong photo, a new angle that was already dropped into the repo, restocking an item that already has art). If "someone non-technical needs to add a brand-new product photo without waiting on a developer" turns out to matter in practice, that's the trigger for the upload-to-object-storage path flagged above, not a sign this approach was wrong — it's a genuinely different requirement with a genuinely different (and more complex) solution. Persisting orders adds a small amount of new write volume (one more document per checkout, inside the same transaction) in exchange for making "what did we sell and to whom" answerable at all, which today it isn't — a straightforward win with no real downside at this scale. Moving admin auth from a flat allowlist to full username/password/2FA accounts is a real jump in build effort — a new collection, password hashing, TOTP enrollment, backup codes, invite and reset email flows, lockout handling — and it's worth being honest that this is more than "simple ecommerce" scope typically needs at day one. It's the right call specifically because admin now controls stock, pricing, and order records, and because "add another admin" was an explicit ask, which the allowlist genuinely couldn't do without editing an env var and redeploying. The `role` field (owner vs. staff) is intentionally minimal — two levels, not a full permissions matrix — which covers "who can add more admins" without building out granular per-action permissions nobody's asked for yet.

## What I'd revisit as this grows

Add an upload path to real object storage (S3/Vercel Blob/Cloudinary) once "admin adds a brand-new photo without a developer" becomes an actual requirement rather than a nice-to-have — the picker alone doesn't solve that, by design. Expand the `role` field into a full permissions matrix if the admin team grows past "owner vs. staff" being enough. Add an audit log of admin actions (who changed a price, who disabled which admin) once enough people have access that "who did this" becomes a real question. Consider passkeys/WebAuthn as an alternative to TOTP if authenticator-app friction becomes a recurring complaint. Add pagination and search to the admin inventory/orders views once the catalog or order history grows past what fits on one screen. Move price to integer cents to remove float rounding risk in totals, same open item as before. Add a low-stock alert surfaced right in the admin inventory view, now that there's a natural place to put it.
