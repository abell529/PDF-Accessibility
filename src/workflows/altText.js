import { PDFDocument } from "pdf-lib";
import { chat } from "../ai.js";
import { embedAltText } from "../pdf.js";
import pLimit from "p-limit";

const VISION_MODEL = "gpt-4o-mini";
const CONCURRENCY  = 3;                 // max parallel Vision calls
const limit        = pLimit(CONCURRENCY);

/**
 * Add concise alt-text (<\u200920 words) to every /Subtype /Image XObject.
 * Non-image XObjects (/Form, /PS, etc.) are ignored.
 * If a single OpenAI call fails, we log and continue.
 *
 * @param {Uint8Array|Buffer} pdfBytes
 * @param {{verbose?:boolean}} opts
 * @returns {Promise<Uint8Array>}
 */
export async function addAltText(pdfBytes, { verbose = false } = {}) {
  const pdf   = await PDFDocument.load(pdfBytes);
  const jobs  = [];

  for (const page of pdf.getPages()) {
    const res = page.node.Resources();
    const xo  = res?.lookup("XObject");
    if (!xo) continue;

    for (const [name, ref] of xo.entries()) {
      const obj      = page.doc.context.lookup(ref);
      const subtype  = obj.get("Subtype")?.name;

      if (subtype !== "Image") {
        if (verbose) console.log(`\u2022 skip ${name}: subtype ${subtype}`);
        continue;
      }

      const bytes = obj.contents;
      if (!bytes || bytes.length === 0) continue;

      jobs.push(limit(async () => {
        const b64 = Buffer.from(bytes)
                          .slice(0, 20_000)      // keep token cost low
                          .toString("base64");
        try {
          const alt = await chat(
            VISION_MODEL,
            "You are an accessibility expert. Provide concise (\u226420 words) alt-text.",
            `Image (base64, truncated): ${b64}`
          );
          embedAltText(page, name, alt);
          if (verbose) console.log(`\u2713 alt-text for ${name}: ${alt}`);
        } catch (err) {
          console.error(`\u26a0\ufe0f  OpenAI error for ${name}: ${err.message}`);
        }
      }));
    }
  }

  await Promise.all(jobs);
  return pdf.save();
}
