"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Baseline,
  Highlighter,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  RemoveFormatting,
  Strikethrough,
  Underline,
  Unlink,
} from "lucide-react";
import { MAX_RICH_TEXT_LENGTH, richTextToPlain, sanitizeRichText } from "@/lib/richText";

/**
 * The description editor: a formatting toolbar over a `contentEditable`
 * surface.
 *
 * Why `document.execCommand` when it is marked deprecated — the honest
 * answer is that nothing has replaced it. The proposed successor
 * (`Document.execCommand`'s replacement in the Editing API) was never
 * shipped, every browser still implements these commands, and every
 * editor library that isn't ProseMirror-sized is still built on them. The
 * alternative here was adding a real editor framework to a project whose
 * entire dependency list is eleven packages. If a browser ever drops
 * these, this file is the only thing that breaks, and the stored markup —
 * which is plain sanitized HTML, not a proprietary document model — is
 * still readable by whatever replaces it.
 *
 * What this component deliberately does *not* do is sanitize on every
 * keystroke. Rewriting `innerHTML` under a live caret moves it to the end
 * of the field, so the sanitizer runs at the three moments where that
 * cannot happen: on paste, on submit (ProductForm), and on the server —
 * where the only one that matters for security lives.
 */

/**
 * The palette offered for text colour and highlight.
 *
 * These are the storefront's own tokens rather than a generic colour
 * wheel, because a description is rendered on Paper (#fff8f0) next to
 * everything else the palette governs — an arbitrary colour picker mostly
 * produces text that clashes with the page or fails contrast against it.
 * The greys and the red are all AA on Paper; the fills carry Ink.
 */
const TEXT_COLORS: { label: string; value: string }[] = [
  { label: "Default", value: "#1c1512" },
  { label: "Muted", value: "#7a6153" },
  { label: "Sale red", value: "#c4241a" },
  { label: "Deep red", value: "#a81c13" },
  { label: "Forest", value: "#1f6b45" },
  { label: "Navy", value: "#1e3a5f" },
];

const HIGHLIGHT_COLORS: { label: string; value: string }[] = [
  { label: "Beacon", value: "#ffc72c" },
  { label: "Soft sand", value: "#f5e6d3" },
  { label: "Mint", value: "#d7f0e2" },
  { label: "Sky", value: "#d9e8f7" },
  { label: "Blush", value: "#fbdcd9" },
];

type Block = "p" | "h2" | "h3";

const BLOCK_LABELS: { value: Block; label: string }[] = [
  { value: "p", label: "Normal text" },
  { value: "h2", label: "Heading" },
  { value: "h3", label: "Subheading" },
];

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  /** Rendered under the field, e.g. a validation message. */
  hint?: ReactNode;
}

interface ToolbarState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikeThrough: boolean;
  insertUnorderedList: boolean;
  insertOrderedList: boolean;
  justifyCenter: boolean;
  justifyRight: boolean;
  block: Block;
  inLink: boolean;
}

const EMPTY_STATE: ToolbarState = {
  bold: false,
  italic: false,
  underline: false,
  strikeThrough: false,
  insertUnorderedList: false,
  insertOrderedList: false,
  justifyCenter: false,
  justifyRight: false,
  block: "p",
  inLink: false,
};

export default function RichTextEditor({
  value,
  onChange,
  placeholder,
  hint,
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<ToolbarState>(EMPTY_STATE);
  const [openMenu, setOpenMenu] = useState<"text" | "highlight" | "link" | null>(null);
  const [linkDraft, setLinkDraft] = useState("");
  const linkInputRef = useRef<HTMLInputElement>(null);
  /** The selection at the moment the link popover opened. Clicking into an
   *  input collapses the editor's selection, so the range has to be saved
   *  before focus moves and restored before the command runs. */
  const savedRange = useRef<Range | null>(null);
  const editorId = useId();

  /**
   * Push the incoming value into the DOM only when it genuinely differs.
   *
   * A `contentEditable` is uncontrolled by nature: React does not own its
   * children once the user starts typing. Writing `innerHTML` on every
   * render would reset the caret to the start of the field on every
   * keystroke, so this compares first and stays out of the way otherwise.
   * That makes the effect a one-way door for external changes — loading an
   * existing product — which is exactly what it is for.
   */
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (editor.innerHTML !== value) {
      editor.innerHTML = value || "";
    }
  }, [value]);

  useEffect(() => {
    // `styleWithCSS` makes colour commands emit `<span style="color:…">`
    // instead of `<font color>`. The sanitizer understands both, but the
    // span is what everything else in the pipeline expects, and asking for
    // it here means the stored markup does not vary by browser.
    try {
      document.execCommand("styleWithCSS", false, "true");
      document.execCommand("defaultParagraphSeparator", false, "p");
    } catch {
      // Both are best-effort. Safari has historically thrown on the
      // second; the sanitizer normalises the difference either way.
    }
  }, []);

  const readToolbarState = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const selection = window.getSelection();
    if (!selection || !selection.anchorNode || !editor.contains(selection.anchorNode)) {
      return;
    }

    const query = (command: string) => {
      try {
        return document.queryCommandState(command);
      } catch {
        return false;
      }
    };

    let block: Block = "p";
    try {
      const formatted = document.queryCommandValue("formatBlock").toLowerCase();
      if (formatted === "h2" || formatted === "h3") block = formatted;
    } catch {
      // Left as "p" — the dropdown showing the wrong label is cosmetic.
    }

    let node: Node | null = selection.anchorNode;
    let inLink = false;
    while (node && node !== editor) {
      if (node.nodeName === "A") {
        inLink = true;
        break;
      }
      node = node.parentNode;
    }

    setState({
      bold: query("bold"),
      italic: query("italic"),
      underline: query("underline"),
      strikeThrough: query("strikeThrough"),
      insertUnorderedList: query("insertUnorderedList"),
      insertOrderedList: query("insertOrderedList"),
      justifyCenter: query("justifyCenter"),
      justifyRight: query("justifyRight"),
      block,
      inLink,
    });
  }, []);

  useEffect(() => {
    document.addEventListener("selectionchange", readToolbarState);
    return () => document.removeEventListener("selectionchange", readToolbarState);
  }, [readToolbarState]);

  const emitChange = useCallback(() => {
    const editor = editorRef.current;
    if (editor) onChange(editor.innerHTML);
  }, [onChange]);

  /** Run a command against the editor, keeping focus and reporting the
   *  result upward. Every toolbar button goes through here. */
  const run = useCallback(
    (command: string, argument?: string) => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.focus();
      try {
        document.execCommand(command, false, argument);
      } catch {
        return;
      }
      emitChange();
      readToolbarState();
    },
    [emitChange, readToolbarState],
  );

  const setBlock = useCallback(
    (block: Block) => {
      // Chrome wants the angle brackets, Firefox tolerates them; without
      // them Chrome silently does nothing.
      run("formatBlock", `<${block}>`);
    },
    [run],
  );

  /**
   * Paste, reduced to the formatting we store.
   *
   * This is the one place the sanitizer runs while typing, and it is worth
   * it: pasting from Word or a webpage otherwise drops kilobytes of
   * inline styles, class names and font stacks into the field, which then
   * all vanish on save and leave the admin wondering why the preview
   * doesn't match what they pasted. Cleaning it at the door means what
   * they see is what gets stored.
   */
  const handlePaste = useCallback(
    (event: React.ClipboardEvent<HTMLDivElement>) => {
      event.preventDefault();
      const html = event.clipboardData.getData("text/html");
      const text = event.clipboardData.getData("text/plain");

      let markup: string;
      if (html) {
        markup = sanitizeRichText(html);
      } else {
        // Plain text: keep the line structure the user copied.
        markup = text
          .split(/\n\s*\n/)
          .map((paragraph) =>
            paragraph
              .split("\n")
              .map((line) =>
                line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
              )
              .join("<br>"),
          )
          .filter(Boolean)
          .map((paragraph) => `<p>${paragraph}</p>`)
          .join("");
      }
      if (!markup) return;
      run("insertHTML", markup);
    },
    [run],
  );

  const openLinkEditor = useCallback(() => {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      savedRange.current = selection.getRangeAt(0).cloneRange();
    }
    setLinkDraft("");
    setOpenMenu("link");
    // The input mounts in the same commit; focus lands on the next frame.
    requestAnimationFrame(() => linkInputRef.current?.focus());
  }, []);

  const applyLink = useCallback(() => {
    const url = linkDraft.trim();
    setOpenMenu(null);
    if (!url) return;

    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const selection = window.getSelection();
    if (savedRange.current && selection) {
      selection.removeAllRanges();
      selection.addRange(savedRange.current);
    }
    // If nothing was selected, the URL becomes its own link text —
    // `createLink` on a collapsed selection is a no-op otherwise, which
    // reads as the button being broken.
    if (selection?.isCollapsed) {
      run("insertHTML", `<a href="${url.replace(/"/g, "&quot;")}">${url}</a>`);
    } else {
      run("createLink", url);
    }
    setLinkDraft("");
  }, [linkDraft, run]);

  const plainLength = richTextToPlain(value).length;
  const overLimit = value.length > MAX_RICH_TEXT_LENGTH;
  const isEmpty = plainLength === 0;

  return (
    <div className="space-y-2">
      <div
        className={`rounded-xl border bg-white overflow-hidden ${
          overLimit ? "border-red-400" : "border-border"
        }`}
      >
        {/* Toolbar. Sticky so it stays reachable once the field is scrolled —
            the whole point of the taller surface is long descriptions. */}
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-0.5 border-b border-border bg-zinc-50/95 backdrop-blur px-1.5 py-1.5">
          <select
            aria-label="Paragraph style"
            value={state.block}
            onChange={(e) => setBlock(e.target.value as Block)}
            className="h-8 rounded-lg border border-border bg-white px-2 text-sm text-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-900"
          >
            {BLOCK_LABELS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <Divider />

          <ToolButton
            label="Bold"
            shortcut="Ctrl+B"
            active={state.bold}
            onClick={() => run("bold")}
          >
            <Bold className="w-4 h-4" />
          </ToolButton>
          <ToolButton
            label="Italic"
            shortcut="Ctrl+I"
            active={state.italic}
            onClick={() => run("italic")}
          >
            <Italic className="w-4 h-4" />
          </ToolButton>
          <ToolButton
            label="Underline"
            shortcut="Ctrl+U"
            active={state.underline}
            onClick={() => run("underline")}
          >
            <Underline className="w-4 h-4" />
          </ToolButton>
          <ToolButton
            label="Strikethrough"
            active={state.strikeThrough}
            onClick={() => run("strikeThrough")}
          >
            <Strikethrough className="w-4 h-4" />
          </ToolButton>

          <Divider />

          <ToolButton
            label="Bulleted list"
            active={state.insertUnorderedList}
            onClick={() => run("insertUnorderedList")}
          >
            <List className="w-4 h-4" />
          </ToolButton>
          <ToolButton
            label="Numbered list"
            active={state.insertOrderedList}
            onClick={() => run("insertOrderedList")}
          >
            <ListOrdered className="w-4 h-4" />
          </ToolButton>

          <Divider />

          <ToolButton
            label="Align left"
            active={!state.justifyCenter && !state.justifyRight}
            onClick={() => run("justifyLeft")}
          >
            <AlignLeft className="w-4 h-4" />
          </ToolButton>
          <ToolButton
            label="Align centre"
            active={state.justifyCenter}
            onClick={() => run("justifyCenter")}
          >
            <AlignCenter className="w-4 h-4" />
          </ToolButton>
          <ToolButton
            label="Align right"
            active={state.justifyRight}
            onClick={() => run("justifyRight")}
          >
            <AlignRight className="w-4 h-4" />
          </ToolButton>

          <Divider />

          <div className="relative">
            <ToolButton
              label="Text colour"
              active={openMenu === "text"}
              onClick={() => setOpenMenu(openMenu === "text" ? null : "text")}
            >
              <Baseline className="w-4 h-4" />
            </ToolButton>
            {openMenu === "text" && (
              <Swatches
                colors={TEXT_COLORS}
                onPick={(color) => {
                  run("foreColor", color);
                  setOpenMenu(null);
                }}
                onDismiss={() => setOpenMenu(null)}
              />
            )}
          </div>

          <div className="relative">
            <ToolButton
              label="Highlight"
              active={openMenu === "highlight"}
              onClick={() => setOpenMenu(openMenu === "highlight" ? null : "highlight")}
            >
              <Highlighter className="w-4 h-4" />
            </ToolButton>
            {openMenu === "highlight" && (
              <Swatches
                colors={HIGHLIGHT_COLORS}
                onPick={(color) => {
                  // `hiliteColor` is the standard name; Chrome historically
                  // only honoured `backColor`. Trying both costs nothing and
                  // the second is a no-op where the first worked.
                  run("hiliteColor", color);
                  run("backColor", color);
                  setOpenMenu(null);
                }}
                onDismiss={() => setOpenMenu(null)}
              />
            )}
          </div>

          <Divider />

          <div className="relative">
            <ToolButton label="Insert link" active={openMenu === "link"} onClick={openLinkEditor}>
              <LinkIcon className="w-4 h-4" />
            </ToolButton>
            {openMenu === "link" && (
              <div className="absolute left-0 top-full mt-1 z-20 flex items-center gap-1 rounded-xl border border-border bg-white p-1.5 shadow-lg">
                <input
                  ref={linkInputRef}
                  value={linkDraft}
                  onChange={(e) => setLinkDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      applyLink();
                    }
                    if (e.key === "Escape") setOpenMenu(null);
                  }}
                  placeholder="https://example.com"
                  className="w-56 rounded-lg border border-border px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
                />
                <button
                  type="button"
                  onClick={applyLink}
                  className="rounded-lg bg-zinc-900 px-2.5 py-1 text-sm font-medium text-white hover:bg-zinc-700"
                >
                  Add
                </button>
              </div>
            )}
          </div>

          <ToolButton
            label="Remove link"
            disabled={!state.inLink}
            onClick={() => run("unlink")}
          >
            <Unlink className="w-4 h-4" />
          </ToolButton>

          <Divider />

          <ToolButton
            label="Clear formatting"
            onClick={() => {
              run("removeFormat");
              setBlock("p");
            }}
          >
            <RemoveFormatting className="w-4 h-4" />
          </ToolButton>
        </div>

        {/* The surface. `resize-y` needs a non-visible overflow to work, which
            the scroll container already provides. */}
        <div className="relative">
          {isEmpty && placeholder && (
            <p className="pointer-events-none absolute left-4 top-3 text-zinc-400">
              {placeholder}
            </p>
          )}
          <div
            id={editorId}
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            aria-label="Description"
            onInput={emitChange}
            onBlur={emitChange}
            onPaste={handlePaste}
            onKeyUp={readToolbarState}
            onMouseUp={readToolbarState}
            className="rich-text min-h-[320px] max-h-[70vh] resize-y overflow-y-auto px-4 py-3 text-zinc-900 focus:outline-none"
          />
        </div>
      </div>

      <div className="flex items-start justify-between gap-4 text-xs">
        <div className="text-zinc-500">
          {hint ?? "Select text to format it. Paste from Word or a webpage keeps bold, lists and links."}
        </div>
        <div className={overLimit ? "text-red-600 font-medium" : "text-zinc-400"}>
          {plainLength.toLocaleString()} characters
          {overLimit && " — too long, trim it before saving"}
        </div>
      </div>
    </div>
  );
}

function Divider() {
  return <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />;
}

function ToolButton({
  label,
  shortcut,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      // `onMouseDown` rather than `onClick` for the preventDefault: the
      // browser clears the editor's selection the instant focus leaves it,
      // so by click time there would be nothing left to format.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-label={label}
      aria-pressed={active}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
        disabled
          ? "text-zinc-300 cursor-not-allowed"
          : active
            ? "bg-zinc-900 text-white"
            : "text-zinc-600 hover:bg-zinc-200"
      }`}
    >
      {children}
    </button>
  );
}

function Swatches({
  colors,
  onPick,
  onDismiss,
}: {
  colors: { label: string; value: string }[];
  onPick: (value: string) => void;
  onDismiss: () => void;
}) {
  return (
    <>
      {/* Click-away. A transparent full-screen layer is cheaper and more
          reliable than a document listener that has to ignore its own
          opening click. */}
      <button
        type="button"
        aria-label="Close colour picker"
        className="fixed inset-0 z-10 cursor-default"
        onClick={onDismiss}
      />
      <div className="absolute left-0 top-full mt-1 z-20 flex gap-1 rounded-xl border border-border bg-white p-1.5 shadow-lg">
        {colors.map((color) => (
          <button
            key={color.value}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(color.value)}
            title={color.label}
            aria-label={color.label}
            className="h-6 w-6 rounded-md border border-black/10 transition-transform hover:scale-110"
            style={{ backgroundColor: color.value }}
          />
        ))}
      </div>
    </>
  );
}
