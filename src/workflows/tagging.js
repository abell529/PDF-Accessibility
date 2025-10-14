import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFOperator,
  PDFOperatorNames as Ops,
  PDFRef,
  PDFStream,
  PDFString,
  StandardFonts,
} from "pdf-lib";
import { extractTextPerPage, addOutline } from "../pdf.js";
import { chat } from "../ai.js";

const MODEL = "gpt-4.1-nano"; // cheapest text tier

export async function addTagTree(pdfBytes) {
  const pdf = await PDFDocument.load(pdfBytes);
  const pages = await extractTextPerPage(pdfBytes);

  const ctx = pdf.context;
  const root = ctx.obj({ Type: "StructTreeRoot" });
  const rootKids = ctx.obj([]);
  root.set(PDFName.of("K"), rootKids);
  const documentElem = ctx.obj({
    Type: "StructElem",
    S: PDFName.of("Document"),
  });
  const documentKids = ctx.obj([]);
  documentElem.set(PDFName.of("K"), documentKids);
  const documentRef = ctx.register(documentElem);
  rootKids.push(documentRef);

  const roleMap = ctx.obj({});
  const usedTags = new Set(["Document"]);
  const rootRef = ctx.register(root);
  pdf.catalog.set(PDFName.of("StructTreeRoot"), rootRef);
  pdf.catalog.set(PDFName.of("MarkInfo"), ctx.obj({ Marked: true }));

  const font = await pdf.embedFont(StandardFonts.Helvetica);

  const parentNums = [];

  for (let i = 0; i < pages.length; i++) {
    const raw = pages[i].slice(0, 8000);
    const json = await chat(
      MODEL,
      [
        "You are preparing a PDF tag tree that must pass PAC 2024's",
        "Screen Reader Preview. Return a JSON array describing the",
        "logical reading order for this page. Use PDF structure tags",
        "for every node (Document, Sect, H1–H6, P, L, LI, Lbl, LBody,",
        "Table, TR, TH, TD, Figure, Caption, Link, Span, Quote).",
        "Each item must be an object with optional keys: tag",
        "(string), text (string), actualText (string), alt (string),",
        "lang (BCP47 string), url (string for Link targets), scope",
        "(Row or Column for TH cells), children (array of nested",
        "items). For lists, include LI children with Lbl and LBody",
        "elements. For tables, build TR rows with TH/TD cells.",
        "Only include Artifact entries for decorative content.",
        "Keep JSON valid and no extra commentary.",
      ].join(" "),
      raw,
    );

    let nodes;
    try {
      nodes = JSON.parse(json);
      if (!Array.isArray(nodes)) nodes = [];
    } catch {
      nodes = [];
    }

    const page = pdf.getPages()[i];
    const structParentIndex = i;
    page.node.set(PDFName.of("StructParents"), PDFNumber.of(structParentIndex));

    const pageElem = ctx.obj({
      Type: "StructElem",
      S: PDFName.of("Sect"),
      Pg: page.ref,
      P: documentRef,
    });
    const pageKids = ctx.obj([]);
    pageElem.set(PDFName.of("K"), pageKids);
    const pageRef = ctx.register(pageElem);
    documentKids.push(pageRef);
    usedTags.add("Sect");

    const pageCtx = {
      page,
      font,
      nextMcid: 0,
      nextY: page.getHeight() - 48,
      items: [],
      parentRefs: [],
    };

    const normalisedNodes = normaliseNodes(nodes);

    if (normalisedNodes.length === 0) {
      const fallbackText = raw.trim();
      if (fallbackText) {
        const fallback = normaliseNode({ tag: "P", text: fallbackText });
        if (fallback) normalisedNodes.push(fallback);
      }
    }

    for (const node of normalisedNodes) {
      createStructElem({
        node,
        parentRef: pageRef,
        parentKids: pageKids,
        pageCtx,
        ctx,
        usedTags,
      });
    }

    addImageFigures({ ctx, page, parentRef: pageRef, parentKids: pageKids, usedTags });

    const accessibleStreamRef = buildAccessibleContentStream(ctx, pageCtx);
    wrapPageContentWithArtifact(ctx, page, accessibleStreamRef);
    ensureFontResource(ctx, page, font);

    const parentArray = ctx.obj([]);
    for (const ref of pageCtx.parentRefs) {
      parentArray.push(ref);
    }
    parentNums.push(PDFNumber.of(structParentIndex), parentArray);

    const outlineNodes = collectOutlineCandidates(normalisedNodes);
    outlineNodes.forEach(title => addOutline(pdf, title.slice(0, 60), page.ref));
  }

  const parentTree = ctx.obj({ Nums: ctx.obj(parentNums) });
  root.set(PDFName.of("ParentTree"), ctx.register(parentTree));

  populateRoleMap(ctx, roleMap, usedTags);
  root.set(PDFName.of("RoleMap"), ctx.register(roleMap));

  return pdf.save();
}

function normaliseNodes(nodes) {
  const out = [];
  for (const node of nodes) {
    const cleaned = normaliseNode(node);
    if (cleaned) out.push(cleaned);
  }
  return out;
}

function normaliseNode(node) {
  if (!node || typeof node !== "object") return undefined;
  const tag = typeof node.tag === "string" ? node.tag.trim() : undefined;
  if (!tag) return undefined;

  const text = typeof node.text === "string" ? node.text : undefined;
  const actualText = typeof node.actualText === "string" ? node.actualText : undefined;
  const lang = typeof node.lang === "string" && node.lang.trim() ? node.lang.trim() : undefined;
  const alt = typeof node.alt === "string" ? node.alt : undefined;
  const url = typeof node.url === "string" && node.url.trim() ? node.url.trim() : undefined;
  const scope = typeof node.scope === "string" ? node.scope : undefined;
  const label = typeof node.label === "string" ? node.label : undefined;

  let children = [];
  if (Array.isArray(node.children)) {
    children = normaliseNodes(node.children);
  }

  if (tag === "LI" && children.length === 0 && text) {
    const match = text.match(/^\s*([\u2022\-\*\dA-Za-z\.]+)\s+(.*)$/);
    const lblText = label || (match ? match[1] : "•");
    const bodyText = match ? match[2] : text;
    children = normaliseNodes([
      { tag: "Lbl", text: lblText },
      { tag: "LBody", text: bodyText },
    ]);
  }

  if ((tag === "L" || tag === "Table" || tag === "TR") && children.length === 0 && text) {
    children = normaliseNodes([{ tag: "Span", text }]);
  }

  return {
    tag,
    text,
    actualText,
    lang,
    alt,
    url,
    scope,
    label,
    children,
  };
}

function createStructElem({ node, parentRef, parentKids, pageCtx, ctx, usedTags }) {
  if (node.tag === "Artifact") return undefined;

  usedTags.add(node.tag);

  const struct = ctx.obj({
    Type: "StructElem",
    S: PDFName.of(node.tag),
    P: parentRef,
    Pg: pageCtx.page.ref,
  });

  if (node.alt) {
    struct.set(PDFName.of("Alt"), PDFHexString.fromText(node.alt));
  }
  if (node.lang) {
    struct.set(PDFName.of("Lang"), PDFString.of(node.lang));
  }
  if (node.tag === "Link" && node.url) {
    const action = ctx.obj({
      S: PDFName.of("URI"),
      URI: PDFString.of(node.url),
    });
    struct.set(PDFName.of("A"), action);
  }
  if (node.scope && node.tag === "TH") {
    struct.set(PDFName.of("Scope"), PDFName.of(node.scope));
  }

  let kidsArray;
  if (node.children && node.children.length > 0) {
    kidsArray = ctx.obj([]);
    struct.set(PDFName.of("K"), kidsArray);
  }

  let mcid;
  const hasText = typeof node.text === "string" && node.text.trim() !== "";
  if (hasText && !kidsArray) {
    mcid = pageCtx.nextMcid++;
    struct.set(PDFName.of("K"), PDFNumber.of(mcid));
  }

  const structRef = ctx.register(struct);
  parentKids.push(structRef);

  if (typeof mcid === "number") {
    pageCtx.parentRefs[mcid] = structRef;
    const item = buildContentItem({ node, mcid, pageCtx });
    pageCtx.items.push(item);
  }

  if (kidsArray) {
    if (hasText) {
      const spanNode = {
        tag: "Span",
        text: node.text,
        actualText: node.actualText,
        lang: node.lang,
        url: node.url,
      };
      createStructElem({
        node: spanNode,
        parentRef: structRef,
        parentKids: kidsArray,
        pageCtx,
        ctx,
        usedTags,
      });
    }
    for (const child of node.children) {
      createStructElem({
        node: child,
        parentRef: structRef,
        parentKids: kidsArray,
        pageCtx,
        ctx,
        usedTags,
      });
    }
  }

  return structRef;
}

function buildContentItem({ node, mcid, pageCtx }) {
  const text = node.actualText || node.text || "";
  const lines = text
    .split(/[\r\n]+/)
    .map(line => line.trim())
    .filter(line => line.length > 0);
  if (lines.length === 0) lines.push(" ");

  const fontSize = 12;
  const lineHeight = 14;
  const x = 36;
  const y = pageCtx.nextY;
  const url = node.url;

  pageCtx.nextY -= lineHeight * lines.length + 4;

  return {
    mcid,
    tag: node.tag,
    lines,
    actualText: text,
    lang: node.lang,
    x,
    y,
    fontSize,
    lineHeight,
    url,
  };
}

function buildAccessibleContentStream(ctx, pageCtx) {
  if (pageCtx.items.length === 0) return undefined;

  const ops = [];

  for (const item of pageCtx.items) {
    const props = ctx.obj({
      MCID: PDFNumber.of(item.mcid),
      ActualText: PDFHexString.fromText(item.actualText || ""),
    });
    if (item.lang) {
      props.set(PDFName.of("Lang"), PDFString.of(item.lang));
    }

    const tagName = typeof item.tag === "string" && item.tag.length > 0 ? item.tag : "Span";
    ops.push(
      PDFOperator.of(Ops.BeginMarkedContentSequence, [
        PDFName.of(tagName),
        props,
      ]),
    );

    let lineIndex = 0;
    for (const line of item.lines) {
      const yOffset = item.y - lineIndex * item.lineHeight;
      ops.push(PDFOperator.of(Ops.BeginText));
      ops.push(
        PDFOperator.of(Ops.SetFontAndSize, [
          PDFName.of(pageCtx.font.name),
          PDFNumber.of(item.fontSize),
        ]),
      );
      ops.push(PDFOperator.of(Ops.SetTextRenderingMode, [PDFNumber.of(3)]));
      ops.push(
        PDFOperator.of(Ops.SetTextMatrix, [
          PDFNumber.of(1),
          PDFNumber.of(0),
          PDFNumber.of(0),
          PDFNumber.of(1),
          PDFNumber.of(item.x),
          PDFNumber.of(yOffset),
        ]),
      );
      ops.push(PDFOperator.of(Ops.ShowText, [PDFHexString.fromText(line)]));
      ops.push(PDFOperator.of(Ops.EndText));
      lineIndex += 1;
    }

    ops.push(PDFOperator.of(Ops.EndMarkedContent));
  }

  const stream = ctx.contentStream(ops);
  return ctx.register(stream);
}

function wrapPageContentWithArtifact(ctx, page, accessibleStreamRef) {
  const existing = page.node.Contents();
  const start = ctx.contentStream([
    PDFOperator.of(Ops.BeginMarkedContent, [PDFName.of("Artifact")]),
  ]);
  const end = ctx.contentStream([PDFOperator.of(Ops.EndMarkedContent)]);
  const startRef = ctx.register(start);
  const endRef = ctx.register(end);

  const refs = [];
  refs.push(startRef);

  if (existing instanceof PDFArray) {
    for (let idx = 0; idx < existing.size(); idx += 1) {
      const value = existing.get(idx);
      if (value instanceof PDFRef) {
        refs.push(value);
      } else if (value instanceof PDFStream) {
        refs.push(ctx.register(value));
      }
    }
  } else if (existing instanceof PDFRef) {
    refs.push(existing);
  } else if (existing instanceof PDFStream) {
    refs.push(ctx.register(existing));
  }

  refs.push(endRef);
  if (accessibleStreamRef) refs.push(accessibleStreamRef);

  const arr = ctx.obj(refs);
  page.node.set(PDFName.of("Contents"), arr);
}

function ensureFontResource(ctx, page, font) {
  const resources = page.node.Resources() || ctx.obj({});
  let fonts = resources.lookup(PDFName.of("Font"), PDFDict);
  if (!fonts) {
    fonts = ctx.obj({});
    resources.set(PDFName.of("Font"), fonts);
  }
  fonts.set(PDFName.of(font.name), font.ref);
  page.node.set(PDFName.of("Resources"), resources);
}

function asDict(ctx, value) {
  if (!value) return undefined;
  if (value instanceof PDFDict) return value;
  if (value instanceof PDFRef) {
    const lookedUp = ctx.lookup(value);
    return lookedUp instanceof PDFDict ? lookedUp : undefined;
  }
  return undefined;
}

function asStream(ctx, value) {
  if (!value) return undefined;
  if (value instanceof PDFStream) return value;
  if (value instanceof PDFRef) {
    const lookedUp = ctx.lookup(value);
    return lookedUp instanceof PDFStream ? lookedUp : undefined;
  }
  return undefined;
}

function addImageFigures({ ctx, page, parentRef, parentKids, usedTags }) {
  const res = asDict(ctx, page.node.Resources());
  if (!res) return;

  const xoRaw = res.lookupMaybe(PDFName.of("XObject"), PDFDict);
  const xo = asDict(ctx, xoRaw);
  if (!xo) return;

  for (const key of xo.keys()) {
    const entry = xo.get(key);
    const stream = asStream(ctx, entry);
    if (!stream) continue;

    const subtype = stream.dict.lookupMaybe(PDFName.of("Subtype"), PDFName);
    if (subtype?.decodeText() !== "Image") continue;

    const alt = stream.dict.lookupMaybe(
      PDFName.of("Alt"),
      PDFString,
      PDFHexString,
    );
    if (!alt) {
      // Decorative image – mark as artifact
      continue;
    }

    let imageRef = entry instanceof PDFRef ? entry : ctx.getObjectRef(stream);
    if (!imageRef) {
      imageRef = ctx.register(stream);
      xo.set(key, imageRef);
    }

    const objr = ctx.obj({ Type: PDFName.of("OBJR"), Obj: imageRef });
    const objrRef = ctx.register(objr);
    const fig = ctx.obj({
      Type: "StructElem",
      S: PDFName.of("Figure"),
      Alt: alt,
      Pg: page.ref,
      P: parentRef,
      K: objrRef,
    });
    const figRef = ctx.register(fig);
    parentKids.push(figRef);
    usedTags.add("Figure");
  }
}

function populateRoleMap(ctx, roleMap, usedTags) {
  const standard = new Map([
    ["Document", "Document"],
    ["Sect", "Sect"],
    ["Part", "Part"],
    ["Div", "Div"],
    ["P", "P"],
    ["Span", "Span"],
    ["Quote", "BlockQuote"],
    ["Link", "Link"],
    ["Annot", "Annot"],
    ["Figure", "Figure"],
    ["Formula", "Formula"],
    ["Caption", "Caption"],
    ["L", "L"],
    ["LI", "LI"],
    ["Lbl", "Lbl"],
    ["LBody", "LBody"],
    ["Table", "Table"],
    ["TR", "TR"],
    ["TH", "TH"],
    ["TD", "TD"],
    ["THead", "THead"],
    ["TBody", "TBody"],
    ["TFoot", "TFoot"],
    ["H1", "H1"],
    ["H2", "H2"],
    ["H3", "H3"],
    ["H4", "H4"],
    ["H5", "H5"],
    ["H6", "H6"],
  ]);

  for (const tag of usedTags) {
    const mapped = standard.get(tag) || "Span";
    roleMap.set(PDFName.of(tag), PDFName.of(mapped));
  }
}

function collectOutlineCandidates(nodes) {
  const out = [];
  for (const node of nodes) {
    if (node.tag && node.tag.startsWith("H")) {
      const level = Number(node.tag.slice(1));
      if (!Number.isNaN(level) && level <= 2 && node.text) {
        out.push(node.text);
      }
    }
    if (node.children && node.children.length > 0) {
      out.push(...collectOutlineCandidates(node.children));
    }
  }
  return out;
}
