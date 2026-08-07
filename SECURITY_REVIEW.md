# Security Review — rmk-at-sale (checkout + admin)

**Date:** 2026-08-07
**Scope:** `app/api/checkout`, `app/api/auth/*`, `app/api/admin/**`, `lib/adminAuth.ts`, `lib/adminGuard.ts`, `lib/crypto.ts`, `lib/email.ts`, `lib/models/*`
**Method:** Manual source review. No dynamic testing was performed against a running instance.

---

## Summary

The auth design is better than most projects this size: HMAC-signed cookies with timing-safe comparison, bcrypt at cost 12, mandatory TOTP 2FA for admins, hashed single-use backup codes, opaque reset/invite tokens stored only as hashes, `httpOnly` + `SameSite=Strict` on every cookie, and a guard call on **every** admin route handler (verified — no unprotected admin endpoint). Prices are computed server-side from the DB, and stock changes are transactional. Secrets are not in git history.

The problems are concentrated in two places: **untyped request bodies reaching Mongo query filters**, and **a total absence of rate limiting on the code-verification endpoints**. Both are exploitable by an unauthenticated attacker.

---

## Critical Issues

| # | File | Line | Issue | Severity |
|---|------|------|-------|----------|
| 1 | `app/api/checkout/route.ts` | 56–67, 104, 111 | **NoSQL operator injection.** `cartItem.id` is validated with `!cartItem.id` only — never `typeof id === "string"`. `req.json()` returns `any`, so TypeScript does not catch it. A cart item of `{"id": {"$gt": ""}, "quantity": 1}` makes the filter `{_id: {$gt: ""}, stock: {$gte: 1}}`, which matches an arbitrary in-stock product and decrements it. Unauthenticated-adjacent (any logged-in customer). Lets an attacker drain inventory on products they never selected, and place orders for items chosen by the database rather than the user. | 🔴 Critical |
| 2 | `app/api/auth/verify/route.ts` | 23–39 | **Brute-forceable checkout OTP.** No attempt counter, no lockout, and the `otp_challenge` cookie is only deleted on *success* — a failed guess leaves the same `(email, expires, otp)` triple valid for the full 10 minutes. The search space is 900,000 codes (`crypto.randomInt(100000, 1000000)`). At a few hundred parallel requests per second that is a realistic online attack, and success yields a `session` cookie bound to any email the attacker names. | 🔴 Critical |
| 3 | `app/api/admin/auth/verify-2fa/route.ts` | 55–81 | **Unlimited 2FA guesses after a correct password.** `login/route.ts:97–103` resets `failedLoginAttempts` to 0 the moment the password verifies, and `verify-2fa` never increments any counter or deletes the challenge cookie on failure. An attacker holding a leaked/phished admin password gets 5 minutes of unrestricted TOTP guessing, against a 6-digit code with `window: 1` (3 codes valid at any instant). This defeats the primary purpose of the 2FA layer. | 🔴 Critical |
| 4 | `app/api/auth/otp/route.ts` | 6–29 | **Unauthenticated mail relay.** No rate limit, no email format validation, no CAPTCHA. Anyone can POST arbitrary addresses in a loop and have your SMTP account send branded "Your Secure Checkout Code" mail to them. Leads to SMTP credential suspension and domain reputation damage. | 🟠 High |

---

## Suggestions

| # | File | Line | Suggestion | Category |
|---|------|------|------------|----------|
| 5 | `app/api/checkout/route.ts` | 56–67 | `quantity` is checked as `typeof === "number"` and `> 0` but not `Number.isInteger`. `{"quantity": 0.0001}` passes, produces fractional `stock` in the DB and an order total of a few centavos. Add `Number.isInteger(quantity) && quantity <= MAX_PER_ITEM`. | Security / Correctness |
| 6 | `app/api/admin/brands/route.ts` | 45 | `new RegExp(\`^${trimmedName}$\`, "i")` interpolates unescaped input. A brand named `C++ (Pro)` throws `SyntaxError` → 500; a crafted name is a ReDoS. Note `login/route.ts:36` escapes correctly — apply the same `.replace(/[.*+?^${}()\|[\]\\]/g, "\\$&")` here, or use a case-insensitive collation index instead. | Security |
| 7 | `app/api/admin/admins/[id]/route.ts` | 20–23, 59–61 | `role` and `status` are cast from JSON with no allow-list check, then written straight to the document. An owner (or anything with an owner session) can set `status: "actve"` and permanently lock an account out, since `requireAdmin` demands exactly `"active"`. Validate against `["owner","staff"]` / `["invited","active","disabled"]`. | Security |
| 8 | `app/api/admin/auth/reset-password/route.ts` | 46–56 | Password reset does not invalidate existing sessions. After an account compromise, resetting the password does not evict the attacker — their `admin_session` cookie stays valid for up to 8 hours. Add a `sessionEpoch` counter to `AdminDoc`, include it in the signed payload, and bump it on reset/disable. Same gap for the customer `session` cookie (24h, no revocation at all). | Security |
| 9 | `app/api/checkout/route.ts` | 103–132 | `color` and `size` are stored on the order without ever being checked against the product's actual `colors`/`sizes` arrays. Also, `stock` is a single per-product number, so variants can be oversold — 10 units of stock can be sold as 10 of a colour you have 2 of. | Correctness |
| 10 | `lib/email.ts` | 58–68 | `item.color` and `item.size` are client-controlled and interpolated raw into the receipt's HTML. HTML/style injection into the email body (self-targeted, and into whatever the ops team reads). Escape before interpolation. | Security |
| 11 | `app/api/admin/auth/login/route.ts` `admins/route.ts` | 32–42 / 45–47 | Login matches `username` case-**insensitively**; the uniqueness index (`lib/models/admin.ts:35`) and the duplicate check are case-**sensitive**. `Admin` and `admin` can both exist, and login's `findOne` then returns whichever Mongo picks. Normalize usernames to lowercase on insert. | Security |
| 12 | `admins/[id]`, `orders/[id]`, `reset-password`, `accept-invite` | — | `new ObjectId(id)` on unvalidated input throws `BSONError` → generic 500. Guard with `ObjectId.isValid(id)` and return 400, as `brands/[id]/route.ts:20` already does correctly. | Correctness |
| 13 | `app/api/admin/auth/forgot-password/route.ts` | 8–44 | No rate limit. Repeated POSTs mail-bomb a known admin address and repeatedly rotate their outstanding reset token. | Security |
| 14 | `next.config.ts` | 3 | Empty config — no CSP, HSTS, `X-Frame-Options`, or `Referrer-Policy`. Add a `headers()` block; the admin panel in particular should be `frame-ancestors 'none'`. | Security |
| 15 | `lib/adminAuth.ts`, `app/api/auth/verify/route.ts` | — | `secure: process.env.NODE_ENV === "production"` means any non-production deploy (staging, preview) transmits session cookies over plain HTTP. Prefer keying off the request protocol, or hardcode `true` outside local dev. | Security |
| 16 | `app/api/admin/products/route.ts` | 51–52 | `GET` returns raw product documents rather than a `toPublicProduct`-style projection. Harmless today; becomes a leak the moment an internal field (cost price, supplier) is added. | Maintainability |
| 17 | `lib/adminAuth.ts` | 83–92 | `bcryptjs@2.x` silently truncates passwords at 72 bytes. Reject over-long passwords explicitly rather than accepting a password whose tail is ignored. | Security |

---

## What Looks Good

- **Every** admin route handler calls `requireAdmin`/`requireOwner` — no route relies on the layout alone for protection. Owner-only endpoints (`/api/admin/admins/*`) correctly use `requireOwner`.
- `requireAdmin` re-fetches the admin document and re-checks `status`, so disabling an account or changing a role takes effect on the next request instead of waiting out the cookie. The role in the signed cookie is never trusted for authorization.
- `verifyHash` uses `crypto.timingSafeEqual` with a length guard first.
- Checkout computes `totalAmount` from the DB document (`updated.price`), never from the client's cart — no price tampering.
- Stock check and decrement are atomic (`$gte` in the filter) and wrapped in a transaction with the order insert, so overselling and orphaned orders are both prevented.
- Login returns an identical response for "no such user" and "wrong password"; `forgot-password` returns an identical response regardless of existence. No account enumeration on those paths.
- Invite and reset tokens are 256-bit random, stored only as HMAC hashes, single-use, and time-boxed.
- `.env.local` is gitignored and no secret has ever been committed (verified across all history).
- Login lockout (5 attempts / 15 min) is implemented correctly — the gap is that it doesn't extend to the 2FA step.

---

## Verdict

**Request Changes.** Findings 1–4 should be fixed before this handles real orders or is exposed publicly.

---

# Remediation — applied 2026-08-07

All four critical/high findings are fixed, along with #5, #6, #7, #9, #10, #12, #13 and #14. Status of every finding:

| # | Finding | Status |
|---|---------|--------|
| 1 | NoSQL operator injection in checkout | ✅ Fixed |
| 2 | Brute-forceable checkout OTP | ✅ Fixed |
| 3 | Unlimited admin 2FA guesses | ✅ Fixed |
| 4 | Unauthenticated mail relay | ✅ Fixed |
| 5 | Fractional quantities | ✅ Fixed |
| 6 | Regex injection / ReDoS in brand lookup | ✅ Fixed |
| 7 | Unvalidated `role` / `status` | ✅ Fixed |
| 8 | No session invalidation on password reset | ⬜ Open — needs a `sessionEpoch` on the admin doc |
| 9 | Unvalidated order variants | ✅ Fixed |
| 10 | HTML injection into receipt email | ✅ Fixed |
| 11 | Username case-shadowing | ⬜ Open — needs a data migration to lowercase existing usernames |
| 12 | `new ObjectId()` on unvalidated input | ✅ Fixed |
| 13 | No rate limit on forgot-password | ✅ Fixed |
| 14 | No security headers | ✅ Fixed |
| 15 | `secure` cookie tied to `NODE_ENV` | ⬜ Open — documented in `lib/customerSession.ts` |
| 16 | Admin product GET returns raw docs | ⬜ Open — cosmetic today |
| 17 | bcrypt 72-byte truncation | ⬜ Open |

## New modules

| File | Purpose |
|------|---------|
| `lib/validation.ts` | Type guards for request bodies. `validateCartItems` is what closes finding #1 — `id` must be a string matching the item-code shape, so no object can reach a Mongo filter. |
| `lib/rateLimit.ts` | Distributed sliding-window limiter over Upstash's REST API (no new npm dependency). Atomic via a single Lua script, so concurrent requests across containers cannot over-admit. **Fails closed in production** when Redis is unset or unreachable. |
| `lib/models/otpChallenge.ts` | Server-side OTP challenge store. The attempt counter had to move out of the cookie — a signed cookie can always be rewound by replaying an older copy. |
| `lib/customerSession.ts` | Single place that parses and signs the storefront session cookie, with full type checks. |
| `lib/orderTransitions.ts` | The order status machine, free of DB imports so it can be tested directly. |

## How each critical finding was closed

**#1 — NoSQL injection.** `validateCartItems` rejects any `id` that is not a string matching `/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/`. Eight injection payloads (`$gt`, `$ne`, `$regex`, `$where`, arrays, numbers, booleans, null) are asserted rejected in `scripts/security-checks.ts`.

**#2 — OTP brute force.** The challenge now lives in Mongo behind an opaque 32-byte cookie id. The attempt counter increments in the *same* `findOneAndUpdate` that reads the challenge, with `attempts: { $lt: 5 }` in the filter — so the 6th concurrent request finds nothing to update regardless of how many run at once. A correct code is marked consumed conditionally, making it single-use even under a race. Requesting a new code deletes outstanding ones for that address.

**#3 — Admin 2FA brute force.** `login` no longer resets `failedLoginAttempts` on a correct password; the counter is cleared only when a session is actually issued. `verify-2fa` checks the lockout, counts failures, and locks the account at 5 — dropping the challenge cookie so the attacker must clear the password again. TOTP replay is blocked by recording the highest accepted time step (`lastTotpStep`) and refusing anything at or below it. Backup codes are consumed with a conditional `$pull` so two racing requests cannot both spend one.

**#4 — Mail relay.** `/api/auth/otp` validates the address and is limited per IP (5 / 15 min) and per address (3 / 15 min). `forgot-password` gets the same treatment.

A third, site-wide ceiling (`otpSendGlobal`, 500/hour) sits behind those two. The per-IP and per-email limits each bound one actor; neither bounds the sum, so an attacker spraying a few hundred proxy IPs across many target addresses could stay under both while still exhausting the SMTP quota. The global counter is checked *after* the other two — every `checkRateLimit` call records an attempt, so testing it first would let an already-over-limit IP keep consuming global budget and starve real customers. Tripping it logs at `error` level, because for a store this size it means an attack is in progress rather than that the limit is too low.

### Access policy — internal storefront

This is an employee shop, not a public one, which is a far stronger position than any rate limit: an outsider never obtains a session at all. Implemented in `lib/orderPolicy.ts`.

**Domain allowlist.** Only addresses at `ALLOWED_EMAIL_DOMAINS` (default `rgoc.com.ph`) may request a checkout code. Enforced in two places on purpose:

- `/api/auth/otp`, *before* the rate limiters — so an outside address cannot consume the per-IP or global send budget and deny codes to real employees.
- `/api/checkout`, against the session's own email — sessions are signed rather than stored and last 24 hours, so one minted before the policy existed would otherwise still be able to order. Checking at the point of effect is what makes the policy revocable.

The match is **exact**, not a suffix test. `endsWith("rgoc.com.ph")` would accept `attacker@notrgoc.com.ph`, a domain anyone can register in minutes. Subdomains are excluded unless listed. Thirteen bypass attempts are asserted in `scripts/security-checks.ts`, including look-alike domains, the domain used as a prefix, the domain in the local part, and multiple `@` signs.

**Daily order cap.** Ten orders per address per rolling 24 hours (`DAILY_ORDER_LIMIT`). Counted in Mongo *inside the checkout transaction*, not with the Redis limiter, for two reasons: the cap concerns orders actually placed rather than requests made — a request counter would burn quota on a checkout that failed on stock, costing someone one of their ten for an order they never received — and reading it inside the transaction closes the race where two simultaneous checkouts both observe nine and both commit. Cancelled orders do not count, so a mistaken order that the team cancels frees the slot back up.

This matters because there is **no payment integration**: checkout writes real inventory on nothing but a confirmed email address. Without a cap, one account could reserve the entire sellable stock, and every one of those orders would look legitimate.

### Why the OTP code is stored in Mongo rather than Redis

A deliberate split, worth recording because it looks inconsistent at a glance:

- **Rate limits → Redis.** Disposable, high-write, worthless once the window passes, and must be correct across containers.
- **The challenge and its attempt counter → Mongo.** This is the guarantee that actually stops the brute force, so it should not depend on a second service being reachable. A Redis outage currently degrades rate limiting only (and fails closed); the challenge keeps working. Redis can also evict keys under memory pressure, which would drop a live challenge mid-checkout.

Moving the challenge to Redis would make it faster and take load off the order-serving cluster. It would not make it more secure: the code is never stored in either place — only `HMAC(JWT_SECRET, "otp|email|code")` — and the atomicity that makes the attempt counter safe under concurrency is already provided by Mongo's conditional `findOneAndUpdate`.

## Order tracking

- **Order numbers** — `RMK-2026-000042`, allocated from an atomic counter *inside* the checkout transaction, so a rolled-back order leaves no gap. Shown on the success screen, in the receipt email subject and body, and in the admin list, which is now searchable by reference or buyer email.
- **Audit trail** — every order carries `statusHistory`: who changed it, from what to what, when, and whether stock moved. Viewable per order in the admin UI.
- **Validated transitions** — `ORDER_TRANSITIONS` states which moves are legal and what each does to inventory. `cancelled → fulfilled` is now refused; previously any status was accepted.
- **Double-restock bug fixed** — cancelling restocked an order and reopening did not re-deduct, so `cancel → reopen → cancel` restocked the same units twice and silently inflated inventory. A `stockReleased` flag makes every stock move idempotent. Reopening now re-reserves stock atomically and fails with a clear 409 if the units have since sold.
- **Race-safe** — the status update is conditional on the status that was read, so two admins acting at once produce a 409 instead of a lost update.
- **Bounded list** — the admin endpoint used to return every order ever placed on each page load; it is now paginated.

## Verification

```bash
npm run check:security     # 52 assertions — injection payloads, quantity
                           # validation, escaping, transition invariants
npm run check:ratelimit    # run locally: proves the Upstash path enforces
                           # its limit under concurrency
npx tsc --noEmit           # clean
```

`scripts/security-checks.ts` includes a regression test that replays `cancel → reopen → cancel` and asserts the net stock movement is exactly one release, plus a longer six-step cycle.

**Rate limiter — verified against live Upstash on 2026-08-07:**

```
Backend: Upstash Redis (distributed sliding window)
  PASS first 3 admitted, next 2 refused — allow allow allow deny deny
  PASS refusal carries a positive Retry-After — 4s
  PASS exactly 3 of 10 concurrent requests admitted — 3 admitted
  PASS admitted again once the window has passed
```

The concurrency line is the one that matters. A read-then-write limiter passes the sequential test and fails that one — ten requests each read "0 used" before any of them writes, so 6–8 get admitted past a limit of 3. Exactly 3 confirms the `EVAL` script is atomic on the server, which is the entire reason it is a Lua script rather than a `GET`/`INCR` pair.

Re-run `npm run check:ratelimit` after any change to `SLIDING_WINDOW_LUA`; it is the only thing that exercises that path.

## Required before deploy

1. **`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` must be set in the production environment.** The limiter fails closed — without them, login, checkout codes and password reset will reject every request. This is deliberate: an unmetered auth endpoint is worse than a rejected one.
2. **Set `ALLOWED_EMAIL_DOMAINS`** (or accept the `rgoc.com.ph` default). Getting this wrong locks every employee out of ordering, so confirm it before release.
3. **Run `npm run migrate:orders`** to backfill `orderNumber`, `stockReleased` and `statusHistory` on existing orders, and to create the unique index on `orderNumber`. Idempotent.
4. ~~Run `npm run check:ratelimit`~~ — done, passing against live Upstash (see Verification above). Re-run against the production instance if it is a different database from the one used in development.

Still unexercised end to end: no order has been placed through the running application. `tsc` confirms the wiring types line up and the unit checks confirm each guard behaves, but neither proves a guard is actually reached at request time. One real order — plus one attempt from a personal address, and one cancel/reopen cycle — closes that gap in about two minutes.

Note that existing customer sessions are unaffected by the allowlist at the point of issue — but the checkout re-check means any session belonging to a non-company address stops being able to order immediately.

---

# Admin hardening — applied 2026-08-07

Second pass, covering the admin panel rather than checkout.

### Audit trail (`lib/models/auditLog.ts`)

Orders already carried `statusHistory`; nothing else did. Any staff account could change a price, zero out stock, or delete a brand and leave no record of who or when. Every mutating admin route now writes an attributable entry with field-level before/after values, viewable at **/admin/audit** (owner-only).

Coverage — verified route by route:

| Route | Actions logged |
|---|---|
| `products` POST, `products/[id]` PATCH | create, update (diffed) |
| `brands` POST, `brands/[id]` DELETE | create, delete |
| `admins` POST, `admins/[id]` PATCH | invite, role/status change, session revocation |
| `orders/[id]` PATCH | status change + stock effect |
| `auth/reset-password` POST | password reset + session revocation |

Two deliberate choices: a failed audit write **never** fails the operation it describes (a logging outage should not stop the team fulfilling orders — failures go to stderr instead), and no application code updates or deletes entries, with no TTL index. A no-op edit produces an empty diff and no entry, so resubmitting a form unchanged doesn't bury the changes that matter.

The log is **owner-only**. It exists to hold staff accountable, and letting the people it covers read it weakens that without adding much.

### Session revocation — closes finding #8

`AdminDoc.sessionEpoch` is now inside the signed cookie payload and compared on every request in `requireAdmin`. Bumping it invalidates every live session for that admin immediately. Bumped on:

- **Password reset** — this was the actual hole. Resetting a compromised admin's password previously left whoever was already signed in as them working for up to eight more hours, because the signed cookie stayed valid regardless of the new password.
- **Role change** — demoting an owner to staff took effect on their next sign-in, not on their live session.
- **Status change away from `active`.**

`?? 0` throughout, so admins predating the field behave as epoch 0.

### Owner-only price changes

Changing the price of an *existing* product is now owner-only; staff keep stock, photos, descriptions, sizes, colours, and can still set a price when creating a product. Compared against the stored value, so resubmitting the same price (as the edit form does on any save) is not treated as a change. Price is the field with direct financial consequence and the least day-to-day reason for staff to touch — the smallest change that removes the worst outcome of a compromised staff account.

### Brand deletion no longer orphans products

`brand` is stored on products as a plain string, not a reference, so deleting a brand left products pointing at a name that no longer resolved. Delete is now refused with a 409 naming the count (`4 products still use "Samsonite"`).

### Rate limits completed

`accept-invite`, `reset-password` and `confirm-2fa` were unmetered. The tokens are 256-bit so guessing was never the concern — but each runs bcrypt at cost 12, making them a cheap way to burn CPU, and `confirm-2fa` verifies a TOTP code with no per-account counter, the same shape of gap fixed earlier on login and verify-2fa. All three now share `adminTokenEndpointPerIp` (10 / 15 min).

## ⚠️ Deploying this logs every admin out

Existing `admin_session` cookies carry no `epoch` field, so `verifyAdminSession` rejects them and everyone signs in again — including whoever deploys. This is correct behaviour for a session-format change, but do it at a time when someone with owner credentials and their authenticator is available. No migration script is needed; `sessionEpoch` is created lazily by the first `$inc`.

---

# Mail and rate-limit corrections — applied 2026-08-07

### Per-IP limits were sized for the wrong deployment — corrected

The original limits assumed a public storefront, where one IP is a fair proxy for one actor. On an internal store everyone sits behind the same corporate NAT, so the whole company shares **one** IP. `otpRequestPerIp` at 5 per 15 minutes did not mean five attempts per person — it meant **the sixth colleague to shop in any quarter-hour was refused**. Every `PerIp` limit had the same defect; admin login at 10/15min gave the entire office ten sign-in attempts between them.

This was a guaranteed outage on the first busy day, not a theoretical risk.

| Limit | Was | Now |
|---|---|---|
| `otpRequestPerIp` | 5 / 15 min | 100 / 15 min |
| `otpVerifyPerIp` | 15 / 15 min | 300 / 15 min |
| `adminLoginPerIp` | 10 / 15 min | 60 / 15 min |
| `admin2faPerIp` | 10 / 15 min | 60 / 15 min |
| `adminForgotPerIp` | 5 / hr | 40 / hr |
| `adminTokenEndpointPerIp` | 10 / 15 min | 60 / 15 min |

**Per-account limits are unchanged and still tight** — they are what actually stops a targeted attack, and they are unaffected by which IP requests arrive from. Per-IP is now a coarse flood backstop. This is only safe because the domain allowlist means there is no anonymous attacker to throttle; if this ever becomes public, these must come back down.

### Global send ceiling was above the provider's own quota

`otpSendGlobal` was set to 500/hour without reference to the mail provider. Mail goes through Gmail, which allows roughly 500 recipients **per day** free, ~2,000 on Workspace — so the ceiling sat above the entire daily allowance and could never trip before Gmail cut sending off. Now 100/hour, configurable via `OTP_GLOBAL_HOURLY_LIMIT`.

### SMTP transport hardened

- **`requireTLS: true`** on port 587. The connection opens in the clear and upgrades via STARTTLS; without this, nodemailer authenticates over the plaintext socket anyway if the upgrade is not offered, leaking the SMTP password to a downgrade attack or a misconfigured relay.
- **`minVersion: "TLSv1.2"`** and an explicit `rejectUnauthorized: true`, stated so nobody later "fixes" a certificate error by disabling verification.
- **Explicit timeouts** (5s connect, 5s greeting, 10s socket). Nodemailer defaults to 2 minutes and 10 minutes, which on serverless means a hung connection burns the entire request budget.
- **No connection pool, deliberately.** Pooling is the standard advice and is wrong here: each Vercel container serves one request then freezes, so there is no long-lived process for a pool to amortise across.

### Receipt email moved off the response path

Checkout awaited Gmail before responding, adding a second or two of spinner to every order. It now uses Next's `after()`, so the response returns immediately and the mail sends before the function is frozen. A bare fire-and-forget promise would not work — serverless kills in-flight work once the response is sent.

Failures are logged with the order number, since the only other signal is a customer who never received a receipt.

### Invite email validated and escaped

`admins` POST checked only `typeof email === "string"` — no format validation, unlike the checkout path — and `sendAdminInviteEmail` interpolated `invitedByEmail` raw into HTML. Now uses `asEmail`, and the invite and reset templates escape both the address and the URL.

## Credential leakage sweep

Scanned rather than assumed. Every check run against the live secret values from `.env.local`:

| Check | Result |
|---|---|
| Secret values anywhere in git history | Clean — no `.env`/secret file ever committed |
| Secret values in build output (`.next/`) | Clean — no value appears in any bundle |
| `NEXT_PUBLIC_*` variables (these ship to the browser) | Clean — none defined or referenced |
| `process.env` inside `"use client"` components | Clean — none |
| MongoDB driver errors carrying the URI password | Clean — verified by forcing a connection failure with a known password and inspecting `message`, `stack` and all own properties |
| Nodemailer errors carrying the SMTP password | Clean — verified the same way |
| API error responses returning raw error objects | Clean — every catch returns a generic message |
| `.gitignore` coverage | `.env*` ignored |

The last two driver checks matter because `console.error(error)` appears throughout the codebase; had either driver embedded credentials in its error objects, every failed connection would have written them to the Vercel logs. Neither does.

**One residual risk, outside the code:** `SMTP_PASS` is a Gmail app password, which grants send access to that mailbox to anyone holding it. It lives in `.env.local` and in Vercel's environment settings. Rotate it if it is ever pasted into a chat, a ticket, or a screenshot.

## Remaining work, in priority order

1. **#11 — username case-shadowing.** Lowercase usernames on insert and migrate existing ones; login matches case-insensitively while the unique index does not.
2. **#15 — `secure` cookie flag** keys off `NODE_ENV`, so a preview deploy that doesn't set it sends session cookies over plain HTTP.
3. **#17 — bcrypt truncation.** Reject passwords over 72 bytes rather than silently ignoring the tail.
4. **Customer sessions still can't be revoked individually.** The admin epoch mechanism was not extended to them: customers have no account record to hang an epoch on, and the domain allowlist already blocks ordering the moment someone leaves the company. Worth revisiting only if customer accounts are ever introduced.
5. **#16 — admin product GET returns raw documents** rather than a projection. Harmless today; becomes a leak the moment an internal field (cost price, supplier) is added.
6. **No way to reset a locked-out admin's 2FA.** If someone loses their authenticator and exhausts their ten backup codes, there is no owner-facing recovery path — it needs a direct database edit. An operational gap rather than a security one, but it will happen eventually.
7. Consider a schema library (zod) to replace the hand-rolled guards in `lib/validation.ts` as the API surface grows.
