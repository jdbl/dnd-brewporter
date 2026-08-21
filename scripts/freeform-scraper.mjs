// Best-effort parser for homebrew subclass write-ups that don't have
// wikidot's structured HTML (Google Docs exports, and — since nothing here
// is Google-specific — any other free-form page). Unlike scraper.mjs, this
// leans on a *textual* convention rather than real markup: the official PHB
// habit of writing feature headers as a plain line reading e.g.
// "3rd Level: Oath Spells", which homebrew authors commonly imitate even
// when their doc has no semantic heading tags at all (confirmed: Google
// Docs' HTML export represents headings as CSS-styled <p> tags, nothing an
// element selector can key off).
//
// Verified against a real example (a public "Oath of Love" homebrew Paladin
// subclass doc): Google Docs frequently joins what are visually two lines
// with a bare <br> inside a single <p> (e.g. the title block "Oath of Love"
// / "A Paladin Subclass" is ONE <p> with a <br> between the two — NOT two
// separate <p> elements). textContent alone would run them together with no
// separator, so line-extraction here explicitly splits on <br>.
//
// Unlike wikidot pages — where a granted feature ("Divine Order", "Channel
// Divinity", ...) already exists as a real item somewhere in the official
// compendium and just needs its UUID looked up by name — homebrew content
// like "Loving Embrace" has no equivalent anywhere: it's original to the
// doc. So this parser captures each feature's own prose (everything between
// its heading and the next one) as `descriptionHtml`, letting the importer
// create a real Item for it instead of leaving an unresolvable FIXME.
//
// Output is intentionally an intermediate shape, not a finished item —
// confidence-gated review happens in importer.mjs before assembleSubclassItem
// (scraper.mjs) is called to actually build the item document.

import { slugify } from "./scraper.mjs";

const LEVEL_HEADING_FREEFORM = /^(\d+)(?:st|nd|rd|th)\s+Level:\s*(.+)$/i;
const CLASS_TAGLINE = /^A\s+(\w+)\s+Subclass$/i;

// Splits a block element's rendered text into lines at <br> boundaries —
// see file header comment for why this matters more than it sounds like it
// should.
function extractLines(el) {
  const lines = [];
  let current = "";
  (function walk(node) {
    if (node.nodeType === 3) {
      current += node.textContent;
    } else if (node.nodeName === "BR") {
      lines.push(current);
      current = "";
    } else if (node.childNodes) {
      for (const child of node.childNodes) walk(child);
    }
  })(el);
  lines.push(current);
  return lines.map((l) => l.replace(/ /g, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
}

function outerHtmlWithoutImages(el) {
  const clone = el.cloneNode(true);
  clone.querySelectorAll("img").forEach((img) => img.remove());
  return clone.outerHTML;
}

function nonEmptyBlocksHtml(els) {
  return els
    .filter((el) => el.textContent.trim() !== "" || el.tagName === "TABLE")
    .map(outerHtmlWithoutImages)
    .join("");
}

export function scrapeFreeformSubclass(html, sourceLabel) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  // A normal Google Docs "export?format=html" page puts its real content
  // directly under <body> (which itself carries the "doc-content" class).
  // A "Publish to web" page (docs.google.com/document/d/e/<id>/pub — a
  // different, opaque ID scheme from a normal doc link) wraps the same
  // per-paragraph markup several divs deep instead, inside a nested
  // .doc-content — querySelector finds whichever one actually holds it,
  // falling back to <body> for anything else.
  const root = doc.querySelector(".doc-content") ?? doc.body;
  const blockEls = Array.from(root.children).filter((el) => !["STYLE", "SCRIPT"].includes(el.tagName));

  let name = null;
  let classIdentifier = null;
  let className = null;
  let titleResolved = false;
  const titleCandidateLines = []; // substantial lines seen so far, before the title is resolved
  const spellGrants = [];
  const preambleEls = []; // flavor text before the first "Nth Level:" heading
  const features = []; // ordered [{level, name, descBlocks: []}]
  let activeFeature = null; // the feature currently accumulating description blocks

  for (const el of blockEls) {
    if (el.tagName === "TABLE") {
      const firstRow = el.querySelector("tr");
      const headerCells = firstRow ? Array.from(firstRow.querySelectorAll("td,th")).map((c) => c.textContent.trim()) : [];
      const isSpellTable = headerCells.length === 2 && /^Level$/i.test(headerCells[0]) && /Spells?$/i.test(headerCells[1]);

      if (isSpellTable) {
        for (const row of Array.from(el.querySelectorAll("tr")).slice(1)) {
          const cells = row.querySelectorAll("td,th");
          if (cells.length < 2) continue;
          const levelMatch = cells[0].textContent.trim().match(/^(\d+)/);
          if (!levelMatch) continue;
          const spellNames = cells[1].textContent.split(",").map((s) => s.trim()).filter(Boolean);
          if (spellNames.length) {
            spellGrants.push({ level: parseInt(levelMatch[1], 10), title: activeFeature?.name ?? headerCells[1], spellNames });
          }
        }
        // A spell table isn't part of any feature's own prose description.
      } else if (activeFeature) {
        activeFeature.descBlocks.push(el);
      } else {
        preambleEls.push(el); // e.g. a decorative disclaimer table before the real content starts
      }
      continue;
    }

    let elHasHeading = false;
    for (const lineText of extractLines(el)) {
      const headingMatch = lineText.match(LEVEL_HEADING_FREEFORM);

      if (!titleResolved) {
        const taglineMatch = lineText.match(CLASS_TAGLINE);
        if (taglineMatch) {
          // The tagline always follows the name directly (verified against
          // both a 2-line title — "Oath of Love" / "A Paladin Subclass" —
          // and a 3-line one with a category label first — "Otherworldly
          // Patron:" / "The Dragon" / "A Warlock Subclass"), so the name is
          // whichever candidate line was buffered most recently, not
          // necessarily the very first line seen.
          classIdentifier = slugify(taglineMatch[1]);
          className = taglineMatch[1];
          name = titleCandidateLines.at(-1) ?? null;
          titleResolved = true;
          if (!headingMatch) continue;
        } else if (headingMatch) {
          // Hit the first real feature heading with no tagline ever showing
          // up — fall back to the very first substantial line as the name.
          name = titleCandidateLines[0] ?? null;
          titleResolved = true;
        } else {
          if (lineText.length >= 3) titleCandidateLines.push(lineText);
          continue;
        }
      }

      if (headingMatch) {
        activeFeature = { level: parseInt(headingMatch[1], 10), name: headingMatch[2].trim(), descBlocks: [] };
        features.push(activeFeature);
        elHasHeading = true;
      }
    }

    if (elHasHeading) continue; // the heading's own paragraph isn't part of the description body
    if (activeFeature) activeFeature.descBlocks.push(el);
    else preambleEls.push(el);
  }

  if (!name) throw new Error(`Could not find any readable text in ${sourceLabel} — is this really a document/page?`);

  const featuresByLevel = {};
  for (const f of features) (featuresByLevel[f.level] ??= []).push(f.name);

  const confidence = features.length;
  const descriptionHtml = nonEmptyBlocksHtml(preambleEls);
  const featureDetails = features.map((f) => ({ level: f.level, name: f.name, descriptionHtml: nonEmptyBlocksHtml(f.descBlocks) }));

  return { name, classIdentifier, className, featuresByLevel, spellGrants, scaleColumns: {}, confidence, descriptionHtml, featureDetails };
}
