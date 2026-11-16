import React from "react";

/**
 * Renderer markdown minimal untuk jawaban AI.
 *
 * Sengaja TIDAK memakai dangerouslySetInnerHTML: seluruh teks dirender sebagai
 * node React, sehingga HTML/script apa pun dari jawaban AI tidak pernah
 * dieksekusi. Hanya bold, code inline, heading, dan daftar yang didukung.
 */

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;

  let lastIndex = 0;
  let match = pattern.exec(text);
  let i = 0;

  while (match !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    if (token.startsWith("**")) {
      nodes.push(
        <strong key={`${keyPrefix}-b${i}`} className="font-semibold text-main">
          {token.slice(2, -2)}
        </strong>
      );
    } else {
      nodes.push(
        <code
          key={`${keyPrefix}-c${i}`}
          className="px-1.5 py-0.5 rounded bg-base border border-border text-[0.85em] font-mono break-all inline-block"
        >
          {token.slice(1, -1)}
        </code>
      );
    }

    lastIndex = match.index + token.length;
    i += 1;
    match = pattern.exec(text);
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

export default function MarkdownMessage({ content }: { content: string }) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];

  let paragraph: string[] = [];
  let list: { type: "ul" | "ol"; items: string[] } | null = null;

  const flushParagraph = (key: string) => {
    if (paragraph.length === 0) return;
    blocks.push(
      <p key={key} className="whitespace-pre-wrap break-words">
        {renderInline(paragraph.join("\n"), key)}
      </p>
    );
    paragraph = [];
  };

  const flushList = (key: string) => {
    if (!list) return;
    const items = list.items.map((item, i) => (
      <li key={`${key}-li${i}`} className="break-words">
        {renderInline(item, `${key}-${i}`)}
      </li>
    ));
    const Tag = list.type === "ol" ? "ol" : "ul";
    blocks.push(
      <Tag
        key={key}
        className={`pl-5 space-y-1.5 ${list.type === "ol" ? "list-decimal" : "list-disc"}`}
      >
        {items}
      </Tag>
    );
    list = null;
  };

  lines.forEach((rawLine, index) => {
    const line = rawLine.trimEnd();
    const key = `l${index}`;

    if (line.trim() === "") {
      flushParagraph(`${key}-p`);
      flushList(`${key}-ul`);
      return;
    }

    const heading = line.match(/^#{1,4}\s+(.*)$/);
    if (heading) {
      flushParagraph(`${key}-p`);
      flushList(`${key}-ul`);
      blocks.push(
        <p key={key} className="font-semibold text-main pt-1 break-words">
          {renderInline(heading[1], key)}
        </p>
      );
      return;
    }

    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const numbered = line.match(/^\s*(\d+)[.)]\s+(.*)$/);

    if (bullet || numbered) {
      flushParagraph(`${key}-p`);
      const type: "ul" | "ol" = bullet ? "ul" : "ol";
      const item = bullet ? bullet[1] : numbered![2];
      if (list && list.type !== type) {
        flushList(`${key}-ul`);
      }
      if (!list) list = { type, items: [] };
      list.items.push(item);
      return;
    }

    flushList(`${key}-ul`);
    paragraph.push(line);
  });

  flushParagraph("tail-p");
  flushList("tail-ul");

  return <div className="space-y-2 leading-relaxed break-words text-sm text-main">{blocks}</div>;
}
