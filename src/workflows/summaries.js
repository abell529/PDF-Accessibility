import { PDFDocument } from "pdf-lib";
import { extractTextPerPage, addOutline } from "../pdf.js";
import { chat } from "../ai.js";

const MODEL = "gpt-4.1-nano";

export async function addSummaries(pdfBytes) {
const pdf = await PDFDocument.load(pdfBytes);
const pages = await extractTextPerPage(pdfBytes);

for (let i = 0; i < pages.length; i++) {
const summary = await chat(
MODEL,
"Summarise this page in ≤35 words.",
pages[i].slice(0, 8000)
);
const page = pdf.getPages()[i];
  addOutline(pdf, `Pg ${i + 1}: ${summary}`, page.ref);
}

pdf.setTitle("Remediated PDF");
pdf.setSubject("Accessibility-enhanced PDF");
pdf.setKeywords(["accessibility", "alt-text", "PDF remediation"]);

return pdf.save();
}
