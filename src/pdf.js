import {
  PDFDocument,
  PDFName,
  PDFDict,
  PDFRef,
  PDFHexString,
  PDFNumber,
} from "pdf-lib";
// The default `pdfjs-dist` build targets modern runtimes and relies on
// `Promise.withResolvers`, which is only available in Node 22+.
// To remain compatible with Node 20 (as required by this project),
// use the `legacy` build instead which includes a polyfill.
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

/** Extract plaintext for every page using pdfjs-dist. */
export async function extractTextPerPage(pdfBytes) {
const doc = await getDocument({ data: pdfBytes }).promise;
const out = [];
for (let p = 1; p <= doc.numPages; p++) {
const page = await doc.getPage(p);
const c = await page.getTextContent();
out.push(c.items.map(i => i.str).join("\n"));
}
return out;
}

/** Low-level helper to attach /Alt text to an image XObject. */
export function embedAltText(page, name, alt) {
const res = page.node.Resources();
const xo = res?.lookup("XObject");
const ref = xo?.lookup(name);
if (ref) ref.set("Alt", page.doc.context.obj(alt));
}

/** Create a top-level bookmark linked to the given page. */
export function addOutline(pdf, title, pageRef) {
  const ctx = pdf.context;
  const cat = pdf.catalog;

  let outlinesRef = cat.get(PDFName.of("Outlines"));
  let outlines;
  if (outlinesRef instanceof PDFRef) {
    outlines = ctx.lookup(outlinesRef, PDFDict);
  }
  if (!outlines) {
    outlines = ctx.obj({ Type: "Outlines", Count: 0 });
    outlinesRef = ctx.register(outlines);
    cat.set(PDFName.of("Outlines"), outlinesRef);
  }

  const dest = ctx.obj([pageRef, PDFName.of("Fit")]);
  const item = ctx.obj({
    Title: PDFHexString.fromText(title),
    Parent: outlinesRef,
    Dest: dest,
  });
  const itemRef = ctx.register(item);

  const first = outlines.lookupMaybe(PDFName.of("First"), PDFRef);
  if (!first) {
    outlines.set(PDFName.of("First"), itemRef);
    outlines.set(PDFName.of("Last"), itemRef);
  } else {
    const lastRef = outlines.lookup(PDFName.of("Last"), PDFRef);
    const last = ctx.lookup(lastRef, PDFDict);
    last.set(PDFName.of("Next"), itemRef);
    item.set(PDFName.of("Prev"), lastRef);
    outlines.set(PDFName.of("Last"), itemRef);
  }

  const countObj = outlines.lookupMaybe(PDFName.of("Count"), PDFNumber);
  const count = countObj ? countObj.asNumber() : 0;
  outlines.set(PDFName.of("Count"), PDFNumber.of(count + 1));

  return itemRef;
}
