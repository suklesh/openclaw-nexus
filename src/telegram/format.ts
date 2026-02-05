import type { MarkdownTableMode } from "../config/types.base.js";
import {
  chunkMarkdownIR,
  markdownToIR,
  type MarkdownLinkSpan,
  type MarkdownIR,
} from "../markdown/ir.js";
import { renderMarkdownWithMarkers } from "../markdown/render.js";

export type TelegramFormattedChunk = {
  html: string;
  text: string;
};

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeHtmlAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, "&quot;");
}

function buildTelegramLink(link: MarkdownLinkSpan, _text: string) {
  const href = link.href.trim();
  if (!href) {
    return null;
  }
  if (link.start === link.end) {
    return null;
  }
  const safeHref = escapeHtmlAttr(href);
  return {
    start: link.start,
    end: link.end,
    open: `<a href="${safeHref}">`,
    close: "</a>",
  };
}

function renderTelegramHtml(ir: MarkdownIR): string {
  return renderMarkdownWithMarkers(ir, {
    styleMarkers: {
      bold: { open: "<b>", close: "</b>" },
      italic: { open: "<i>", close: "</i>" },
      strikethrough: { open: "<s>", close: "</s>" },
      code: { open: "<code>", close: "</code>" },
      code_block: { open: "<pre><code>", close: "</code></pre>" },
    },
    escapeText: escapeHtml,
    buildLink: buildTelegramLink,
  });
}

export function markdownToTelegramHtml(
  markdown: string,
  options: { tableMode?: MarkdownTableMode } = {},
): string {
  const ir = markdownToIR(markdown ?? "", {
    linkify: true,
    headingStyle: "none",
    blockquotePrefix: "",
    tableMode: options.tableMode,
  });
  return renderTelegramHtml(ir);
}

export function renderTelegramHtmlText(
  text: string,
  options: { textMode?: "markdown" | "html"; tableMode?: MarkdownTableMode } = {},
): string {
  const textMode = options.textMode ?? "markdown";
  if (textMode === "html") {
    return text;
  }
  return markdownToTelegramHtml(text, { tableMode: options.tableMode });
}

function sanitizeTelegramPlainText(text: string): string {
  if (!text) {
    return text;
  }
  // Telegram plain-text fallback should not leak HTML-like wrapper tags that the model
  // might emit (e.g. <details>, <summary>, <p>, <br/>). These tags are not supported
  // by Telegram HTML mode anyway and look ugly when we fall back to plain text.
  return (
    text
      // Normalize common HTML line breaks.
      .replace(/<\s*br\s*\/?>/gi, "\n")
      // Treat paragraph boundaries as newlines.
      .replace(/<\s*\/\s*p\s*>/gi, "\n")
      .replace(/<\s*p\b[^>]*>/gi, "")
      // Remove collapsible wrappers.
      .replace(/<\s*\/\s*details\s*>/gi, "")
      .replace(/<\s*details\b[^>]*>/gi, "")
      .replace(/<\s*\/\s*summary\s*>/gi, "")
      .replace(/<\s*summary\b[^>]*>/gi, "")
      // If we reached plain-text fallback, strip any other HTML-ish tags that would
      // otherwise leak into the user-visible message (e.g. <span style="...">).
      .replace(/<[^>]+>/g, "")
      // Collapse excessive blank lines.
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

export function markdownToTelegramChunks(
  markdown: string,
  limit: number,
  options: { tableMode?: MarkdownTableMode } = {},
): TelegramFormattedChunk[] {
  const ir = markdownToIR(markdown ?? "", {
    linkify: true,
    headingStyle: "none",
    blockquotePrefix: "",
    tableMode: options.tableMode,
  });
  const chunks = chunkMarkdownIR(ir, limit);
  return chunks.map((chunk) => ({
    html: renderTelegramHtml(chunk),
    text: sanitizeTelegramPlainText(chunk.text),
  }));
}

export function markdownToTelegramHtmlChunks(markdown: string, limit: number): string[] {
  return markdownToTelegramChunks(markdown, limit).map((chunk) => chunk.html);
}
