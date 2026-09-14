import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { CSP_DIRECTIVES } from "@/lib/csp";
import { SITE_NAME } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Privacy",
  description: `How ${SITE_NAME} handles the documents you open: read in the browser, never uploaded, nothing stored. Includes the Content-Security-Policy your browser is enforcing.`,
};

/** Bumped by hand whenever a claim on this page changes. */
const LAST_UPDATED_ISO = "2026-09-14";
const LAST_UPDATED_LABEL = "14 September 2026";

/* --- Local typography primitives ------------------------------------------
 * There is no typography plugin in this project, and descendant-selector
 * variants (`[&_p]:…`) out-specify per-element classes, which makes one-off
 * overrides fight the base style. Plain components instead.
 * ------------------------------------------------------------------------ */

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-12">
      <h2 className="text-fg text-lg font-semibold tracking-tight">{title}</h2>
      <div className="mt-3 space-y-4">{children}</div>
    </section>
  );
}

function Subheading({ children }: { children: ReactNode }) {
  return <h3 className="text-fg pt-3 text-base font-semibold tracking-tight">{children}</h3>;
}

function P({ children }: { children: ReactNode }) {
  return <p className="text-fg-muted leading-7">{children}</p>;
}

function Bullets({ children }: { children: ReactNode }) {
  return (
    <ul className="marker:text-border text-fg-muted list-disc space-y-2 pl-5 leading-7">
      {children}
    </ul>
  );
}

/** Inline code. Used for API names, header values, and CSP syntax. */
function Code({ children }: { children: ReactNode }) {
  return (
    <code className="bg-canvas-inset text-fg rounded px-1 py-0.5 font-mono text-[0.85em]">
      {children}
    </code>
  );
}

/** Leads a bullet, in full-strength text so the list skims. */
function Lead({ children }: { children: ReactNode }) {
  return <strong className="text-fg font-medium">{children}</strong>;
}

export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-[65ch] px-6 py-12 text-[0.9375rem] sm:py-16">
      <h1 className="text-fg text-3xl font-semibold tracking-tight sm:text-4xl">Privacy</h1>

      <p className="text-fg mt-4 text-base leading-7">
        This is a markdown viewer that runs in your browser. This page describes what happens to a
        document you open, what this site and its host can and cannot see, and how to check that for
        yourself rather than take it on trust.
      </p>

      <Section title="The short version">
        <Bullets>
          <li>
            Your document is read and rendered <Lead>in your browser</Lead>. It is never uploaded.
          </li>
          <li>
            There is no server that receives documents, no database, and no logging of document
            content.
          </li>
          <li>Nothing is kept between sessions. Reload the page and the document is gone.</li>
          <li>No cookies. No accounts. No sign-in. Free to use, for anyone.</li>
          <li>Pageviews are counted, anonymously and in aggregate. Nothing else is measured.</li>
          <li>
            Hosting and analytics see ordinary request metadata — that is delivery, not content.
            Details below.
          </li>
        </Bullets>
      </Section>

      <Section title="How your document is handled">
        <P>
          A file you drop or open is read with the browser’s <Code>FileReader</Code> API — the same
          mechanism that lets a page show you a photo you picked before anything is sent anywhere.
          The text goes into the page’s memory, the markdown is parsed there, and the result is
          rendered there. Text you paste in works the same way, minus the file read.
        </P>
        <P>
          There is no upload step because there is nothing to upload to. This site is static files
          and client-side JavaScript. There is no API route, no database, and no server-side code
          that ever sees a document.
        </P>
        <P>
          The strong form of that claim is not a promise — it is enforced by your browser.{" "}
          <Code>{"connect-src 'self'"}</Code> in the Content-Security-Policy means this page is
          technically incapable of opening a network connection to any host other than its own
          origin. Every script on the page is bound by it, and you can read the header yourself; it
          is listed further down.
        </P>
      </Section>

      <Section title="What is stored">
        <P>
          Nothing persists across sessions. Closing the tab or reloading clears the document. There
          is deliberately no “recent files” list, no draft recovery, and no autosave — if you want
          the document again, open it again.
        </P>
        <P>
          The one exception is your light/dark preference, kept in this browser’s{" "}
          <Code>localStorage</Code> so the page does not flash the wrong theme while loading. It is a
          single value, readable only by this site, and clearing your site data removes it.
        </P>
        <P>No cookies are set — not by this site, and not by anything it loads.</P>
      </Section>

      <Section title="What the host can see">
        <P>
          This site is deployed on Vercel. Serving you a page means Vercel’s edge network receives
          the request, and with it the metadata every web server receives: your IP address, your
          user-agent, the URL requested, and a timestamp. That is how the page reaches you at all,
          and the same is true of every website you visit.
        </P>
        <P>
          That metadata is about delivery, not content. Your document is never part of any request,
          so it cannot appear in those logs — there is no request for it to appear in.
        </P>
      </Section>

      <Section title="This site has analytics">
        <P>
          Vercel Web Analytics counts pageviews here. Rather than gloss over that, here is exactly
          what it is:
        </P>
        <Bullets>
          <li>
            <Lead>Cookieless.</Lead> It stores no identifier in your browser.
          </li>
          <li>
            <Lead>Same-origin.</Lead> It posts to <Code>/_vercel/insights/</Code> on this domain, not
            to a third-party tracking host. <Code>{"connect-src 'self'"}</Code> would block anything
            else outright.
          </li>
          <li>
            <Lead>Aggregate.</Lead> It records that a page was viewed, plus the coarse device and
            country information any server can already derive from the request itself.
          </li>
          <li>
            <Lead>No cross-site profile.</Lead> It does not follow you to other sites, and it is not
            used for advertising.
          </li>
          <li>
            <Lead>It never sees your document.</Lead> It has no access to the rendered content and
            does not transmit it.
          </li>
        </Bullets>
      </Section>

      <Section title="Remote images are the one real leak">
        <P>
          Markdown often points at images hosted elsewhere — GitHub badges, a screenshot hotlinked
          from another site. Loading one is a request from your browser to that host, which tells
          that host your IP address, roughly when you looked, and which image you wanted. That is a
          genuine leak of something, even though it is not your document.
        </P>
        <P>
          So remote images are not loaded. The renderer withholds the address until you explicitly
          choose to load them; before that, no request is made. If you do choose, those requests go
          to those hosts, and what they do with them is between you and them.
        </P>
        <P>Two things worth knowing if you opt in:</P>
        <Bullets>
          <li>
            <Code>Referrer-Policy: no-referrer</Code> means those hosts are not told which page the
            request came from.
          </li>
          <li>
            The Content-Security-Policy is <Lead>not</Lead> what blocks them. A header is sent once,
            when the page loads, and cannot be changed afterwards, so <Code>img-src</Code> has to
            stay permissive enough to allow images you might later ask for. The blocking is done by
            the renderer, inside the page. That is a weaker guarantee than a browser-enforced one,
            and it would be dishonest to present the two as the same thing.
          </li>
        </Bullets>
      </Section>

      <Section title="Why 'unsafe-inline' is in script-src">
        <P>
          <Code>script-src</Code> includes <Code>{"'unsafe-inline'"}</Code>. It is there for
          Next.js’s own inline bootstrap — the mechanism the framework uses to hand server-rendered
          markup over to React in the browser. It is not there to run anything from a document.
        </P>
        <P>
          Document content never reaches a script context. Before rendering, every{" "}
          <Code>{"<script>"}</Code> tag, every <Code>on*</Code> event-handler attribute, and every{" "}
          <Code>javascript:</Code> URL is stripped out of the markdown. A file containing a script is
          shown as text or dropped, never executed.
        </P>
        <P>
          Stated plainly: <Code>{"'unsafe-inline'"}</Code> does widen what a cross-site-scripting bug
          could do, if one existed. What it does not do is create a route for your document to leave
          the page. <Code>{"connect-src 'self'"}</Code> still applies — to inline scripts as much as
          to any other.
        </P>
      </Section>

      <Section title="Check it yourself">
        <P>
          None of the above has to be believed. It was built to be verifiable, so here are two ways
          to test it.
        </P>

        <Subheading>It works offline</Subheading>
        <P>
          Load this site, turn off your network — airplane mode, or pull the cable — and then open a
          markdown file. It renders. A page that needed to send your document somewhere in order to
          render it could not possibly do that.
        </P>
        <P>Two honest notes on the test:</P>
        <Bullets>
          <li>
            There is no service worker or offline cache here, so a fresh reload while disconnected
            will fail. The page has to already be loaded — that is the state the test is about.
          </li>
          <li>
            Parts of the renderer, such as syntax highlighting and diagrams, are fetched on demand
            from this domain. So the cleanest run is: render one document, then disconnect, then
            render another.
          </li>
        </Bullets>
        <P>
          If you would rather watch it directly, open your browser’s Network tab and drop a file. You
          will see JavaScript load from this domain, and nothing else. No request carries your
          document — and by the policy below, no request to another host is possible in the first
          place.
        </P>

        <Subheading>The policy your browser is enforcing right now</Subheading>
        <P>
          This list is generated from the same source that builds the header, so it cannot drift from
          what is actually sent. Compare it against the real thing: DevTools → Network → the document
          request → Response Headers, or <Code>curl -I</Code> against this page’s URL.
        </P>
        <ul className="border-border bg-canvas-subtle mt-6 space-y-4 rounded-lg border p-5">
          {CSP_DIRECTIVES.map(({ name, value, note }) => (
            <li key={name} className="border-border border-t pt-4 first:border-t-0 first:pt-0">
              <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 font-mono text-[0.8125rem]">
                <span className="text-fg font-medium">{name}</span>
                {value ? <span className="text-fg-muted break-all">{value}</span> : null}
              </p>
              {note ? <p className="text-fg-muted mt-2 text-sm leading-6">{note}</p> : null}
            </li>
          ))}
        </ul>
        <p className="text-fg-muted mt-4 text-sm leading-6">
          One caveat for anyone running this locally: the development server loosens the policy
          slightly, because hot reloading needs <Code>{"'unsafe-eval'"}</Code> and a websocket. What
          is listed above is what production sends.
        </p>
      </Section>

      <Section title="There is no data to request or delete">
        <P>
          There is no account to close, no export to request, and no deletion to ask for, because
          nothing is held. Your document was never received. Your theme preference sits in your
          browser and nowhere else — clear your site data and it is gone. The aggregate pageview
          counts hold no identifier tied to you, which also means there is nothing in them to look up
          or remove on request.
        </P>
        <P>
          This project has no company behind it, no postal address, and no support inbox. Rather than
          invent a contact point for data requests that would have nothing to act on, this page says
          it plainly: there is no data here to hand over.
        </P>
      </Section>

      <hr className="border-border mt-12" />

      <p className="text-fg-muted mt-6 text-sm">
        Last updated <time dateTime={LAST_UPDATED_ISO}>{LAST_UPDATED_LABEL}</time>.
      </p>

      <p className="mt-6">
        <Link
          href="/"
          className="text-accent focus-visible:outline-accent rounded-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Back to the viewer
        </Link>
      </p>
    </main>
  );
}
