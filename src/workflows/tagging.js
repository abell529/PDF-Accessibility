import { PDFDocument } from "pdf-lib";
import { extractTextPerPage, addOutline } from "../pdf.js";
import { chat } from "../ai.js";

const MODEL = "gpt-4.1-nano"; // cheapest text tier

export async function addTagTree(pdfBytes) {
const pdf = await PDFDocument.load(pdfBytes);
const pages = await extractTextPerPage(pdfBytes);

for (let i = 0; i < pages.length; i++) {
const raw = pages[i].slice(0, 8000);
const json = await chat(
MODEL,
"Label each line with H1, H2, P, LI, TH, TD. Return JSON array.",
raw
);
let roles;
try { roles = JSON.parse(json); } catch { continue; }
const page = pdf.getPages()[i];
roles
  .filter(r => r.role === "H1" || r.role === "H2")
  .forEach(r => addOutline(pdf, r.text.slice(0, 60), page.ref));

}
return pdf.save();
}
