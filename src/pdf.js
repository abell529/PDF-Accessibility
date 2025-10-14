import {
  PDFDocument,
  PDFName,
  PDFDict,
  PDFRef,
  PDFHexString,
  PDFNumber,
  PDFStream,
} from "pdf-lib";
import { fileURLToPath } from "node:url";
// The default `pdfjs-dist` build targets modern runtimes and relies on
// `Promise.withResolvers`, which is only available in Node 22+.
// To remain compatible with Node 20 (as required by this project),
// use the `legacy` build instead which includes a polyfill.
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const standardFontDataUrl = fileURLToPath(
  new URL("../node_modules/pdfjs-dist/standard_fonts/", import.meta.url),
);

/** Extract plaintext for every page using pdfjs-dist. */
export async function extractTextPerPage(pdfBytes) {
  const doc = await getDocument({
    data: pdfBytes,
    standardFontDataUrl,
  }).promise;
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
  const xo = res?.lookup(PDFName.of("XObject"), PDFDict);
  const img = xo?.lookup(name, PDFStream);
  if (img) img.dict.set(PDFName.of("Alt"), page.doc.context.obj(alt));
}

/** Create a top-level bookmark linked to the given page. */
export function addOutline(pdf, title, pageRef) {
  const ctx = pdf.context;
  const cat = pdf.catalog;

  let outlinesRef = cat.get(PDFName.of("Outlines"));
  let outlines;
  if (outlinesRef instanceof PDFRef) {
    outlines = ctx.lookup(outlinesRef, PDFDict);
  } else if (outlinesRef instanceof PDFDict) {
    outlines = outlinesRef;
  }
  if (!outlines) {
    outlines = ctx.obj({ Type: "Outlines", Count: 0 });
    outlinesRef = ctx.register(outlines);
    cat.set(PDFName.of("Outlines"), outlinesRef);
  } else if (!(outlinesRef instanceof PDFRef)) {
    // Ensure outlines dictionary has a reference
    outlinesRef = ctx.getObjectRef(outlines) || ctx.register(outlines);
    cat.set(PDFName.of("Outlines"), outlinesRef);
  }

  const dest = ctx.obj([pageRef, PDFName.of("Fit")]);
  const item = ctx.obj({
    Title: PDFHexString.fromText(title),
    Parent: outlinesRef,
    Dest: dest,
  });
  const itemRef = ctx.register(item);

  const first = outlines.lookupMaybe(
    PDFName.of("First"),
    PDFRef,
    PDFDict,
  );
  if (!first) {
    outlines.set(PDFName.of("First"), itemRef);
    outlines.set(PDFName.of("Last"), itemRef);
  } else {
    let last = outlines.lookup(
      PDFName.of("Last"),
      PDFRef,
      PDFDict,
    );
    let lastRef;
    if (last instanceof PDFRef) {
      lastRef = last;
      last = ctx.lookup(lastRef, PDFDict);
    } else {
      lastRef = ctx.getObjectRef(last) || ctx.register(last);
      outlines.set(PDFName.of("Last"), lastRef);
    }
    last.set(PDFName.of("Next"), itemRef);
    item.set(PDFName.of("Prev"), lastRef);
    outlines.set(PDFName.of("Last"), itemRef);
  }

  const countObj = outlines.lookupMaybe(PDFName.of("Count"), PDFNumber);
  const count = countObj ? countObj.asNumber() : 0;
  outlines.set(PDFName.of("Count"), PDFNumber.of(count + 1));

  return itemRef;
}

function escapeXml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function ensureNamespace(descriptionTag, prefix, uri) {
  if (new RegExp(`xmlns:${prefix}=`).test(descriptionTag)) return descriptionTag;
  return descriptionTag.replace(
    /<rdf:Description([^>]*)>/,
    (match, attrs) => `<rdf:Description${attrs} xmlns:${prefix}="${uri}">`,
  );
}

function injectTitleFragments(metadataXml, escapedTitle) {
  const dcBlock =
    `   <dc:title>\n` +
    `    <rdf:Alt>\n` +
    `     <rdf:li xml:lang="x-default">${escapedTitle}</rdf:li>\n` +
    `    </rdf:Alt>\n` +
    `   </dc:title>`;
  const pdfBlock = `   <pdf:Title>${escapedTitle}</pdf:Title>`;

  let updated = metadataXml;

  if (/<dc:title[\s\S]*?<\/dc:title>/i.test(updated)) {
    updated = updated.replace(/<dc:title[\s\S]*?<\/dc:title>/i, dcBlock);
  } else {
    updated = updated.replace(
      /(<rdf:Description[^>]*>)/i,
      `$1\n${dcBlock}`,
    );
  }

  if (/<pdf:Title[\s\S]*?<\/pdf:Title>/i.test(updated)) {
    updated = updated.replace(/<pdf:Title[\s\S]*?<\/pdf:Title>/i, pdfBlock);
  } else {
    updated = updated.replace(
      /(<dc:title[\s\S]*?<\/dc:title>)/i,
      `$1\n${pdfBlock}`,
    );
  }

  return updated;
}

function injectPdfUaIdentifier(metadataXml) {
  const pdfuaBlock = `   <pdfuaid:part>1</pdfuaid:part>`;

  if (/<pdfuaid:part[\s\S]*?<\/pdfuaid:part>/i.test(metadataXml)) {
    return metadataXml.replace(/<pdfuaid:part[\s\S]*?<\/pdfuaid:part>/i, pdfuaBlock);
  }

  return metadataXml.replace(/(<rdf:Description[^>]*>)/i, `$1\n${pdfuaBlock}`);
}

function buildXmpMetadata(title) {
  const escapedTitle = escapeXml(title);

  return (
    `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>\n` +
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<x:xmpmeta xmlns:x="adobe:ns:meta/">\n` +
    ` <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n` +
    `  <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/" xmlns:pdfuaid="http://www.aiim.org/pdfua/ns/id/">\n` +
    `   <dc:title>\n` +
    `    <rdf:Alt>\n` +
    `     <rdf:li xml:lang="x-default">${escapedTitle}</rdf:li>\n` +
    `    </rdf:Alt>\n` +
    `   </dc:title>\n` +
    `   <pdf:Title>${escapedTitle}</pdf:Title>\n` +
    `   <pdfuaid:part>1</pdfuaid:part>\n` +
    `  </rdf:Description>\n` +
    ` </rdf:RDF>\n` +
    `</x:xmpmeta>\n` +
    `<?xpacket end="w"?>`
  );
}

function updateExistingXmp(metadataStream, escapedTitle) {
  const contents = metadataStream?.getContents?.();
  if (!contents) return undefined;

  let xml;
  try {
    xml = Buffer.from(contents).toString("utf8");
  } catch (err) {
    return undefined;
  }

  if (!xml.includes("<rdf:RDF")) return undefined;

  let updated = xml;
  updated = ensureNamespace(
    updated,
    "dc",
    "http://purl.org/dc/elements/1.1/",
  );
  updated = ensureNamespace(
    updated,
    "pdf",
    "http://ns.adobe.com/pdf/1.3/",
  );
  updated = ensureNamespace(
    updated,
    "pdfuaid",
    "http://www.aiim.org/pdfua/ns/id/",
  );

  updated = injectTitleFragments(updated, escapedTitle);
  updated = injectPdfUaIdentifier(updated);
  return updated;
}

/** Set the document title and embed it in XMP metadata. */
export function setDocumentTitle(pdf, rawTitle) {
  const title = (rawTitle ?? "").trim() || "Untitled Document";
  pdf.setTitle(title, { showInWindowTitleBar: true });

  const escapedTitle = escapeXml(title);
  const metadataRef = pdf.catalog.get(PDFName.of("Metadata"));
  let metadataStream;
  if (metadataRef instanceof PDFRef) {
    metadataStream = pdf.context.lookup(metadataRef, PDFStream);
  } else if (metadataRef instanceof PDFStream) {
    metadataStream = metadataRef;
  }

  let xmp = updateExistingXmp(metadataStream, escapedTitle);
  if (!xmp) {
    xmp = buildXmpMetadata(title);
  }

  const metadata = pdf.context.stream(new TextEncoder().encode(xmp), {
    Type: "Metadata",
    Subtype: "XML",
  });
  pdf.catalog.set(PDFName.of("Metadata"), pdf.context.register(metadata));
}
