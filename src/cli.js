#!/usr/bin/env node
import fs from "node:fs/promises";
import { program } from "commander";
import "dotenv/config";
import { addAltText } from "./workflows/altText.js";
import { addTagTree } from "./workflows/tagging.js";
import { addSummaries } from "./workflows/summaries.js";

program
.name("pdf-remediate")
.command("remediate")
.requiredOption("--in <pdf>", "input PDF path")
.requiredOption("--out <pdf>", "output PDF path")
.option("--alt", "generate alt-text")
.option("--tags", "generate tag tree")
.option("--summaries","generate summaries & bookmarks")
.action(async opts => {
  const { in: input, out: output, alt, tags, summaries } = opts;
  if (!alt && !tags && !summaries) {
    console.error("Nothing to do — add --alt, --tags or --summaries.");
    process.exit(1);
  }

  let pdfBytes = await fs.readFile(input);

  if (alt)       pdfBytes = await addAltText(pdfBytes);
  if (tags)      pdfBytes = await addTagTree(pdfBytes);
  if (summaries) pdfBytes = await addSummaries(pdfBytes);

  await fs.writeFile(output, pdfBytes);
  console.log("✅  Remediated PDF saved to", output);

});

program.parse(process.argv);
