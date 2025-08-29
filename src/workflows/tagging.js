import {
  PDFDocument,
  PDFName,
  PDFDict,
  PDFNumber,
  PDFOperator,
  PDFOperatorNames as Ops,
} from "pdf-lib";
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

  const parentNums = [];

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
    const pageElem = ctx.obj({
      Type: "StructElem",
      S: PDFName.of("Div"),
      Pg: page.ref,
      P: rootRef,
    });
    const pageKids = ctx.obj([]);
    pageElem.set(PDFName.of("K"), pageKids);
    const pageRef = ctx.register(pageElem);
    kids.push(pageRef);

    // Wrap existing page content in a marked-content sequence
    const start = ctx.contentStream([
      PDFOperator.of(Ops.BeginMarkedContentSequence, [
        PDFName.of("P"),
        ctx.obj({ MCID: PDFNumber.of(0) }),
      ]),
    ]);
    const end = ctx.contentStream([
      PDFOperator.of(Ops.EndMarkedContent),
    ]);
    const startRef = ctx.register(start);
    const endRef = ctx.register(end);
    if (!page.node.wrapContentStreams(startRef, endRef)) {
      const contents = page.node.Contents();
      const arr = ctx.obj([startRef, contents, endRef]);
      page.node.set(PDFName.of("Contents"), arr);
    }

    const pElem = ctx.obj({
      Type: "StructElem",
      S: PDFName.of("P"),
      Pg: page.ref,
      P: pageRef,
      K: PDFNumber.of(0),
    });
    const pRef = ctx.register(pElem);
    pageKids.push(pRef);
    parentNums.push(PDFNumber.of(i), ctx.obj([pRef]));

    const res = page.node.Resources();
    const xo = res?.lookup("XObject");
    if (xo) {
      for (const [name, ref] of xo.entries()) {
        const obj = ctx.lookup(ref, PDFDict);
        if (obj.get("Subtype")?.name !== "Image") continue;
        const alt = obj.get(PDFName.of("Alt"));
        if (!alt) continue;


        const objr = ctx.obj({ Type: PDFName.of("OBJR"), Obj: ref });
        const objrRef = ctx.register(objr);


        const fig = ctx.obj({
          Type: "StructElem",
          S: PDFName.of("Figure"),
          Alt: alt,
          Pg: page.ref,
          P: pageRef,

          K: objrRef,

        });
        pageKids.push(ctx.register(fig));
      }
    }

      roles
        .filter(r => r.role === "H1" || r.role === "H2")
        .forEach(r => addOutline(pdf, r.text.slice(0, 60), page.ref));
  }

  const parentTree = ctx.obj({ Nums: ctx.obj(parentNums) });
  root.set(PDFName.of("ParentTree"), ctx.register(parentTree));

  return pdf.save();
}
