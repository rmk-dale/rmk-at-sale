/**
 * Checks for the description sanitizer.
 *
 * Run with `npm run check:richtext`. Like the other check:* scripts this
 * needs no database and no server — lib/richText.ts is deliberately free of
 * both, so its entire behaviour is testable as pure functions.
 *
 * The cases below are grouped by what they defend. The XSS group is the
 * reason this file exists: the description is the only field in the app
 * whose contents reach a shopper's browser as markup rather than as text,
 * so every assertion in that group is the difference between a formatted
 * paragraph and a stored cross-site-scripting payload.
 */
import {
  isRichTextEmpty,
  plainToRichText,
  richTextToPlain,
  sanitizeRichText,
  toRichText,
} from "../lib/richText.ts";

let failures = 0;
let checks = 0;

function expect(label: string, actual: string, expected: string) {
  checks += 1;
  if (actual !== expected) {
    failures += 1;
    console.error(`✗ ${label}`);
    console.error(`    expected: ${expected}`);
    console.error(`    actual:   ${actual}`);
  }
}

function expectNotToContain(label: string, actual: string, forbidden: string) {
  checks += 1;
  if (actual.toLowerCase().includes(forbidden.toLowerCase())) {
    failures += 1;
    console.error(`✗ ${label}`);
    console.error(`    must not contain: ${forbidden}`);
    console.error(`    actual:           ${actual}`);
  }
}

function expectTrue(label: string, actual: boolean) {
  checks += 1;
  if (!actual) {
    failures += 1;
    console.error(`✗ ${label}`);
  }
}

// ---------------------------------------------------------------------------
// The formatting the toolbar produces has to survive intact. If this group
// fails, an admin's saved layout silently degrades on the storefront.
// ---------------------------------------------------------------------------

expect(
  "bold, italic, underline and strikethrough survive",
  sanitizeRichText(
    "<p><strong>Cabin</strong> <em>size</em> <u>carry-on</u> <s>large</s></p>",
  ),
  "<p><strong>Cabin</strong> <em>size</em> <u>carry-on</u> <s>large</s></p>",
);

expect(
  "bulleted lists survive",
  sanitizeRichText("<ul><li>Four wheels</li><li>TSA lock</li></ul>"),
  "<ul><li>Four wheels</li><li>TSA lock</li></ul>",
);

expect(
  "numbered lists survive",
  sanitizeRichText("<ol><li>Unzip</li><li>Pack</li></ol>"),
  "<ol><li>Unzip</li><li>Pack</li></ol>",
);

expect(
  "headings survive",
  sanitizeRichText("<h2>Materials</h2><h3>Shell</h3>"),
  "<h2>Materials</h2><h3>Shell</h3>",
);

expect(
  "alignment survives on blocks",
  sanitizeRichText('<p style="text-align: center">Centred</p>'),
  '<p style="text-align:center">Centred</p>',
);

expect(
  "text colour survives and is normalised to hex",
  sanitizeRichText('<p><span style="color: rgb(196, 36, 26)">Sale</span></p>'),
  '<p><span style="color:#c4241a">Sale</span></p>',
);

expect(
  "highlight survives",
  sanitizeRichText('<p><span style="background-color:#FFC72C">Deal</span></p>'),
  '<p><span style="background-color:#ffc72c">Deal</span></p>',
);

expect(
  "external links keep the href and gain the safety rel",
  sanitizeRichText('<p><a href="https://example.com/care">Care guide</a></p>'),
  '<p><a href="https://example.com/care" target="_blank" rel="noopener noreferrer nofollow">Care guide</a></p>',
);

expect(
  "internal links stay in the same tab",
  sanitizeRichText('<p><a href="/shipping">Shipping</a></p>'),
  '<p><a href="/shipping">Shipping</a></p>',
);

expect(
  "line breaks survive",
  sanitizeRichText("<p>55cm<br>67cm</p>"),
  "<p>55cm<br>67cm</p>",
);

// ---------------------------------------------------------------------------
// Cross-site scripting. Each case is a payload that a stricter-looking but
// naive filter (regex-stripping <script>, blocklisting "javascript:") lets
// through.
// ---------------------------------------------------------------------------

expect(
  "script tags are removed with their contents",
  sanitizeRichText("<p>Before</p><script>alert(1)</script><p>After</p>"),
  "<p>Before</p><p>After</p>",
);

expectNotToContain(
  "an unclosed script swallows the rest rather than leaking",
  sanitizeRichText("<p>Safe</p><script>alert(1)"),
  "alert",
);

expectNotToContain(
  "event handlers are dropped",
  sanitizeRichText('<p onclick="steal()">Text</p>'),
  "onclick",
);

expectNotToContain(
  "onerror on a smuggled image is dropped with the image",
  sanitizeRichText('<p><img src="x" onerror="alert(1)"></p>'),
  "onerror",
);

expectNotToContain(
  "javascript: hrefs are rejected",
  sanitizeRichText('<a href="javascript:alert(1)">Click</a>'),
  "javascript",
);

expectNotToContain(
  "javascript: hrefs hidden behind control characters are rejected",
  sanitizeRichText('<a href="java	script:alert(1)">Click</a>'),
  "javascript",
);

expectNotToContain(
  "javascript: hrefs hidden behind entities are rejected",
  sanitizeRichText('<a href="&#106;avascript:alert(1)">Click</a>'),
  "javascript",
);

expectNotToContain(
  "data: URLs are rejected",
  sanitizeRichText('<a href="data:text/html,<script>alert(1)</script>">Click</a>'),
  "data:",
);

expectNotToContain(
  "protocol-relative hrefs are rejected",
  sanitizeRichText('<a href="//evil.example/steal">Click</a>'),
  "evil.example",
);

expectNotToContain(
  "entity-encoded tags cannot re-form into live markup",
  sanitizeRichText("<p>&#60;script&#62;alert(1)&#60;/script&#62;</p>"),
  "<script",
);

expectNotToContain(
  "iframes are removed with their contents",
  sanitizeRichText('<iframe src="https://evil.example"></iframe>'),
  "iframe",
);

expectNotToContain(
  "style blocks are removed with their contents",
  sanitizeRichText("<style>body{display:none}</style><p>Text</p>"),
  "display",
);

expectNotToContain(
  "url() in a style declaration is rejected",
  sanitizeRichText('<p><span style="background-color:url(javascript:alert(1))">x</span></p>'),
  "url(",
);

expectNotToContain(
  "arbitrary css properties are dropped, not just dangerous ones",
  sanitizeRichText('<p style="position:fixed;top:0;left:0;width:100vw">Overlay</p>'),
  "position",
);

expectNotToContain(
  "conditional comments cannot smuggle markup",
  sanitizeRichText("<!--[if IE]><script>alert(1)</script><![endif]--><p>Text</p>"),
  "alert",
);

expectNotToContain(
  "form controls are dropped",
  sanitizeRichText('<form action="https://evil.example"><input name="card"></form>'),
  "input",
);

expect(
  "a link with an unusable href keeps its text",
  sanitizeRichText('<p><a href="javascript:alert(1)">Care guide</a></p>'),
  "<p>Care guide</p>",
);

// ---------------------------------------------------------------------------
// Structure. Pasted and hand-edited markup is rarely well-formed, and the
// output still has to be renderable HTML.
// ---------------------------------------------------------------------------

expect(
  "loose text is wrapped in a paragraph",
  sanitizeRichText("Just some text"),
  "<p>Just some text</p>",
);

expect(
  "unclosed tags are closed",
  sanitizeRichText("<p><strong>Bold forever"),
  "<p><strong>Bold forever</strong></p>",
);

expect(
  "inline formatting cannot leak across a paragraph boundary",
  sanitizeRichText("<p><strong>Bold</p><p>Normal</p>"),
  "<p><strong>Bold</strong></p><p>Normal</p>",
);

expect(
  "stray closing tags are ignored",
  sanitizeRichText("<p>Text</strong></em></p>"),
  "<p>Text</p>",
);

expect(
  "an orphan list item is given a list",
  sanitizeRichText("<li>Alone</li>"),
  "<ul><li>Alone</li></ul>",
);

expect(
  "divs collapse to paragraphs without nesting",
  sanitizeRichText("<div><div>Nested</div></div>"),
  "<p>Nested</p>",
);

expect(
  "h1 is demoted so it cannot outrank the product title",
  sanitizeRichText("<h1>Overview</h1>"),
  "<h2>Overview</h2>",
);

expect(
  "legacy b and i are modernised",
  sanitizeRichText("<p><b>Bold</b> <i>Italic</i></p>"),
  "<p><strong>Bold</strong> <em>Italic</em></p>",
);

expect(
  "font colour becomes an inline style",
  sanitizeRichText('<p><font color="#C4241A">Red</font></p>'),
  '<p><span style="color:#c4241a">Red</span></p>',
);

expect(
  "blocks left empty by stripping are removed",
  sanitizeRichText("<p><img src=x></p><p>Real</p>"),
  "<p>Real</p>",
);

expect("empty input stays empty", sanitizeRichText(""), "");
expect("non-string input is tolerated", sanitizeRichText(null), "");
expect("whitespace-only markup collapses away", sanitizeRichText("<p>   </p>"), "");

checks += 1;
if (sanitizeRichText("x".repeat(50_000)).length > 20_100) {
  failures += 1;
  console.error("✗ oversized input is not capped");
}

// ---------------------------------------------------------------------------
// Idempotence. `toPublicProduct` sanitizes on read as well as on write, so
// output that changes on a second pass would corrupt every description a
// little more each time the cache refills.
// ---------------------------------------------------------------------------

const roundTripCases = [
  "<p>Ampersands &amp; entities &lt;stay&gt; put</p>",
  '<p style="text-align:right"><span style="color:#c4241a">Coloured</span></p>',
  '<p><a href="https://example.com">Link</a></p>',
  "<ul><li>One</li><li>Two</li></ul>",
  "Plain text with an & ampersand",
  "<p>Quote \" and apostrophe ' characters</p>",
];

for (const input of roundTripCases) {
  const once = sanitizeRichText(input);
  const twice = sanitizeRichText(once);
  expect(`sanitizing is idempotent: ${input.slice(0, 40)}`, twice, once);
}

// ---------------------------------------------------------------------------
// Plain-text derivation — the meta description, and the label fallback for
// products saved before `name` existed.
// ---------------------------------------------------------------------------

expect(
  "block boundaries become spaces, not nothing",
  richTextToPlain("<p>Cabin size.</p><p>Fits overhead.</p>"),
  "Cabin size. Fits overhead.",
);

expect(
  "list items are readable as plain text",
  richTextToPlain("<ul><li>Four wheels</li><li>TSA lock</li></ul>"),
  "Four wheels TSA lock",
);

expect(
  "entities are decoded for the meta description",
  richTextToPlain("<p>Hard-shell &amp; lightweight</p>"),
  "Hard-shell & lightweight",
);

expect("plain text passes through unchanged", richTextToPlain("Just text"), "Just text");

// ---------------------------------------------------------------------------
// The legacy path. Every product saved before this feature holds plain
// text, and it has to render — and stay escaped — without a migration.
// ---------------------------------------------------------------------------

expect(
  "a legacy plain description becomes a paragraph",
  toRichText("AIRCONIC SPINNER 55/20 TSA SPORTY BLUE"),
  "<p>AIRCONIC SPINNER 55/20 TSA SPORTY BLUE</p>",
);

expect(
  "blank lines in legacy text become separate paragraphs",
  plainToRichText("First para.\n\nSecond para."),
  "<p>First para.</p><p>Second para.</p>",
);

expect(
  "single newlines in legacy text become line breaks",
  plainToRichText("Line one\nLine two"),
  "<p>Line one<br>Line two</p>",
);

expect(
  "a stray angle bracket in legacy text is escaped, not rendered",
  toRichText("Fits 55 < 60cm overhead"),
  "<p>Fits 55 &lt; 60cm overhead</p>",
);

expect(
  "markup already stored is recognised and sanitized rather than escaped",
  toRichText("<p>Already <strong>rich</strong></p>"),
  "<p>Already <strong>rich</strong></p>",
);

expectTrue("a description of only stripped markup counts as empty", isRichTextEmpty(sanitizeRichText("<script>alert(1)</script>")));
expectTrue("a real description does not count as empty", !isRichTextEmpty("<p>Text</p>"));

// ---------------------------------------------------------------------------

if (failures > 0) {
  console.error(`\n${failures} of ${checks} checks failed.`);
  process.exit(1);
}

console.log(`All ${checks} rich-text checks passed.`);
