import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { extractTextPerPage } from "../pdf.js";
import { chat } from "../ai.js";

const VISION_MODEL = "gpt-4o-mini";

/**
 * For pages with little or no selectable text, run OCR on the first image
 * and overlay the result as invisible text so it's searchable.
 * @param {Uint8Array|Buffer} pdfBytes
 * @param {{verbose?:boolean}} opts
 */
export async function addOcrText(pdfBytes, { verbose = false } = {}) {
  const pdf = await PDFDocument.load(pdfBytes);
  const pages = pdf.getPages();
  const pageTexts = await extractTextPerPage(pdfBytes);
  const font = await pdf.embedFont(StandardFonts.Helvetica);

  for (let i = 0; i < pages.length; i++) {
    const text = pageTexts[i].trim();
    if (text.length > 10) continue; // page already has text
    const page = pages[i];
    const res = page.node.Resources();
    const xo = res?.lookup("XObject");
    if (!xo) continue;
    for (const [name, ref] of xo.entries()) {
      const obj = page.doc.context.lookup(ref);
      if (obj.get("Subtype")?.name !== "Image") continue;
      const bytes = obj.contents;
      if (!bytes || bytes.length === 0) continue;
      try {
        const b64 = Buffer.from(bytes).slice(0, 20_000).toString("base64");
        const ocr = await chat(
          VISION_MODEL,
          "You are an OCR engine. Transcribe the text exactly.",
          `Image (base64, truncated): ${b64}`
        );
        page.drawText(ocr, {
          x: 10,
          y: page.getHeight() - 20,
          size: 12,
          font,
          color: rgb(1, 1, 1),
          opacity: 0,
        });
        if (verbose) console.log(`\u2713 OCR text for page ${i+1}`);
      } catch (err) {
        console.error(`\u26A0\uFE0F  OCR error on page ${i+1}: ${err.message}`);
      }
      break;
    }
  }

  return pdf.save();
}
