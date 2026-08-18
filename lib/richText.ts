/**
 * Rich text for product descriptions.
 *
 * `description` is the only free-form prose field in the catalog, and it is
 * rendered in exactly one place: the "Details" block on the item detail
 * page. It used to double as the item's label — the original CSV import
 * read a "Description" column and seeded `name` from it — which is why
 * checkout, the admin lists and the order emails all used to reach for it.
 * They now go through `productLabel()` in lib/models/product.ts, so this
 * field is free to hold markup.
 *
 * Everything here is dependency-free and DOM-free on purpose:
 *
 *  - dependency-free, because a sanitizer is the last place you want a
 *    supply-chain surface, and the allowlist below is small enough to read
 *    in one sitting and audit.
 *  - DOM-free, because this module is imported by both the admin editor (a
 *    client component) and the API routes (server). Reaching for
 *    `document` would work in the editor and crash the route; reaching for
 *    a Node-only parser would do the reverse.
 *
 * The security model: the API routes sanitize on write, and
 * `toPublicProduct` sanitizes again on read. The second pass is not
 * redundancy for its own sake — it is what stops a payload written by a
 * compromised or careless admin account from ever reaching a shopper's
 * browser, and it costs one pass per 15-second cache fill rather than one
 * per request. That second pass is only sound if sanitizing twice equals
 * sanitizing once, which is why entities are decoded before they are
 * re-escaped below, and why scripts/check-richtext.ts asserts idempotence.
 */

/** Hard ceiling on stored markup. A paste from a word processor can carry
 *  tens of kilobytes of junk attributes; the allowlist strips them, but the
 *  text itself still has to be bounded so one product can't bloat the
 *  document and, with it, every cached copy of the catalog. */
export const MAX_RICH_TEXT_LENGTH = 20_000;

/**
 * Tags that survive, and what they become.
 *
 * The left column is what a browser's `contentEditable` and a paste from
 * Word/Docs/a webpage actually emit; the right column is the small set we
 * are willing to store. Mapping rather than dropping is deliberate: a
 * pasted `<b>` should stay bold, not silently lose its formatting, and an
 * `<h1>` should become the page's `<h2>` rather than compete with the
 * product title for the top of the heading outline.
 */
const TAG_ALIASES: Record<string, string> = {
  // Inline emphasis
  b: "strong",
  strong: "strong",
  i: "em",
  em: "em",
  u: "u",
  ins: "u",
  s: "s",
  strike: "s",
  del: "s",
  // `font` is what execCommand emits when styleWithCSS is off, and what
  // older pasted HTML is full of. Its colour attribute is translated to a
  // style below; the tag itself becomes a plain span.
  font: "span",
  span: "span",
  a: "a",
  br: "br",
  // Blocks. Anything div-shaped collapses to a paragraph — we do not store
  // layout containers, only prose.
  p: "p",
  div: "p",
  section: "p",
  article: "p",
  blockquote: "p",
  h1: "h2",
  h2: "h2",
  h3: "h3",
  h4: "h3",
  h5: "h3",
  h6: "h3",
  ul: "ul",
  ol: "ol",
  li: "li",
  // Pasting a row out of Excel or a Word table is common enough to handle.
  // We do not store tables, so a row flattens to a paragraph and its cells
  // are separated by SEPARATOR_TAGS below — without that, `<td>a</td>
  // <td>b</td>` would arrive on the storefront as "ab".
  tr: "p",
  caption: "p",
  dt: "p",
  dd: "p",
  pre: "p",
  figcaption: "p",
};

/** Dropped as markup, but their boundary is worth a space. */
const SEPARATOR_TAGS = new Set(["td", "th"]);

/** Tags whose *contents* are discarded too, not just their markup.
 *
 *  Dropping only the tag would turn `<script>alert(1)</script>` into the
 *  visible text "alert(1)" — harmless, but it means a stripped payload
 *  shows up as garbage in the description instead of disappearing. */
const VOID_CONTENT_TAGS = new Set([
  "script",
  "style",
  "noscript",
  "template",
  "iframe",
  "object",
  "embed",
  "applet",
  "svg",
  "math",
  "head",
  "title",
  "xmp",
]);

const BLOCK_TAGS = new Set(["p", "h2", "h3", "ul", "ol", "li"]);
const INLINE_TAGS = new Set(["strong", "em", "u", "s", "a", "span"]);
const SELF_CLOSING = new Set(["br"]);

/** Alignment values the toolbar can produce. `justify` is included because
 *  a paste from a word processor commonly carries it and it is harmless. */
const ALIGNMENTS = new Set(["left", "center", "right", "justify"]);

/**
 * Named entities we decode back to characters.
 *
 * The first six are the security-relevant ones — `&#60;script&#62;` has to
 * become `<script>` here so that escaping neutralises it — and browsers
 * accept them in any case, so they are matched case-insensitively.
 *
 * The rest are fidelity, not safety. A paste from Word or Google Docs is
 * full of `&eacute;`, `&rsquo;` and `&mdash;`; an entity this table does
 * not know keeps its ampersand escaped, so the shopper reads a literal
 * "caf&eacute;". These are matched case-sensitively, because `&Eacute;`
 * and `&eacute;` are different letters.
 */
const CASE_INSENSITIVE_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
};

/**
 * The Latin-1 accented letters, by their standard entity names.
 *
 * `&Agrave;` through `&yuml;` occupy code points 0xC0–0xFF in order, with
 * two gaps where `&times;` and `&divide;` sit. Building the table from that
 * run keeps sixty lines of boilerplate out of the file without hiding
 * anything — the names are listed in the same order as the code points.
 */
function buildLatin1Entities(): Record<string, string> {
  const names =
    "Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml " +
    "Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times " +
    "Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig " +
    "agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml " +
    "igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide " +
    "oslash ugrave uacute ucirc uuml yacute thorn yuml";
  const table: Record<string, string> = {};
  names.split(" ").forEach((name, index) => {
    table[name] = String.fromCharCode(0xc0 + index);
  });
  return table;
}

const NAMED_ENTITIES: Record<string, string> = {
  // Punctuation a word processor substitutes as you type.
  ndash: "\u2013",
  mdash: "\u2014",
  lsquo: "\u2018",
  rsquo: "\u2019",
  sbquo: "\u201a",
  ldquo: "\u201c",
  rdquo: "\u201d",
  bdquo: "\u201e",
  hellip: "\u2026",
  bull: "\u2022",
  middot: "\u00b7",
  dagger: "\u2020",
  laquo: "\u00ab",
  raquo: "\u00bb",
  lsaquo: "\u2039",
  rsaquo: "\u203a",
  prime: "\u2032",
  ensp: "\u2002",
  emsp: "\u2003",
  thinsp: "\u2009",
  // Commerce and measurement — what a product description actually uses.
  copy: "\u00a9",
  reg: "\u00ae",
  trade: "\u2122",
  deg: "\u00b0",
  plusmn: "\u00b1",
  times: "\u00d7",
  divide: "\u00f7",
  frac12: "\u00bd",
  frac14: "\u00bc",
  frac34: "\u00be",
  sup2: "\u00b2",
  sup3: "\u00b3",
  micro: "\u00b5",
  ne: "\u2260",
  le: "\u2264",
  ge: "\u2265",
  minus: "\u2212",
  infin: "\u221e",
  euro: "\u20ac",
  pound: "\u00a3",
  yen: "\u00a5",
  cent: "\u00a2",
  sect: "\u00a7",
  para: "\u00b6",
  ...buildLatin1Entities(),
};

/**
 * Turn any entity — named, decimal or hex — back into the character it
 * stands for.
 *
 * This runs before escaping, and it is the reason sanitizing is idempotent
 * rather than a machine for turning `&` into `&amp;amp;amp;` one pass at a
 * time. It is also a security step in its own right: `&#60;script&#62;`
 * has to become `<script>` here so that the escape below neutralises it,
 * instead of passing through as an entity that the browser decodes into a
 * live tag later.
 */
function decodeEntities(text: string): string {
  return text.replace(
    /&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{1,31});/g,
    (match, body: string) => {
      if (body[0] === "#") {
        const codePoint =
          body[1] === "x" || body[1] === "X"
            ? Number.parseInt(body.slice(2), 16)
            : Number.parseInt(body.slice(1), 10);
        if (!Number.isFinite(codePoint) || codePoint <= 0 || codePoint > 0x10ffff) {
          return match;
        }
        // Surrogate halves are not standalone characters; emitting one
        // produces a lone surrogate that breaks JSON encoding downstream.
        if (codePoint >= 0xd800 && codePoint <= 0xdfff) return "";
        try {
          return String.fromCodePoint(codePoint);
        } catch {
          return match;
        }
      }
      const named =
        NAMED_ENTITIES[body] ?? CASE_INSENSITIVE_ENTITIES[body.toLowerCase()];
      return named ?? match;
    },
  );
}

function escapeText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, "&quot;");
}

/**
 * Parse the attribute soup inside a start tag.
 *
 * Values may be double-quoted, single-quoted or bare; names are lowercased.
 * Nothing is trusted here — this only turns text into a map, and every
 * decision about what survives happens in `filterAttributes`.
 */
function parseAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const name = match[1].toLowerCase();
    let value = match[2] ?? "";
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    attributes[name] = decodeEntities(value);
  }
  return attributes;
}

/**
 * Is this href safe to store?
 *
 * Allowlisted schemes only. The leading strip is what makes the check
 * meaningful: `java\tscript:alert(1)` and `  javascript:alert(1)` are both
 * accepted by browsers as javascript URLs, so any check that looks at the
 * raw string can be walked straight past with a control character. We
 * remove control characters and whitespace first, then require the result
 * to *start* with something we recognise.
 */
function safeHref(rawValue: string): string | null {
  const stripped = rawValue.replace(/[\u0000-\u0020\u007f-\u00a0\u2000-\u200f\u2028-\u202f]/g, "");
  if (!stripped) return null;
  const lower = stripped.toLowerCase();
  if (
    lower.startsWith("http://") ||
    lower.startsWith("https://") ||
    lower.startsWith("mailto:")
  ) {
    return stripped;
  }
  // Site-relative links are fine; protocol-relative (`//evil.com`) is not,
  // because it inherits the page's scheme and leaves the site.
  if (stripped.startsWith("/") && !stripped.startsWith("//")) return stripped;
  // A bare `example.com` typed into the link box is almost certainly meant
  // as a URL, and upgrading it beats storing a link that resolves to a
  // path on our own domain. Anything containing a colon is rejected
  // instead of guessed at — that is where the dangerous schemes live.
  if (!lower.includes(":") && /^[a-z0-9][-a-z0-9.]*\.[a-z]{2,}(\/|$)/i.test(stripped)) {
    return `https://${stripped}`;
  }
  return null;
}

/** `rgb(196, 36, 26)` and `#c4241a` both mean the same colour; storing one
 *  form keeps the markup stable across browsers, which is what makes the
 *  idempotence check meaningful. Anything that is not plainly a colour is
 *  rejected rather than sanitized — a value like `url(...)` or
 *  `expression(...)` has no business in this field at all. */
function normalizeColor(rawValue: string): string | null {
  const value = rawValue.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(value);
  if (hex) {
    const digits = hex[1];
    if (digits.length === 3) {
      return `#${digits[0]}${digits[0]}${digits[1]}${digits[1]}${digits[2]}${digits[2]}`;
    }
    return `#${digits}`;
  }
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*[\d.]+\s*)?\)$/.exec(
    value,
  );
  if (rgb) {
    const channels = [rgb[1], rgb[2], rgb[3]].map((n) => Number.parseInt(n, 10));
    if (channels.some((n) => n > 255)) return null;
    return `#${channels.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
  }
  return null;
}

/**
 * The style attribute, reduced to the three properties the toolbar can set.
 *
 * A style attribute is the widest hole in any HTML allowlist — it is the
 * one place markup can still reach the renderer after the script tags are
 * gone. So this does not filter out known-bad declarations; it discards
 * everything and re-emits only `text-align`, `color` and
 * `background-color`, each having survived a value check strict enough
 * that no syntax is left to abuse.
 */
function filterStyle(rawValue: string, tag: string): string | null {
  const kept: string[] = [];
  for (const declaration of rawValue.split(";")) {
    const separator = declaration.indexOf(":");
    if (separator === -1) continue;
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const value = declaration.slice(separator + 1).trim();
    if (!value) continue;

    if (property === "text-align" && BLOCK_TAGS.has(tag)) {
      const alignment = value.toLowerCase();
      if (ALIGNMENTS.has(alignment)) kept.push(`text-align:${alignment}`);
      continue;
    }
    if (property === "color" || property === "background-color") {
      const color = normalizeColor(value);
      if (color) kept.push(`${property}:${color}`);
    }
  }
  return kept.length > 0 ? kept.join(";") : null;
}

/**
 * Build the attribute string for a tag we have decided to keep.
 *
 * Note what is absent: there is no "strip the dangerous ones" branch. Only
 * `href` and `style` can produce output at all, so `onclick`, `onerror`,
 * `srcdoc`, `formaction` and every attribute invented after this was
 * written are dropped by falling through, not by being listed.
 */
function filterAttributes(tag: string, attributes: Record<string, string>): string {
  const parts: string[] = [];

  if (tag === "a") {
    const href = attributes.href ? safeHref(attributes.href) : null;
    if (!href) return "";
    parts.push(`href="${escapeAttribute(href)}"`);
    // Storefront links leave the shop, so they open in a new tab —
    // `noopener` because a target-blank link otherwise hands the opened
    // page a handle back to ours, and `nofollow` because a description is
    // admin-entered content we do not want to vouch for.
    if (!href.startsWith("/")) {
      parts.push('target="_blank"', 'rel="noopener noreferrer nofollow"');
    }
  }

  // `<font color=red>` from a paste or an old execCommand becomes the same
  // inline style the toolbar produces, so both round-trip identically.
  let style = attributes.style ?? "";
  if (attributes.color) style = `color:${attributes.color};${style}`;

  if (style) {
    const filtered = filterStyle(style, tag);
    if (filtered) parts.push(`style="${escapeAttribute(filtered)}"`);
  }

  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

interface OpenTag {
  tag: string;
  /** Opened in the input but not emitted — a `<span>` whose only styling
   *  was rejected. It still occupies the stack so that its closing tag
   *  closes the right thing: without it, `</span>` would close an
   *  *enclosing* coloured span and strip the colour off everything after
   *  the nested one. */
  suppressed?: boolean;
  /** Opened by the sanitizer rather than by the input — a paragraph
   *  wrapped around loose text, or a list wrapped around an orphan `<li>`.
   *  Implicit tags are closed automatically the moment a real block
   *  starts, so they never swallow the rest of the document. */
  implicit: boolean;
}

/**
 * Reduce arbitrary HTML to the subset the storefront renders.
 *
 * Runs on write (in the API routes, on what the admin submitted) and again
 * on read (in `toPublicProduct`, on what the database holds).
 */
export function sanitizeRichText(input: unknown): string {
  if (typeof input !== "string" || input.length === 0) return "";

  const source = input.slice(0, MAX_RICH_TEXT_LENGTH);
  const output: string[] = [];
  const stack: OpenTag[] = [];

  const topBlock = (): string | null => {
    for (let i = stack.length - 1; i >= 0; i -= 1) {
      if (BLOCK_TAGS.has(stack[i].tag)) return stack[i].tag;
    }
    return null;
  };

  const closeTag = () => {
    const open = stack.pop();
    if (open && !open.suppressed) output.push(`</${open.tag}>`);
  };

  /** Close inline tags back to the nearest block boundary. Called before a
   *  block opens or closes, so a stray `<strong>` can never leak across a
   *  paragraph break and turn the rest of the description bold. */
  const closeInlines = () => {
    while (stack.length > 0 && INLINE_TAGS.has(stack[stack.length - 1].tag)) {
      closeTag();
    }
  };

  const closeUpTo = (tag: string): boolean => {
    let index = -1;
    for (let i = stack.length - 1; i >= 0; i -= 1) {
      if (stack[i].tag === tag) {
        index = i;
        break;
      }
    }
    if (index === -1) return false;
    while (stack.length > index) closeTag();
    return true;
  };

  /** A block element cannot live inside a paragraph or a heading, and a
   *  list item cannot live inside another list item. Everything that has
   *  to give way before `tag` opens gives way here. */
  const prepareForBlock = (tag: string) => {
    closeInlines();
    if (tag === "li") {
      // A list item closes the previous one, but stays inside its list.
      if (stack.length > 0 && stack[stack.length - 1].tag === "li") closeTag();
      const enclosing = topBlock();
      if (enclosing !== "ul" && enclosing !== "ol") {
        // An orphan `<li>` — common in pasted fragments. Give it a list to
        // live in rather than emitting invalid markup.
        while (stack.length > 0 && BLOCK_TAGS.has(stack[stack.length - 1].tag)) {
          closeTag();
        }
        output.push("<ul>");
        stack.push({ tag: "ul", implicit: true });
      }
      return;
    }
    // Lists may nest inside a list item; nothing else may nest at all.
    if ((tag === "ul" || tag === "ol") && topBlock() === "li") return;
    while (stack.length > 0 && BLOCK_TAGS.has(stack[stack.length - 1].tag)) {
      closeTag();
    }
  };

  /** Text and inline markup at the top level get a paragraph, so the
   *  storefront's spacing rules have something to attach to. Without this
   *  a description typed as one line of plain text would render with no
   *  block box at all and collide with whatever follows it. */
  const ensureTextContainer = () => {
    if (topBlock() === null) {
      output.push("<p>");
      stack.push({ tag: "p", implicit: true });
    }
  };

  const tokenizer = /<(!--[\s\S]*?--|!\[CDATA\[[\s\S]*?\]\]|![^>]*|\/?[a-zA-Z][^>]*)>/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  const pushText = (raw: string) => {
    if (!raw) return;
    const decoded = decodeEntities(raw);
    // Whitespace between block tags is layout noise from whichever editor
    // produced the markup, not content. Emitting it would open a stray
    // paragraph for every newline in the source.
    if (!decoded.trim()) {
      if (topBlock() !== null) output.push(escapeText(decoded));
      return;
    }
    ensureTextContainer();
    output.push(escapeText(decoded));
  };

  while ((match = tokenizer.exec(source)) !== null) {
    pushText(source.slice(cursor, match.index));
    cursor = tokenizer.lastIndex;

    const body = match[1];

    // Comments, CDATA and doctypes carry no content worth keeping, and
    // conditional comments are a classic way to smuggle markup past a
    // naive filter. All of it goes.
    if (body.startsWith("!")) continue;

    const isClosing = body[0] === "/";
    const nameMatch = /^\/?\s*([a-zA-Z][a-zA-Z0-9]*)/.exec(body);
    if (!nameMatch) continue;
    const rawName = nameMatch[1].toLowerCase();

    if (VOID_CONTENT_TAGS.has(rawName)) {
      if (isClosing) continue;
      // Skip to the matching close tag, discarding everything between. An
      // unclosed `<script>` swallows the rest of the input, which is the
      // safe direction to fail in.
      const closePattern = new RegExp(`<\\s*/\\s*${rawName}\\s*>`, "i");
      const rest = source.slice(cursor);
      const closeIndex = rest.search(closePattern);
      if (closeIndex === -1) {
        cursor = source.length;
        break;
      }
      const closeMatch = closePattern.exec(rest);
      cursor += closeIndex + (closeMatch ? closeMatch[0].length : 0);
      tokenizer.lastIndex = cursor;
      continue;
    }

    const tag = TAG_ALIASES[rawName];
    if (!tag) {
      if (!isClosing && SEPARATOR_TAGS.has(rawName) && topBlock() !== null) {
        output.push(" ");
      }
      continue;
    }

    if (isClosing) {
      if (INLINE_TAGS.has(tag)) {
        closeUpTo(tag);
      } else if (BLOCK_TAGS.has(tag)) {
        closeInlines();
        closeUpTo(tag);
      }
      continue;
    }

    if (SELF_CLOSING.has(tag)) {
      // A `<br>` outside any block would be a line break with nothing to
      // break, so it gets the same paragraph treatment as loose text.
      ensureTextContainer();
      output.push("<br>");
      continue;
    }

    const attributeSource = body.slice(nameMatch[0].length).replace(/\/\s*$/, "");
    const attributes = parseAttributes(attributeSource);

    if (BLOCK_TAGS.has(tag)) {
      prepareForBlock(tag);
      output.push(`<${tag}${filterAttributes(tag, attributes)}>`);
      stack.push({ tag, implicit: false });
      continue;
    }

    // Inline. A link with no usable href is dropped as a tag but its text
    // is kept — losing the URL should not lose the sentence.
    if (tag === "a" && !(attributes.href && safeHref(attributes.href))) continue;

    ensureTextContainer();
    const rendered = filterAttributes(tag, attributes);
    if (tag === "span" && !rendered) {
      // Nothing left to say. Keep the text, drop the wrapper.
      stack.push({ tag, implicit: false, suppressed: true });
      continue;
    }
    output.push(`<${tag}${rendered}>`);
    stack.push({ tag, implicit: false });
  }

  pushText(source.slice(cursor));
  while (stack.length > 0) closeTag();

  return collapseEmpty(output.join(""));
}

/**
 * Drop blocks that ended up with nothing in them.
 *
 * Stripping disallowed markup routinely leaves `<p></p>` behind — a pasted
 * `<div><img></div>` becomes exactly that — and an empty paragraph is not
 * invisible once the storefront gives paragraphs bottom margin. Runs to a
 * fixed point because removing an inner empty block can empty its parent.
 */
function collapseEmpty(html: string): string {
  const pattern = /<(p|h2|h3|ul|ol|li)(?:\s[^>]*)?>(?:\s|<br>|&nbsp;| )*<\/\1>/g;
  let current = html;
  for (let pass = 0; pass < 5; pass += 1) {
    const next = current.replace(pattern, "");
    if (next === current) break;
    current = next;
  }
  return current.trim();
}

/**
 * The plain-text reading of a rich description.
 *
 * Used for the page's `<meta name="description">`, and as the last-resort
 * label for a legacy product saved before `name` existed. Block boundaries
 * become spaces rather than being dropped, so "Cabin size.Fits overhead"
 * can't happen.
 */
export function richTextToPlain(input: unknown): string {
  if (typeof input !== "string" || input.length === 0) return "";
  return decodeEntities(
    input
      .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
      .replace(/<[^>]*>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Promote a plain-text description to markup.
 *
 * Every product saved before this feature holds plain text, and this is
 * what `toPublicProduct` runs them through — so there is no migration
 * script and no flag day. A row upgrades itself the first time an admin
 * opens it and saves.
 *
 * Blank-line-separated chunks become paragraphs and single newlines become
 * line breaks, which is how the text was almost certainly meant to read
 * when someone typed it into a two-row textarea.
 */
export function plainToRichText(input: unknown): string {
  if (typeof input !== "string") return "";
  const text = input.trim();
  if (!text) return "";
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => {
      const lines = paragraph.split(/\n/).map((line) => escapeText(line.trim()));
      return `<p>${lines.join("<br>")}</p>`;
    })
    .join("");
}

/**
 * The one entry point the rest of the app should use for reading a stored
 * description, whatever era it was written in.
 *
 * Detecting "is this markup?" by looking for a tag is a heuristic, but a
 * safe one in both directions: plain text containing a stray `<` fails the
 * test and gets escaped by `plainToRichText`, and markup that somehow
 * escaped sanitizing on write is sanitized here.
 */
export function toRichText(stored: unknown): string {
  if (typeof stored !== "string" || !stored.trim()) return "";
  const looksLikeHtml = /<\/?(p|h2|h3|ul|ol|li|br|strong|em|u|s|a|span)\b[^>]*>/i.test(
    stored,
  );
  return looksLikeHtml ? sanitizeRichText(stored) : plainToRichText(stored);
}

/** True when a description has no readable content — the check the API
 *  routes run *after* sanitizing, so a submission of `<p><script>…</script></p>`
 *  is rejected as empty rather than stored as an empty paragraph. */
export function isRichTextEmpty(html: string): boolean {
  return richTextToPlain(html).length === 0;
}
