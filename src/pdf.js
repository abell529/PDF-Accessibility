import { PDFDocument } from "pdf-lib";
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
