# Markdown Preview

A free, public markdown **viewer**. Drop a `.md` file and read it rendered — GitHub-faithful, with syntax highlighting, diagrams, and math.

Nothing is uploaded. There is no backend, no database, and no storage. The file is read and rendered in your browser, and a reload clears it.

## Why it can make that claim

The privacy story is architectural, not a promise in a footer:

- **No server takes the file.** `FileReader` reads it locally; the rendered output never leaves the page.
- **`connect-src 'self'`** in the Content-Security-Policy means the browser will not let this page open a network connection to any host but its own origin. Enforced by the browser, not by us.
- **It works offline.** Load the page, disconnect, drop a file — it still renders. That is the whole proof.
- **Remote images are blocked until you ask.** A document's external images (badges, hotlinked screenshots) would tell those hosts your IP. They get no `src` until you opt in.
- **No cookies, no accounts.** Only the theme preference touches browser storage.

The one disclosure: the site is hosted on Vercel, so Vercel's edge sees ordinary request metadata, and cookieless same-origin Vercel Web Analytics and Speed Insights count pageviews and page-load timings. None of them sees document content. `/privacy` spells this out.

## Features

| | |
|---|---|
| Input | Drag-and-drop, click-to-browse, paste raw markdown |
| Rendering | GFM (tables, task lists, footnotes, strikethrough), Mermaid diagrams, KaTeX math, YAML frontmatter |
| Highlighting | Shiki 4 with the JS RegExp engine — no WASM, languages loaded on demand |
| HTML in markdown | Allowed and sanitized: `<details>`, `<kbd>`, `<sub>`, badges. Scripts, handlers, and `javascript:` URLs stripped |
| Reading | Preview / Raw toggle, TOC sidebar with scroll-spy, heading anchors, light / dark / system |
| Limits | `.md` only, 2 MB, one document at a time |

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · react-markdown / unified

## Development

```bash
pnpm install
pnpm dev
```

`fixtures/torture-test.md` exercises every supported feature plus the hostile-HTML cases — drop it in to check a change end to end.

```bash
pnpm build      # production build
pnpm lint
```

## Architecture

```
app/
  layout.tsx            theme provider, footer, analytics + speed insights
  page.tsx              mounts the viewer
  privacy/page.tsx      the privacy page, rendering the live CSP
  globals.css           Tailwind v4 tokens, light/dark
  markdown.css          GitHub-faithful .markdown-body styles
components/
  viewer.tsx            composition root — all app state lives here
  dropzone.tsx          empty state, drag/drop/paste/picker
  viewer-header.tsx     file name, Preview|Raw, theme, close
  markdown-renderer.tsx the unified pipeline
  remote-image-gate.tsx image blocking + opt-in bar
  mermaid-block.tsx     lazily loaded diagrams
  toc-sidebar.tsx       scroll-spy contents
lib/
  csp.ts                the policy, shared by next.config and /privacy
  markdown/             frontmatter, sanitize schema, Shiki, mermaid plugin
```

Plugin order in the pipeline is load-bearing: `rehype-raw` → `rehype-sanitize` → slug/autolink → KaTeX → mermaid placeholder → Shiki. Sanitizing **before** Shiki and KaTeX is what keeps their generated markup from being stripped; KaTeX and the mermaid placeholder run **before** Shiki so it cannot claim their `<pre>` blocks first.

## Deployment

Vercel. The analytics integrations assume it; drop `@vercel/analytics` and `@vercel/speed-insights` from `app/layout.tsx` and it will run on any static host.

## Not included

Editing, multiple files or tabs, folder drop, loading from a URL, persistence, PDF export, `.mdx`/`.txt`.
