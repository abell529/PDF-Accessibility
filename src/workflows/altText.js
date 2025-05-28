import { PDFDocument } from "pdf-lib";
import { chat } from "../ai.js";
import { embedAltText } from "../pdf.js";

const MODEL = "gpt-4o-mini"; // cheapest vision tier

export async function addAltText(pdfBytes) {
const pdf = await PDFDocument.load(pdfBytes);

for (const page of pdf.getPages()) {
const res = page.node.Resources();
const xo = res?.lookup("XObject");
if (!xo) continue;
for (const [name, ref] of xo.entries()) {
  const img = page.doc.context.lookup(ref);
  const bytes = img.contents;
  if (!bytes) continue;

  const b64 = bytes.slice(0, 20_000).toString("base64");
  const alt = await chat(
    MODEL,
    "You are an accessibility expert. Provide concise (≤20 words) alt-text.",
    `Image (base64, truncated): ${b64}`
  );
  embedAltText(page, name, alt);
}

}
return pdf.save();
}
