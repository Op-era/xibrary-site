"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const zlib = require("node:zlib");
const catalogue = require("./catalogue.js");

const root = path.join(__dirname, "..");

function u16(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
}

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
}

function buildZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  entries.forEach(function (entry) {
    const name = Buffer.from(entry.name);
    const raw = Buffer.from(entry.data);
    const data = zlib.deflateRawSync(raw);
    const crc = zlib.crc32(raw);
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0), u16(8), u16(0), u16(0),
      u32(crc), u32(data.length), u32(raw.length),
      u16(name.length), u16(0), name, data
    ]);
    const central = Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(8), u16(0), u16(0),
      u32(crc), u32(data.length), u32(raw.length),
      u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0),
      u32(offset), name
    ]);
    offset += local.length;
    locals.push(local);
    centrals.push(central);
  });
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(centralBuf.length), u32(offset), u16(0)
  ]);
  return Buffer.concat(locals.concat([centralBuf, eocd]));
}

test("example catalogue scores one complete part and two incomplete parts", function () {
  const csv = fs.readFileSync(path.join(__dirname, "example-catalogue.csv"), "utf8");
  const result = catalogue.rowsToParts(catalogue.parseCsv(csv));
  assert.equal(result.parts.length, 3);
  assert.deepEqual(result.warnings, []);

  const gear = catalogue.analyzePart(result.parts[0]);
  assert.equal(gear.complete, true);
  assert.deepEqual(gear.missing, []);
  assert.deepEqual(gear.optionalMissing, ["specsExtractionMethod"]);
  assert.equal(result.parts[0].priceCents, 1499);
  assert.equal(result.parts[0].itarFlag, false);
  assert.equal(result.parts[0].specs.voltageV, 12);
  assert.equal(result.parts[0].specs.noLoadRpm, 100);

  const sensor = catalogue.analyzePart(result.parts[1]);
  assert.equal(sensor.complete, false);
  assert.deepEqual(sensor.missing, [
    "leadTimeDays", "moq", "listingUrl", "datasheetUrl", "specs", "imageUrl",
    "eccn", "itarFlag", "classificationSource", "confidenceTier"
  ]);
  assert.deepEqual(sensor.present, ["name", "sku", "category", "subcategory", "price", "currency"]);
  assert.ok(sensor.optionalMissing.includes("stockQty"));
  assert.ok(!sensor.optionalMissing.includes("subcategory"));

  const bracket = catalogue.analyzePart(result.parts[2]);
  assert.equal(bracket.complete, false);
  assert.ok(bracket.missing.includes("price"));
  assert.ok(bracket.missing.includes("imageUrl"));
  assert.ok(bracket.missing.includes("category"));
});

test("spreadsheet headers, aliases, and invalid values become gaps the supplier can correct", function () {
  const csv = [
    "Part Name,MPN,Unit Price (USD),Lead Time,ECCN,ITAR,Specs,Voltage,Datasheet",
    "\"Widget, geared\",ABC-1,14.99,2 weeks,n/a,no,not specs,12,datasheet.pdf",
    "Other,ABC-2,1499 cents,soon,EAR99,yes,torqueNm=2,24,https://example.invalid/ds.pdf"
  ].join("\n");
  const result = catalogue.rowsToParts(catalogue.parseCsv(csv));
  assert.equal(result.parts.length, 2);
  assert.deepEqual(result.specColumns, ["Voltage"]);

  const first = result.parts[0];
  assert.equal(first.name, "Widget, geared");
  assert.equal(first.sku, "ABC-1");
  assert.equal(first.priceCents, 1499);
  assert.equal(first.currency, "USD");
  assert.equal(first.leadTimeDays, 14);
  assert.equal(first.itarFlag, false);
  assert.equal(first.specs.Voltage, 12);
  assert.equal(first.eccn, "");
  assert.equal(first.draft.datasheetUrl, "datasheet.pdf");
  const gaps = catalogue.analyzePart(first);
  assert.ok(gaps.missing.includes("datasheetUrl"));
  assert.ok(gaps.missing.includes("eccn"));
  assert.ok(gaps.missing.includes("imageUrl"));
  assert.equal(gaps.complete, false);

  catalogue.setField(first, "leadTimeDays", "3 days");
  assert.equal(first.leadTimeDays, 3);
  catalogue.setField(first, "datasheetUrl", "https://example.invalid/widget.pdf");
  catalogue.setField(first, "imageUrl", "https://example.invalid/widget.png");
  catalogue.setField(first, "eccn", "EAR99");
  catalogue.setField(first, "classificationSource", "example-fixture");
  catalogue.setField(first, "confidenceTier", "UNKNOWN");
  catalogue.setField(first, "moq", "1");
  catalogue.setField(first, "listingUrl", "https://example.invalid/widget");
  catalogue.setField(first, "category", "electronics");
  let afterUnknown = catalogue.analyzePart(first);
  assert.ok(afterUnknown.missing.includes("confidenceTier"));
  assert.ok(!afterUnknown.missing.includes("datasheetUrl"));
  assert.ok(!afterUnknown.missing.includes("imageUrl"));

  catalogue.setField(first, "confidenceTier", "AUTO_CLASSIFIED");
  afterUnknown = catalogue.analyzePart(first);
  assert.equal(afterUnknown.complete, true);

  const second = result.parts[1];
  assert.equal(second.priceCents, null);
  assert.equal(second.draft.price, "1499 cents");
  assert.equal(second.leadTimeDays, null);
  assert.equal(second.itarFlag, true);
  assert.equal(second.specs.torqueNm, 2);
  assert.equal(second.specs.Voltage, 24);
});

test("semicolon CSV and a weak id column do not clobber a real SKU", function () {
  const csv = "name;id;sku;price_cents\nMotor;SHOULD-NOT-WIN;REAL-1;2500\n";
  const result = catalogue.rowsToParts(catalogue.parseCsv(csv));
  assert.equal(result.parts[0].sku, "REAL-1");
  assert.equal(result.parts[0].priceCents, 2500);
});

test("xlsx and ods workbooks parse into the same gap report", async function () {
  const shared = `<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <si><t>name</t></si>
  <si><t>sku</t></si>
  <si><t>price</t></si>
  <si><t>Example &amp; Gearmotor</t></si>
  <si><t>EX-9</t></si>
</sst>`;
  const sheet = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="s"><v>0</v></c>
      <c r="B1" t="s"><v>1</v></c>
      <c r="C1" t="inlineStr"><is><t>price</t></is></c>
    </row>
    <row r="2">
      <c r="A2" t="s"><v>3</v></c>
      <c r="B2" t="s"><v>4</v></c>
      <c r="C2"><v>14.99</v></c>
    </row>
  </sheetData>
</worksheet>`;
  const xlsx = buildZip([
    { name: "xl/sharedStrings.xml", data: shared },
    { name: "xl/worksheets/sheet1.xml", data: sheet }
  ]);
  const xlsxRows = await catalogue.parseWorkbook(xlsx);
  const xlsxParts = catalogue.rowsToParts(xlsxRows).parts;
  assert.equal(xlsxParts.length, 1);
  assert.equal(xlsxParts[0].name, "Example & Gearmotor");
  assert.equal(xlsxParts[0].sku, "EX-9");
  assert.equal(xlsxParts[0].priceCents, 1499);
  assert.equal(catalogue.analyzePart(xlsxParts[0]).complete, false);
  assert.ok(catalogue.analyzePart(xlsxParts[0]).missing.includes("leadTimeDays"));

  const ods = `<?xml version="1.0"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">
<office:body><office:spreadsheet><table:table>
<table:table-row>
  <table:table-cell><text:p>name</text:p></table:table-cell>
  <table:table-cell><text:p>sku</text:p></table:table-cell>
  <table:table-cell><text:p>lead_time_days</text:p></table:table-cell>
</table:table-row>
<table:table-row>
  <table:table-cell><text:p>Bracket</text:p></table:table-cell>
  <table:table-cell office:value-type="float" office:value="3"><text:p>ignored</text:p></table:table-cell>
  <table:table-cell><text:p>1 week</text:p></table:table-cell>
</table:table-row>
<table:table-row table:number-rows-repeated="5"/>
</table:table></office:spreadsheet></office:body></office:document-content>`;
  const odsRows = await catalogue.parseWorkbook(buildZip([{ name: "content.xml", data: ods }]));
  const odsParts = catalogue.rowsToParts(odsRows).parts;
  assert.equal(odsParts.length, 1);
  assert.equal(odsParts[0].name, "Bracket");
  assert.equal(odsParts[0].sku, "3");
  assert.equal(odsParts[0].leadTimeDays, 7);
});

test("saved gap state round-trips and export never self-verifies the supplier", function () {
  const part = catalogue.blankPart();
  catalogue.setField(part, "name", "Loose screw");
  catalogue.setField(part, "confidenceTier", "VERIFIED");
  const state = { supplierName: "", updatedAt: "2026-10-03T00:00:00.000Z", parts: [part] };
  const restored = catalogue.hydrateState(catalogue.serializeState(state));
  assert.equal(restored.parts.length, 1);
  assert.equal(restored.parts[0].name, "Loose screw");
  assert.equal(restored.parts[0].analysis.complete, false);
  assert.ok(restored.parts[0].analysis.missing.includes("price"));
  assert.ok(!restored.parts[0].analysis.missing.includes("confidenceTier"));

  const exported = catalogue.exportSubmission(restored);
  assert.equal(exported.parts[0].listings[0].supplierTrustTier, "UNVERIFIED");
  assert.equal(exported.parts[0].listings[0].lastVerifiedAt, null);
  assert.deepEqual(exported.submissionGaps, ["supplier"]);
  assert.match(exported.note, /Not a published/);
  assert.equal(exported.parts[0].imageUrl, null);
});

test("the marketing site links the intake and does not add a public parts directory", function () {
  const home = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const page = fs.readFileSync(path.join(root, "suppliers", "index.html"), "utf8");
  assert.match(home, /href="\/suppliers\/"/);
  assert.match(page, /not publish a public parts directory/);
  assert.equal(fs.existsSync(path.join(root, "parts", "index.html")), false);
  assert.doesNotMatch(page, /href="\/parts/);
  const nav = home.slice(home.indexOf("<nav"), home.indexOf("</nav>"));
  assert.equal(nav.includes('\\"'), false);
  assert.match(nav, /class="nav-toggle"/);
});
