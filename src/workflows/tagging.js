import { PDFDocument, PDFName } from "pdf-lib";
import { extractTextPerPage, addOutline } from "../pdf.js";
import { chat } from "../ai.js";

const MODEL = "gpt-4.1-nano"; // cheapest text tier

export async function addTagTree(pdfBytes) {
  const pdf = await PDFDocument.load(pdfBytes);
  const pages = await extractTextPerPage(pdfBytes);

  const ctx = pdf.context;
  const root = ctx.obj({ Type: "StructTreeRoot" });
  const kids = ctx.obj([]);
  root.set(PDFName.of("K"), kids);
  const rootRef = ctx.register(root);
  pdf.catalog.set(PDFName.of("StructTreeRoot"), rootRef);
  pdf.catalog.set(PDFName.of("MarkInfo"), ctx.obj({ Marked: true }));

  for (let i = 0; i < pages.length; i++) {
    const raw = pages[i].slice(0, 8000);
    const json = await chat(
      MODEL,
      "Label each line with H1, H2, P, LI, TH, TD. Return JSON array.",
      raw
    );
    let roles;
    try { roles = JSON.parse(json); } catch { roles = []; }

    const page = pdf.getPages()[i];
    page.node.set(PDFName.of("StructParents"), ctx.obj(i));
    const pageElem = ctx.obj({ Type: "StructElem", S: PDFName.of("Div"), P: rootRef });
    const pageRef = ctx.register(pageElem);
    kids.push(pageRef);

    roles
      .filter(r => r.role === "H1" || r.role === "H2")
      .forEach(r => addOutline(pdf, r.text.slice(0, 60), page.ref));
  }

  return pdf.save();
}
