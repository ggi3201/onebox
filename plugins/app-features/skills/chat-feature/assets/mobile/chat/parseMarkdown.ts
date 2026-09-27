/**
 * Markdown, lexed by `marked` and adapted into a small union this app renders.
 *
 * Parsing is `marked`'s job: tested, maintained, and no dependencies. A
 * hand-rolled parser produced two bugs in half an hour (a table-looking line
 * silently dropped; `a * b * c` emphasised the b). React Native markdown
 * packages bring their own styling, which looks pasted in next to your theme.
 *
 * RENDERING is ours (Markdown.tsx). The union is smaller than markdown on
 * purpose: the renderer needs a case for everything in it, and anything else
 * degrades to text. It loses styling, never words.
 *
 * This runs on every streamed delta, so it mostly sees a truncated document.
 * `marked` tolerates that; keep a test that parses every prefix of a real answer.
 *
 * Needs: npm i marked
 */
import { lexer, type Token, type Tokens } from 'marked';

export type Span =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'em'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string };

export type Block =
  | { kind: 'paragraph'; spans: Span[] }
  | { kind: 'heading'; level: 1 | 2 | 3; spans: Span[] }
  | { kind: 'bullets'; items: Span[][] }
  | { kind: 'ordered'; items: Span[][] }
  | { kind: 'table'; head: Span[][]; rows: Span[][][] }
  | { kind: 'code'; text: string }
  | { kind: 'rule' };

/** Inline tokens to FLAT spans. Nested markup keeps the outer style and every word. */
function spansOf(tokens: Token[] | undefined): Span[] {
  if (!tokens) return [];
  const spans: Span[] = [];
  for (const token of tokens) {
    switch (token.type) {
      case 'strong':
        spans.push({ kind: 'strong', text: flatten(token as Tokens.Strong) });
        break;
      case 'em':
        spans.push({ kind: 'em', text: flatten(token as Tokens.Em) });
        break;
      case 'codespan':
        spans.push({ kind: 'code', text: decode((token as Tokens.Codespan).text) });
        break;
      case 'link': {
        const link = token as Tokens.Link;
        spans.push({ kind: 'link', text: flatten(link) || link.href, href: link.href });
        break;
      }
      case 'br':
        spans.push({ kind: 'text', text: '\n' });
        break;
      default: {
        const t = token as { tokens?: Token[]; text?: string; raw?: string };
        if (t.tokens?.length) spans.push(...spansOf(t.tokens));
        else spans.push({ kind: 'text', text: soften(decode(t.text ?? t.raw ?? '')) });
      }
    }
  }
  return merge(spans);
}

function flatten(token: { tokens?: Token[]; text?: string }): string {
  if (!token.tokens?.length) return decode(token.text ?? '');
  return token.tokens.map((t) => flatten(t as { tokens?: Token[]; text?: string })).join('');
}

/** `marked` escapes for HTML; we render Text nodes. Otherwise `&` shows as `&amp;`. */
function decode(text: string): string {
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

/** A soft line break is a space. Models hard-wrap their prose; without this it arrives broken mid-line. */
function soften(text: string): string {
  return text.replace(/\s*\n\s*/g, ' ');
}

function merge(spans: Span[]): Span[] {
  return spans.reduce<Span[]>((acc, span) => {
    const prev = acc.at(-1);
    if (span.kind === 'text' && prev?.kind === 'text') { prev.text += span.text; return acc; }
    if (span.kind === 'text' && span.text.length === 0) return acc;
    acc.push(span);
    return acc;
  }, []);
}

export function parseMarkdown(source: string): Block[] {
  let tokens: Token[];
  try {
    tokens = lexer(source);
  } catch {
    // On the render path of every delta: plain text beats a blank message.
    return [{ kind: 'paragraph', spans: [{ kind: 'text', text: source }] }];
  }

  const blocks: Block[] = [];
  for (const token of tokens) {
    switch (token.type) {
      case 'heading': {
        const h = token as Tokens.Heading;
        blocks.push({ kind: 'heading', level: Math.min(h.depth, 3) as 1 | 2 | 3, spans: spansOf(h.tokens) });
        break;
      }
      case 'paragraph':
        blocks.push({ kind: 'paragraph', spans: spansOf((token as Tokens.Paragraph).tokens) });
        break;
      case 'list': {
        const list = token as Tokens.List;
        const items = list.items.map((item) => spansOf(item.tokens));
        blocks.push(list.ordered ? { kind: 'ordered', items } : { kind: 'bullets', items });
        break;
      }
      case 'table': {
        const t = token as Tokens.Table;
        blocks.push({ kind: 'table', head: t.header.map((c) => spansOf(c.tokens)), rows: t.rows.map((r) => r.map((c) => spansOf(c.tokens))) });
        break;
      }
      case 'code':
        blocks.push({ kind: 'code', text: (token as Tokens.Code).text });
        break;
      case 'hr':
        blocks.push({ kind: 'rule' });
        break;
      case 'space':
        break;
      case 'blockquote':
        blocks.push({ kind: 'paragraph', spans: spansOf((token as Tokens.Blockquote).tokens) });
        break;
      default: {
        const t = token as { text?: string; raw?: string };
        const text = (t.text ?? t.raw ?? '').trim();
        if (text) blocks.push({ kind: 'paragraph', spans: [{ kind: 'text', text: decode(text) }] });
      }
    }
  }
  return blocks;
}

/** Flat text, for accessibility labels. */
export function plainText(blocks: Block[]): string {
  const s = (spans: Span[]) => spans.map((x) => x.text).join('');
  return blocks
    .map((b) => {
      switch (b.kind) {
        case 'paragraph':
        case 'heading': return s(b.spans);
        case 'bullets':
        case 'ordered': return b.items.map(s).join('. ');
        case 'table': return [b.head, ...b.rows].map((r) => r.map(s).join(', ')).join('. ');
        case 'code': return b.text;
        case 'rule': return '';
      }
    })
    .filter(Boolean)
    .join('\n');
}
