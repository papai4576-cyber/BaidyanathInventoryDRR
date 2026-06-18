const fs = require("fs");
const path = require("path");
const { parseStringPromise } = require("xml2js");

const WSDL_PATH = path.join(__dirname, "..", "docs", "uniware19.wsdl");
const MAX_DEPTH = 6;

function stripPrefix(name) {
  return name.replace(/^[a-zA-Z0-9]+:/, "");
}

async function main() {
  const xml = fs.readFileSync(WSDL_PATH, "utf-8");
  const parsed = await parseStringPromise(xml, {
    explicitArray: true,
    tagNameProcessors: [stripPrefix],
    attrNameProcessors: [stripPrefix],
  });

  const schemas = parsed.definitions.types[0].schema;
  const elementsByName = new Map();
  const complexTypesByName = new Map();

  for (const schema of schemas) {
    for (const el of schema.element || []) {
      elementsByName.set(el.$.name, el);
    }
    for (const ct of schema.complexType || []) {
      complexTypesByName.set(ct.$.name, ct);
    }
  }

  function describeComplexType(ct, depth, lines, indent) {
    const seq = ct.sequence?.[0];
    if (!seq) return;
    for (const child of seq.element || []) {
      const name = child.$.name;
      const type = child.$.type ? stripPrefix(child.$.type) : null;
      const minOccurs = child.$.minOccurs ?? "1";
      const maxOccurs = child.$.maxOccurs ?? "1";
      const required = minOccurs === "0" ? "optional" : "required";
      lines.push(`${indent}${name}: ${type || "(inline complexType)"} [${required}, maxOccurs=${maxOccurs}]`);

      if (depth >= MAX_DEPTH) {
        lines.push(`${indent}  ... (max depth reached)`);
        continue;
      }

      let nestedCt = null;
      if (child.complexType) {
        nestedCt = child.complexType[0];
      } else if (type && complexTypesByName.has(type)) {
        nestedCt = complexTypesByName.get(type);
      }
      if (nestedCt) {
        describeComplexType(nestedCt, depth + 1, lines, indent + "  ");
      }
    }
  }

  function describeElement(elementName) {
    const lines = [`### ${elementName}`];
    const el = elementsByName.get(elementName);
    if (!el) {
      lines.push("  NOT FOUND in WSDL");
      return lines;
    }
    const ct = el.complexType?.[0];
    if (!ct) {
      lines.push("  (simple/empty element, no nested fields)");
      return lines;
    }
    describeComplexType(ct, 0, lines, "  ");
    return lines;
  }

  const targets = [
    "SearchSaleOrderRequest",
    "SearchSaleOrderResponse",
    "GetSaleOrderRequest",
    "GetSaleOrderResponse",
    "GetItemTypeInventoryRequest",
    "GetItemTypeInventoryResponse",
    "GetBulkItemTypeInventoryRequest",
    "GetBulkItemTypeInventoryResponse",
    "GetInventorySnapshotRequest",
    "GetInventorySnapshotResponse",
    "SearchOptions",
  ];

  const out = [];
  for (const t of targets) {
    out.push(...describeElement(t), "");
  }

  const outPath = path.join(__dirname, "..", "docs", "soap-operations.md");
  fs.writeFileSync(
    outPath,
    "# Unicommerce SOAP Operation Schemas (auto-extracted from uniware19.wsdl)\n\n" + out.join("\n") + "\n"
  );
  console.log("Wrote", outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
