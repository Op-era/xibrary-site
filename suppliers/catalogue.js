"use strict";

/*
 * Supplier catalogue intake.
 *
 * Parses a CSV/TSV or spreadsheet, scores every part against the fields
 * Xibrary already uses to list a part (see openapi.yaml Part, Listing, and
 * ComplianceRecord, plus the live specsConfidence / specsExtractionMethod
 * fields), and keeps the submission in this browser.
 *
 * Submissions are not published. There is no public parts directory on this
 * site, and supplier trust is always recorded as UNVERIFIED.
 *
 * Image URL is required here even though the public read API does not return
 * an image yet — a listing an agent can use still needs one.
 */

(function (root) {
  var STORAGE_KEY = "xibrary.supplierCatalogue.v1";
  var MAX_PARTS = 2000;

  var FIELDS = [
    { key: "name", label: "Part name", required: true, type: "text" },
    { key: "sku", label: "SKU", required: true, type: "text" },
    { key: "category", label: "Category", required: true, type: "text" },
    { key: "subcategory", label: "Subcategory", required: false, type: "text" },
    { key: "price", label: "Price", required: true, type: "text" },
    { key: "currency", label: "Currency", required: true, type: "text" },
    { key: "leadTimeDays", label: "Lead time", required: true, type: "text" },
    { key: "moq", label: "Minimum order quantity", required: true, type: "text" },
    { key: "stockQty", label: "Stock quantity", required: false, type: "text" },
    { key: "listingUrl", label: "Listing URL", required: true, type: "text" },
    { key: "datasheetUrl", label: "Datasheet", required: true, type: "text" },
    { key: "specs", label: "Specs", required: true, type: "textarea" },
    { key: "imageUrl", label: "Image", required: true, type: "text" },
    { key: "eccn", label: "Compliance / ECCN", required: true, type: "text" },
    { key: "itarFlag", label: "ITAR flag", required: true, type: "boolean" },
    { key: "authorizedDistributor", label: "Authorized distributor", required: false, type: "boolean" },
    { key: "classificationSource", label: "Classification source", required: true, type: "text" },
    { key: "confidenceTier", label: "Compliance confidence", required: true, type: "confidence" },
    { key: "specsConfidence", label: "Specs confidence", required: false, type: "confidence" },
    { key: "specsExtractionMethod", label: "How specs were captured", required: false, type: "extraction" }
  ];

  var HEADER_MAP = {
    name: "name",
    partname: "name",
    productname: "name",
    title: "name",
    sku: "sku",
    partnumber: "sku",
    partno: "sku",
    mpn: "sku",
    manufacturerpartnumber: "sku",
    id: "sku",
    partid: "sku",
    category: "category",
    subcategory: "subcategory",
    subcat: "subcategory",
    price: "price",
    unitprice: "price",
    unitpriceusd: "price",
    priceusd: "price",
    pricecents: "priceCents",
    currency: "currency",
    leadtime: "leadTimeDays",
    leadtimedays: "leadTimeDays",
    leadtimeindays: "leadTimeDays",
    moq: "moq",
    minimumorderquantity: "moq",
    minorderqty: "moq",
    minimumorder: "moq",
    stock: "stockQty",
    stockqty: "stockQty",
    stockquantity: "stockQty",
    quantityonhand: "stockQty",
    listingurl: "listingUrl",
    producturl: "listingUrl",
    url: "listingUrl",
    datasheet: "datasheetUrl",
    datasheeturl: "datasheetUrl",
    specsheet: "datasheetUrl",
    datasheetlink: "datasheetUrl",
    image: "imageUrl",
    imageurl: "imageUrl",
    imagelink: "imageUrl",
    photourl: "imageUrl",
    picture: "imageUrl",
    photo: "imageUrl",
    specs: "specs",
    specifications: "specs",
    eccn: "eccn",
    exportcontrol: "eccn",
    exportclassification: "eccn",
    itar: "itarFlag",
    itarflag: "itarFlag",
    itarcontrolled: "itarFlag",
    authorizeddistributor: "authorizedDistributor",
    classificationsource: "classificationSource",
    compliancesource: "classificationSource",
    confidencetier: "confidenceTier",
    complianceconfidence: "confidenceTier",
    specsconfidence: "specsConfidence",
    specsextractionmethod: "specsExtractionMethod",
    extractionmethod: "specsExtractionMethod"
  };

  var SKU_PRIORITY = {
    sku: 3,
    partnumber: 3,
    partno: 3,
    mpn: 3,
    manufacturerpartnumber: 3,
    id: 1,
    partid: 1
  };

  var SUPPLIER_HEADERS = {
    supplier: true,
    suppliername: true,
    company: true,
    companyname: true,
    manufacturer: true
  };

  function blankPart() {
    return {
      localId: generateId(),
      name: "",
      sku: "",
      category: "",
      subcategory: "",
      priceCents: null,
      currency: "",
      leadTimeDays: null,
      moq: null,
      stockQty: null,
      listingUrl: "",
      datasheetUrl: "",
      imageUrl: "",
      specs: {},
      eccn: "",
      itarFlag: null,
      authorizedDistributor: null,
      classificationSource: "",
      confidenceTier: "",
      specsConfidence: "",
      specsExtractionMethod: "",
      draft: {}
    };
  }

  function generateId() {
    return "p" + Math.random().toString(36).slice(2, 10);
  }

  function normHeader(value) {
    return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  }

  function isPlaceholder(value) {
    return /^(n\/a|na|none|null|unknown|tbd|tba|-|—)$/i.test(String(value || "").trim());
  }

  function isHttpUrl(value) {
    return /^https?:\/\/\S+$/i.test(String(value || "").trim());
  }

  function coerceScalar(value) {
    var text = String(value).trim();
    if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
    return text;
  }

  function parseSpecPairs(text) {
    var specs = {};
    String(text || "").split(/[;\n]+/).forEach(function (chunk) {
      var match = chunk.match(/^\s*([^:=]+?)\s*[:=]\s*(.+)\s*$/);
      if (!match) return;
      var key = match[1].trim();
      var raw = match[2].trim();
      if (!key || isPlaceholder(raw)) return;
      specs[key] = coerceScalar(raw);
    });
    return specs;
  }

  function formatSpecs(specs) {
    if (!specs) return "";
    return Object.keys(specs).map(function (key) {
      return key + "=" + specs[key];
    }).join("; ");
  }

  function formatPrice(cents) {
    if (typeof cents !== "number") return "";
    return (cents / 100).toFixed(2);
  }

  function parsePriceToCents(value) {
    var text = String(value || "").trim().replace(/[$,\s]/g, "");
    if (!/^\d+(\.\d+)?$/.test(text)) return null;
    var amount = Number(text);
    if (!isFinite(amount)) return null;
    return Math.round(amount * 100);
  }

  function parseInteger(value) {
    var text = String(value || "").trim().replace(/[, ]/g, "");
    if (!/^\d+$/.test(text)) return null;
    return Number(text);
  }

  function parseLeadTime(value) {
    var text = String(value || "").trim().toLowerCase();
    if (!text || isPlaceholder(text)) return { empty: true };
    var weeks = text.match(/^(\d+(?:\.\d+)?)\s*weeks?$/);
    if (weeks) return { value: Math.round(Number(weeks[1]) * 7) };
    var days = text.match(/^(\d+(?:\.\d+)?)\s*days?$/);
    if (days) return { value: Math.round(Number(days[1])) };
    if (/^\d+$/.test(text)) return { value: Number(text) };
    return { invalid: true };
  }

  function parseBool(value) {
    var text = String(value || "").trim().toLowerCase();
    if (!text || isPlaceholder(text)) return { empty: true };
    if (/^(true|yes|y|1)$/.test(text)) return { value: true };
    if (/^(false|no|n|0)$/.test(text)) return { value: false };
    return { invalid: true };
  }

  function normalizeTier(value) {
    var text = String(value || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
    if (text === "AUTO" || text === "AUTOCLASSIFIED") return "AUTO_CLASSIFIED";
    if (text === "VERIFIED" || text === "AUTO_CLASSIFIED" || text === "UNKNOWN") return text;
    return "";
  }

  function normalizeExtraction(value) {
    var text = String(value || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
    if (text === "LLM" || text === "LLMEXTRACTED") return "LLM_EXTRACTED";
    if (text === "MANUAL" || text === "API" || text === "LLM_EXTRACTED") return text;
    return "";
  }

  function setField(part, key, raw) {
    if (!part.draft) part.draft = {};
    var text = raw == null ? "" : String(raw).trim();

    if (key === "price") return setPrice(part, text, false);
    if (key === "priceCents") return setPrice(part, text, true);
    if (key === "leadTimeDays") return setNumberish(part, key, parseLeadTime(text), text);
    if (key === "moq" || key === "stockQty") {
      if (!text || isPlaceholder(text)) {
        part[key] = null;
        delete part.draft[key];
        return;
      }
      var count = parseInteger(text);
      if (count == null) {
        part[key] = null;
        part.draft[key] = text;
        return;
      }
      part[key] = count;
      delete part.draft[key];
      return;
    }
    if (key === "listingUrl" || key === "datasheetUrl" || key === "imageUrl") {
      if (!text || isPlaceholder(text)) {
        part[key] = "";
        delete part.draft[key];
        return;
      }
      if (!isHttpUrl(text)) {
        part[key] = "";
        part.draft[key] = text;
        return;
      }
      part[key] = text;
      delete part.draft[key];
      return;
    }
    if (key === "specs") return setSpecs(part, text);
    if (key === "itarFlag" || key === "authorizedDistributor") {
      return setNumberish(part, key, parseBool(text), text);
    }
    if (key === "confidenceTier" || key === "specsConfidence") {
      var tier = text ? normalizeTier(text) : "";
      if (!text || (!tier && isPlaceholder(text))) {
        part[key] = "";
        delete part.draft[key];
        return;
      }
      if (!tier) {
        part[key] = "";
        part.draft[key] = text;
        return;
      }
      part[key] = tier;
      delete part.draft[key];
      return;
    }
    if (key === "specsExtractionMethod") {
      if (!text || isPlaceholder(text)) {
        part.specsExtractionMethod = "";
        delete part.draft.specsExtractionMethod;
        return;
      }
      var method = normalizeExtraction(text);
      if (!method) {
        part.specsExtractionMethod = "";
        part.draft.specsExtractionMethod = text;
        return;
      }
      part.specsExtractionMethod = method;
      delete part.draft.specsExtractionMethod;
      return;
    }
    if (key === "currency") {
      if (!text || isPlaceholder(text)) {
        part.currency = "";
        delete part.draft.currency;
        return;
      }
      var code = text.toUpperCase();
      if (!/^[A-Z]{3}$/.test(code)) {
        part.currency = "";
        part.draft.currency = text;
        return;
      }
      part.currency = code;
      delete part.draft.currency;
      return;
    }
    if (!text || isPlaceholder(text)) {
      part[key] = "";
      delete part.draft[key];
      return;
    }
    part[key] = text;
    delete part.draft[key];
  }

  function setPrice(part, text, alreadyCents) {
    if (!text || isPlaceholder(text)) {
      part.priceCents = null;
      delete part.draft.price;
      return;
    }
    var cents = alreadyCents ? parseInteger(text) : parsePriceToCents(text);
    if (cents == null) {
      part.priceCents = null;
      part.draft.price = text;
      return;
    }
    part.priceCents = cents;
    delete part.draft.price;
  }

  function setNumberish(part, key, parsed, text) {
    if (parsed.empty) {
      part[key] = null;
      delete part.draft[key];
      return;
    }
    if (parsed.invalid || (typeof parsed.value !== "number" && typeof parsed.value !== "boolean")) {
      part[key] = null;
      part.draft[key] = text;
      return;
    }
    part[key] = parsed.value;
    delete part.draft[key];
  }

  function setSpecs(part, text) {
    if (!text || isPlaceholder(text)) {
      part.specs = {};
      delete part.draft.specs;
      return;
    }
    if (text.charAt(0) === "{") {
      try {
        var parsed = JSON.parse(text);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          part.specs = parsed;
          delete part.draft.specs;
          return;
        }
      } catch (err) { /* fall through to pair parsing */ }
    }
    var specs = parseSpecPairs(text);
    if (Object.keys(specs).length) {
      part.specs = specs;
      delete part.draft.specs;
      return;
    }
    part.specs = {};
    part.draft.specs = text;
  }

  function addSpec(part, key, raw) {
    var text = raw == null ? "" : String(raw).trim();
    if (!key || !text || isPlaceholder(text)) return;
    if (!part.specs) part.specs = {};
    part.specs[key] = coerceScalar(text);
    if (part.draft) delete part.draft.specs;
  }

  function isFilled(part, key) {
    if (key === "price") return typeof part.priceCents === "number" && part.priceCents >= 0;
    if (key === "leadTimeDays" || key === "moq" || key === "stockQty") {
      return typeof part[key] === "number" && part[key] >= 0;
    }
    if (key === "listingUrl" || key === "datasheetUrl" || key === "imageUrl") return isHttpUrl(part[key]);
    if (key === "specs") return !!(part.specs && Object.keys(part.specs).length);
    if (key === "itarFlag" || key === "authorizedDistributor") return typeof part[key] === "boolean";
    if (key === "confidenceTier") {
      return part.confidenceTier === "VERIFIED" || part.confidenceTier === "AUTO_CLASSIFIED";
    }
    if (key === "specsConfidence") {
      return part.specsConfidence === "VERIFIED" || part.specsConfidence === "AUTO_CLASSIFIED" || part.specsConfidence === "UNKNOWN";
    }
    if (key === "specsExtractionMethod") {
      return part.specsExtractionMethod === "MANUAL" || part.specsExtractionMethod === "API" || part.specsExtractionMethod === "LLM_EXTRACTED";
    }
    if (key === "currency") return /^[A-Z]{3}$/.test(part.currency || "");
    return String(part[key] || "").trim() !== "";
  }

  function analyzePart(part) {
    var missing = [];
    var present = [];
    var optionalMissing = [];
    FIELDS.forEach(function (field) {
      if (isFilled(part, field.key)) {
        present.push(field.key);
        return;
      }
      if (field.required) missing.push(field.key);
      else optionalMissing.push(field.key);
    });
    return {
      complete: missing.length === 0,
      missing: missing,
      present: present,
      optionalMissing: optionalMissing
    };
  }

  function fieldIssue(part, field) {
    if (isFilled(part, field.key)) return "";
    if (field.key === "confidenceTier" && part.confidenceTier === "UNKNOWN") {
      return "UNKNOWN means not reviewed, so this still counts as missing";
    }
    var draft = part.draft && part.draft[field.key];
    if (draft) return '"' + draft + '" is not a value this field can use';
    return "";
  }

  function parseCsv(text) {
    var source = String(text || "").replace(/^\uFEFF/, "");
    if (!source.trim()) return [];
    var delimiter = detectDelimiter(source);
    var rows = [];
    var row = [];
    var cell = "";
    var inQuotes = false;
    for (var i = 0; i < source.length; i++) {
      var ch = source.charAt(i);
      if (inQuotes) {
        if (ch === '"') {
          if (source.charAt(i + 1) === '"') {
            cell += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          cell += ch;
        }
        continue;
      }
      if (ch === '"') {
        inQuotes = true;
        continue;
      }
      if (ch === delimiter) {
        row.push(cell);
        cell = "";
        continue;
      }
      if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && source.charAt(i + 1) === "\n") i++;
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
        continue;
      }
      cell += ch;
    }
    if (cell.length || row.length) {
      row.push(cell);
      rows.push(row);
    }
    return rows.filter(function (line) {
      return line.some(function (value) { return String(value).trim() !== ""; });
    });
  }

  function detectDelimiter(text) {
    var line = "";
    var inQuotes = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (ch === '"') {
        if (inQuotes && text.charAt(i + 1) === '"') {
          line += '"';
          i++;
          continue;
        }
        inQuotes = !inQuotes;
        continue;
      }
      if (!inQuotes && (ch === "\n" || ch === "\r")) break;
      line += ch;
    }
    var counts = { ",": 0, ";": 0, "\t": 0 };
    Object.keys(counts).forEach(function (mark) {
      for (var n = 0; n < line.length; n++) if (line.charAt(n) === mark) counts[mark]++;
    });
    var best = ",";
    var bestCount = counts[","];
    if (counts[";"] > bestCount) {
      best = ";";
      bestCount = counts[";"];
    }
    if (counts["\t"] > bestCount) best = "\t";
    return best;
  }

  function rowsToParts(rows) {
    var warnings = [];
    var table = rows || [];
    if (!table.length) {
      return { parts: [], specColumns: [], supplierName: "", warnings: ["That file has no rows."] };
    }
    var header = table[0].map(function (cell) { return String(cell || "").trim(); });
    var known = header.some(function (cell) { return HEADER_MAP[normHeader(cell)] || SUPPLIER_HEADERS[normHeader(cell)]; });
    if (!known) {
      return {
        parts: [],
        specColumns: [],
        supplierName: "",
        warnings: ["The first row needs column names such as name, sku, price, lead_time_days, datasheet_url."]
      };
    }

    var parts = [];
    var specColumns = [];
    var suppliers = {};
    header.forEach(function (cell) {
      var key = normHeader(cell);
      if (!key || HEADER_MAP[key] || SUPPLIER_HEADERS[key]) return;
      if (key === "notes" || key === "note" || key === "comments" || key === "comment") return;
      if (key === "description" || key === "productdescription") return;
      specColumns.push(cell);
    });

    for (var r = 1; r < table.length; r++) {
      if (parts.length >= MAX_PARTS) {
        warnings.push("Only the first " + MAX_PARTS + " parts were read.");
        break;
      }
      var built = rowToPart(header, table[r]);
      if (built.supplier) suppliers[built.supplier] = true;
      if (!partIsBlank(built.part)) parts.push(built.part);
    }

    var supplierNames = Object.keys(suppliers);
    var supplierName = supplierNames.length === 1 ? supplierNames[0] : "";
    if (supplierNames.length > 1) {
      warnings.push("This file names more than one supplier. The company name on this page is used for the submission.");
    }
    if (!parts.length) warnings.push("No part rows were found under that header.");
    return { parts: parts, specColumns: specColumns, supplierName: supplierName, warnings: warnings };
  }

  function rowToPart(header, row) {
    var part = blankPart();
    var skuPriority = 0;
    var specBlob = "";
    var extras = [];
    var supplier = "";
    for (var c = 0; c < header.length; c++) {
      var label = header[c];
      var key = normHeader(label);
      var value = row[c] == null ? "" : String(row[c]);
      if (!key) continue;
      if (SUPPLIER_HEADERS[key]) {
        var name = value.trim();
        if (name && !isPlaceholder(name)) supplier = name;
        continue;
      }
      if ((key === "description" || key === "productdescription") && !part.name) {
        setField(part, "name", value);
        continue;
      }
      if (key === "notes" || key === "note" || key === "comments" || key === "comment") continue;
      var field = HEADER_MAP[key];
      if (field === "sku") {
        var priority = SKU_PRIORITY[key] || 2;
        if (priority < skuPriority) continue;
        skuPriority = priority;
        setField(part, "sku", value);
        continue;
      }
      if (field === "price" && (key === "unitpriceusd" || key === "priceusd") && !part.currency) {
        part.currency = "USD";
      }
      if (field === "specs") {
        specBlob = value;
        continue;
      }
      if (field) {
        setField(part, field, value);
        continue;
      }
      extras.push([label.trim(), value]);
    }
    if (specBlob.trim()) setField(part, "specs", specBlob);
    extras.forEach(function (pair) { addSpec(part, pair[0], pair[1]); });
    return { part: part, supplier: supplier };
  }

  function partIsBlank(part) {
    if (part.name || part.sku || part.category || part.subcategory) return false;
    if (part.priceCents != null || part.currency || part.leadTimeDays != null || part.moq != null || part.stockQty != null) return false;
    if (part.listingUrl || part.datasheetUrl || part.imageUrl || part.eccn || part.classificationSource) return false;
    if (part.itarFlag != null || part.authorizedDistributor != null) return false;
    if (part.confidenceTier || part.specsConfidence || part.specsExtractionMethod) return false;
    if (part.specs && Object.keys(part.specs).length) return false;
    if (part.draft && Object.keys(part.draft).length) return false;
    return true;
  }

  function exportPart(part, supplierName) {
    return {
      category: part.category || null,
      subcategory: part.subcategory || null,
      name: part.name || null,
      specs: part.specs || {},
      specsExtractionMethod: part.specsExtractionMethod || null,
      specsConfidence: part.specsConfidence || null,
      datasheetUrl: isHttpUrl(part.datasheetUrl) ? part.datasheetUrl : null,
      imageUrl: isHttpUrl(part.imageUrl) ? part.imageUrl : null,
      listings: [{
        supplier: supplierName || "",
        supplierTrustTier: "UNVERIFIED",
        sku: part.sku || "",
        priceCents: typeof part.priceCents === "number" ? part.priceCents : null,
        currency: part.currency || "",
        moq: typeof part.moq === "number" ? part.moq : null,
        leadTimeDays: typeof part.leadTimeDays === "number" ? part.leadTimeDays : null,
        stockQty: typeof part.stockQty === "number" ? part.stockQty : null,
        listingUrl: isHttpUrl(part.listingUrl) ? part.listingUrl : null,
        lastVerifiedAt: null
      }],
      compliance: [{
        confidenceTier: part.confidenceTier || null,
        eccn: part.eccn || null,
        itarFlag: typeof part.itarFlag === "boolean" ? part.itarFlag : null,
        authorizedDistributor: typeof part.authorizedDistributor === "boolean" ? part.authorizedDistributor : null,
        classificationSource: part.classificationSource || null
      }],
      gapAnalysis: analyzePart(part)
    };
  }

  function exportSubmission(state) {
    var supplierName = (state.supplierName || "").trim();
    return {
      note: "Intake submission stored in the supplier's browser. Not a published Xibrary listing. Supplier trust is UNVERIFIED. This file is not a public parts index.",
      supplierName: supplierName,
      updatedAt: state.updatedAt || null,
      submissionGaps: supplierName ? [] : ["supplier"],
      parts: (state.parts || []).map(function (part) { return exportPart(part, supplierName); })
    };
  }

  function serializeState(state) {
    return JSON.stringify({
      version: 1,
      supplierName: state.supplierName || "",
      updatedAt: state.updatedAt || new Date().toISOString(),
      parts: (state.parts || []).map(function (part) {
        var copy = JSON.parse(JSON.stringify(part));
        copy.analysis = analyzePart(part);
        return copy;
      })
    });
  }

  function hydrateState(json) {
    var data = {};
    try {
      data = JSON.parse(json) || {};
    } catch (err) {
      data = {};
    }
    if (!data || typeof data !== "object") data = {};
    return {
      supplierName: typeof data.supplierName === "string" ? data.supplierName : "",
      updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : "",
      parts: Array.isArray(data.parts) ? data.parts.map(hydratePart) : []
    };
  }

  function hydratePart(raw) {
    var part = blankPart();
    if (!raw || typeof raw !== "object") return part;
    Object.keys(part).forEach(function (key) {
      if (key === "localId" || key === "draft" || key === "specs") return;
      if (raw[key] !== undefined) part[key] = raw[key];
    });
    if (typeof raw.localId === "string" && raw.localId) part.localId = raw.localId;
    part.specs = raw.specs && typeof raw.specs === "object" && !Array.isArray(raw.specs) ? raw.specs : {};
    part.draft = raw.draft && typeof raw.draft === "object" ? raw.draft : {};
    part.analysis = analyzePart(part);
    return part;
  }

  async function parseWorkbook(buffer) {
    var files = await unzip(buffer);
    var sheetName = Object.keys(files).filter(function (name) {
      return /xl\/worksheets\/sheet\d+\.xml$/i.test(name);
    }).sort()[0];
    if (sheetName) {
      var shared = findZipFile(files, "xl/sharedStrings.xml");
      return gridFromXlsx(decodeText(files[sheetName]), shared ? decodeText(shared) : "");
    }
    var content = findZipFile(files, "content.xml");
    if (content) return gridFromOds(decodeText(content));
    throw new Error("No sheet was found in that file. Save it as .xlsx, .ods, or .csv and try again.");
  }

  function findZipFile(files, suffix) {
    var wanted = suffix.toLowerCase();
    var names = Object.keys(files);
    for (var i = 0; i < names.length; i++) {
      var name = names[i].replace(/\\/g, "/").toLowerCase();
      if (name === wanted || name.endsWith("/" + wanted)) return files[names[i]];
    }
    return null;
  }

  async function unzip(buffer) {
    var view = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    var eocd = -1;
    var min = Math.max(0, view.length - 22 - 65535);
    for (var i = view.length - 22; i >= min; i--) {
      if (readU32(view, i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error("That spreadsheet could not be read. Save it as .xlsx, .ods, or .csv and try again.");
    var count = readU16(view, eocd + 10);
    var cursor = readU32(view, eocd + 16);
    var files = {};
    for (var n = 0; n < count; n++) {
      if (readU32(view, cursor) !== 0x02014b50) {
        throw new Error("That spreadsheet could not be read. Save it as .xlsx, .ods, or .csv and try again.");
      }
      var method = readU16(view, cursor + 10);
      var compSize = readU32(view, cursor + 20);
      var uncompSize = readU32(view, cursor + 24);
      var nameLen = readU16(view, cursor + 28);
      var extraLen = readU16(view, cursor + 30);
      var commentLen = readU16(view, cursor + 32);
      var localOffset = readU32(view, cursor + 42);
      var name = decodeText(view.subarray(cursor + 46, cursor + 46 + nameLen));
      var localNameLen = readU16(view, localOffset + 26);
      var localExtraLen = readU16(view, localOffset + 28);
      var dataStart = localOffset + 30 + localNameLen + localExtraLen;
      var compressed = view.subarray(dataStart, dataStart + compSize);
      if (compSize === 0 && uncompSize === 0) files[name] = new Uint8Array();
      else if (method === 0) files[name] = compressed;
      else if (method === 8) files[name] = await inflateRaw(compressed);
      else throw new Error("That spreadsheet uses a compression this page cannot read. Save it as .csv and try again.");
      cursor += 46 + nameLen + extraLen + commentLen;
    }
    return files;
  }

  async function inflateRaw(bytes) {
    var copy = bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes);
    var stream = new Blob([copy]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function readU16(view, offset) {
    return view[offset] | (view[offset + 1] << 8);
  }

  function readU32(view, offset) {
    return (view[offset] | (view[offset + 1] << 8) | (view[offset + 2] << 16) | (view[offset + 3] << 24)) >>> 0;
  }

  function decodeText(bytes) {
    return new TextDecoder("utf-8").decode(bytes);
  }

  function decodeXml(value) {
    return String(value || "")
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(Number(n)); })
      .replace(/&#x([0-9a-fA-F]+);/g, function (_, n) { return String.fromCharCode(parseInt(n, 16)); })
      .replace(/&amp;/g, "&");
  }

  function xmlAttr(attrs, name) {
    var pattern = new RegExp("(?:^|\\s)" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*=\\s*\"([^\"]*)\"");
    var match = pattern.exec(attrs || "");
    return match ? decodeXml(match[1]) : "";
  }

  function parseSharedStrings(xml) {
    if (!xml) return [];
    var strings = [];
    var blocks = xml.match(/<si\b[^>]*>[\s\S]*?<\/si>/g) || [];
    blocks.forEach(function (block) {
      var texts = block.match(/<t\b[^>]*>[\s\S]*?<\/t>/g) || [];
      strings.push(texts.map(function (node) {
        var inner = node.replace(/^<t\b[^>]*>/, "").replace(/<\/t>$/, "");
        return decodeXml(inner);
      }).join(""));
    });
    return strings;
  }

  function gridFromXlsx(sheetXml, sharedXml) {
    var shared = parseSharedStrings(sharedXml);
    var cells = [];
    var pattern = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    var match;
    while ((match = pattern.exec(sheetXml))) {
      var ref = xmlAttr(match[1], "r");
      var coord = /^([A-Z]+)(\d+)$/.exec(ref);
      if (!coord) continue;
      cells.push({
        col: columnIndex(coord[1]),
        row: Number(coord[2]),
        value: xlsxCellValue(match[1], match[2] || "", shared)
      });
    }
    return gridFromCells(cells);
  }

  function xlsxCellValue(attrs, inner, shared) {
    var type = xmlAttr(attrs, "t");
    var valueMatch = inner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
    var raw = valueMatch ? decodeXml(valueMatch[1]).trim() : "";
    if (type === "s") {
      var index = Number(raw);
      return shared[index] != null ? shared[index] : "";
    }
    if (type === "inlineStr") {
      var texts = inner.match(/<t\b[^>]*>[\s\S]*?<\/t>/g) || [];
      return texts.map(function (node) {
        return decodeXml(node.replace(/^<t\b[^>]*>/, "").replace(/<\/t>$/, ""));
      }).join("");
    }
    if (type === "b") return raw === "1" || raw === "true" ? "true" : "false";
    return raw;
  }

  function columnIndex(letters) {
    var n = 0;
    for (var i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
    return n - 1;
  }

  function gridFromCells(cells) {
    if (!cells.length) return [];
    var byRow = {};
    var maxCol = 0;
    cells.forEach(function (cell) {
      if (!byRow[cell.row]) byRow[cell.row] = {};
      byRow[cell.row][cell.col] = cell.value;
      if (cell.col > maxCol) maxCol = cell.col;
    });
    return Object.keys(byRow).map(Number).sort(function (a, b) { return a - b; }).map(function (rowNumber) {
      var line = [];
      for (var col = 0; col <= maxCol; col++) line.push(byRow[rowNumber][col] || "");
      return line;
    });
  }

  function gridFromOds(xml) {
    var tableMatch = xml.match(/<table:table\b[^>]*>([\s\S]*?)<\/table:table>/);
    if (!tableMatch) return [];
    var rows = [];
    var rowPattern = /<table:table-row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/table:table-row>)/g;
    var rowMatch;
    while ((rowMatch = rowPattern.exec(tableMatch[1]))) {
      var line = [];
      var inner = rowMatch[2] || "";
      var cellPattern = /<table:(?:table-cell|covered-table-cell)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/table:(?:table-cell|covered-table-cell)>)/g;
      var cellMatch;
      while ((cellMatch = cellPattern.exec(inner))) {
        var repeat = Number(xmlAttr(cellMatch[1], "table:number-columns-repeated") || "1");
        if (!isFinite(repeat) || repeat < 1) repeat = 1;
        var value = odsCellValue(cellMatch[1], cellMatch[2] || "");
        if (!value && repeat > 1) repeat = 1;
        if (repeat > 30) repeat = 30;
        for (var n = 0; n < repeat; n++) line.push(value);
      }
      var rowRepeat = Number(xmlAttr(rowMatch[1], "table:number-rows-repeated") || "1");
      if (!isFinite(rowRepeat) || rowRepeat < 1) rowRepeat = 1;
      var empty = line.every(function (value) { return !String(value).trim(); });
      if (empty) rowRepeat = 1;
      if (rowRepeat > 30) rowRepeat = 30;
      for (var r = 0; r < rowRepeat; r++) rows.push(line.slice());
    }
    return rows.filter(function (line) {
      return line.some(function (value) { return String(value).trim() !== ""; });
    });
  }

  function odsCellValue(attrs, inner) {
    var type = xmlAttr(attrs, "office:value-type");
    if (type === "float" || type === "currency" || type === "percentage") {
      var numeric = xmlAttr(attrs, "office:value");
      if (numeric) return numeric;
    }
    if (type === "boolean") {
      var flag = xmlAttr(attrs, "office:boolean-value");
      if (flag) return flag;
    }
    var paragraphs = inner.match(/<text:p\b[^>]*>[\s\S]*?<\/text:p>/g) || [];
    return paragraphs.map(function (paragraph) {
      return decodeXml(paragraph.replace(/<[^>]+>/g, "")).trim();
    }).filter(Boolean).join(" ");
  }

  function fieldByKey(key) {
    for (var i = 0; i < FIELDS.length; i++) if (FIELDS[i].key === key) return FIELDS[i];
    return { key: key, label: key, required: false };
  }

  function fieldValueForInput(part, key) {
    if (part.draft && part.draft[key] != null && part.draft[key] !== "") return String(part.draft[key]);
    if (key === "price") return formatPrice(part.priceCents);
    if (key === "leadTimeDays" || key === "moq" || key === "stockQty") {
      return typeof part[key] === "number" ? String(part[key]) : "";
    }
    if (key === "itarFlag" || key === "authorizedDistributor") {
      if (part[key] === true) return "true";
      if (part[key] === false) return "false";
      return "";
    }
    if (key === "specs") return formatSpecs(part.specs);
    return part[key] == null ? "" : String(part[key]);
  }

  function displayField(part, field) {
    if (field.key === "price") {
      var amount = formatPrice(part.priceCents);
      return part.currency ? part.currency + " " + amount : amount;
    }
    if (field.key === "leadTimeDays") return part.leadTimeDays + " days";
    if (field.key === "itarFlag") return part.itarFlag ? "Yes — ITAR applies" : "No";
    if (field.key === "authorizedDistributor") return part.authorizedDistributor ? "Yes" : "No";
    if (field.key === "specs") return formatSpecs(part.specs);
    return part[field.key] == null ? "" : String(part[field.key]);
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  var api = {
    STORAGE_KEY: STORAGE_KEY,
    FIELDS: FIELDS,
    blankPart: blankPart,
    setField: setField,
    analyzePart: analyzePart,
    parseCsv: parseCsv,
    rowsToParts: rowsToParts,
    parseWorkbook: parseWorkbook,
    exportPart: exportPart,
    exportSubmission: exportSubmission,
    serializeState: serializeState,
    hydrateState: hydrateState,
    formatSpecs: formatSpecs
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.XibraryCatalogue = api;

  if (typeof document === "undefined") return;
  var app = document.getElementById("catalogue-app");
  if (app) initCatalogue(app);

  function initCatalogue(rootEl) {
    var state = loadState();
    var supplierInput = document.getElementById("supplier-name");
    var fileInput = document.getElementById("catalogue-file");
    var summary = document.getElementById("catalogue-summary");
    var report = document.getElementById("catalogue-report");
    var alertBox = document.getElementById("catalogue-alert");

    supplierInput.value = state.supplierName;
    document.getElementById("intake-form").addEventListener("submit", function (event) {
      event.preventDefault();
    });
    supplierInput.addEventListener("input", function () {
      state.supplierName = supplierInput.value;
      persist();
      renderSummary();
    });

    fileInput.addEventListener("change", function () {
      var file = fileInput.files && fileInput.files[0];
      fileInput.value = "";
      if (file) readFile(file);
    });

    document.getElementById("load-example").addEventListener("click", function () {
      fetch("/suppliers/example-catalogue.csv")
        .then(function (response) {
          if (!response.ok) throw new Error("The example catalogue could not be loaded.");
          return response.text();
        })
        .then(function (text) {
          ingestRows(parseCsv(text), "Loaded the example catalogue. It is fixture data, not a real supplier.");
        })
        .catch(function (err) {
          showMessage(err.message || "The example catalogue could not be loaded.", "error");
        });
    });

    document.getElementById("add-part").addEventListener("click", function () {
      var part = blankPart();
      part.analysis = analyzePart(part);
      state.parts.push(part);
      persist();
      render();
      var card = document.getElementById("part-" + part.localId);
      if (card) card.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    document.getElementById("recheck-all").addEventListener("click", function () {
      state.parts.forEach(function (part) { part.analysis = analyzePart(part); });
      persist();
      render();
      showMessage("Re-checked " + state.parts.length + " part" + (state.parts.length === 1 ? "" : "s") + ".", "ok");
    });

    document.getElementById("download-report").addEventListener("click", function () {
      var payload = JSON.stringify(exportSubmission(state), null, 2);
      var blob = new Blob([payload], { type: "application/json" });
      var link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "xibrary-catalogue-gap-report.json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
    });

    document.getElementById("clear-catalogue").addEventListener("click", function () {
      if (!state.parts.length && !state.supplierName) return;
      if (!window.confirm("Clear this catalogue from this browser? The downloaded JSON, if you saved one, is the only other copy.")) return;
      state = { supplierName: "", updatedAt: "", parts: [] };
      supplierInput.value = "";
      try { window.localStorage.removeItem(STORAGE_KEY); } catch (err) { /* ignore */ }
      showMessage("Cleared the catalogue stored in this browser.", "ok");
      render();
    });

    report.addEventListener("submit", function (event) {
      var form = event.target;
      if (!form.dataset || !form.dataset.localId) return;
      event.preventDefault();
      var part = findPart(form.dataset.localId);
      if (!part) return;
      FIELDS.forEach(function (field) {
        var input = form.elements[field.key];
        if (input) setField(part, field.key, input.value);
      });
      part.analysis = analyzePart(part);
      persist();
      render();
    });

    report.addEventListener("click", function (event) {
      var button = event.target.closest("[data-remove]");
      if (!button) return;
      var localId = button.getAttribute("data-remove");
      state.parts = state.parts.filter(function (part) { return part.localId !== localId; });
      persist();
      render();
    });

    window.addEventListener("storage", function (event) {
      if (event.key !== STORAGE_KEY) return;
      state = loadState();
      supplierInput.value = state.supplierName;
      render();
    });

    render();

    function readFile(file) {
      if (file.size > 5 * 1024 * 1024) {
        showMessage("That file is over 5 MB. Split it, or export a smaller CSV.", "error");
        return;
      }
      var name = (file.name || "").toLowerCase();
      if (/\.xls$/.test(name) && !/\.xlsx$/.test(name)) {
        showMessage("Old .xls workbooks are not read here. Save the sheet as .xlsx, .ods, or .csv.", "error");
        return;
      }
      var reader = new FileReader();
      reader.onerror = function () {
        showMessage("That file could not be read.", "error");
      };
      if (/\.(xlsx|ods)$/.test(name)) {
        reader.onload = function () {
          parseWorkbook(reader.result).then(function (rows) {
            ingestRows(rows, "Added parts from " + file.name + ".");
          }).catch(function (err) {
            showMessage(err.message || "That spreadsheet could not be read.", "error");
          });
        };
        reader.readAsArrayBuffer(file);
        return;
      }
      reader.onload = function () {
        try {
          ingestRows(parseCsv(String(reader.result || "")), "Added parts from " + file.name + ".");
        } catch (err) {
          showMessage(err.message || "That file could not be read.", "error");
        }
      };
      reader.readAsText(file);
    }

    function ingestRows(rows, prefix) {
      var result = rowsToParts(rows);
      if (!result.parts.length) {
        showMessage(result.warnings.join(" ") || "No parts were found in that file.", "error");
        return;
      }
      if (!state.supplierName.trim() && result.supplierName) {
        state.supplierName = result.supplierName;
        supplierInput.value = result.supplierName;
      }
      result.parts.forEach(function (part) {
        part.analysis = analyzePart(part);
        state.parts.push(part);
      });
      if (state.parts.length > MAX_PARTS) {
        state.parts = state.parts.slice(0, MAX_PARTS);
        result.warnings.push("Only the first " + MAX_PARTS + " parts are kept on this page.");
      }
      persist();
      render();
      summary.scrollIntoView({ block: "start" });
      var message = prefix + " " + result.parts.length + " part" + (result.parts.length === 1 ? "" : "s") + ".";
      if (result.specColumns.length) {
        message += " Unmapped columns were stored as specs: " + result.specColumns.join(", ") + ".";
      }
      if (result.warnings.length) message += " " + result.warnings.join(" ");
      showMessage(message, "ok");
    }

    function render() {
      var scrollY = window.scrollY;
      renderSummary();
      if (!state.parts.length) {
        report.innerHTML = "";
        window.scrollTo(0, scrollY);
        return;
      }
      report.innerHTML = state.parts.map(renderPart).join("");
      window.scrollTo(0, scrollY);
    }

    function renderSummary() {
      if (!state.parts.length) {
        summary.textContent = "No parts yet. Upload a catalogue or add one part to see the gap report.";
        summary.classList.remove("is-complete");
        return;
      }
      var complete = 0;
      state.parts.forEach(function (part) {
        var analysis = part.analysis || analyzePart(part);
        if (analysis.complete) complete++;
      });
      var missing = state.parts.length - complete;
      var text = state.parts.length + " part" + (state.parts.length === 1 ? "" : "s") + " · " + complete + " complete · " + missing + " missing information";
      if (!state.supplierName.trim()) text += " · company name missing";
      summary.textContent = text;
      summary.classList.toggle("is-complete", missing === 0 && !!state.supplierName.trim());
    }

    function renderPart(part) {
      var analysis = part.analysis || analyzePart(part);
      var title = part.name ? part.name : "Untitled part";
      var sku = part.sku ? " · " + part.sku : "";
      var missing = analysis.missing.map(function (key) {
        var field = fieldByKey(key);
        var issue = fieldIssue(part, field);
        var text = issue ? field.label + " — " + issue : field.label;
        return "<li>" + esc(text) + "</li>";
      }).join("");
      var present = analysis.present.map(function (key) {
        var field = fieldByKey(key);
        return "<li><span>" + esc(field.label) + "</span> " + esc(displayField(part, field)) + "</li>";
      }).join("");
      var optional = analysis.optionalMissing.map(function (key) {
        return fieldByKey(key).label;
      });
      var optionalLine = optional.length
        ? "<p class=\"optional-line\">Optional and still empty: " + esc(optional.join(", ")) + "</p>"
        : "";
      return [
        "<article class=\"part-card\" id=\"part-" + esc(part.localId) + "\">",
        "<header class=\"part-head\">",
        "<h3>" + esc(title) + esc(sku) + "</h3>",
        analysis.complete
          ? "<span class=\"badge badge-accent\">Complete</span>"
          : "<span class=\"badge badge-missing\">Missing " + analysis.missing.length + "</span>",
        "</header>",
        "<div class=\"gap-columns\">",
        "<div><h4>Missing</h4>",
        missing ? "<ul class=\"gap-list\">" + missing + "</ul>" : "<p>Nothing required is missing.</p>",
        "</div>",
        "<div><h4>Already complete</h4>",
        present ? "<ul class=\"gap-list present-list\">" + present + "</ul>" : "<p>Nothing required is filled in yet.</p>",
        "</div>",
        "</div>",
        optionalLine,
        "<details" + (analysis.complete ? "" : " open") + ">",
        "<summary>Edit fields and re-check</summary>",
        "<form class=\"catalogue-form field-grid\" data-local-id=\"" + esc(part.localId) + "\">",
        FIELDS.map(function (field) { return renderField(part, field); }).join(""),
        "<div class=\"button-row wide\">",
        "<button type=\"submit\">Save and re-check</button>",
        "<button type=\"button\" class=\"quiet\" data-remove=\"" + esc(part.localId) + "\">Remove part</button>",
        "</div>",
        "</form>",
        "</details>",
        "</article>"
      ].join("");
    }

    function renderField(part, field) {
      var filled = isFilled(part, field.key);
      var value = fieldValueForInput(part, field.key);
      var issue = fieldIssue(part, field);
      var classes = "field" + (field.required && !filled ? " missing" : "");
      if (field.type === "textarea") classes += " wide";
      var control;
      if (field.type === "textarea") {
        control = "<textarea name=\"" + field.key + "\" rows=\"3\">" + esc(value) + "</textarea>";
      } else if (field.type === "boolean") {
        control = selectControl(field.key, value, [
          ["", "Not set"],
          ["true", field.key === "itarFlag" ? "Yes — ITAR applies" : "Yes"],
          ["false", "No"]
        ]);
      } else if (field.type === "confidence") {
        control = selectControl(field.key, value, [
          ["", "Not set"],
          ["VERIFIED", "VERIFIED"],
          ["AUTO_CLASSIFIED", "AUTO_CLASSIFIED"],
          ["UNKNOWN", "UNKNOWN"]
        ]);
      } else if (field.type === "extraction") {
        control = selectControl(field.key, value, [
          ["", "Not set"],
          ["MANUAL", "MANUAL"],
          ["API", "API"],
          ["LLM_EXTRACTED", "LLM_EXTRACTED"]
        ]);
      } else {
        control = "<input name=\"" + field.key + "\" type=\"text\" value=\"" + esc(value) + "\">";
      }
      var note = "";
      if (issue) note = "<span class=\"field-issue\">" + esc(issue) + "</span>";
      else if (field.required && !filled) note = "<span class=\"field-issue\">Missing</span>";
      var optional = field.required ? "" : " <span class=\"optional\">(optional)</span>";
      return "<label class=\"" + classes + "\"><span>" + esc(field.label) + optional + "</span>" + control + note + "</label>";
    }

    function selectControl(name, value, options) {
      return "<select name=\"" + name + "\">" + options.map(function (option) {
        var selected = option[0] === value ? " selected" : "";
        return "<option value=\"" + esc(option[0]) + "\"" + selected + ">" + esc(option[1]) + "</option>";
      }).join("") + "</select>";
    }

    function findPart(localId) {
      for (var i = 0; i < state.parts.length; i++) {
        if (state.parts[i].localId === localId) return state.parts[i];
      }
      return null;
    }

    function persist() {
      state.updatedAt = new Date().toISOString();
      state.parts.forEach(function (part) { part.analysis = analyzePart(part); });
      try {
        window.localStorage.setItem(STORAGE_KEY, serializeState(state));
      } catch (err) {
        showMessage("This browser did not keep a copy. The report on screen is still here, and you can download the JSON.", "error");
      }
    }

    function loadState() {
      try {
        var raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return { supplierName: "", updatedAt: "", parts: [] };
        return hydrateState(raw);
      } catch (err) {
        return { supplierName: "", updatedAt: "", parts: [] };
      }
    }

    function showMessage(text, kind) {
      if (!text) {
        alertBox.hidden = true;
        alertBox.textContent = "";
        return;
      }
      alertBox.hidden = false;
      alertBox.dataset.kind = kind || "ok";
      alertBox.textContent = text;
    }
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
