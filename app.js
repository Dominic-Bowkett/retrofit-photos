(() => {
  "use strict";

  const DB_NAME = "retrofit-photos";
  const DB_VERSION = 1;
  const STORE_PROPERTIES = "properties";
  const STORE_PHOTOS = "photos";
  const ACTIVE_KEY = "retrofit-photos:active-property";

  const DEFAULT_GROUPS = [
    { name: "External Elevations" },
    { name: "Loft" },
  ];

  // Legacy default-group names that used to exist but have been collapsed
  // into photo tags. On load we move their photos into External Elevations
  // and stamp each photo with the mapped tag so the information survives.
  const LEGACY_GROUP_TO_TAG = {
    "meters": "Meters",
    "windows": "Windows",
    "doors": "Other",
    "conservatory": "Other",
    "renewables": "Renewables",
    "mains heating": "Heating",
    "secondary heating": "Secondary Heating",
    "water heating": "Heating",
    "ventilation": "Ventilation",
    "lighting": "Lighting",
    "walls": "Other",
    "floor": "Other",
  };

  const BUILDING_TAGS = ["Main", "Ext1", "Ext2", "Ext3", "Ext4"];
  const DEFAULT_BUILDING = "Main";

  // -------------------- Rooms --------------------
  // Presets the user picks from when adding a room. "Other" is the free-form
  // fallback. The chosen preset is remembered on the room so the dropdown in
  // the header reflects it; the displayed name is editable independently.
  const ROOM_TYPES = [
    "Living Room",
    "Dining Room",
    "Office",
    "Kitchen",
    "Utility Room",
    "Bedroom",
    "Bathroom",
    "WC",
    "Hallway",
    "Landing",
    "Porch",
    "Conservatory",
    "Basement",
    "Room in Roof",
    "Other",
  ];
  const DEFAULT_ROOM_TYPE = "Living Room";
  const HABITABILITY_OPTIONS = ["Habitable", "Non Habitable", "Wet Room"];
  const DEFAULT_HABITABILITY_BY_TYPE = {
    "Living Room": "Habitable",
    "Dining Room": "Habitable",
    "Office": "Habitable",
    "Kitchen": "Habitable",
    "Utility Room": "Non Habitable",
    "Bedroom": "Habitable",
    "Bathroom": "Wet Room",
    "WC": "Wet Room",
    "Hallway": "Non Habitable",
    "Landing": "Non Habitable",
    "Porch": "Non Habitable",
    "Conservatory": "Non Habitable",
    "Basement": "Non Habitable",
    "Room in Roof": "Habitable",
    "Other": "Habitable",
  };
  // Optional per-photo tag applied to a room photo. Replaces the old
  // sub-group layout — a room has a single photos area, and each photo
  // can carry one of these tags (or none).
  const ROOM_TAGS = [
    "Room",
    "Undercuts",
    "Windows",
    "Lighting",
    "Heating",
    "Secondary Heating",
    "Ventilation",
    "Renewables",
    "Meters",
    "Other",
  ];
  const NO_ROOM_TAG = "";

  // -------------------- AI photo analysis (Claude API) --------------------
  // Calls Claude's vision API with the user's own API key (stored in
  // localStorage). Key + model are user-configurable via the Settings
  // dialog. Each preset is one system prompt + one JSON schema, so adding
  // more is a matter of dropping another entry into this array.
  const CLAUDE_API_ENDPOINT = "https://api.anthropic.com/v1/messages";
  const CLAUDE_API_KEY_STORAGE = "retrofit-photos:claude-api-key";
  const CLAUDE_MODEL_STORAGE = "retrofit-photos:claude-model";
  const DEFAULT_CLAUDE_MODEL = "claude-opus-4-7";
  const CLAUDE_MODELS = [
    { id: "claude-opus-4-7", label: "Opus 4.7 — highest accuracy" },
    { id: "claude-sonnet-4-6", label: "Sonnet 4.6 — balanced" },
    { id: "claude-haiku-4-5", label: "Haiku 4.5 — fastest / cheapest" },
  ];

  const ANALYSIS_SCHEMAS = {
    electric_meter: {
      type: "object",
      properties: {
        make: { type: ["string", "null"] },
        model: { type: ["string", "null"] },
        serial: { type: ["string", "null"] },
        is_smart_meter: { type: ["boolean", "null"] },
        smets_generation: { type: ["string", "null"] },
        is_export_capable: { type: ["boolean", "null"] },
        export_capability_source: { type: ["string", "null"] },
        current_reading: { type: ["string", "null"] },
        manual_url: { type: ["string", "null"] },
        notes: { type: "string" },
        confidence: { type: "string", enum: ["high", "medium", "low"] },
      },
      required: ["make", "model", "is_smart_meter", "notes", "confidence"],
      additionalProperties: false,
    },
    gas_meter: {
      type: "object",
      properties: {
        make: { type: ["string", "null"] },
        model: { type: ["string", "null"] },
        serial: { type: ["string", "null"] },
        is_smart_meter: { type: ["boolean", "null"] },
        smets_generation: { type: ["string", "null"] },
        current_reading: { type: ["string", "null"] },
        manual_url: { type: ["string", "null"] },
        notes: { type: "string" },
        confidence: { type: "string", enum: ["high", "medium", "low"] },
      },
      required: ["make", "model", "is_smart_meter", "notes", "confidence"],
      additionalProperties: false,
    },
    boiler: {
      type: "object",
      properties: {
        make: { type: ["string", "null"] },
        model: { type: ["string", "null"] },
        type: { type: ["string", "null"] },
        fuel: { type: ["string", "null"] },
        installed_year: { type: ["number", "null"] },
        efficiency_rating: { type: ["string", "null"] },
        output_kw: { type: ["number", "null"] },
        manual_url: { type: ["string", "null"] },
        notes: { type: "string" },
        confidence: { type: "string", enum: ["high", "medium", "low"] },
      },
      required: ["make", "model", "type", "notes", "confidence"],
      additionalProperties: false,
    },
    laser_measurement: {
      type: "object",
      properties: {
        measurements: {
          type: "array",
          items: {
            type: "object",
            properties: {
              display: { type: "string" },
              value: { type: ["number", "null"] },
              unit: { type: ["string", "null"] },
              role_hint: { type: ["string", "null"] },
              confidence: { type: "string", enum: ["high", "medium", "low"] },
            },
            required: ["display", "confidence"],
            additionalProperties: false,
          },
        },
        primary_index: { type: ["number", "null"] },
        notes: { type: "string" },
      },
      required: ["measurements", "notes"],
      additionalProperties: false,
    },
    auto_tag: {
      type: "object",
      properties: {
        // Free-form nullable string — the client validates the value
        // against ROOM_TAGS so we don't need an enum here, which
        // avoids JSON-schema quirks around mixing enum with null.
        tag: { type: ["string", "null"] },
        reason: { type: "string" },
        confidence: { type: "string", enum: ["high", "medium", "low"] },
      },
      required: ["tag", "reason", "confidence"],
      additionalProperties: false,
    },
  };

  const ANALYSIS_PRESETS = [
    {
      id: "electric_meter",
      label: "Electricity meter",
      shortLabel: "Elec meter",
      systemPrompt:
        "You are a Domestic Energy Assessor's assistant analysing photos of UK electricity meters.\n\n" +
        "FROM THE PHOTO, identify:\n" +
        "- Make and model (read the faceplate / labels).\n" +
        "- Serial number if legible.\n" +
        "- Whether it is a smart meter (LCD display with a communication indicator vs. mechanical counter wheels).\n" +
        "- The currently-displayed reading if visible.\n\n" +
        "FROM YOUR KNOWLEDGE of the identified make + model (NOT from the photo alone), determine:\n" +
        "- SMETS generation (SMETS1 or SMETS2) if the model is distinctly one or the other; otherwise null.\n" +
        "- Export capability: whether this specific model generally supports solar/battery export registers. " +
        "Export capability is largely a property of the model, not something you can see visually. For common UK " +
        "meters (Landis+Gyr E470 / E570, Aclara SGM1441/1443, EDMI ES-10B / Atlas Mk10, Kaifa MA120/MA105, " +
        "Itron ACE3000/4000, Secure Liberty 100, Honeywell/Elster A1700/AS3000 etc.) you usually know. " +
        "If you don't recognise the model with enough confidence, set is_export_capable to null rather than guess.\n" +
        "- export_capability_source: short string explaining the basis — e.g. \"Landis+Gyr E470 SMETS2: standard \" +\n" +
        "  \"UK domestic spec includes export register\" or \"visible export button on faceplate\" or \"unknown model — can't look up\".\n" +
        "- manual_url: URL to the manufacturer's technical manual / datasheet for this exact model. " +
        "ONLY include a URL if you are highly confident it is a real, still-active page (prefer official manufacturer domains). " +
        "If you're not sure the URL is correct, return null. DO NOT invent plausible-looking URLs.\n\n" +
        "Return JSON matching the schema. Use null for anything you can't determine. " +
        "confidence=high only when visual identification AND your model knowledge both support the answer; any " +
        "uncertainty (unclear photo, unfamiliar model, ambiguous export capability) → medium or low. Put the " +
        "reasoning for borderline calls in notes.",
      userPrompt:
        "Analyse this electricity meter photo. Identify the model visually, then use your knowledge of that model " +
        "to judge export capability and look up the manual URL. Return JSON matching the schema.",
      schema: ANALYSIS_SCHEMAS.electric_meter,
    },
    {
      id: "gas_meter",
      label: "Gas meter",
      shortLabel: "Gas meter",
      systemPrompt:
        "You are a Domestic Energy Assessor's assistant analysing photos of UK gas meters.\n\n" +
        "FROM THE PHOTO, identify: make and model (read any visible labels / data plate); serial number if legible; " +
        "whether it is a smart meter (LCD + communications indicator vs. mechanical dials); and the currently-displayed reading if visible.\n\n" +
        "FROM YOUR KNOWLEDGE of the identified make + model: SMETS generation (SMETS1 / SMETS2) if distinct; " +
        "and manual_url — URL to the manufacturer's technical manual / datasheet for this exact model, ONLY if you are highly " +
        "confident the URL is real. Prefer official manufacturer domains. If unsure, return null. DO NOT invent URLs.\n\n" +
        "Return JSON matching the schema. Use null for anything not determinable. " +
        "confidence=high only when both visual ID and model knowledge support the answer; any uncertainty → medium or low.",
      userPrompt:
        "Analyse this gas meter photo. Identify the model visually, then add a manual URL if you're confident it exists. Return JSON matching the schema.",
      schema: ANALYSIS_SCHEMAS.gas_meter,
    },
    {
      id: "boiler",
      label: "Boiler",
      shortLabel: "Boiler",
      systemPrompt:
        "You are a Domestic Energy Assessor's assistant analysing photos of UK domestic boilers (gas / LPG / oil / electric).\n\n" +
        "FROM THE PHOTO, identify: make and model (read the badge / data plate); boiler type (combi / system / regular / back boiler / other); " +
        "fuel (natural_gas / lpg / oil / electric / other); installation year if a date is visible; efficiency rating (ErP or SEDBUK band) if visible; rated output in kW if visible.\n\n" +
        "FROM YOUR KNOWLEDGE of the identified make + model: manual_url — URL to the manufacturer's installation / user manual for this exact model, " +
        "ONLY if you are highly confident the URL is real and on an official manufacturer domain. If unsure, return null. DO NOT invent URLs.\n\n" +
        "Return JSON matching the schema. Use null for anything not determinable. confidence=high only when unambiguous.",
      userPrompt:
        "Analyse this boiler photo. Identify the model, then add a manual URL if you're confident it exists. Return JSON matching the schema.",
      schema: ANALYSIS_SCHEMAS.boiler,
    },
    {
      id: "auto_tag",
      label: "Auto-tag photo",
      shortLabel: "Auto-tag",
      systemPrompt:
        "You are a Domestic Energy Assessor's assistant tagging photos in a UK retrofit survey.\n\n" +
        "Pick the SINGLE best tag for the photo from this fixed list:\n" +
        "- Room — general view of a room or its empty walls.\n" +
        "- Undercuts — gaps below an internal door (door + floor visible).\n" +
        "- Windows — close-up of a window: frame, glass, sash, sill, or a clear shot of one whole window.\n" +
        "- Lighting — light fittings, bulbs, lamps, light switches.\n" +
        "- Heating — radiators, central heating boilers, hot water cylinders, thermostats, heating programmers / timers, " +
        "underfloor heating manifolds.\n" +
        "- Secondary Heating — fireplaces, wood-burning stoves, plug-in electric heaters used as supplementary heat.\n" +
        "- Ventilation — extractor fans, MVHR / MEV units, air bricks, dedicated trickle / core / IEV / DMEV vents " +
        "(close-up of the vent itself, not just a window).\n" +
        "- Renewables — solar PV / thermal panels, battery storage, heat-pump indoor or outdoor units, EV chargers.\n" +
        "- Meters — electricity meter, gas meter, smart meter In-Home Display.\n" +
        "- Other — anything else (general construction, walls, ceilings, junction boxes, exterior shots that don't fit).\n\n" +
        "Return tag = null if you genuinely cannot tell. Don't guess wildly — if you're not at least medium-confident, " +
        "prefer null. confidence: high only when the subject is unambiguous and dominates the frame. " +
        "Keep reason to one short sentence describing what you see.",
      userPrompt:
        "Tag this photo with the single most appropriate retrofit-survey tag, or null if unclear.",
      schema: ANALYSIS_SCHEMAS.auto_tag,
    },
    {
      id: "laser_measurement",
      label: "Laser measurer screen",
      shortLabel: "Laser screen",
      systemPrompt:
        "You are reading the LCD screen of a handheld laser distance measurer (Bosch PLR / GLM, Leica DISTO, " +
        "DeWalt, Stanley, etc.) in a photo.\n\n" +
        "Extract EVERY numeric reading visible on the screen. For each reading, return:\n" +
        "- display: the value EXACTLY as printed on the screen, including the unit (e.g. \"1.275 m\", \"0.842 m\", \"3' 6\\\"\").\n" +
        "- value: the numeric value as a number (e.g. 1.275). null if you can't parse it cleanly.\n" +
        "- unit: the unit shown (\"m\", \"cm\", \"mm\", \"ft\", \"in\"). null if not visible.\n" +
        "- role_hint: a short description of where on the screen the number appears, e.g. " +
        "\"main display\", \"history line 1\", \"history line 2\", \"min\", \"max\", \"sum\", \"area\", \"volume\". null if unclear.\n" +
        "- confidence: high / medium / low for THIS reading.\n\n" +
        "ORDERING IS IMPORTANT: return the readings in the order they appear on the screen FROM TOP TO BOTTOM. " +
        "Most laser measurers stack older / sub-readings above the main reading, with the most recent / largest " +
        "value at the bottom — preserve that visual order in the array. Set primary_index to the index of the " +
        "most prominent reading (0-based) or null if ambiguous. " +
        "Use the notes field for anything that affects interpretation (glare, partial occlusion, mode like \"Pythagoras\", " +
        "device make/model if obvious). DO NOT invent readings — if the screen isn't legible, return an empty measurements array.",
      userPrompt:
        "This is a photo of a laser distance measurer's LCD screen. List every numeric reading visible, " +
        "exactly as printed (with units), so the assessor can pick which one is the width and which is the height. " +
        "Return JSON matching the schema.",
      schema: ANALYSIS_SCHEMAS.laser_measurement,
    },
  ];
  // Storage / export quality: keep individual exported images at near-original
  // fidelity. Camera captures are re-encoded once when the date/GPS overlay is
  // burned in; uploads keep their original bytes unless they exceed the ceiling.
  const MAX_DIMENSION = 5000;
  const JPEG_QUALITY = 1.0;
  // PDF embedding: re-encode each image at a smaller dimension and lower
  // quality so the report PDF stays compact (compress: true is also set on
  // the jsPDF doc itself).
  const PDF_MAX_DIMENSION = 1400;
  const PDF_JPEG_QUALITY = 0.6;
  // ZIP export: captures straight from an iPhone can be 5000 px × quality 1.0.
  // At 300+ photos a full-fidelity in-memory ZIP blows past the iOS PWA
  // memory ceiling and the tab is killed mid-export. Re-encode each photo
  // here to keep peak memory an order of magnitude smaller while staying
  // above the resolution a DEA report needs.
  const ZIP_MAX_DIMENSION = 2200;
  const ZIP_JPEG_QUALITY = 0.82;

  // -------------------- IndexedDB --------------------
  const IDB = (() => {
    let dbp = null;
    function open() {
      if (dbp) return dbp;
      dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE_PROPERTIES)) {
            db.createObjectStore(STORE_PROPERTIES, { keyPath: "id" });
          }
          if (!db.objectStoreNames.contains(STORE_PHOTOS)) {
            const s = db.createObjectStore(STORE_PHOTOS, { keyPath: "id" });
            s.createIndex("propertyId", "propertyId", { unique: false });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      return dbp;
    }
    function req(storeName, mode, fn) {
      return open().then(
        (db) =>
          new Promise((resolve, reject) => {
            const t = db.transaction(storeName, mode);
            const store = t.objectStore(storeName);
            let result;
            Promise.resolve(fn(store)).then((r) => (result = r));
            t.oncomplete = () => resolve(result);
            t.onerror = () => reject(t.error);
            t.onabort = () => reject(t.error);
          })
      );
    }
    return {
      async listProperties() {
        return req(STORE_PROPERTIES, "readonly", (s) => {
          return new Promise((resolve, reject) => {
            const r = s.getAll();
            r.onsuccess = () => resolve(r.result || []);
            r.onerror = () => reject(r.error);
          });
        });
      },
      async getProperty(id) {
        return req(STORE_PROPERTIES, "readonly", (s) => {
          return new Promise((resolve, reject) => {
            const r = s.get(id);
            r.onsuccess = () => resolve(r.result || null);
            r.onerror = () => reject(r.error);
          });
        });
      },
      async putProperty(p) {
        return req(STORE_PROPERTIES, "readwrite", (s) => s.put(p));
      },
      async deleteProperty(id) {
        return req(STORE_PROPERTIES, "readwrite", (s) => s.delete(id));
      },
      async putPhoto(photo) {
        return req(STORE_PHOTOS, "readwrite", (s) => s.put(photo));
      },
      async getPhoto(id) {
        return req(STORE_PHOTOS, "readonly", (s) => {
          return new Promise((resolve, reject) => {
            const r = s.get(id);
            r.onsuccess = () => resolve(r.result || null);
            r.onerror = () => reject(r.error);
          });
        });
      },
      async deletePhoto(id) {
        return req(STORE_PHOTOS, "readwrite", (s) => s.delete(id));
      },
      async getPhotosByProperty(propertyId) {
        return req(STORE_PHOTOS, "readonly", (s) => {
          return new Promise((resolve, reject) => {
            const idx = s.index("propertyId");
            const r = idx.getAll(IDBKeyRange.only(propertyId));
            r.onsuccess = () => resolve(r.result || []);
            r.onerror = () => reject(r.error);
          });
        });
      },
      async deletePhotosByProperty(propertyId) {
        return req(STORE_PHOTOS, "readwrite", (s) => {
          return new Promise((resolve, reject) => {
            const idx = s.index("propertyId");
            const r = idx.openCursor(IDBKeyRange.only(propertyId));
            r.onsuccess = () => {
              const cur = r.result;
              if (!cur) return resolve();
              cur.delete();
              cur.continue();
            };
            r.onerror = () => reject(r.error);
          });
        });
      },
    };
  })();

  // -------------------- State --------------------
  const state = {
    properties: [], // [{ id, name }] — summary for switcher
    currentId: null,
    property: null, // full active property { id, name, meta, groups }
    photos: new Map(), // photoId -> photo record
    expanded: new Set(), // group ids currently expanded in the accordion
    view: "group", // "group" | "tag"
    gps: null,
    gpsWatchId: null,
  };

  // -------------------- Elements --------------------
  const els = {
    groups: document.getElementById("groups"),
    rooms: document.getElementById("rooms"),
    roomTpl: document.getElementById("room-template"),
    newRoomType: document.getElementById("new-room-type"),
    addRoomBtn: document.getElementById("btn-add-room"),
    groupTpl: document.getElementById("group-template"),
    thumbTpl: document.getElementById("thumb-template"),
    addGroupName: null,
    addGroupBtn: null,
    gpsBtn: document.getElementById("btn-enable-gps"),
    refreshBtn: document.getElementById("btn-refresh"),
    settingsBtn: document.getElementById("btn-settings"),
    autolabelBtn: document.getElementById("btn-autolabel"),
    autolabelDialog: document.getElementById("autolabel-dialog"),
    autolabelBackdrop: document.getElementById("autolabel-backdrop"),
    autolabelScope: document.getElementById("autolabel-scope"),
    autolabelRunBtn: document.getElementById("autolabel-run"),
    autolabelCancelBtn: document.getElementById("autolabel-cancel"),
    autotagScope: document.getElementById("autotag-scope"),
    autotagRunBtn: document.getElementById("autotag-run"),
    bulkLabelBanner: document.getElementById("bulk-label-banner"),
    bulkLabelText: document.getElementById("bulk-label-text"),
    bulkLabelCancelBtn: document.getElementById("bulk-label-cancel"),
    settingsDialog: document.getElementById("settings-dialog"),
    settingsBackdrop: document.getElementById("settings-backdrop"),
    settingsApiKey: document.getElementById("settings-api-key"),
    settingsApiKeyToggle: document.getElementById("settings-api-key-toggle"),
    settingsModel: document.getElementById("settings-model"),
    settingsTestBtn: document.getElementById("settings-test"),
    settingsSaveBtn: document.getElementById("settings-save"),
    settingsCancelBtn: document.getElementById("settings-cancel"),
    settingsAutoTag: document.getElementById("settings-auto-tag"),
    lightboxAnalysePreset: document.getElementById("lightbox-analyse-preset"),
    lightboxAnalyseRun: document.getElementById("lightbox-analyse-run"),
    lightboxAnalyses: document.getElementById("lightbox-analyses"),
    gpsDot: document.getElementById("gps-dot"),
    gpsLabel: document.getElementById("gps-label"),
    exportBtn: document.getElementById("btn-export"),
    exportPhotosBtn: document.getElementById("btn-export-photos"),
    exportPhotosDialog: document.getElementById("export-photos-dialog"),
    exportPhotosBackdrop: document.getElementById("export-photos-backdrop"),
    exportPhotosShareBtn: document.getElementById("export-photos-share"),
    exportPhotosZipBtn: document.getElementById("export-photos-zip"),
    exportPhotosZipOriginalBtn: document.getElementById("export-photos-zip-original"),
    exportPhotosCancelBtn: document.getElementById("export-photos-cancel"),
    exportPhotosHelp: document.getElementById("export-photos-help"),
    pdfLayoutDialog: document.getElementById("pdf-layout-dialog"),
    pdfLayoutBackdrop: document.getElementById("pdf-layout-backdrop"),
    pdfLayoutGroupBtn: document.getElementById("pdf-layout-group"),
    pdfLayoutTagBtn: document.getElementById("pdf-layout-tag"),
    pdfIncludeAnalysis: document.getElementById("pdf-include-analysis"),
    pdfShare: document.getElementById("pdf-share"),
    pdfShareToggleWrap: document.getElementById("pdf-share-toggle-wrap"),
    exportShare: document.getElementById("export-share"),
    exportShareToggleWrap: document.getElementById("export-share-toggle-wrap"),
    originalsPartsDialog: document.getElementById("originals-parts-dialog"),
    originalsPartsBackdrop: document.getElementById("originals-parts-backdrop"),
    originalsPartsTitle: document.getElementById("originals-parts-count"),
    originalsPartsList: document.getElementById("originals-parts-list"),
    originalsPartsCancelBtn: document.getElementById("originals-parts-cancel"),
    pdfLayoutCancelBtn: document.getElementById("pdf-layout-cancel"),
    viewToggleBtns: Array.from(document.querySelectorAll(".view-toggle-btn")),
    lightbox: document.getElementById("lightbox"),
    lightboxImg: document.getElementById("lightbox-img"),
    lightboxCaption: document.getElementById("lightbox-caption"),
    lightboxCounter: document.getElementById("lightbox-counter"),
    lightboxCloseBtn: document.querySelector(".lightbox-close"),
    lightboxPrevBtn: document.querySelector(".lightbox-prev"),
    lightboxNextBtn: document.querySelector(".lightbox-next"),
    lightboxFilter: document.getElementById("lightbox-filter"),
    lightboxLabel: document.getElementById("lightbox-label"),
    lightboxLabelAi: document.getElementById("lightbox-label-ai"),
    lightboxBuilding: document.getElementById("lightbox-building"),
    lightboxTag: document.getElementById("lightbox-tag"),
    lightboxDefect: document.getElementById("lightbox-defect"),
    lightboxDelete: document.getElementById("lightbox-delete"),
    toast: document.getElementById("toast"),
    propSelect: document.getElementById("property-select"),
    newPropBtn: document.getElementById("btn-new-property"),
    delPropBtn: document.getElementById("btn-delete-property"),
    saveStatus: document.getElementById("save-status"),
    metaCard: document.getElementById("meta-card"),
    metaHeader: document.getElementById("meta-header"),
    totalsCard: document.getElementById("totals-card"),
    totalsHeader: document.getElementById("totals-header"),
    metaName: document.getElementById("meta-name"),
    metaAssessor: document.getElementById("meta-assessor"),
    metaAddress: document.getElementById("meta-address"),
    metaRef: document.getElementById("meta-ref"),
    metaDate: document.getElementById("meta-date"),
  };

  // -------------------- Utils --------------------
  function uid(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function slugify(s) {
    return (
      String(s)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "")
        .slice(0, 40) || "group"
    );
  }

  function todayISO() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function formatStamp(date) {
    const pad = (n) => String(n).padStart(2, "0");
    return (
      `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ` +
      `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    );
  }

  function formatGps(gps) {
    if (!gps) return "GPS: unavailable";
    const lat = gps.latitude.toFixed(5);
    const lon = gps.longitude.toFixed(5);
    const acc = gps.accuracy ? `±${Math.round(gps.accuracy)}m` : "";
    return `${lat}°, ${lon}°  ${acc}`.trim();
  }

  let toastTimer = null;
  function toast(message, variant) {
    els.toast.textContent = message;
    els.toast.classList.toggle("err", variant === "err");
    els.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2600);
  }

  function setSaveStatus(kind) {
    els.saveStatus.classList.remove("saving", "error");
    if (kind === "saving") {
      els.saveStatus.classList.add("saving");
      els.saveStatus.textContent = "Saving…";
    } else if (kind === "error") {
      els.saveStatus.classList.add("error");
      els.saveStatus.textContent = "Save failed";
    } else {
      els.saveStatus.textContent = "Saved";
    }
  }

  function debounce(fn, ms) {
    let t = null;
    const debounced = (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
    debounced.flush = () => {
      clearTimeout(t);
      t = null;
    };
    return debounced;
  }

  // -------------------- GPS --------------------
  function setGpsStatus(status, text) {
    els.gpsDot.classList.remove("ok", "err");
    if (status === "ok") els.gpsDot.classList.add("ok");
    if (status === "err") els.gpsDot.classList.add("err");
    if (text) els.gpsLabel.textContent = text;
  }

  function enableGps() {
    if (!("geolocation" in navigator)) {
      setGpsStatus("err", "No GPS support");
      toast("This device/browser does not support geolocation.", "err");
      return;
    }
    setGpsStatus(null, "Locating…");

    const onSuccess = (pos) => {
      state.gps = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        timestamp: pos.timestamp,
      };
      setGpsStatus("ok", "GPS");
    };
    const onError = (err) => {
      setGpsStatus("err", "GPS off");
      toast(`GPS error: ${err.message}`, "err");
    };

    navigator.geolocation.getCurrentPosition(onSuccess, onError, {
      enableHighAccuracy: true,
      maximumAge: 10000,
      timeout: 15000,
    });

    if (state.gpsWatchId !== null) {
      navigator.geolocation.clearWatch(state.gpsWatchId);
    }
    state.gpsWatchId = navigator.geolocation.watchPosition(onSuccess, onError, {
      enableHighAccuracy: true,
      maximumAge: 5000,
    });
  }

  // -------------------- Image processing --------------------
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = (e) => {
        URL.revokeObjectURL(url);
        reject(e);
      };
      img.src = url;
    });
  }

  function loadImageFromDataUrl(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = (e) => reject(e);
      img.src = dataUrl;
    });
  }

  async function reencodeForPdf(dataUrl) {
    try {
      const img = await loadImageFromDataUrl(dataUrl);
      const longest = Math.max(img.naturalWidth, img.naturalHeight);
      const scale = longest > PDF_MAX_DIMENSION ? PDF_MAX_DIMENSION / longest : 1;
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      return canvas.toDataURL("image/jpeg", PDF_JPEG_QUALITY);
    } catch (err) {
      console.warn("PDF re-encode failed; embedding original.", err);
      return dataUrl;
    }
  }

  async function reencodeForZip(dataUrl) {
    try {
      const img = await loadImageFromDataUrl(dataUrl);
      const longest = Math.max(img.naturalWidth, img.naturalHeight);
      const scale = longest > ZIP_MAX_DIMENSION ? ZIP_MAX_DIMENSION / longest : 1;
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      return canvas.toDataURL("image/jpeg", ZIP_JPEG_QUALITY);
    } catch (err) {
      console.warn("ZIP re-encode failed; zipping original bytes.", err);
      return dataUrl;
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawOverlay(ctx, width, height, dateText, gpsText) {
    const pad = Math.round(Math.min(width, height) * 0.015);
    const fontPx = Math.max(14, Math.round(Math.min(width, height) * 0.028));
    ctx.font = `600 ${fontPx}px -apple-system, Roboto, "Segoe UI", Arial, sans-serif`;
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "right";

    const lineGap = Math.round(fontPx * 0.35);
    const lines = [dateText, gpsText];
    const metrics = lines.map((l) => ctx.measureText(l));
    const maxWidth = Math.max(...metrics.map((m) => m.width));
    const boxH = lines.length * fontPx + (lines.length - 1) * lineGap + pad * 2;
    const boxW = maxWidth + pad * 2;
    const x = width - pad;
    const yTop = height - pad - boxH;

    ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
    roundRect(ctx, x - boxW + pad, yTop, boxW, boxH, Math.round(pad * 0.6));
    ctx.fill();

    ctx.fillStyle = "#fff";
    ctx.shadowColor = "rgba(0,0,0,0.75)";
    ctx.shadowBlur = 2;
    let y = yTop + pad + fontPx;
    for (const line of lines) {
      ctx.fillText(line, x, y);
      y += fontPx + lineGap;
    }
    ctx.shadowBlur = 0;
  }

  async function processFile(file) {
    const img = await loadImage(file);
    const longest = Math.max(img.naturalWidth, img.naturalHeight);
    const scale = longest > MAX_DIMENSION ? MAX_DIMENSION / longest : 1;
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, w, h);

    const stampDate = new Date();
    drawOverlay(ctx, w, h, formatStamp(stampDate), formatGps(state.gps));

    const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    return {
      id: uid("p"),
      source: "camera",
      dataUrl,
      width: w,
      height: h,
      takenAt: stampDate.toISOString(),
      gps: state.gps ? { ...state.gps } : null,
      building: DEFAULT_BUILDING,
      defect: false,
      roomTag: NO_ROOM_TAG,
      label: "",
    };
  }

  // -------------------- Upload / EXIF read helpers --------------------
  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
  }

  function dmsToDeg(arr) {
    if (!Array.isArray(arr) || arr.length !== 3) return null;
    try {
      const [[dN, dD], [mN, mD], [sN, sD]] = arr;
      return dN / dD + mN / mD / 60 + sN / sD / 3600;
    } catch (_) {
      return null;
    }
  }

  function parseExifDateTime(str) {
    if (!str || typeof str !== "string") return null;
    const m = str.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (!m) return null;
    const [, y, mo, d, h, mi, s] = m;
    const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}`);
    return isNaN(date.getTime()) ? null : date.toISOString();
  }

  function readExifFromDataUrl(dataUrl) {
    if (typeof piexif === "undefined") return { takenAt: null, gps: null, rawExif: null };
    try {
      const exif = piexif.load(dataUrl);
      const dtStr =
        (exif.Exif && exif.Exif[piexif.ExifIFD.DateTimeOriginal]) ||
        (exif.Exif && exif.Exif[piexif.ExifIFD.DateTimeDigitized]) ||
        (exif["0th"] && exif["0th"][piexif.ImageIFD.DateTime]) ||
        null;
      const takenAt = parseExifDateTime(dtStr);

      let gps = null;
      if (exif.GPS && exif.GPS[piexif.GPSIFD.GPSLatitude] && exif.GPS[piexif.GPSIFD.GPSLongitude]) {
        const lat = dmsToDeg(exif.GPS[piexif.GPSIFD.GPSLatitude]);
        const lon = dmsToDeg(exif.GPS[piexif.GPSIFD.GPSLongitude]);
        if (lat != null && lon != null) {
          const latRef = exif.GPS[piexif.GPSIFD.GPSLatitudeRef] || "N";
          const lonRef = exif.GPS[piexif.GPSIFD.GPSLongitudeRef] || "E";
          gps = {
            latitude: latRef === "S" ? -lat : lat,
            longitude: lonRef === "W" ? -lon : lon,
            accuracy: null,
          };
        }
      }

      let rawExif = null;
      try {
        rawExif = piexif.dump(exif);
      } catch (_) {
        rawExif = null;
      }
      return { takenAt, gps, rawExif };
    } catch (err) {
      return { takenAt: null, gps: null, rawExif: null };
    }
  }

  async function processUploadedFile(file) {
    const originalDataUrl = await readFileAsDataUrl(file);
    const { takenAt, gps, rawExif } = readExifFromDataUrl(originalDataUrl);

    const img = await loadImage(file);
    const longest = Math.max(img.naturalWidth, img.naturalHeight);
    const scale = longest > MAX_DIMENSION ? MAX_DIMENSION / longest : 1;

    let dataUrl = originalDataUrl;
    let w = img.naturalWidth;
    let h = img.naturalHeight;

    if (scale < 1) {
      w = Math.round(img.naturalWidth * scale);
      h = Math.round(img.naturalHeight * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
      if (rawExif) {
        try {
          dataUrl = piexif.insert(rawExif, dataUrl);
        } catch (_) {
          /* fall back to no-exif resized copy */
        }
      }
    }

    return {
      id: uid("p"),
      source: "upload",
      dataUrl,
      width: w,
      height: h,
      takenAt, // from EXIF, may be null
      gps, // from EXIF, may be null
      uploadedAt: new Date().toISOString(),
      originalName: file.name || "",
      building: DEFAULT_BUILDING,
      defect: false,
      roomTag: NO_ROOM_TAG,
      label: "",
    };
  }

  // -------------------- Persistence --------------------
  const saveProperty = debounce(async () => {
    if (!state.property) return;
    state.property.updatedAt = new Date().toISOString();
    try {
      setSaveStatus("saving");
      await IDB.putProperty(state.property);
      refreshPropertyList();
      setSaveStatus("saved");
    } catch (err) {
      console.error(err);
      setSaveStatus("error");
      toast("Couldn't save — storage may be full.", "err");
    }
  }, 400);

  async function savePhotoNow(photo) {
    try {
      await IDB.putPhoto(photo);
    } catch (err) {
      console.error(err);
      toast("Couldn't save photo to local storage.", "err");
    }
  }

  function refreshPropertyList() {
    if (!state.property) return;
    const entry = state.properties.find((p) => p.id === state.property.id);
    if (entry) entry.name = state.property.name;
    renderPropertySelect();
  }

  // -------------------- Property manager --------------------
  function makeDefaultGroups() {
    return DEFAULT_GROUPS.map((g) => ({
      id: uid("g"),
      name: g.name,
      photoIds: [],
      protected: true,
    }));
  }

  // Rename legacy top-level names that have changed. (Historically these
  // were sub-group renames; now they're top-level too.)
  const LEGACY_RENAMES = {
    "wall thickness": "Walls",
    roof: "Loft",
  };

  function migrateDefaults(property, photosMap) {
    if (!property || !Array.isArray(property.groups)) {
      return { changed: false, dirtyPhotoIds: [] };
    }
    let changed = false;
    const dirtyPhotoIds = [];

    // Rename legacy group names.
    for (const g of property.groups) {
      const norm = (g.name || "").trim().toLowerCase();
      if (LEGACY_RENAMES[norm]) {
        g.name = LEGACY_RENAMES[norm];
        changed = true;
      }
    }

    // Collapse the old Main Property / Extension N sections into flat
    // top-level groups, stamping each affected photo with its building tag.
    const sectioned = property.groups.filter((g) => g.section);
    if (sectioned.length) {
      const findOrCreateFlat = (name) => {
        const lower = (name || "").toLowerCase();
        let top = property.groups.find(
          (g) => !g.section && (g.name || "").toLowerCase() === lower
        );
        if (!top) {
          top = { id: uid("g"), name, photoIds: [], protected: true };
          property.groups.push(top);
        }
        return top;
      };
      for (const sg of sectioned) {
        const section = sg.section;
        let building = DEFAULT_BUILDING;
        if (section === "Main Property") building = "Main";
        else if (section.startsWith("Extension ")) {
          const n = section.slice("Extension ".length).trim();
          if (/^\d+$/.test(n)) building = `Ext${n}`;
        }
        const target = findOrCreateFlat(sg.name);
        for (const pid of sg.photoIds) {
          const photo = photosMap && photosMap.get(pid);
          if (photo) {
            photo.building = building;
            if (photo.propertyId === property.id) dirtyPhotoIds.push(pid);
          }
          if (!target.photoIds.includes(pid)) target.photoIds.push(pid);
        }
      }
      property.groups = property.groups.filter((g) => !g.section);
      changed = true;
    }

    // Add any missing flat default groups (External Elevations, Loft).
    const existingNames = new Set(
      property.groups.map((g) => (g.name || "").trim().toLowerCase())
    );
    for (const d of DEFAULT_GROUPS) {
      if (!existingNames.has(d.name.toLowerCase())) {
        property.groups.push({
          id: uid("g"),
          name: d.name,
          photoIds: [],
          protected: true,
        });
        changed = true;
      }
    }

    // Fold photos from the retired default groups (Meters, Windows, Doors,
    // etc.) into External Elevations, stamping each photo with the mapped
    // roomTag. Empty legacy groups are then removed outright; user-renamed
    // / custom groups are untouched.
    const extElev = property.groups.find(
      (g) => (g.name || "").trim().toLowerCase() === "external elevations"
    );
    const survivingGroups = [];
    for (const group of property.groups) {
      const norm = (group.name || "").trim().toLowerCase();
      const mappedTag = LEGACY_GROUP_TO_TAG[norm];
      if (mappedTag && group.protected && extElev && group !== extElev) {
        for (const pid of group.photoIds || []) {
          const photo = photosMap && photosMap.get(pid);
          if (photo && photo.roomTag !== mappedTag) {
            photo.roomTag = mappedTag;
            if (photo.propertyId === property.id) dirtyPhotoIds.push(pid);
          }
          if (!extElev.photoIds.includes(pid)) extElev.photoIds.push(pid);
        }
        changed = true;
        continue; // drop the legacy group
      }
      survivingGroups.push(group);
    }
    if (survivingGroups.length !== property.groups.length) {
      property.groups = survivingGroups;
    }

    // Apply the protected flag to any group that matches a default name.
    const flatDefaultNames = new Set(DEFAULT_GROUPS.map((g) => g.name.toLowerCase()));
    for (const group of property.groups) {
      if (group.protected) continue;
      const norm = (group.name || "").trim().toLowerCase();
      if (flatDefaultNames.has(norm)) {
        group.protected = true;
        changed = true;
      }
    }

    // Reorder so External Elevations is first, Loft second, and everything
    // else keeps its relative order after the two protected defaults.
    const orderKey = (g) => {
      const n = (g.name || "").trim().toLowerCase();
      if (n === "external elevations") return 0;
      if (n === "loft") return 1;
      return 2;
    };
    const sortedGroups = property.groups
      .map((g, i) => ({ g, i }))
      .sort((a, b) => {
        const ka = orderKey(a.g);
        const kb = orderKey(b.g);
        if (ka !== kb) return ka - kb;
        return a.i - b.i;
      })
      .map((o) => o.g);
    const sameOrder = sortedGroups.every((g, i) => g === property.groups[i]);
    if (!sameOrder) {
      property.groups = sortedGroups;
      changed = true;
    }

    return { changed, dirtyPhotoIds };
  }

  function makeNewProperty(name) {
    const id = uid("prop");
    const property = {
      id,
      name: name || `Property ${state.properties.length + 1}`,
      meta: {
        assessor: "",
        address: "",
        ref: "",
        date: todayISO(),
      },
      groups: makeDefaultGroups(),
      rooms: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return property;
  }

  function makeRoom(roomType) {
    const type = ROOM_TYPES.includes(roomType) ? roomType : DEFAULT_ROOM_TYPE;
    return {
      id: uid("room"),
      name: type,
      roomType: type,
      habitability: DEFAULT_HABITABILITY_BY_TYPE[type] || "Habitable",
      heated: true,
      photoIds: [],
      lights: { led: 0, cfl: 0, incandescent: 0 },
      chimneys: { open: 0, blocked: 0 },
      flues: { open: 0, closed: 0, boiler: 0, other: 0 },
      ventilation: { trickle: 0, core: 0, iev: 0, dmev: 0 },
      windows: [makeNewWindow()],
      notes: "",
    };
  }

  const LIGHT_KINDS = [
    { key: "led", label: "LED" },
    { key: "cfl", label: "CFL" },
    { key: "incandescent", label: "Incandescent" },
  ];

  const CHIMNEY_KINDS = [
    { key: "open", label: "Open" },
    { key: "blocked", label: "Blocked" },
  ];

  const FLUE_KINDS = [
    { key: "open", label: "Open" },
    { key: "closed", label: "Closed" },
    { key: "boiler", label: "Boiler" },
    { key: "other", label: "Other" },
  ];

  const VENTILATION_KINDS = [
    { key: "trickle", label: "Trickle Vents" },
    { key: "core", label: "Core Vents" },
    { key: "iev", label: "IEV" },
    { key: "dmev", label: "DMEV" },
  ];

  const WINDOW_TYPES = ["Single", "Double", "Triple"];
  const WINDOW_AGES = ["Unknown", "Pre 2002", "2002-2021", "2023+"];
  const WINDOW_GAPS = ["6mm", "12mm", "16mm"];
  const WINDOW_FRAMES = ["Wooden", "PVC", "Metal"];
  const WINDOW_ORIENTATIONS = [
    "North",
    "North East",
    "East",
    "South East",
    "South",
    "South West",
    "West",
    "North West",
  ];
  const WINDOW_AGES_NEEDING_GAP = new Set(["Unknown", "Pre 2002"]);
  const WINDOW_TYPES_NEEDING_FRAME = new Set(["Double", "Triple"]);

  function makeNewWindow(overrides) {
    return {
      id: uid("win"),
      type: "Double",
      age: "",
      gap: "",
      frame: "",
      width: "",
      height: "",
      orientation: "",
      roofWindow: false,
      ...(overrides || {}),
    };
  }

  function normalizeRoomCounts(room, prop, kinds) {
    const src = room && typeof room[prop] === "object" && room[prop] ? room[prop] : {};
    const out = {};
    let changed = !room[prop] || typeof room[prop] !== "object";
    for (const { key } of kinds) {
      const n = Number(src[key]);
      const v = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
      out[key] = v;
      if (src[key] !== v) changed = true;
    }
    room[prop] = out;
    return changed;
  }

  function normalizeRoomLights(room) {
    return normalizeRoomCounts(room, "lights", LIGHT_KINDS);
  }

  function normalizeRoomChimneys(room) {
    return normalizeRoomCounts(room, "chimneys", CHIMNEY_KINDS);
  }

  function normalizeRoomFlues(room) {
    return normalizeRoomCounts(room, "flues", FLUE_KINDS);
  }

  function normalizeRoomVentilation(room) {
    return normalizeRoomCounts(room, "ventilation", VENTILATION_KINDS);
  }

  // Normalise a single window record in-place. Returns true if anything
  // about the record changed (so callers can mark the property dirty).
  function normalizeOneWindow(win) {
    let changed = false;
    if (!win.id) { win.id = uid("win"); changed = true; }
    const type = WINDOW_TYPES.includes(win.type) ? win.type : "Double";
    const age = WINDOW_AGES.includes(win.age) ? win.age : "";
    const gap = WINDOW_GAPS.includes(win.gap) ? win.gap : "";
    const frame = WINDOW_FRAMES.includes(win.frame) ? win.frame : "";
    const width = typeof win.width === "string" ? win.width : "";
    const height = typeof win.height === "string" ? win.height : "";
    const roofWindow = win.roofWindow === true;
    // Roof windows can additionally point Horizontal (looking up the
    // sky from a flat skylight or a Velux at low pitch).
    const allowedOrientations = roofWindow
      ? WINDOW_ORIENTATIONS.concat("Horizontal")
      : WINDOW_ORIENTATIONS;
    const orientation = allowedOrientations.includes(win.orientation) ? win.orientation : "";
    // Glazing gap is only meaningful on Double / Triple where the age
    // is Unknown or Pre 2002 — single glazing has no cavity to measure.
    const gapAllowed =
      WINDOW_AGES_NEEDING_GAP.has(age) && WINDOW_TYPES_NEEDING_FRAME.has(type);
    const effectiveGap = gapAllowed ? gap : "";
    const effectiveFrame = WINDOW_TYPES_NEEDING_FRAME.has(type) ? frame : "";
    if (
      win.type !== type || win.age !== age ||
      win.gap !== effectiveGap || win.frame !== effectiveFrame ||
      win.width !== width || win.height !== height ||
      win.orientation !== orientation || win.roofWindow !== roofWindow
    ) {
      changed = true;
    }
    win.type = type;
    win.age = age;
    win.gap = effectiveGap;
    win.frame = effectiveFrame;
    win.width = width;
    win.height = height;
    win.orientation = orientation;
    win.roofWindow = roofWindow;
    return changed;
  }

  function normalizeRoomWindows(room) {
    let changed = false;
    // Migrate legacy single-object schema to a one-element array.
    if (room.windows && !Array.isArray(room.windows) && typeof room.windows === "object") {
      room.windows = [{ ...room.windows }];
      changed = true;
    }
    if (!Array.isArray(room.windows)) {
      room.windows = [];
      changed = true;
    }
    for (const w of room.windows) {
      if (normalizeOneWindow(w)) changed = true;
    }
    return changed;
  }

  function normalizeRoomNotes(room) {
    if (typeof room.notes === "string") return false;
    room.notes = "";
    return true;
  }

  function migrateRooms(property, photosMap) {
    if (!property) return { changed: false, dirtyPhotoIds: [] };
    let changed = false;
    const dirtyPhotoIds = [];
    if (!Array.isArray(property.rooms)) {
      property.rooms = [];
      changed = true;
    }
    for (const room of property.rooms) {
      if (!room.id) {
        room.id = uid("room");
        changed = true;
      }
      if (!room.name) {
        room.name = room.roomType || DEFAULT_ROOM_TYPE;
        changed = true;
      }
      if (!ROOM_TYPES.includes(room.roomType)) {
        room.roomType = DEFAULT_ROOM_TYPE;
        changed = true;
      }
      if (!HABITABILITY_OPTIONS.includes(room.habitability)) {
        room.habitability =
          DEFAULT_HABITABILITY_BY_TYPE[room.roomType] || "Habitable";
        changed = true;
      }
      // Flatten the legacy sub-group layout into a single photos list,
      // stamping each photo with its former sub-group as a roomTag.
      const renameLegacyTag = (name) => {
        if (!name) return NO_ROOM_TAG;
        if (name === "Room Photos") return "Room";
        return ROOM_TAGS.includes(name) ? name : NO_ROOM_TAG;
      };
      if (Array.isArray(room.subGroups) && room.subGroups.length) {
        const merged = Array.isArray(room.photoIds) ? room.photoIds.slice() : [];
        for (const sg of room.subGroups) {
          const tag = renameLegacyTag(sg.name);
          for (const pid of sg.photoIds || []) {
            if (!merged.includes(pid)) merged.push(pid);
            if (photosMap) {
              const photo = photosMap.get(pid);
              if (photo && photo.roomTag !== tag) {
                photo.roomTag = tag;
                if (photo.propertyId === property.id) dirtyPhotoIds.push(pid);
              }
            }
          }
        }
        room.photoIds = merged;
        delete room.subGroups;
        changed = true;
      }
      if (!Array.isArray(room.photoIds)) {
        room.photoIds = [];
        changed = true;
      }
      if (normalizeRoomLights(room)) changed = true;
      if (normalizeRoomChimneys(room)) changed = true;
      if (normalizeRoomFlues(room)) changed = true;
      if (normalizeRoomVentilation(room)) changed = true;
      if (normalizeRoomWindows(room)) changed = true;
      if (normalizeRoomNotes(room)) changed = true;
      if (typeof room.heated !== "boolean") {
        room.heated = true;
        changed = true;
      }
      // Catch photos that got the old "Room Photos" tag before this migration.
      if (photosMap) {
        for (const pid of room.photoIds) {
          const photo = photosMap.get(pid);
          if (photo && photo.roomTag === "Room Photos") {
            photo.roomTag = "Room";
            if (photo.propertyId === property.id) dirtyPhotoIds.push(pid);
            changed = true;
          }
        }
      }
    }
    return { changed, dirtyPhotoIds };
  }

  function findGroupById(id) {
    if (!state.property) return null;
    for (const g of state.property.groups || []) {
      if (g.id === id) return { group: g, room: null };
    }
    for (const room of state.property.rooms || []) {
      if (room.id === id) return { group: room, room };
    }
    return null;
  }

  function allPhotoGroups() {
    // Return every { group, room? } pair that can contain photos — used by
    // the exports so nothing is missed. Rooms act as their own photo group.
    const out = [];
    for (const g of state.property.groups || []) out.push({ group: g, room: null });
    for (const room of state.property.rooms || []) {
      out.push({ group: room, room });
    }
    return out;
  }

  // Laser-screen captures are a data source for window measurements,
  // not evidence — they get filtered out of every PDF / ZIP / HTML
  // export and the total photo count. The explicit boolean flag is
  // stamped at capture time, but we also detect older photos (taken
  // before the flag existed) by their laser_measurement analysis.
  function isLaserCapturePhoto(p) {
    if (!p) return false;
    if (p.laserCapture === true) return true;
    if (Array.isArray(p.analyses)) {
      for (const a of p.analyses) {
        if (a && a.preset === "laser_measurement") return true;
      }
    }
    return false;
  }

  // Older builds saved laser captures as room photos with a
  // laserCapture flag and excluded them from exports. The current
  // build doesn't persist them at all, so on load we delete any that
  // are still lying around — including from rooms' photoIds and from
  // IndexedDB.
  function cleanupLegacyLaserCaptures() {
    if (!state.property) return;
    const ids = [];
    for (const photo of state.photos.values()) {
      if (isLaserCapturePhoto(photo)) ids.push(photo.id);
    }
    if (!ids.length) return;
    const idSet = new Set(ids);
    for (const g of state.property.groups || []) {
      g.photoIds = (g.photoIds || []).filter((pid) => !idSet.has(pid));
    }
    for (const room of state.property.rooms || []) {
      room.photoIds = (room.photoIds || []).filter((pid) => !idSet.has(pid));
    }
    for (const id of ids) {
      state.photos.delete(id);
      IDB.deletePhoto(id).catch((err) => console.warn("Failed to delete legacy laser photo", err));
    }
    saveProperty();
  }

  function totalPhotoCount() {
    let n = 0;
    for (const { group } of allPhotoGroups()) {
      for (const pid of group.photoIds || []) {
        const p = state.photos.get(pid);
        if (p && !isLaserCapturePhoto(p)) n++;
      }
    }
    return n;
  }

  async function createProperty(name) {
    const p = makeNewProperty(name);
    await IDB.putProperty(p);
    state.properties.push({ id: p.id, name: p.name });
    renderPropertySelect();
    await switchProperty(p.id);
  }

  async function deleteCurrentProperty() {
    if (!state.property) return;
    const name = state.property.name;
    if (!confirm(`Delete "${name}" and all its photos? This can't be undone.`)) return;
    const id = state.property.id;
    await IDB.deletePhotosByProperty(id);
    await IDB.deleteProperty(id);
    state.properties = state.properties.filter((p) => p.id !== id);

    if (!state.properties.length) {
      await createProperty("Property 1");
      return;
    }
    const next = state.properties[0].id;
    await switchProperty(next);
    toast(`Deleted "${name}".`);
  }

  async function switchProperty(id) {
    saveProperty.flush();
    const prop = await IDB.getProperty(id);
    if (!prop) {
      toast("Property not found.", "err");
      return;
    }
    state.currentId = id;
    state.property = prop;
    state.photos = new Map();
    const photos = await IDB.getPhotosByProperty(id);
    for (const p of photos) state.photos.set(p.id, p);
    localStorage.setItem(ACTIVE_KEY, id);

    if (!state.property.groups || !state.property.groups.length) {
      state.property.groups = makeDefaultGroups();
      saveProperty();
    } else {
      const migration = migrateDefaults(state.property, state.photos);
      if (migration.changed) {
        for (const pid of migration.dirtyPhotoIds) {
          const photo = state.photos.get(pid);
          if (photo) {
            try {
              await IDB.putPhoto(photo);
            } catch (err) {
              console.warn("Failed to persist migrated photo", err);
            }
          }
        }
        saveProperty();
      }
    }

    const roomMigration = migrateRooms(state.property, state.photos);
    if (roomMigration.changed) {
      for (const pid of roomMigration.dirtyPhotoIds) {
        const photo = state.photos.get(pid);
        if (photo) {
          try {
            await IDB.putPhoto(photo);
          } catch (err) {
            console.warn("Failed to persist migrated room photo", err);
          }
        }
      }
      saveProperty();
    }

    // Drop any laser-capture photos that older builds left in the room.
    cleanupLegacyLaserCaptures();

    initExpandedForProperty();
    renderMeta();
    renderRooms();
    renderGroups();
    renderPropertySelect();
    updateExportButton();
    setSaveStatus("saved");

    // If a previous originals export was interrupted (page reloaded
    // after the user saved a part), pop the resume dialog so they
    // can pick up where they left off.
    setTimeout(maybeResumeOriginalsPlan, 200);
  }

  function renderPropertySelect() {
    els.propSelect.innerHTML = "";
    for (const p of state.properties) {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name || "(untitled)";
      if (p.id === state.currentId) opt.selected = true;
      els.propSelect.appendChild(opt);
    }
  }

  function renderMeta() {
    const p = state.property;
    els.metaName.value = p.name || "";
    els.metaAssessor.value = p.meta.assessor || "";
    els.metaAddress.value = p.meta.address || "";
    els.metaRef.value = p.meta.ref || "";
    els.metaDate.value = p.meta.date || todayISO();
    applyMetaCollapsed(!!p.meta.collapsed);
  }

  function applyMetaCollapsed(collapsed) {
    if (!els.metaCard || !els.metaHeader) return;
    els.metaCard.classList.toggle("collapsed", collapsed);
    els.metaHeader.setAttribute("aria-expanded", String(!collapsed));
  }

  function toggleMetaCollapsed() {
    if (!state.property) return;
    const next = !state.property.meta.collapsed;
    state.property.meta.collapsed = next;
    applyMetaCollapsed(next);
    saveProperty();
  }

  // -------------------- Groups / photos rendering --------------------
  function initExpandedForProperty() {
    // Default to fully collapsed on load and on view-switch — the user
    // opens what they need. Newly-added rooms / groups still register
    // themselves in state.expanded at creation so they appear open.
    state.expanded.clear();
  }

  function tagGroupId(tag) {
    return `tag-${tag}`;
  }

  function photoBuildingOf(photo) {
    return BUILDING_TAGS.includes(photo.building) ? photo.building : DEFAULT_BUILDING;
  }

  function setView(view) {
    if (view !== "group" && view !== "tag" && view !== "defects" && view !== "analysis") return;
    if (state.view === view) return;
    state.view = view;
    document.body.classList.toggle("view-defects", view === "defects");
    document.body.classList.toggle("view-tag", view === "tag");
    document.body.classList.toggle("view-analysis", view === "analysis");
    for (const btn of els.viewToggleBtns) {
      const active = btn.dataset.view === view;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", String(active));
    }
    initExpandedForProperty();
    renderGroups();
  }

  function toggleGroup(group, node) {
    const nowExpanded = !state.expanded.has(group.id);
    if (nowExpanded) state.expanded.add(group.id);
    else state.expanded.delete(group.id);
    node.classList.toggle("collapsed", !nowExpanded);
    const header = node.querySelector(".group-header");
    if (header) header.setAttribute("aria-expanded", String(nowExpanded));
  }

  function expandGroup(group) {
    state.expanded.add(group.id);
    const node = document.querySelector(`[data-group-id="${group.id}"]`);
    if (node) {
      node.classList.remove("collapsed");
      const header = node.querySelector(".group-header, .subgroup-header");
      if (header) header.setAttribute("aria-expanded", "true");
    }
  }

  function renderGroups() {
    els.groups.innerHTML = "";
    if (state.view === "tag") {
      renderByTag();
    } else if (state.view === "defects") {
      renderByDefects();
    } else if (state.view === "analysis") {
      renderByAnalysis();
    } else {
      for (const group of state.property.groups) {
        renderGroup(group, els.groups);
      }
    }
  }

  function renderByAnalysis() {
    // Flatten every photo that has at least one analysis, keyed by
    // source group/room so the list reads "which photo, in which
    // section, analysed how".
    const entries = [];
    const pushPhoto = (photo, source) => {
      if (!photo || !Array.isArray(photo.analyses) || !photo.analyses.length) return;
      entries.push({ photo, source });
    };
    for (const g of state.property.groups || []) {
      for (const pid of g.photoIds || []) {
        pushPhoto(state.photos.get(pid), g);
      }
    }
    for (const room of state.property.rooms || []) {
      for (const pid of room.photoIds || []) {
        pushPhoto(state.photos.get(pid), room);
      }
    }

    if (!entries.length) {
      const empty = document.createElement("p");
      empty.className = "defects-empty";
      if (!getClaudeApiKey()) {
        empty.innerHTML =
          "No AI analyses yet. Open a photo, choose <em>Analyse as…</em>, and pick a preset. " +
          "Add a Claude API key in Settings (⚙) first.";
      } else {
        empty.innerHTML =
          "No AI analyses yet. Open a photo, choose <em>Analyse as…</em>, and pick a preset.";
      }
      els.groups.appendChild(empty);
      return;
    }

    // One synthetic section per preset so similar analyses group together.
    const bySection = new Map();
    for (const entry of entries) {
      for (const a of entry.photo.analyses) {
        const key = a.preset;
        if (!bySection.has(key)) bySection.set(key, []);
        bySection.get(key).push({ entry, analysis: a });
      }
    }
    const presetOrder = ANALYSIS_PRESETS.map((p) => p.id);
    const orderedKeys = [...bySection.keys()].sort(
      (a, b) => presetOrder.indexOf(a) - presetOrder.indexOf(b)
    );

    for (const presetKey of orderedKeys) {
      const items = bySection.get(presetKey);
      const preset = getAnalysisPreset(presetKey);
      const section = document.createElement("article");
      section.className = "card group group-analysis";
      const header = document.createElement("header");
      header.className = "group-header";
      header.innerHTML = `
        <div class="group-title-wrap">
          <h2 class="group-title group-title-locked"></h2>
          <span class="group-count">${items.length} photo${items.length === 1 ? "" : "s"}</span>
        </div>`;
      header.querySelector(".group-title").textContent = preset
        ? preset.label
        : presetKey;
      section.appendChild(header);

      const list = document.createElement("div");
      list.className = "analysis-list";
      for (const { entry, analysis } of items) {
        list.appendChild(buildAnalysisListItem(entry, analysis));
      }
      section.appendChild(list);
      els.groups.appendChild(section);
    }
  }

  function buildAnalysisListItem(entry, analysis) {
    const { photo, source } = entry;
    const row = document.createElement("div");
    row.className = "analysis-list-item";

    const thumb = document.createElement("button");
    thumb.type = "button";
    thumb.className = "analysis-list-thumb";
    thumb.setAttribute("aria-label", "Open photo");
    const img = document.createElement("img");
    img.src = photo.dataUrl;
    img.loading = "lazy";
    img.alt = photo.label || "";
    thumb.appendChild(img);
    thumb.addEventListener("click", () => openLightbox(source, photo));
    row.appendChild(thumb);

    const body = document.createElement("div");
    body.className = "analysis-list-body";

    const meta = document.createElement("div");
    meta.className = "analysis-list-meta";
    const source_name = document.createElement("span");
    source_name.className = "analysis-list-source";
    source_name.textContent = (source && source.name) || "";
    meta.appendChild(source_name);
    if (photo.label) {
      const label = document.createElement("span");
      label.className = "analysis-list-label";
      label.textContent = photo.label;
      meta.appendChild(label);
    }
    const when = document.createElement("span");
    when.className = "analysis-list-when";
    when.textContent = analysis.generatedAt
      ? new Date(analysis.generatedAt).toLocaleString()
      : "";
    meta.appendChild(when);
    body.appendChild(meta);

    body.appendChild(buildAnalysisCard(analysis, photo, { editable: true }));
    row.appendChild(body);
    return row;
  }

  function renderByDefects() {
    // One synthetic section per source (flat group or room) that holds
    // defect photos. Rooms appear under their room name.
    const sections = [];
    for (const g of state.property.groups || []) {
      const entries = [];
      for (const pid of g.photoIds) {
        const photo = state.photos.get(pid);
        if (photo && photo.defect) entries.push({ photo, source: g });
      }
      if (entries.length) {
        sections.push({
          id: `defect-${g.id}`,
          name: g.name,
          entries,
          photoIds: entries.map((e) => e.photo.id),
          sourceGroup: g,
          isRoom: false,
        });
      }
    }
    for (const room of state.property.rooms || []) {
      const entries = [];
      for (const pid of room.photoIds || []) {
        const photo = state.photos.get(pid);
        if (photo && photo.defect) entries.push({ photo, source: room });
      }
      if (entries.length) {
        sections.push({
          id: `defect-room-${room.id}`,
          name: `${room.name} (${room.habitability})`,
          entries,
          photoIds: entries.map((e) => e.photo.id),
          sourceGroup: room,
          isRoom: true,
        });
      }
    }

    if (!sections.length) {
      const empty = document.createElement("p");
      empty.className = "defects-empty";
      empty.textContent =
        "No defects flagged — tap a photo's Defect chip to flag it and it'll appear here.";
      els.groups.appendChild(empty);
      return;
    }

    for (const section of sections) {
      state.expanded.add(section.id);
      renderDefectSection(section);
    }
  }

  function renderDefectSection(section) {
    const node = els.groupTpl.content.firstElementChild.cloneNode(true);
    node.dataset.groupId = section.id;
    node.classList.add("group-virtual", "group-defect");

    const header = node.querySelector(".group-header");
    const expanded = state.expanded.has(section.id);
    if (!expanded) node.classList.add("collapsed");
    header.setAttribute("aria-expanded", String(expanded));
    header.addEventListener("click", (e) => {
      if (e.target.closest(".accordion-toggle")) {
        toggleGroup(section, node);
        return;
      }
      if (e.target.closest("button, input, [contenteditable='true']")) return;
      toggleGroup(section, node);
    });
    header.addEventListener("keydown", (e) => {
      if (e.target !== header) return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        toggleGroup(section, node);
      }
    });

    const title = node.querySelector(".group-title");
    title.textContent = section.name;
    title.setAttribute("contenteditable", "false");
    title.classList.add("group-title-locked");

    const actions = node.querySelector(".group-actions");
    if (actions) actions.remove();

    els.groups.appendChild(node);

    for (const { photo } of section.entries) {
      renderThumb(section.sourceGroup, photo, {
        containerGroupId: section.id,
        isRoomPhoto: section.isRoom,
      });
    }
    updateGroupCount(section);
  }

  function renderByTag() {
    // Bucket every tagged photo by its photo.roomTag (Room, Undercuts,
    // Windows, Lighting, Heating, Ventilation, Renewables, Meters,
    // Other). Photos without a tag are omitted — the point of this
    // view is to see what's been labelled and what hasn't.
    const buckets = new Map();
    const pushEntry = (photo, source) => {
      if (!photo) return;
      const tag = photo.roomTag;
      if (!tag || !ROOM_TAGS.includes(tag)) return;
      if (!buckets.has(tag)) buckets.set(tag, []);
      buckets.get(tag).push({ group: source, photo });
    };
    for (const group of state.property.groups) {
      for (const pid of group.photoIds) pushEntry(state.photos.get(pid), group);
    }
    for (const room of state.property.rooms || []) {
      for (const pid of room.photoIds || []) {
        pushEntry(state.photos.get(pid), {
          id: room.id,
          name: room.name,
          photoIds: room.photoIds,
        });
      }
    }

    if (!buckets.size) {
      const empty = document.createElement("p");
      empty.className = "defects-empty";
      empty.textContent =
        "No tagged photos yet. Open a photo and pick a tag (Room, Meters, Windows, etc.).";
      els.groups.appendChild(empty);
      return;
    }

    // Canonical order: iterate ROOM_TAGS so the sections always appear
    // in the same sequence, regardless of which tags are present.
    for (const tag of ROOM_TAGS) {
      const entries = buckets.get(tag);
      if (!entries || !entries.length) continue;
      const synthetic = {
        id: tagGroupId(tag),
        name: tag,
        photoIds: entries.map((e) => e.photo.id),
        protected: true,
        virtual: true,
        tag,
      };
      renderTagGroup(synthetic, entries);
    }
  }

  function renderTagGroup(synthetic, entries) {
    const node = els.groupTpl.content.firstElementChild.cloneNode(true);
    node.dataset.groupId = synthetic.id;
    node.classList.add("group-virtual");

    const header = node.querySelector(".group-header");
    const expanded = state.expanded.has(synthetic.id);
    if (!expanded) node.classList.add("collapsed");
    header.setAttribute("aria-expanded", String(expanded));
    header.addEventListener("click", (e) => {
      if (e.target.closest(".accordion-toggle")) {
        toggleGroup(synthetic, node);
        return;
      }
      if (e.target.closest("button, input, [contenteditable='true']")) return;
      toggleGroup(synthetic, node);
    });
    header.addEventListener("keydown", (e) => {
      if (e.target !== header) return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        toggleGroup(synthetic, node);
      }
    });

    const title = node.querySelector(".group-title");
    title.textContent = synthetic.name;
    title.setAttribute("contenteditable", "false");
    title.classList.add("group-title-locked");

    // No Take photo / Upload / Remove buttons in virtual tag groups.
    const actions = node.querySelector(".group-actions");
    if (actions) actions.remove();

    // Replace the flat thumbs grid with a stack of per-group clusters,
    // each with its own heading and thumbs grid. Preserves the group
    // context that the user is used to in Group view.
    const oldThumbs = node.querySelector(".thumbs");
    const clusters = document.createElement("div");
    clusters.className = "tag-clusters";
    oldThumbs.replaceWith(clusters);

    els.groups.appendChild(node);

    // Cluster entries by their real group, preserving the first-seen order
    // so groups appear in the same sequence they have in the property list.
    const byGroupId = new Map();
    const groupOrder = [];
    for (const entry of entries) {
      const gid = entry.group.id;
      if (!byGroupId.has(gid)) {
        byGroupId.set(gid, { group: entry.group, items: [] });
        groupOrder.push(gid);
      }
      byGroupId.get(gid).items.push(entry);
    }

    for (const gid of groupOrder) {
      const { group, items } = byGroupId.get(gid);
      const cluster = document.createElement("div");
      cluster.className = "tag-cluster";

      const clusterTitle = document.createElement("h3");
      clusterTitle.className = "tag-cluster-title";
      const countText = `${items.length} photo${items.length === 1 ? "" : "s"}`;
      clusterTitle.innerHTML = `<span class="tag-cluster-name"></span> <span class="tag-cluster-count"></span>`;
      clusterTitle.querySelector(".tag-cluster-name").textContent = group.name;
      clusterTitle.querySelector(".tag-cluster-count").textContent = countText;
      cluster.appendChild(clusterTitle);

      const thumbs = document.createElement("div");
      thumbs.className = "thumbs";
      cluster.appendChild(thumbs);
      clusters.appendChild(cluster);

      for (const { photo } of items) {
        renderThumb(group, photo, {
          containerGroupId: synthetic.id,
          thumbsEl: thumbs,
        });
      }
    }
    updateGroupCount(synthetic);
  }

  function renderGroup(group, container) {
    const node = els.groupTpl.content.firstElementChild.cloneNode(true);
    node.dataset.groupId = group.id;

    const header = node.querySelector(".group-header");
    const expanded = state.expanded.has(group.id);
    if (!expanded) node.classList.add("collapsed");
    header.setAttribute("aria-expanded", String(expanded));
    header.addEventListener("click", (e) => {
      if (e.target.closest(".accordion-toggle")) {
        toggleGroup(group, node);
        return;
      }
      if (e.target.closest("button, input, [contenteditable='true']")) return;
      toggleGroup(group, node);
    });
    header.addEventListener("keydown", (e) => {
      if (e.target !== header) return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        toggleGroup(group, node);
      }
    });

    const title = node.querySelector(".group-title");
    title.textContent = group.name;
    if (group.protected) {
      // Default group names are fixed to keep the report structure consistent.
      title.setAttribute("contenteditable", "false");
      title.classList.add("group-title-locked");
    } else {
      title.addEventListener("blur", () => {
        const v = title.textContent.trim();
        group.name = v || "Untitled group";
        title.textContent = group.name;
        saveProperty();
      });
      title.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          title.blur();
        }
      });
    }

    const takeButtons = node.querySelectorAll(".btn-take-photo, .btn-take-photo-tile");
    takeButtons.forEach((btn) => {
      btn.addEventListener("click", () => openCamera(group));
    });

    const uploadInput = node.querySelector(".file-input-upload");
    if (uploadInput) {
      uploadInput.addEventListener("change", async (e) => {
        const files = Array.from(e.target.files || []);
        uploadInput.value = "";
        if (files.length) await addUploadedPhotos(group, files);
      });
    }

    const removeBtn = node.querySelector(".btn-remove-group");
    if (group.protected) {
      removeBtn.remove();
    } else {
      removeBtn.addEventListener("click", () => removeGroup(group.id));
    }

    (container || els.groups).appendChild(node);
    for (const id of group.photoIds) {
      const photo = state.photos.get(id);
      if (photo) renderThumb(group, photo);
    }
    updateGroupCount(group);
  }

  // -------------------- Rooms rendering --------------------
  function renderRooms() {
    if (!els.rooms) return;
    els.rooms.innerHTML = "";
    const rooms = (state.property && state.property.rooms) || [];
    if (!rooms.length) {
      const empty = document.createElement("p");
      empty.className = "rooms-empty";
      empty.textContent = "No rooms yet — pick a room type and tap Add room to get started.";
      els.rooms.appendChild(empty);
      renderTotals();
      return;
    }
    for (const room of rooms) renderRoom(room);
    renderTotals();
  }

  // Recompute the Totals card from state.property.rooms. Cheap so we
  // call it any time a relevant input changes; the lookup is a single
  // pass and the DOM writes are six numbers.
  function renderTotals() {
    const rooms = (state.property && state.property.rooms) || [];
    let heated = 0, unheated = 0;
    let led = 0, cfl = 0, inc = 0;
    let chimOpen = 0, chimBlocked = 0;
    let flueOpen = 0, flueClosed = 0, flueBoiler = 0, flueOther = 0;
    let ventTrickle = 0, ventCore = 0, ventIev = 0, ventDmev = 0;
    for (const r of rooms) {
      if (r.habitability === "Habitable") {
        if (r.heated === false) unheated++;
        else heated++;
      }
      const l = r.lights || {};
      led += Number(l.led) || 0;
      cfl += Number(l.cfl) || 0;
      inc += Number(l.incandescent) || 0;
      const c = r.chimneys || {};
      chimOpen += Number(c.open) || 0;
      chimBlocked += Number(c.blocked) || 0;
      const f = r.flues || {};
      flueOpen += Number(f.open) || 0;
      flueClosed += Number(f.closed) || 0;
      flueBoiler += Number(f.boiler) || 0;
      flueOther += Number(f.other) || 0;
      const v = r.ventilation || {};
      ventTrickle += Number(v.trickle) || 0;
      ventCore += Number(v.core) || 0;
      ventIev += Number(v.iev) || 0;
      ventDmev += Number(v.dmev) || 0;
    }
    const set = (id, n) => {
      const el = document.getElementById(id);
      if (el) el.textContent = String(n);
    };
    set("totals-rooms-heated", heated);
    set("totals-rooms-unheated", unheated);
    set("totals-lights-led", led);
    set("totals-lights-cfl", cfl);
    set("totals-lights-incandescent", inc);
    set("totals-chimneys-open", chimOpen);
    set("totals-chimneys-blocked", chimBlocked);
    set("totals-flues-open", flueOpen);
    set("totals-flues-closed", flueClosed);
    set("totals-flues-boiler", flueBoiler);
    set("totals-flues-other", flueOther);
    set("totals-vent-trickle", ventTrickle);
    set("totals-vent-core", ventCore);
    set("totals-vent-iev", ventIev);
    set("totals-vent-dmev", ventDmev);
  }

  function expandRoom(room) {
    state.expanded.add(room.id);
    const node = document.querySelector(`[data-room-id="${room.id}"]`);
    if (node) {
      node.classList.remove("collapsed");
      const header = node.querySelector(".room-header");
      if (header) header.setAttribute("aria-expanded", "true");
    }
  }

  function toggleRoom(room, node) {
    const nowExpanded = !state.expanded.has(room.id);
    if (nowExpanded) state.expanded.add(room.id);
    else state.expanded.delete(room.id);
    node.classList.toggle("collapsed", !nowExpanded);
    const header = node.querySelector(".room-header");
    if (header) header.setAttribute("aria-expanded", String(nowExpanded));
  }

  // Build one window-fieldset DOM node bound to `win` inside `room`.
  // The fieldset owns its own change listeners so callers don't need
  // to know the schema; it asks the surrounding stack to re-render
  // (via stack.__rerender) only when add/remove changes the count.
  // -------------------- Compass (device orientation) --------------------
  // Read a single compass heading (0-360, clockwise from magnetic North)
  // from the device's magnetometer. iOS Safari requires permission via
  // DeviceOrientationEvent.requestPermission(); Android Chrome doesn't,
  // but only the absolute orientation event gives a stable bearing.
  function readCompassHeading(opts) {
    const timeoutMs = (opts && opts.timeoutMs) || 4000;
    return new Promise((resolve, reject) => {
      if (typeof DeviceOrientationEvent === "undefined") {
        reject(new Error("This device doesn't expose a compass."));
        return;
      }

      const start = (eventName) => {
        let settled = false;
        const finish = (h, err) => {
          if (settled) return;
          settled = true;
          window.removeEventListener(eventName, onEvent, true);
          clearTimeout(timer);
          if (err) reject(err);
          else resolve(h);
        };
        const onEvent = (e) => {
          let heading = null;
          // iOS Safari — degrees from magnetic north, clockwise.
          if (typeof e.webkitCompassHeading === "number") {
            heading = e.webkitCompassHeading;
          } else if (e.absolute && typeof e.alpha === "number") {
            // Android: alpha is rotation around Z, anti-clockwise from
            // North. Compass heading = (360 - alpha) mod 360.
            heading = (360 - e.alpha) % 360;
          }
          if (heading == null || Number.isNaN(heading)) return;
          finish(((heading % 360) + 360) % 360);
        };
        window.addEventListener(eventName, onEvent, true);
        const timer = setTimeout(() => {
          finish(null, new Error("No compass reading. Move the phone in a figure-of-eight to calibrate, then try again."));
        }, timeoutMs);
      };

      const begin = () => {
        // Prefer the absolute event where it exists (Android), fall
        // back to the regular orientation event (iOS exposes
        // webkitCompassHeading on it).
        if ("ondeviceorientationabsolute" in window) {
          start("deviceorientationabsolute");
        } else {
          start("deviceorientation");
        }
      };

      // iOS 13+ requires explicit permission for orientation events.
      if (typeof DeviceOrientationEvent.requestPermission === "function") {
        DeviceOrientationEvent.requestPermission()
          .then((response) => {
            if (response === "granted") begin();
            else reject(new Error("Compass permission denied."));
          })
          .catch((err) => reject(err));
      } else {
        begin();
      }
    });
  }

  // Snap a 0-360 heading to the nearest of the 8 compass points.
  function compassHeadingToOrientation(heading) {
    const POINTS = [
      "North", "North East", "East", "South East",
      "South", "South West", "West", "North West",
    ];
    const idx = Math.round(((heading % 360) + 360) % 360 / 45) % 8;
    return POINTS[idx];
  }

  // Continuous compass watcher used while the camera is open for a
  // window-photo capture. The shutter / Done event reads the latest
  // heading from this object and applies it to the target window.
  const compassWatch = {
    active: false,
    eventName: null,
    listener: null,
    heading: null,
  };

  async function startCompassWatch() {
    if (compassWatch.active) return true;
    if (typeof DeviceOrientationEvent === "undefined") return false;
    if (typeof DeviceOrientationEvent.requestPermission === "function") {
      try {
        const r = await DeviceOrientationEvent.requestPermission();
        if (r !== "granted") return false;
      } catch (_) {
        return false;
      }
    }
    const eventName = "ondeviceorientationabsolute" in window
      ? "deviceorientationabsolute"
      : "deviceorientation";
    const listener = (e) => {
      let h = null;
      if (typeof e.webkitCompassHeading === "number") {
        h = e.webkitCompassHeading;
      } else if (e.absolute && typeof e.alpha === "number") {
        h = (360 - e.alpha) % 360;
      }
      if (h != null && Number.isFinite(h)) {
        compassWatch.heading = ((h % 360) + 360) % 360;
      }
    };
    window.addEventListener(eventName, listener, true);
    compassWatch.active = true;
    compassWatch.eventName = eventName;
    compassWatch.listener = listener;
    compassWatch.heading = null;
    return true;
  }

  function stopCompassWatch() {
    if (!compassWatch.active) return;
    if (compassWatch.listener && compassWatch.eventName) {
      window.removeEventListener(compassWatch.eventName, compassWatch.listener, true);
    }
    compassWatch.active = false;
    compassWatch.listener = null;
    compassWatch.eventName = null;
  }

  function startWindowPhotoCapture(room, win) {
    camera.pendingWindowPhoto = { roomId: room.id, windowId: win.id };
    // Kick off the compass watcher (with iOS permission if needed)
    // before opening the camera. If permission is denied we still take
    // the photo, just without auto-orientation.
    startCompassWatch().then((ok) => {
      if (!ok) {
        toast("Compass not available — photo will save without orientation.", "err");
      }
    }).catch((err) => {
      console.warn("compass watch failed", err);
    });
    openCamera(room);
  }

  function buildWindowFieldset(room, win, idx) {
    const tpl = document.getElementById("room-window-template");
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.dataset.windowId = win.id;

    const titleEl = node.querySelector(".room-windows-title");
    if (titleEl) titleEl.textContent = `Window ${idx + 1}`;

    const removeBtn = node.querySelector(".room-windows-remove");
    if (removeBtn) {
      removeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const i = room.windows.findIndex((w) => w.id === win.id);
        if (i === -1) return;
        room.windows.splice(i, 1);
        saveProperty();
        const stack = node.closest(".room-windows-stack");
        if (stack && typeof stack.__rerender === "function") stack.__rerender();
      });
    }

    const winType = node.querySelector(".room-windows-type");
    const winAge = node.querySelector(".room-windows-age");
    const winFrame = node.querySelector(".room-windows-frame");
    const winOrient = node.querySelector(".room-windows-orientation");
    const winFrameWrap = node.querySelector(".room-windows-frame-wrap");
    const winGapWrap = node.querySelector(".room-windows-gap-wrap");
    const winGapBtns = node.querySelectorAll(".room-windows-gap-btn");

    for (const t of WINDOW_TYPES) {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t;
      winType.appendChild(opt);
    }
    {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "Select age";
      winAge.appendChild(opt);
    }
    for (const a of WINDOW_AGES) {
      const opt = document.createElement("option");
      opt.value = a;
      opt.textContent = a;
      winAge.appendChild(opt);
    }
    for (const f of WINDOW_FRAMES) {
      const opt = document.createElement("option");
      opt.value = f;
      opt.textContent = f;
      winFrame.appendChild(opt);
    }
    // Build the orientation options. The "Horizontal" option is added
    // / removed dynamically when the Roof-window pill is toggled.
    const rebuildOrientationOptions = () => {
      const current = win.orientation;
      winOrient.innerHTML = "";
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Select orientation";
      winOrient.appendChild(placeholder);
      for (const o of WINDOW_ORIENTATIONS) {
        const opt = document.createElement("option");
        opt.value = o;
        opt.textContent = o;
        winOrient.appendChild(opt);
      }
      if (win.roofWindow) {
        const opt = document.createElement("option");
        opt.value = "Horizontal";
        opt.textContent = "Horizontal";
        winOrient.appendChild(opt);
      }
      // Restore the current value if it's still allowed; otherwise blank.
      const allowed = win.roofWindow
        ? WINDOW_ORIENTATIONS.concat("Horizontal")
        : WINDOW_ORIENTATIONS;
      winOrient.value = allowed.includes(current) ? current : "";
    };
    rebuildOrientationOptions();

    const applyVisibility = () => {
      const showFrame = WINDOW_TYPES_NEEDING_FRAME.has(win.type);
      const showGap =
        WINDOW_AGES_NEEDING_GAP.has(win.age) &&
        WINDOW_TYPES_NEEDING_FRAME.has(win.type);
      winFrameWrap.hidden = !showFrame;
      winGapWrap.hidden = !showGap;
    };
    const applyGapButtons = () => {
      winGapBtns.forEach((btn) => {
        const on = btn.dataset.gap === win.gap;
        btn.classList.toggle("is-on", on);
        btn.setAttribute("aria-pressed", String(on));
      });
    };
    const commit = () => {
      normalizeOneWindow(win);
      applyVisibility();
      applyGapButtons();
      rememberWindowDefaults(win);
      saveProperty();
    };

    winType.value = win.type || "Double";
    winAge.value = win.age || "";
    winFrame.value = win.frame || "";
    applyVisibility();
    applyGapButtons();

    // Roof-window toggle — when on, "Horizontal" appears as an
    // orientation option. Toggling off snaps the orientation back to
    // blank if it was Horizontal.
    const roofPill = node.querySelector(".room-windows-roof");
    const roofText = roofPill ? roofPill.querySelector(".room-windows-roof-text") : null;
    const applyRoofPill = () => {
      if (!roofPill) return;
      const on = win.roofWindow === true;
      roofPill.dataset.state = on ? "on" : "off";
      roofPill.setAttribute("aria-pressed", String(on));
      if (roofText) roofText.textContent = on ? "Roof window ✓" : "Roof window";
    };
    applyRoofPill();
    if (roofPill) {
      roofPill.addEventListener("click", (e) => {
        e.stopPropagation();
        win.roofWindow = !(win.roofWindow === true);
        normalizeOneWindow(win);
        applyRoofPill();
        rebuildOrientationOptions();
        rememberWindowDefaults(win);
        saveProperty();
      });
    }

    const winWidth = node.querySelector(".room-windows-width");
    const winHeight = node.querySelector(".room-windows-height");
    if (winWidth) {
      winWidth.value = win.width || "";
      winWidth.addEventListener("input", () => {
        win.width = winWidth.value;
        // Don't propagate measurements to lastWindowDefaults — the
        // user explicitly asked that next-window seeds skip W/H.
        saveProperty();
      });
      winWidth.addEventListener("click", (e) => e.stopPropagation());
    }
    if (winHeight) {
      winHeight.value = win.height || "";
      winHeight.addEventListener("input", () => {
        win.height = winHeight.value;
        saveProperty();
      });
      winHeight.addEventListener("click", (e) => e.stopPropagation());
    }
    const captureBtn = node.querySelector(".btn-capture-laser");
    if (captureBtn) {
      captureBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        startLaserCapture(room, win);
      });
    }
    const windowPhotoBtn = node.querySelector(".btn-window-photo");
    if (windowPhotoBtn) {
      windowPhotoBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        startWindowPhotoCapture(room, win);
      });
    }

    winType.addEventListener("change", () => { win.type = winType.value; commit(); });
    winType.addEventListener("click", (e) => e.stopPropagation());
    winAge.addEventListener("change", () => { win.age = winAge.value; commit(); });
    winAge.addEventListener("click", (e) => e.stopPropagation());
    winFrame.addEventListener("change", () => { win.frame = winFrame.value; commit(); });
    winFrame.addEventListener("click", (e) => e.stopPropagation());
    winOrient.addEventListener("change", () => {
      win.orientation = winOrient.value;
      // Orientation is per-window only — never sent to the seed.
      normalizeOneWindow(win);
      saveProperty();
    });
    winOrient.addEventListener("click", (e) => e.stopPropagation());

    const compassBtn = node.querySelector(".room-windows-compass");
    if (compassBtn) {
      compassBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        compassBtn.disabled = true;
        const originalLabel = compassBtn.innerHTML;
        compassBtn.innerHTML = '<span aria-hidden="true">⏳</span>';
        try {
          const heading = await readCompassHeading();
          const point = compassHeadingToOrientation(heading);
          win.orientation = point;
          winOrient.value = point;
          normalizeOneWindow(win);
          saveProperty();
          toast(`Orientation set to ${point} (${Math.round(heading)}°).`);
        } catch (err) {
          console.warn("compass read failed", err);
          toast(err && err.message ? err.message : "Couldn't read the compass.", "err");
        } finally {
          compassBtn.disabled = false;
          compassBtn.innerHTML = originalLabel;
        }
      });
    }

    winGapBtns.forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const next = btn.dataset.gap;
        win.gap = win.gap === next ? "" : next;
        commit();
      });
    });

    return node;
  }

  function renderRoom(room) {
    const node = els.roomTpl.content.firstElementChild.cloneNode(true);
    node.dataset.roomId = room.id;
    node.classList.toggle("room-wet", room.habitability === "Wet Room");
    node.classList.toggle("room-nonhab", room.habitability === "Non Habitable");

    const header = node.querySelector(".room-header");
    const expanded = state.expanded.has(room.id);
    if (!expanded) node.classList.add("collapsed");
    header.setAttribute("aria-expanded", String(expanded));
    header.addEventListener("click", (e) => {
      // Tap on a button / input / select inside the header runs that
      // control's own handler, EXCEPT the dedicated accordion-toggle
      // button which is exactly meant to fold the row.
      if (e.target.closest(".accordion-toggle")) {
        toggleRoom(room, node);
        return;
      }
      if (e.target.closest("button, input, select, [contenteditable='true']")) return;
      toggleRoom(room, node);
    });
    header.addEventListener("keydown", (e) => {
      if (e.target !== header) return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        toggleRoom(room, node);
      }
    });

    const title = node.querySelector(".room-title-input");
    title.value = room.name;
    const commitTitle = () => {
      const v = title.value.trim();
      const next = v || room.roomType || "Room";
      if (next === room.name) return;
      room.name = next;
      title.value = next;
      saveProperty();
    };
    title.addEventListener("input", () => {
      // Persist every few keystrokes via the debounced saver so refreshes
      // mid-type don't lose the edit.
      room.name = title.value.trim() || room.roomType || "Room";
      saveProperty();
    });
    title.addEventListener("blur", commitTitle);
    title.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        title.blur();
      }
    });
    // Stop the header's click handler from toggling the room when the user
    // taps the name field to edit it.
    title.addEventListener("click", (e) => e.stopPropagation());

    const typeSelect = node.querySelector(".room-type");
    for (const t of ROOM_TYPES) {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t;
      typeSelect.appendChild(opt);
    }
    typeSelect.value = ROOM_TYPES.includes(room.roomType) ? room.roomType : DEFAULT_ROOM_TYPE;
    typeSelect.addEventListener("change", () => {
      const prev = room.roomType;
      room.roomType = typeSelect.value;
      // If the visible name matches the old type (user hadn't customised it),
      // track the new type so the label stays useful.
      if (!room.name || room.name === prev) {
        room.name = room.roomType;
        title.value = room.name;
      }
      saveProperty();
    });

    const habSelect = node.querySelector(".room-habitability");
    for (const h of HABITABILITY_OPTIONS) {
      const opt = document.createElement("option");
      opt.value = h;
      opt.textContent = h;
      habSelect.appendChild(opt);
    }
    habSelect.value = HABITABILITY_OPTIONS.includes(room.habitability)
      ? room.habitability
      : "Habitable";
    habSelect.addEventListener("change", () => {
      room.habitability = habSelect.value;
      node.classList.toggle("room-wet", room.habitability === "Wet Room");
      node.classList.toggle("room-nonhab", room.habitability === "Non Habitable");
      saveProperty();
      renderTotals();
    });

    if (typeof room.heated !== "boolean") room.heated = true;
    const heatedChip = node.querySelector(".room-heated-chip");
    const heatedText = heatedChip.querySelector(".room-heated-text");
    const applyHeated = () => {
      heatedChip.dataset.state = room.heated ? "heated" : "unheated";
      heatedChip.setAttribute("aria-pressed", String(room.heated));
      heatedText.textContent = room.heated ? "Heated" : "Unheated";
    };
    applyHeated();
    heatedChip.addEventListener("click", (e) => {
      e.stopPropagation();
      room.heated = !room.heated;
      applyHeated();
      saveProperty();
      renderTotals();
    });

    normalizeRoomLights(room);
    normalizeRoomChimneys(room);
    normalizeRoomFlues(room);
    normalizeRoomVentilation(room);
    // Both the Lights and Chimneys fieldsets render the same kind of
    // numeric input — wire them up uniformly via data-count="<bucket>"
    // and data-key="<key>" so the bucket grows by adding HTML alone.
    // Boiler flues default to a visible 0 — assessors mark it explicitly,
    // so a literal zero is more useful than a blank field.
    const showZero = (bucket, key) => bucket === "flues" && key === "boiler";
    const renderCount = (bucket, key) => {
      const v = room[bucket][key];
      if (v > 0) return String(v);
      return showZero(bucket, key) ? "0" : "";
    };
    node.querySelectorAll(".room-count-input").forEach((input) => {
      const bucket = input.dataset.count;
      const key = input.dataset.key;
      if (!bucket || !key || !room[bucket] || !(key in room[bucket])) return;
      input.value = renderCount(bucket, key);
      input.addEventListener("input", () => {
        const n = Number(input.value);
        room[bucket][key] = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
        saveProperty();
        renderTotals();
      });
      input.addEventListener("blur", () => {
        // Snap "03" to "3" and clear non-Boiler zeros to a blank field.
        input.value = renderCount(bucket, key);
      });
      input.addEventListener("click", (e) => e.stopPropagation());
    });

    // ----- Windows -----
    normalizeRoomWindows(room);
    const winStack = node.querySelector(".room-windows-stack");
    const winList = winStack ? winStack.querySelector(".room-windows-stack-list") : null;
    const addWindowBtn = winStack ? winStack.querySelector(".btn-add-window") : null;
    if (winList && addWindowBtn) {
      const renderWindows = () => {
        winList.innerHTML = "";
        room.windows.forEach((win, idx) => {
          winList.appendChild(buildWindowFieldset(room, win, idx));
        });
      };
      renderWindows();
      // Re-rendering callback so child fieldsets can ask the parent to
      // refresh after add / remove without each one wiring it up itself.
      winStack.__rerender = renderWindows;
      addWindowBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        // Prefer the last window already in this room as the seed —
        // that's the "last window entered" the user is most likely
        // copying. Fall back to the property-wide remembered defaults.
        // Type / Age / Frame / Glazing gap copy across; Orientation
        // and the actual measurements always start blank.
        const lastInRoom = room.windows[room.windows.length - 1];
        const source = lastInRoom || lastWindowDefaults();
        room.windows.push(
          makeNewWindow(
            source
              ? {
                  type: source.type,
                  age: source.age,
                  gap: source.gap,
                  frame: source.frame,
                  roofWindow: source.roofWindow === true,
                }
              : {}
          )
        );
        normalizeRoomWindows(room);
        renderWindows();
        saveProperty();
      });
    }

    // ----- Notes -----
    normalizeRoomNotes(room);
    const notes = node.querySelector(".room-notes-input");
    if (notes) {
      notes.value = room.notes;
      notes.addEventListener("input", () => {
        room.notes = notes.value;
        saveProperty();
      });
      notes.addEventListener("click", (e) => e.stopPropagation());
    }

    const removeBtn = node.querySelector(".btn-remove-room");
    removeBtn.addEventListener("click", () => removeRoom(room.id));

    // The photos container carries the room id as data-group-id so the
    // existing thumb / camera / upload plumbing can treat the room as a
    // group-like object with { id, name, photoIds }.
    const photosContainer = node.querySelector(".room-photos");
    photosContainer.dataset.groupId = room.id;

    node.querySelectorAll(".btn-take-photo, .btn-take-photo-tile").forEach((btn) => {
      btn.addEventListener("click", () => openCamera(room));
    });
    const uploadInput = node.querySelector(".file-input-upload");
    if (uploadInput) {
      uploadInput.addEventListener("change", async (e) => {
        const files = Array.from(e.target.files || []);
        uploadInput.value = "";
        if (files.length) await addUploadedPhotos(room, files);
      });
    }

    els.rooms.appendChild(node);

    for (const id of room.photoIds || []) {
      const photo = state.photos.get(id);
      if (photo) renderThumb(room, photo, { isRoomPhoto: true });
    }
    updateRoomCount(room);
  }

  function addRoomFromPreset(type) {
    const room = makeRoom(type);
    // Auto-number duplicates so names stay distinct (e.g. "Bedroom 2").
    const existingSame = (state.property.rooms || []).filter(
      (r) => r.roomType === room.roomType
    ).length;
    if (existingSame > 0) room.name = `${room.roomType} ${existingSame + 1}`;
    // Seed the room's first window from the most recently entered
    // window data so the assessor doesn't repeat themselves on every
    // room. Orientation and the actual measurements (width / height)
    // deliberately reset — each window is on a different wall and
    // has its own size.
    const seed = seedFromDefaults();
    if (seed) room.windows = [seed];
    normalizeRoomWindows(room);
    if (!Array.isArray(state.property.rooms)) state.property.rooms = [];
    state.property.rooms.push(room);
    state.expanded.add(room.id);
    renderRooms();
    updateExportButton();
    saveProperty();
    const el = document.querySelector(`[data-room-id="${room.id}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // Pull the seed-windows defaults — first preference is the property's
  // remembered "last entered" snapshot, second is the most recent room
  // that actually has a window record.
  function lastWindowDefaults() {
    const meta = state.property && state.property.meta;
    if (meta && meta.lastWindowDefaults && typeof meta.lastWindowDefaults === "object") {
      return meta.lastWindowDefaults;
    }
    const rooms = (state.property && state.property.rooms) || [];
    for (let i = rooms.length - 1; i >= 0; i--) {
      const list = rooms[i] && rooms[i].windows;
      if (Array.isArray(list) && list.length) {
        const w = list[list.length - 1];
        if (w && typeof w === "object") return w;
      }
    }
    return null;
  }

  function rememberWindowDefaults(window) {
    if (!state.property || !window || typeof window !== "object") return;
    if (!state.property.meta || typeof state.property.meta !== "object") {
      state.property.meta = {};
    }
    // Strip the per-window id so it isn't reused as a seed.
    const { id: _ignore, ...rest } = window;
    state.property.meta.lastWindowDefaults = { ...rest };
  }

  // Build a fresh window seeded from the last-entered defaults, but
  // never carrying over the per-instance fields: orientation (each
  // window is on a different wall) and the measurements (each window
  // has its own size).
  function seedFromDefaults() {
    const seed = lastWindowDefaults();
    return makeNewWindow(
      seed
        ? { type: seed.type, age: seed.age, gap: seed.gap, frame: seed.frame }
        : {}
    );
  }

  function removeRoom(roomId) {
    if (!state.property || !Array.isArray(state.property.rooms)) return;
    const idx = state.property.rooms.findIndex((r) => r.id === roomId);
    if (idx === -1) return;
    const room = state.property.rooms[idx];
    const count = (room.photoIds || []).length;
    const label = room.name || room.roomType || "Room";
    if (!confirm(
      `Remove the "${label}" room${count ? ` and its ${count} photo${count === 1 ? "" : "s"}` : ""}? This can't be undone.`
    )) return;
    (async () => {
      for (const pid of room.photoIds || []) {
        state.photos.delete(pid);
        try {
          await IDB.deletePhoto(pid);
        } catch (err) {
          console.error(err);
        }
      }
      state.property.rooms.splice(idx, 1);
      renderRooms();
      updateExportButton();
      saveProperty();
    })();
  }

  function updateGroupCount(group) {
    const node = document.querySelector(
      `[data-group-id="${group.id}"] .group-count, [data-group-id="${group.id}"] .subgroup-count`
    );
    if (!node) return;
    const n = group.photoIds.length;
    node.textContent = `${n} photo${n === 1 ? "" : "s"}`;
  }

  function updateRoomCount(room) {
    const node = document.querySelector(
      `[data-room-id="${room.id}"] .room-photo-count`
    );
    if (!node) return;
    const n = (room.photoIds || []).length;
    node.textContent = `${n} photo${n === 1 ? "" : "s"}`;
  }

  function renderThumb(group, photo, opts) {
    const options = opts || {};
    const containerId = options.containerGroupId || group.id;
    const thumbsEl =
      options.thumbsEl ||
      document.querySelector(`[data-group-id="${containerId}"] .thumbs`);
    if (!thumbsEl) return;
    const node = els.thumbTpl.content.firstElementChild.cloneNode(true);
    node.dataset.photoId = photo.id;
    const img = node.querySelector("img");
    img.src = photo.dataUrl;
    img.alt = photo.label;
    img.addEventListener("click", () => openLightbox(group, photo));

    const hint = node.querySelector(".thumb-group-hint");
    if (hint) {
      if (options.hint) hint.textContent = options.hint;
      else hint.remove();
    }

    // Small badge in the top-right when the photo has AI analyses.
    if (Array.isArray(photo.analyses) && photo.analyses.length) {
      const badge = document.createElement("span");
      badge.className = "thumb-analysis-badge";
      badge.textContent =
        photo.analyses.length === 1 ? "AI" : `AI ${photo.analyses.length}`;
      badge.title = "Has AI analysis — tap to view";
      node.appendChild(badge);
    }

    const labelInput = node.querySelector(".thumb-label");
    labelInput.value = photo.label || "";

    const saveLabel = debounce(() => savePhotoNow(photo), 500);
    labelInput.addEventListener("input", () => {
      photo.label = labelInput.value;
      saveLabel();
      saveProperty();
    });

    const buildingSelect = node.querySelector(".thumb-building");
    if (buildingSelect) {
      const current = BUILDING_TAGS.includes(photo.building) ? photo.building : DEFAULT_BUILDING;
      buildingSelect.value = current;
      if (photo.building !== current) {
        photo.building = current;
      }
      buildingSelect.addEventListener("change", () => {
        photo.building = buildingSelect.value;
        savePhotoNow(photo).catch((err) => console.warn("Failed to save building tag", err));
        if (state.view === "tag") {
          // Re-categorise so the thumb moves into the right bucket.
          renderGroups();
        }
      });
    }

    const roomTagSelect = node.querySelector(".thumb-roomtag");
    if (roomTagSelect) {
      for (const tag of ROOM_TAGS) {
        const opt = document.createElement("option");
        opt.value = tag;
        opt.textContent = tag;
        roomTagSelect.appendChild(opt);
      }
      const current = ROOM_TAGS.includes(photo.roomTag) ? photo.roomTag : NO_ROOM_TAG;
      roomTagSelect.value = current;
      if ((photo.roomTag || NO_ROOM_TAG) !== current) {
        photo.roomTag = current;
      }
      roomTagSelect.hidden = false;
      roomTagSelect.addEventListener("change", () => {
        photo.roomTag = roomTagSelect.value;
        savePhotoNow(photo).catch((err) => console.warn("Failed to save tag", err));
        // The By Tag view buckets by photo.roomTag, so a tag change
        // must re-render that view to move the thumb into the right
        // bucket (or drop it if the new value is "none").
        if (state.view === "tag") renderGroups();
      });
    }

    const defectBtn = node.querySelector(".thumb-defect");
    if (defectBtn) {
      const applyDefectUi = () => {
        const on = !!photo.defect;
        node.classList.toggle("has-defect", on);
        defectBtn.setAttribute("aria-pressed", String(on));
        const label = defectBtn.querySelector(".thumb-defect-label");
        if (label) label.textContent = on ? "Defect" : "No defect";
      };
      applyDefectUi();
      defectBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        photo.defect = !photo.defect;
        applyDefectUi();
        savePhotoNow(photo).catch((err) => console.warn("Failed to save defect flag", err));
        // In the Defects view an un-flagged photo no longer belongs, and
        // a newly-flagged one should appear — re-render the list.
        if (state.view === "defects") renderGroups();
      });
    }

    const saveBtn = node.querySelector(".thumb-save");
    if (saveBtn) {
      saveBtn.addEventListener("click", async () => {
        saveBtn.disabled = true;
        try {
          await savePhotoToDevice(photo, group);
        } finally {
          saveBtn.disabled = false;
        }
      });
    }

    node.querySelector(".thumb-remove").addEventListener("click", async () => {
      const label = photo.label || `photo ${group.photoIds.indexOf(photo.id) + 1}`;
      if (!confirm(`Delete "${label}" from ${group.name}? This can't be undone.`)) return;
      const i = group.photoIds.indexOf(photo.id);
      if (i !== -1) group.photoIds.splice(i, 1);
      state.photos.delete(photo.id);
      node.remove();
      updateGroupCount(group);
      const owner = findGroupById(group.id);
      if (owner && owner.room) updateRoomCount(owner.room);
      updateExportButton();
      try {
        await IDB.deletePhoto(photo.id);
      } catch (err) {
        console.error(err);
      }
      saveProperty();
      if (state.view === "tag" || state.view === "defects") renderGroups();
    });

    // Drag-to-reorder is only meaningful in the default "by group" layout
    // where all thumbs belong to the same group.
    if (state.view === "group") {
      node.addEventListener("dragstart", () => node.classList.add("dragging"));
      node.addEventListener("dragend", () => node.classList.remove("dragging"));
      node.addEventListener("dragover", (e) => {
        e.preventDefault();
        const dragging = thumbsEl.querySelector(".thumb.dragging");
        if (!dragging || dragging === node) return;
        const rect = node.getBoundingClientRect();
        const before = e.clientY < rect.top + rect.height / 2;
        thumbsEl.insertBefore(dragging, before ? node : node.nextSibling);
      });
      node.addEventListener("drop", () => {
        const newOrder = Array.from(thumbsEl.querySelectorAll(".thumb"))
          .map((el) => el.dataset.photoId)
          .filter(Boolean);
        group.photoIds = newOrder.slice();
        saveProperty();
      });
    } else {
      node.draggable = false;
    }

    const addTile = thumbsEl.querySelector(".thumb-add");
    if (addTile) thumbsEl.insertBefore(node, addTile);
    else thumbsEl.appendChild(node);
  }

  async function addUploadedPhotos(group, files) {
    const imageFiles = files.filter((f) => f.type.startsWith("image/"));
    if (!imageFiles.length) {
      toast("Please select image files.", "err");
      return;
    }
    toast(`Uploading ${imageFiles.length} photo${imageFiles.length === 1 ? "" : "s"}…`);

    // Make sure the receiving group is visible so the new thumbs appear.
    expandGroup(group);
    const owner = findGroupById(group.id);
    const isRoomPhoto = !!(owner && owner.room);
    if (isRoomPhoto) expandRoom(owner.room);

    let missingExifCount = 0;
    const newPhotos = [];
    for (const file of imageFiles) {
      try {
        const photo = await processUploadedFile(file);
        photo.propertyId = state.property.id;
        photo.label = `${group.name} — ${group.photoIds.length + 1}`;
        state.photos.set(photo.id, photo);
        group.photoIds.push(photo.id);
        newPhotos.push(photo);
        if (!photo.takenAt || !photo.gps) missingExifCount += 1;
        await savePhotoNow(photo);
        renderThumb(group, photo, { isRoomPhoto });
        if (isRoomPhoto) updateRoomCount(owner.room);
        else updateGroupCount(group);
      } catch (err) {
        console.error(err);
        toast(`Failed to process ${file.name}`, "err");
      }
    }
    updateExportButton();
    saveProperty();
    if (missingExifCount) {
      toast(
        `${missingExifCount} upload${missingExifCount === 1 ? "" : "s"} missing date/GPS in metadata — shown as “not in photo metadata” in the PDF.`
      );
    } else {
      toast(`Uploaded ${imageFiles.length} photo${imageFiles.length === 1 ? "" : "s"}.`);
    }
    queueAutoTag(newPhotos);
  }

  function addGroup(name) {
    const group = { id: uid("g"), name: name || "Untitled group", photoIds: [] };
    state.property.groups.push(group);
    state.expanded.add(group.id);
    renderGroup(group);
    updateExportButton();
    saveProperty();
  }

  function removeGroup(groupId) {
    const idx = state.property.groups.findIndex((g) => g.id === groupId);
    if (idx === -1) return;
    const group = state.property.groups[idx];
    if (group.protected) {
      toast("This is a default group and can't be removed.", "err");
      return;
    }
    if (!confirm(`Remove the "${group.name}" group${group.photoIds.length ? ` and its ${group.photoIds.length} photo(s)` : ""}? This can't be undone.`)) return;
    (async () => {
      for (const pid of group.photoIds) {
        state.photos.delete(pid);
        try {
          await IDB.deletePhoto(pid);
        } catch (err) {
          console.error(err);
        }
      }
      state.property.groups.splice(idx, 1);
      const el = els.groups.querySelector(`[data-group-id="${groupId}"]`);
      if (el) el.remove();
      updateExportButton();
      saveProperty();
    })();
  }

  function updateExportButton() {
    const disabled = !state.property || totalPhotoCount() === 0;
    els.exportBtn.disabled = disabled;
    els.exportPhotosBtn.disabled = disabled;
  }

  // -------------------- Lightbox / photo editor --------------------
  const lightbox = {
    photos: [],       // array of photo records currently in the carousel
    index: 0,
    sources: [],      // [{ id, name, getPhotos: () => photo[] }] for the filter
    sourceId: "all",  // currently-selected filter key
    ownersById: new Map(), // photo.id -> its owning group/room object
    dirty: false,     // whether any edit was made while the lightbox was open
  };

  function buildLightboxSources() {
    const sources = [];
    const ownersById = new Map();
    const allPhotos = [];
    for (const g of state.property.groups || []) {
      const photos = (g.photoIds || [])
        .map((id) => state.photos.get(id))
        .filter(Boolean);
      for (const p of photos) ownersById.set(p.id, g);
      if (photos.length) {
        sources.push({ id: `g-${g.id}`, name: g.name, photos });
        allPhotos.push(...photos);
      }
    }
    for (const room of state.property.rooms || []) {
      const photos = (room.photoIds || [])
        .map((id) => state.photos.get(id))
        .filter(Boolean);
      for (const p of photos) ownersById.set(p.id, room);
      if (photos.length) {
        sources.push({
          id: `r-${room.id}`,
          name: `${room.name} (${room.habitability})`,
          photos,
        });
        allPhotos.push(...photos);
      }
    }
    return {
      sources,
      ownersById,
      all: allPhotos,
    };
  }

  function renderLightboxFilter() {
    if (!els.lightboxFilter) return;
    els.lightboxFilter.innerHTML = "";
    const optAll = document.createElement("option");
    optAll.value = "all";
    optAll.textContent = `All photos (${lightbox.photos && lightbox.sourceId === "all" ? lightbox.photos.length : state.photos.size})`;
    els.lightboxFilter.appendChild(optAll);
    for (const s of lightbox.sources) {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = `${s.name} · ${s.photos.length}`;
      els.lightboxFilter.appendChild(opt);
    }
    els.lightboxFilter.value = lightbox.sourceId;
  }

  function populateLightboxTagOptions() {
    if (!els.lightboxTag || els.lightboxTag.options.length) return;
    const none = document.createElement("option");
    none.value = NO_ROOM_TAG;
    none.textContent = "— Tag —";
    els.lightboxTag.appendChild(none);
    for (const t of ROOM_TAGS) {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t;
      els.lightboxTag.appendChild(opt);
    }
  }

  function setLightboxSource(sourceId, preferPhotoId) {
    lightbox.sourceId = sourceId;
    const src = lightbox.sources.find((s) => s.id === sourceId);
    const listRaw = sourceId === "all" || !src
      ? lightbox.sources.flatMap((s) => s.photos)
      : src.photos;
    // De-dupe in case a photo somehow appears in multiple sources.
    const seen = new Set();
    lightbox.photos = [];
    for (const p of listRaw) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      lightbox.photos.push(p);
    }
    if (!lightbox.photos.length) {
      closeLightbox();
      return;
    }
    const idx = preferPhotoId
      ? lightbox.photos.findIndex((p) => p.id === preferPhotoId)
      : -1;
    lightbox.index = idx >= 0 ? idx : 0;
    updateLightbox();
  }

  function openLightbox(group, photo) {
    populateLightboxTagOptions();
    const built = buildLightboxSources();
    lightbox.sources = built.sources;
    lightbox.ownersById = built.ownersById;
    lightbox.dirty = false;
    // Preselect the source the user tapped from when it's a real source;
    // tag-view or synthetic "defect-*" sections fall back to "all".
    const ownerId = group && group.id ? `${state.property.rooms && state.property.rooms.some((r) => r.id === group.id) ? "r" : "g"}-${group.id}` : null;
    const hasSource = ownerId && lightbox.sources.some((s) => s.id === ownerId);
    lightbox.sourceId = hasSource ? ownerId : "all";
    renderLightboxFilter();
    setLightboxSource(lightbox.sourceId, photo && photo.id);
    els.lightbox.hidden = false;
    els.lightbox.setAttribute("aria-hidden", "false");
    lockBodyScroll();
  }

  function currentLightboxPhoto() {
    return lightbox.photos[lightbox.index] || null;
  }

  function currentLightboxOwner() {
    const p = currentLightboxPhoto();
    return p ? lightbox.ownersById.get(p.id) || null : null;
  }

  function updateLightbox() {
    const p = currentLightboxPhoto();
    if (!p) return closeLightbox();
    resetLightboxZoom();
    els.lightboxImg.src = p.dataUrl;
    els.lightboxImg.alt = p.label || "";

    const owner = currentLightboxOwner();
    const pieces = [];
    if (owner && owner.name) pieces.push(owner.name);
    if (p.takenAt) pieces.push(new Date(p.takenAt).toLocaleString());
    else if (p.uploadedAt) pieces.push(`Uploaded ${new Date(p.uploadedAt).toLocaleString()}`);
    if (p.gps) pieces.push(formatGps(p.gps));
    els.lightboxCaption.textContent = pieces.join(" · ");
    if (els.lightboxCounter) {
      els.lightboxCounter.textContent = `${lightbox.index + 1} of ${lightbox.photos.length}`;
    }
    els.lightboxPrevBtn.disabled = lightbox.index === 0;
    els.lightboxNextBtn.disabled = lightbox.index === lightbox.photos.length - 1;

    if (els.lightboxLabel) els.lightboxLabel.value = p.label || "";
    if (els.lightboxBuilding) {
      els.lightboxBuilding.value = BUILDING_TAGS.includes(p.building) ? p.building : DEFAULT_BUILDING;
    }
    if (els.lightboxTag) {
      els.lightboxTag.value = ROOM_TAGS.includes(p.roomTag) ? p.roomTag : NO_ROOM_TAG;
    }
    if (els.lightboxDefect) {
      const on = !!p.defect;
      els.lightboxDefect.setAttribute("aria-pressed", String(on));
      els.lightboxDefect.classList.toggle("is-on", on);
      const label = els.lightboxDefect.querySelector(".lightbox-chip-label");
      if (label) label.textContent = on ? "Defect" : "No defect";
    }
    // Refresh the per-photo analysis list + enable/disable Run button.
    refreshLightboxAnalysisUi();
  }

  function stepLightbox(delta) {
    const next = lightbox.index + delta;
    if (next < 0 || next >= lightbox.photos.length) return;
    lightbox.index = next;
    updateLightbox();
  }

  function closeLightbox() {
    els.lightbox.hidden = true;
    els.lightbox.setAttribute("aria-hidden", "true");
    els.lightboxImg.src = "";
    resetLightboxZoom();
    unlockBodyScroll();
    const shouldRerender = lightbox.dirty;
    lightbox.photos = [];
    lightbox.dirty = false;
    // Re-render the underlying groups so their thumbs / counts reflect
    // any building-tag, room-tag, defect, or delete edits made here.
    if (shouldRerender) renderGroups();
  }

  function persistLightboxPhoto() {
    const p = currentLightboxPhoto();
    if (!p) return;
    savePhotoNow(p).catch((err) => console.warn("Lightbox save failed", err));
    lightbox.dirty = true;
  }

  els.lightboxCloseBtn.addEventListener("click", closeLightbox);
  els.lightboxPrevBtn.addEventListener("click", () => stepLightbox(-1));
  els.lightboxNextBtn.addEventListener("click", () => stepLightbox(1));
  // Click-outside-the-image closes; but don't close when the user clicks
  // form controls inside the footer / header.
  els.lightbox.addEventListener("click", (e) => {
    if (e.target === els.lightbox) closeLightbox();
  });
  document.addEventListener("keydown", (e) => {
    if (els.lightbox.hidden) return;
    if (e.target && e.target.matches && e.target.matches("input, select, textarea")) return;
    if (e.key === "Escape") closeLightbox();
    else if (e.key === "ArrowLeft") stepLightbox(-1);
    else if (e.key === "ArrowRight") stepLightbox(1);
  });

  // Horizontal swipe on the stage to step between photos (mobile).
  // Lightbox gesture handling: swipe at 1× to step between photos, pinch
  // to zoom the photo (the stage has touch-action: none so iOS does not
  // hijack the gesture for page-level pinch), pan when zoomed,
  // double-tap to toggle 1× ↔ 2×. Reset on photo change.
  const lightboxZoom = {
    scale: 1,
    x: 0,
    y: 0,
    startDist: 0,
    startScale: 1,
    startX: 0,
    startY: 0,
    panStartX: 0,
    panStartY: 0,
    mode: "none", // "none" | "swipe" | "pan" | "pinch"
    lastTapAt: 0,
    lastTapX: 0,
    lastTapY: 0,
  };

  function applyLightboxTransform() {
    if (!els.lightboxImg) return;
    els.lightboxImg.style.transform =
      `translate3d(${lightboxZoom.x}px, ${lightboxZoom.y}px, 0) scale(${lightboxZoom.scale})`;
  }

  function resetLightboxZoom() {
    lightboxZoom.scale = 1;
    lightboxZoom.x = 0;
    lightboxZoom.y = 0;
    applyLightboxTransform();
  }

  // iOS Safari / PWA lets the document behind a fixed overlay rubber-band
  // when the user drags near the edges. Lock the body position while the
  // lightbox is open so the page underneath literally can't move. We
  // also reserve the scrollbar width (where the browser has one) so the
  // layout doesn't jump when scrolling is taken away.
  const bodyScrollLock = { active: false, y: 0, scrollbarW: 0 };
  function lockBodyScroll() {
    if (bodyScrollLock.active) return;
    bodyScrollLock.y =
      window.scrollY || window.pageYOffset ||
      (document.documentElement && document.documentElement.scrollTop) || 0;
    const scrollbarW = Math.max(
      0,
      window.innerWidth - (document.documentElement.clientWidth || window.innerWidth)
    );
    bodyScrollLock.scrollbarW = scrollbarW;
    const b = document.body;
    b.style.position = "fixed";
    b.style.top = `-${bodyScrollLock.y}px`;
    b.style.left = "0";
    b.style.right = "0";
    b.style.width = "100%";
    b.style.overflow = "hidden";
    if (scrollbarW > 0) {
      document.documentElement.style.paddingRight = `${scrollbarW}px`;
    }
    bodyScrollLock.active = true;
  }
  function unlockBodyScroll() {
    if (!bodyScrollLock.active) return;
    const b = document.body;
    b.style.position = "";
    b.style.top = "";
    b.style.left = "";
    b.style.right = "";
    b.style.width = "";
    b.style.overflow = "";
    if (bodyScrollLock.scrollbarW > 0) {
      document.documentElement.style.paddingRight = "";
    }
    window.scrollTo(0, bodyScrollLock.y);
    bodyScrollLock.active = false;
  }

  (function wireLightboxGestures() {
    const stage = document.querySelector(".lightbox-stage");
    if (!stage) return;

    const setManipulating = (on) => stage.classList.toggle("is-manipulating", !!on);

    stage.addEventListener("touchstart", (e) => {
      // Ignore touches that land on a form control or button — those have
      // their own handlers and shouldn't be treated as a swipe origin.
      if (e.target && e.target.closest("button, select, input, textarea")) return;

      if (e.touches.length === 2) {
        const [a, b] = e.touches;
        lightboxZoom.mode = "pinch";
        lightboxZoom.startDist = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
        lightboxZoom.startScale = lightboxZoom.scale;
        setManipulating(true);
        e.preventDefault();
      } else if (e.touches.length === 1) {
        const t = e.touches[0];
        if (lightboxZoom.scale > 1.02) {
          lightboxZoom.mode = "pan";
          lightboxZoom.panStartX = t.clientX - lightboxZoom.x;
          lightboxZoom.panStartY = t.clientY - lightboxZoom.y;
          setManipulating(true);
        } else {
          lightboxZoom.mode = "swipe";
          lightboxZoom.startX = t.clientX;
          lightboxZoom.startY = t.clientY;
        }
      }
    }, { passive: false });

    stage.addEventListener("touchmove", (e) => {
      if (lightboxZoom.mode === "pinch" && e.touches.length === 2) {
        const [a, b] = e.touches;
        const dist = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY) || 1;
        const next = lightboxZoom.startScale * (dist / (lightboxZoom.startDist || 1));
        lightboxZoom.scale = Math.max(1, Math.min(4, next));
        if (lightboxZoom.scale <= 1.01) {
          lightboxZoom.x = 0;
          lightboxZoom.y = 0;
        }
        applyLightboxTransform();
        e.preventDefault();
      } else if (lightboxZoom.mode === "pan" && e.touches.length === 1) {
        const t = e.touches[0];
        lightboxZoom.x = t.clientX - lightboxZoom.panStartX;
        lightboxZoom.y = t.clientY - lightboxZoom.panStartY;
        applyLightboxTransform();
        e.preventDefault();
      }
    }, { passive: false });

    stage.addEventListener("touchend", (e) => {
      const ended = lightboxZoom.mode;
      // If the pinch was released, fall through so the next single-finger
      // touch is tracked cleanly.
      if (e.touches.length === 0) setManipulating(false);

      if (ended === "swipe" && e.changedTouches.length === 1) {
        const t = e.changedTouches[0];
        const dx = t.clientX - lightboxZoom.startX;
        const dy = t.clientY - lightboxZoom.startY;
        const now = Date.now();
        // Horizontal swipe → navigate.
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4) {
          stepLightbox(dx > 0 ? -1 : 1);
        } else if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
          // Tap — detect double-tap to toggle zoom.
          const dt = now - lightboxZoom.lastTapAt;
          const ddx = Math.abs(t.clientX - lightboxZoom.lastTapX);
          const ddy = Math.abs(t.clientY - lightboxZoom.lastTapY);
          if (dt < 300 && ddx < 30 && ddy < 30) {
            if (lightboxZoom.scale > 1.02) {
              resetLightboxZoom();
            } else {
              lightboxZoom.scale = 2;
              applyLightboxTransform();
            }
            lightboxZoom.lastTapAt = 0;
          } else {
            lightboxZoom.lastTapAt = now;
            lightboxZoom.lastTapX = t.clientX;
            lightboxZoom.lastTapY = t.clientY;
          }
        }
      }

      if (e.touches.length === 0) {
        // Snap tiny residual scales back to exactly 1 so a near-reset
        // doesn't leave an almost-zoomed image.
        if (lightboxZoom.scale <= 1.02) resetLightboxZoom();
        lightboxZoom.mode = "none";
      } else if (e.touches.length === 1 && ended === "pinch") {
        // Lifting one finger from a pinch: fall back to pan tracking.
        const t = e.touches[0];
        lightboxZoom.mode = lightboxZoom.scale > 1.02 ? "pan" : "swipe";
        if (lightboxZoom.mode === "pan") {
          lightboxZoom.panStartX = t.clientX - lightboxZoom.x;
          lightboxZoom.panStartY = t.clientY - lightboxZoom.y;
        } else {
          lightboxZoom.startX = t.clientX;
          lightboxZoom.startY = t.clientY;
        }
      }
    });

    stage.addEventListener("touchcancel", () => {
      lightboxZoom.mode = "none";
      setManipulating(false);
    });

    // Desktop: double-click toggles zoom too, for testing + trackpad use.
    els.lightboxImg.addEventListener("dblclick", () => {
      if (lightboxZoom.scale > 1.02) resetLightboxZoom();
      else {
        lightboxZoom.scale = 2;
        applyLightboxTransform();
      }
    });
  })();

  if (els.lightboxFilter) {
    els.lightboxFilter.addEventListener("change", () => {
      setLightboxSource(els.lightboxFilter.value);
    });
  }
  if (els.lightboxLabel) {
    const saveLabel = debounce(persistLightboxPhoto, 400);
    els.lightboxLabel.addEventListener("input", () => {
      const p = currentLightboxPhoto();
      if (!p) return;
      p.label = els.lightboxLabel.value;
      els.lightboxImg.alt = p.label || "";
      saveLabel();
    });
    els.lightboxLabel.addEventListener("blur", () => {
      saveLabel.flush && saveLabel.flush();
      persistLightboxPhoto();
    });
  }
  if (els.lightboxLabelAi) {
    const aiTextNode = els.lightboxLabelAi.querySelector(".lightbox-label-ai-text");
    const aiGlyphNode = els.lightboxLabelAi.querySelector(".lightbox-label-ai-glyph");
    const originalText = aiTextNode ? aiTextNode.textContent : "";
    const originalGlyph = aiGlyphNode ? aiGlyphNode.textContent : "";
    els.lightboxLabelAi.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const p = currentLightboxPhoto();
      if (!p) return;
      if (!getClaudeApiKey()) {
        toast("Set a Claude API key in Settings first.", "err");
        openSettingsDialog();
        return;
      }
      els.lightboxLabelAi.disabled = true;
      if (aiTextNode) aiTextNode.textContent = "Generating…";
      if (aiGlyphNode) aiGlyphNode.textContent = "…";
      try {
        const owner = currentLightboxOwner();
        const contextName = owner && owner.name ? owner.name : "";
        const label = await runPhotoLabel(p, contextName);
        if (label) {
          p.label = label;
          if (els.lightboxLabel) els.lightboxLabel.value = label;
          if (els.lightboxImg) els.lightboxImg.alt = label;
          persistLightboxPhoto();
          toast("Label generated.");
        } else {
          toast("Claude returned an empty label.", "err");
        }
      } catch (err) {
        console.error(err);
        toast(err.message || "Label generation failed.", "err");
      } finally {
        els.lightboxLabelAi.disabled = false;
        if (aiTextNode) aiTextNode.textContent = originalText;
        if (aiGlyphNode) aiGlyphNode.textContent = originalGlyph;
      }
    });
  }
  if (els.lightboxBuilding) {
    els.lightboxBuilding.addEventListener("change", () => {
      const p = currentLightboxPhoto();
      if (!p) return;
      p.building = els.lightboxBuilding.value;
      persistLightboxPhoto();
    });
  }
  if (els.lightboxTag) {
    els.lightboxTag.addEventListener("change", () => {
      const p = currentLightboxPhoto();
      if (!p) return;
      p.roomTag = els.lightboxTag.value;
      persistLightboxPhoto();
    });
  }
  if (els.lightboxDefect) {
    els.lightboxDefect.addEventListener("click", () => {
      const p = currentLightboxPhoto();
      if (!p) return;
      p.defect = !p.defect;
      persistLightboxPhoto();
      updateLightbox();
    });
  }
  if (els.lightboxDelete) {
    els.lightboxDelete.addEventListener("click", async () => {
      const p = currentLightboxPhoto();
      if (!p) return;
      const owner = currentLightboxOwner();
      const label = p.label || (owner && owner.name) || "this photo";
      if (!confirm(`Delete "${label}"? This can't be undone.`)) return;
      // Remove from owner's photoIds.
      if (owner && Array.isArray(owner.photoIds)) {
        const i = owner.photoIds.indexOf(p.id);
        if (i !== -1) owner.photoIds.splice(i, 1);
      }
      state.photos.delete(p.id);
      try {
        await IDB.deletePhoto(p.id);
      } catch (err) {
        console.error(err);
      }
      saveProperty();
      lightbox.dirty = true;
      // Remove from the currently-displayed carousel and advance to the
      // next remaining photo, or close if none left.
      lightbox.photos.splice(lightbox.index, 1);
      if (lightbox.sources.find((s) => s.photos.includes(p))) {
        const src = lightbox.sources.find((s) => s.photos.includes(p));
        const j = src.photos.indexOf(p);
        if (j !== -1) src.photos.splice(j, 1);
      }
      lightbox.ownersById.delete(p.id);
      if (!lightbox.photos.length) return closeLightbox();
      if (lightbox.index >= lightbox.photos.length) lightbox.index = lightbox.photos.length - 1;
      renderLightboxFilter();
      updateLightbox();
    });
  }

  // -------------------- In-app camera --------------------
  const camera = {
    stream: null,
    facingMode: "environment",
    group: null,
    buffer: [],
    // When set, the next committed photo from this camera session triggers
    // the laser-screen analysis flow rather than the normal evidence flow.
    pendingLaserCapture: null,
    // When set, the camera session is associated with a specific window
    // and the latest compass heading captured during the session is
    // applied to that window's orientation on commit.
    pendingWindowPhoto: null,
    els: {
      overlay: document.getElementById("camera-overlay"),
      video: document.getElementById("camera-video"),
      flash: document.getElementById("camera-flash"),
      title: document.getElementById("camera-title"),
      count: document.getElementById("camera-count"),
      thumbs: document.getElementById("camera-thumbs"),
      shutter: document.getElementById("camera-shutter"),
      done: document.getElementById("camera-done"),
      cancel: document.getElementById("camera-cancel"),
      switch: document.getElementById("camera-switch"),
      torch: document.getElementById("camera-torch"),
    },
    torchOn: false,
  };

  async function openCamera(group) {
    camera.group = group;
    camera.buffer = [];
    camera.els.title.textContent = group.name;
    updateCameraCount();
    renderCameraBuffer();
    camera.els.overlay.hidden = false;
    camera.els.overlay.setAttribute("aria-hidden", "false");
    try {
      await startCameraStream(camera.facingMode);
    } catch (err) {
      console.warn("getUserMedia failed", err);
      camera.els.overlay.hidden = true;
      camera.els.overlay.setAttribute("aria-hidden", "true");
      toast("Can't open the in-app camera — check camera permission.", "err");
      return;
    }
  }

  function cameraVideoTrack() {
    if (!camera.stream) return null;
    const tracks = camera.stream.getVideoTracks();
    return tracks.length ? tracks[0] : null;
  }

  function trackSupportsTorch(track) {
    if (!track || typeof track.getCapabilities !== "function") return false;
    try {
      const caps = track.getCapabilities();
      return !!(caps && caps.torch);
    } catch (_) {
      return false;
    }
  }

  async function applyTorch(on) {
    const track = cameraVideoTrack();
    if (!track || !trackSupportsTorch(track)) return false;
    try {
      await track.applyConstraints({ advanced: [{ torch: !!on }] });
      return true;
    } catch (err) {
      console.warn("applyConstraints torch failed", err);
      return false;
    }
  }

  function refreshTorchButton() {
    const btn = camera.els.torch;
    if (!btn) return;
    const track = cameraVideoTrack();
    const supported = trackSupportsTorch(track);
    btn.hidden = !supported;
    if (!supported) {
      camera.torchOn = false;
      btn.setAttribute("aria-pressed", "false");
      btn.classList.remove("is-on");
      return;
    }
    btn.setAttribute("aria-pressed", String(camera.torchOn));
    btn.classList.toggle("is-on", camera.torchOn);
    const label = btn.querySelector(".camera-torch-state");
    if (label) label.textContent = camera.torchOn ? "Flash on" : "Flash off";
  }

  async function startCameraStream(facingMode) {
    if (camera.stream) {
      camera.stream.getTracks().forEach((t) => t.stop());
      camera.stream = null;
    }
    // A new stream starts with torch off regardless of the previous state.
    camera.torchOn = false;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("Camera API not available");
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: facingMode },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    });
    camera.stream = stream;
    camera.facingMode = facingMode;
    camera.els.video.srcObject = stream;
    try {
      await camera.els.video.play();
    } catch (_) {
      /* autoplay quirks ignored */
    }
    // Torch capabilities are only populated after the track is live, which
    // on some platforms takes a short moment after getUserMedia resolves.
    refreshTorchButton();
    setTimeout(refreshTorchButton, 400);
  }

  function closeCamera(save) {
    if (camera.stream) {
      if (camera.torchOn) applyTorch(false).catch(() => {});
      camera.stream.getTracks().forEach((t) => t.stop());
      camera.stream = null;
    }
    camera.torchOn = false;
    refreshTorchButton();
    camera.els.video.srcObject = null;
    camera.els.overlay.hidden = true;
    camera.els.overlay.setAttribute("aria-hidden", "true");

    const laserCapture = camera.pendingLaserCapture;
    camera.pendingLaserCapture = null;
    const windowPhoto = camera.pendingWindowPhoto;
    camera.pendingWindowPhoto = null;

    // Snapshot the latest compass reading before the watcher stops —
    // the user pressed Done a moment ago, the phone is still pointed
    // at the window.
    const finalHeading =
      compassWatch.active && Number.isFinite(compassWatch.heading)
        ? compassWatch.heading
        : null;
    stopCompassWatch();

    if (save && camera.buffer.length && camera.group) {
      if (laserCapture) {
        // Laser-screen path: don't save the photo to the room. Run the
        // analysis on the captured frame's dataUrl in the background
        // and discard the photo afterwards — it isn't evidence, just
        // a measurement input.
        const targetRoom = camera.group;
        const captured = camera.buffer[camera.buffer.length - 1];
        const targetWin =
          (targetRoom.windows || []).find((w) => w.id === laserCapture.windowId) ||
          (targetRoom.windows || [])[0] ||
          null;
        if (targetWin) {
          runLaserAutoFill(targetRoom, targetWin, captured).catch((err) => {
            console.error("laser auto-fill failed", err);
            toast(err && err.message ? err.message : "Couldn't read the laser screen.", "err");
          });
        } else {
          toast("Add a window to this room before capturing from the laser.", "err");
        }
      } else {
        // Window-photo capture: pre-tag the photos so they file under
        // Windows even before auto-tag runs.
        if (windowPhoto) {
          for (const p of camera.buffer) {
            if (!p.roomTag) p.roomTag = "Windows";
          }
        }
        commitBufferedPhotos(camera.group, camera.buffer);
        if (windowPhoto) {
          applyWindowPhotoOrientation(windowPhoto, finalHeading);
        }
      }
    }
    camera.buffer = [];
    camera.group = null;
    renderCameraBuffer();
    updateCameraCount();
  }

  function applyWindowPhotoOrientation(target, heading) {
    if (!heading || !Number.isFinite(heading)) return;
    const room = (state.property && state.property.rooms || []).find((r) => r.id === target.roomId);
    if (!room) return;
    const win = (room.windows || []).find((w) => w.id === target.windowId);
    if (!win) return;
    const point = compassHeadingToOrientation(heading);
    win.orientation = point;
    normalizeOneWindow(win);
    saveProperty();
    const sel = document.querySelector(
      `[data-room-id="${room.id}"] [data-window-id="${win.id}"] .room-windows-orientation`
    );
    if (sel) sel.value = point;
    toast(`Orientation set to ${point} (${Math.round(heading)}°).`);
  }

  function flashScreen() {
    camera.els.flash.classList.add("show");
    setTimeout(() => camera.els.flash.classList.remove("show"), 110);
  }

  function captureFrame() {
    const video = camera.els.video;
    if (!video.videoWidth || !video.videoHeight) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    const longest = Math.max(w, h);
    const scale = longest > MAX_DIMENSION ? MAX_DIMENSION / longest : 1;
    const outW = Math.round(w * scale);
    const outH = Math.round(h * scale);
    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, outW, outH);
    const stampDate = new Date();
    drawOverlay(ctx, outW, outH, formatStamp(stampDate), formatGps(state.gps));
    const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    const photo = {
      id: uid("p"),
      source: "camera",
      dataUrl,
      width: outW,
      height: outH,
      takenAt: stampDate.toISOString(),
      gps: state.gps ? { ...state.gps } : null,
      building: DEFAULT_BUILDING,
      defect: false,
      roomTag: NO_ROOM_TAG,
      label: "",
    };
    camera.buffer.push(photo);
    flashScreen();
    renderCameraBuffer();
    updateCameraCount();
  }

  function updateCameraCount() {
    const n = camera.buffer.length;
    camera.els.count.textContent = n ? `${n} captured` : "0 captured";
    camera.els.done.textContent = n ? `Done (${n})` : "Done";
  }

  function renderCameraBuffer() {
    const el = camera.els.thumbs;
    el.innerHTML = "";
    camera.buffer.forEach((photo, i) => {
      const wrap = document.createElement("div");
      wrap.className = "cam-thumb";
      const img = document.createElement("img");
      img.src = photo.dataUrl;
      wrap.appendChild(img);
      const rm = document.createElement("button");
      rm.type = "button";
      rm.textContent = "×";
      rm.addEventListener("click", () => {
        camera.buffer.splice(i, 1);
        renderCameraBuffer();
        updateCameraCount();
      });
      wrap.appendChild(rm);
      el.appendChild(wrap);
    });
  }

  async function commitBufferedPhotos(group, photos) {
    // Auto-expand the group so newly-captured thumbs are immediately visible.
    expandGroup(group);
    const owner = findGroupById(group.id);
    const isRoomPhoto = !!(owner && owner.room);
    if (isRoomPhoto) expandRoom(owner.room);
    for (const photo of photos) {
      photo.propertyId = state.property.id;
      photo.label = `${group.name} — ${group.photoIds.length + 1}`;
      state.photos.set(photo.id, photo);
      group.photoIds.push(photo.id);
      try {
        await savePhotoNow(photo);
      } catch (err) {
        console.error(err);
      }
      renderThumb(group, photo, { isRoomPhoto });
      if (isRoomPhoto) updateRoomCount(owner.room);
      else updateGroupCount(group);
    }
    updateExportButton();
    saveProperty();
    toast(`Added ${photos.length} photo${photos.length === 1 ? "" : "s"} to ${group.name}.`);
    // Fire-and-forget AI auto-tagging for the new photos.
    queueAutoTag(photos);
  }

  camera.els.shutter.addEventListener("click", captureFrame);
  camera.els.done.addEventListener("click", () => closeCamera(true));
  camera.els.cancel.addEventListener("click", () => {
    if (camera.buffer.length && !confirm("Discard all captured photos?")) return;
    closeCamera(false);
  });
  camera.els.switch.addEventListener("click", async () => {
    try {
      await startCameraStream(camera.facingMode === "environment" ? "user" : "environment");
    } catch (err) {
      console.warn(err);
      toast("Couldn't switch camera.", "err");
    }
  });
  if (camera.els.torch) {
    camera.els.torch.addEventListener("click", async () => {
      const target = !camera.torchOn;
      const ok = await applyTorch(target);
      if (ok) {
        camera.torchOn = target;
        refreshTorchButton();
      } else {
        toast(
          "Flash control isn't available on this device — try the system torch.",
          "err"
        );
      }
    });
  }
  document.addEventListener("keydown", (e) => {
    if (camera.els.overlay.hidden) return;
    if (e.key === "Escape") {
      e.preventDefault();
      camera.els.cancel.click();
    } else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      captureFrame();
    }
  });

  // -------------------- EXIF / binary helpers --------------------
  function exifDateTime(iso) {
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, "0");
    return (
      `${d.getFullYear()}:${pad(d.getMonth() + 1)}:${pad(d.getDate())} ` +
      `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    );
  }

  function degToDmsRational(deg) {
    const abs = Math.abs(deg);
    const d = Math.floor(abs);
    const mFloat = (abs - d) * 60;
    const m = Math.floor(mFloat);
    const s = Math.round((mFloat - m) * 60 * 10000);
    return [
      [d, 1],
      [m, 1],
      [s, 10000],
    ];
  }

  // Build an EXIF blob for a photo (date + optional GPS). Null if the piexif
  // library isn't loaded. Shared by the share-sheet, share-per-photo, and
  // ZIP paths so date/GPS survive re-encoding.
  function exifStringFor(photo) {
    if (typeof piexif === "undefined") return null;
    try {
      const dt = exifDateTime(photo.takenAt || new Date().toISOString());
      const zeroth = {
        [piexif.ImageIFD.DateTime]: dt,
        [piexif.ImageIFD.Software]: "Retrofit Photos",
      };
      const exif = {
        [piexif.ExifIFD.DateTimeOriginal]: dt,
        [piexif.ExifIFD.DateTimeDigitized]: dt,
      };
      const gps = {};
      if (photo.gps) {
        const lat = photo.gps.latitude;
        const lon = photo.gps.longitude;
        gps[piexif.GPSIFD.GPSLatitudeRef] = lat >= 0 ? "N" : "S";
        gps[piexif.GPSIFD.GPSLatitude] = degToDmsRational(lat);
        gps[piexif.GPSIFD.GPSLongitudeRef] = lon >= 0 ? "E" : "W";
        gps[piexif.GPSIFD.GPSLongitude] = degToDmsRational(lon);
        const d = new Date(photo.takenAt || Date.now());
        const pad = (n) => String(n).padStart(2, "0");
        gps[piexif.GPSIFD.GPSDateStamp] =
          `${d.getUTCFullYear()}:${pad(d.getUTCMonth() + 1)}:${pad(d.getUTCDate())}`;
        gps[piexif.GPSIFD.GPSTimeStamp] = [
          [d.getUTCHours(), 1],
          [d.getUTCMinutes(), 1],
          [d.getUTCSeconds(), 1],
        ];
      }
      return piexif.dump({ "0th": zeroth, Exif: exif, GPS: gps });
    } catch (_) {
      return null;
    }
  }

  // Inject EXIF into an arbitrary JPEG data URL (e.g. a re-encoded smaller
  // copy). Upload-source photos keep their original EXIF if available.
  function insertExifInto(dataUrl, photo) {
    if (typeof piexif === "undefined") return dataUrl;
    try {
      if (photo.source === "upload" && photo.rawExif) {
        return piexif.insert(photo.rawExif, dataUrl);
      }
      const exifStr = exifStringFor(photo);
      if (!exifStr) return dataUrl;
      return piexif.insert(exifStr, dataUrl);
    } catch (err) {
      console.warn("EXIF injection failed; using plain JPEG.", err);
      return dataUrl;
    }
  }

  function buildExifDataUrl(photo) {
    return insertExifInto(photo.dataUrl, photo);
  }

  function dataUrlToBytes(dataUrl) {
    const base64 = dataUrl.split(",")[1] || "";
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Probe whether the device supports sharing files via the OS share
  // sheet (iOS Safari 16.4+, Android Chrome). Cached at boot so the
  // dialogs can default the share toggle accordingly.
  function canShareFiles() {
    if (typeof navigator === "undefined") return false;
    if (typeof navigator.canShare !== "function") return false;
    try {
      const probe = new File([new Blob(["x"])], "probe.txt", { type: "text/plain" });
      return navigator.canShare({ files: [probe] });
    } catch (_) {
      return false;
    }
  }

  // Share if requested and supported, otherwise fall back to a regular
  // download. Returns a string describing what happened so callers can
  // tailor toast messages.
  async function deliverBlob(blob, filename, opts) {
    const wantsShare = opts && opts.share;
    if (wantsShare && typeof navigator.canShare === "function") {
      const file = new File([blob], filename, {
        type: blob.type || "application/octet-stream",
      });
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: (opts && opts.title) || filename,
            text: (opts && opts.text) || "",
          });
          return "shared";
        } catch (err) {
          if (err && err.name === "AbortError") return "cancelled";
          console.warn("share failed, falling back to download", err);
        }
      }
    }
    saveBlob(blob, filename);
    return "downloaded";
  }

  // -------------------- AI photo analysis --------------------
  function getClaudeApiKey() {
    try {
      return localStorage.getItem(CLAUDE_API_KEY_STORAGE) || "";
    } catch (_) {
      return "";
    }
  }
  function setClaudeApiKey(key) {
    try {
      if (key) localStorage.setItem(CLAUDE_API_KEY_STORAGE, key);
      else localStorage.removeItem(CLAUDE_API_KEY_STORAGE);
    } catch (_) {
      /* noop */
    }
  }
  function getClaudeModel() {
    try {
      const m = localStorage.getItem(CLAUDE_MODEL_STORAGE);
      if (m && CLAUDE_MODELS.some((opt) => opt.id === m)) return m;
    } catch (_) {
      /* fall through */
    }
    return DEFAULT_CLAUDE_MODEL;
  }
  function setClaudeModel(model) {
    try {
      if (model && CLAUDE_MODELS.some((opt) => opt.id === model)) {
        localStorage.setItem(CLAUDE_MODEL_STORAGE, model);
      }
    } catch (_) {
      /* noop */
    }
  }
  function getAnalysisPreset(id) {
    return ANALYSIS_PRESETS.find((p) => p.id === id) || null;
  }

  // Split a data URL like "data:image/jpeg;base64,..." into { mediaType, base64 }.
  function splitDataUrl(dataUrl) {
    if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) {
      return { mediaType: "image/jpeg", base64: "" };
    }
    const semi = dataUrl.indexOf(";");
    const comma = dataUrl.indexOf(",");
    if (semi < 0 || comma < 0) return { mediaType: "image/jpeg", base64: "" };
    return {
      mediaType: dataUrl.slice(5, semi),
      base64: dataUrl.slice(comma + 1),
    };
  }

  // Downscale the stored photo before shipping to the API — 1600 px long
  // edge is plenty for a meter / boiler badge and cuts the request body
  // substantially on slow networks.
  async function shrinkForAnalysis(dataUrl) {
    const MAX = 1600;
    try {
      const img = await loadImageFromDataUrl(dataUrl);
      const longest = Math.max(img.naturalWidth, img.naturalHeight);
      const scale = longest > MAX ? MAX / longest : 1;
      if (scale === 1) return dataUrl;
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      return canvas.toDataURL("image/jpeg", 0.9);
    } catch (err) {
      console.warn("Analysis shrink failed; sending original.", err);
      return dataUrl;
    }
  }

  async function runPhotoAnalysis(photo, presetId) {
    const preset = getAnalysisPreset(presetId);
    if (!preset) throw new Error("Unknown analysis preset");
    const apiKey = getClaudeApiKey();
    if (!apiKey) {
      throw new Error("Set a Claude API key in Settings first.");
    }
    const model = getClaudeModel();
    const smaller = await shrinkForAnalysis(photo.dataUrl);
    const { mediaType, base64 } = splitDataUrl(smaller);
    if (!base64) throw new Error("Couldn't read the photo data.");

    const body = {
      model,
      max_tokens: 2048,
      system: [
        {
          type: "text",
          text: preset.systemPrompt,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType,
                data: base64,
              },
            },
            { type: "text", text: preset.userPrompt },
          ],
        },
      ],
      output_config: {
        format: {
          type: "json_schema",
          schema: preset.schema,
        },
      },
    };

    let response;
    try {
      response = await fetch(CLAUDE_API_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new Error("Network error — check your connection.");
    }

    if (!response.ok) {
      let message = `Claude API error (${response.status})`;
      try {
        const err = await response.json();
        if (err && err.error && err.error.message) message = err.error.message;
      } catch (_) {
        /* keep generic message */
      }
      if (response.status === 401) message = "Invalid API key.";
      throw new Error(message);
    }

    const result = await response.json();
    const textBlock = (result.content || []).find((b) => b.type === "text");
    if (!textBlock) throw new Error("Empty response from Claude.");
    let data;
    try {
      data = JSON.parse(textBlock.text);
    } catch (_) {
      throw new Error("Claude returned a non-JSON response.");
    }

    return {
      id: uid("an"),
      preset: presetId,
      model,
      generatedAt: new Date().toISOString(),
      data,
    };
  }

  // -------------------- Laser-measurer screen capture --------------------
  // Flow: user taps "Capture from laser" in a room's Windows fieldset →
  // we open the camera with a pendingLaserCapture marker → after the
  // photo commits, runLaserPicker analyses it with the laser_measurement
  // preset and pops the picker dialog.
  function startLaserCapture(room, win) {
    const apiKey = getClaudeApiKey();
    if (!apiKey) {
      toast("Set a Claude API key in Settings before capturing from the laser screen.", "err");
      return;
    }
    camera.pendingLaserCapture = { roomId: room.id, windowId: win ? win.id : null };
    openCamera(room);
  }

  async function runLaserAutoFill(room, win, photo) {
    let analysis;
    try {
      analysis = await runPhotoAnalysis(photo, "laser_measurement");
    } catch (err) {
      toast(err && err.message ? err.message : "Couldn't read the laser screen.", "err");
      return;
    }

    // The laser-screen photo is transient — we never save it to the
    // room or to IndexedDB, so there's nothing to persist the analysis
    // onto. Just use the result to fill width / height below.

    const measurements = (analysis.data && Array.isArray(analysis.data.measurements))
      ? analysis.data.measurements.filter((m) => Number.isFinite(Number(m && m.value)))
      : [];
    if (!measurements.length) {
      toast("No usable readings on the laser screen — try a closer, glare-free shot.", "err");
      return;
    }

    // Convert each reading to metres so we can compare like-for-like
    // even if the laser is mixing m / cm / mm. The model returns
    // readings in screen order, top to bottom.
    const TO_METRES = { m: 1, cm: 0.01, mm: 0.001 };
    const valued = measurements
      .map((m) => {
        const unit = (m.unit || "").toLowerCase();
        const factor = Object.prototype.hasOwnProperty.call(TO_METRES, unit) ? TO_METRES[unit] : 1;
        return { display: m.display, valueM: Number(m.value) * factor };
      })
      .filter((m) => Number.isFinite(m.valueM));
    if (!valued.length) {
      toast("Could not parse any laser readings as numbers.", "err");
      return;
    }

    // Fallback rule: when the laser screen is showing 3 or more
    // readings, drop the TOP one (it's typically a stale history line
    // or a sum/area/total) and only consider the remaining readings.
    // For two or fewer readings, use them all.
    const candidates = valued.length >= 3 ? valued.slice(1) : valued.slice();

    // Width = longest reading, Height = shortest. Single-reading
    // captures fill Width only and leave Height untouched.
    let smallest = candidates[0];
    let largest = candidates[0];
    for (const v of candidates) {
      if (v.valueM < smallest.valueM) smallest = v;
      if (v.valueM > largest.valueM) largest = v;
    }

    // Make sure the target window still belongs to this room (the user
    // could have removed it while the analysis was in flight).
    const stillThere = (room.windows || []).some((w) => w.id === win.id);
    if (!stillThere) return;

    win.width = largest.display;
    if (largest !== smallest) win.height = smallest.display;
    normalizeOneWindow(win);
    saveProperty();

    // Refresh the visible inputs for this specific window if its row
    // is currently rendered. Other interactions stay live throughout.
    const node = document.querySelector(
      `[data-room-id="${room.id}"] [data-window-id="${win.id}"]`
    );
    if (node) {
      const w = node.querySelector(".room-windows-width");
      const h = node.querySelector(".room-windows-height");
      if (w) w.value = win.width;
      if (h) h.value = win.height;
    }
    toast(
      largest === smallest
        ? `Width set to ${largest.display}.`
        : `Width ${largest.display} · Height ${smallest.display}.`
    );
  }

  // -------------------- Auto-tag (Claude) --------------------
  // After every camera capture or upload we ask Claude to pick the
  // best room-tag for the photo (Heating / Windows / Meters / …) so
  // the assessor doesn't have to drop the dropdown on each thumb. The
  // runs are queued one at a time so a 30-photo upload doesn't slam
  // the API in parallel.
  const autoTagState = {
    queue: [],
    running: false,
  };

  function isAutoTagEnabled() {
    if (!getClaudeApiKey()) return false;
    try {
      const v = localStorage.getItem("retrofit-photos:auto-tag");
      return v === null ? true : v === "1";
    } catch (_) {
      return true;
    }
  }

  function setAutoTagEnabled(on) {
    try {
      localStorage.setItem("retrofit-photos:auto-tag", on ? "1" : "0");
    } catch (_) { /* ignore */ }
  }

  async function runPhotoAutoTag(photo) {
    const result = await runPhotoAnalysis(photo, "auto_tag");
    return result && result.data ? result.data : null;
  }

  function queueAutoTag(photos) {
    if (!isAutoTagEnabled()) return;
    if (!Array.isArray(photos) || !photos.length) return;
    for (const p of photos) {
      if (!p || isLaserCapturePhoto(p)) continue;
      // Don't overwrite a tag the user has already set manually.
      if (p.roomTag) continue;
      autoTagState.queue.push(p.id);
    }
    pumpAutoTagQueue();
  }

  async function pumpAutoTagQueue() {
    if (autoTagState.running) return;
    autoTagState.running = true;
    try {
      while (autoTagState.queue.length) {
        const id = autoTagState.queue.shift();
        const photo = state.photos.get(id);
        if (!photo || photo.roomTag || isLaserCapturePhoto(photo)) continue;
        try {
          const data = await runPhotoAutoTag(photo);
          const tag = data && data.tag;
          if (!tag || !ROOM_TAGS.includes(tag)) continue;
          // The user may have set the tag manually while we were
          // analysing — don't clobber that.
          const fresh = state.photos.get(id);
          if (!fresh || fresh.roomTag) continue;
          fresh.roomTag = tag;
          try {
            await savePhotoNow(fresh);
          } catch (err) {
            console.warn("Failed to persist auto-tag", err);
          }
          // Refresh any visible thumb dropdowns so the new tag shows.
          syncThumbRoomTagDropdowns(id, tag);
          saveProperty();
        } catch (err) {
          // Auto-tagging is best-effort — log and move on so a single
          // failure doesn't stall the queue.
          console.warn("auto-tag failed for", id, err);
        }
      }
    } finally {
      autoTagState.running = false;
    }
  }

  function syncThumbRoomTagDropdowns(photoId, tag) {
    document
      .querySelectorAll(`[data-photo-id="${photoId}"] .thumb-roomtag`)
      .forEach((sel) => {
        sel.value = tag;
      });
  }

  // Generate a short label for a photo via Claude. The owning section
  // name (room / flat group) is passed in as contextual_location so the
  // model can compose labels like "Bedroom 1 — radiator" rather than
  // picking a generic subject out of thin air.
  async function runPhotoLabel(photo, contextualLocation) {
    const apiKey = getClaudeApiKey();
    if (!apiKey) throw new Error("Set a Claude API key in Settings first.");
    const model = getClaudeModel();
    const smaller = await shrinkForAnalysis(photo.dataUrl);
    const { mediaType, base64 } = splitDataUrl(smaller);
    if (!base64) throw new Error("Couldn't read the photo data.");

    const locLine = contextualLocation
      ? `This photo is filed under "${contextualLocation}" in the property survey. ` +
        `Every label MUST start with "${contextualLocation}" exactly. If there's a ` +
        `specific subject (radiator, boiler, electricity meter, window, …) follow ` +
        `with " — " and 1–4 words describing it. If the photo is just a wide view ` +
        `of the location, the label can be the location name on its own.`
      : "";

    const systemPrompt =
      "You are a Domestic Energy Assessor's assistant writing concise photo labels for a UK retrofit survey. " +
      "Given a photo, produce a short label that ALWAYS starts with the location it's filed under. " +
      "If the photo shows a specific subject, follow the location with ' — ' (em dash) and 1–4 words " +
      "describing the subject. If it's just a wide / general view, the label can be the location name only. " +
      "Examples of good labels:\n" +
      "- Living Room\n" +
      "- Bedroom 1\n" +
      "- Bedroom 1 — radiator\n" +
      "- Kitchen — boiler\n" +
      "- Meter cupboard — electricity meter\n" +
      "- External Elevations — front from street\n" +
      "- Loft — insulation\n" +
      "Use Title Case for the location, lowercase for the rest except proper nouns and model numbers. " +
      "Do not include camera metadata, dates, or the word 'photo'. " +
      "Respond with ONLY the label text via the JSON schema — no quotes, no preamble.";

    const userPrompt = locLine
      ? `${locLine} Write a short label. Return JSON with a single "label" field.`
      : 'Write a short label for this photo. Return JSON with a single "label" field.';

    const body = {
      model,
      max_tokens: 128,
      system: [
        {
          type: "text",
          text: systemPrompt,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: base64 },
            },
            { type: "text", text: userPrompt },
          ],
        },
      ],
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: { label: { type: "string" } },
            required: ["label"],
            additionalProperties: false,
          },
        },
      },
    };

    let response;
    try {
      response = await fetch(CLAUDE_API_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify(body),
      });
    } catch (_) {
      throw new Error("Network error — check your connection.");
    }
    if (!response.ok) {
      let message = `Claude API error (${response.status})`;
      try {
        const err = await response.json();
        if (err && err.error && err.error.message) message = err.error.message;
      } catch (_) {
        /* keep generic */
      }
      if (response.status === 401) message = "Invalid API key.";
      throw new Error(message);
    }
    const result = await response.json();
    const textBlock = (result.content || []).find((b) => b.type === "text");
    if (!textBlock) throw new Error("Empty response from Claude.");
    let data;
    try {
      data = JSON.parse(textBlock.text);
    } catch (_) {
      throw new Error("Claude returned a non-JSON response.");
    }
    let label = (data.label || "").toString().trim();
    // Strip surrounding quotes / fullstops Claude sometimes adds.
    label = label.replace(/^["'“”‘’]+|["'“”‘’.]+$/g, "").trim();
    if (contextualLocation && label) {
      const loc = contextualLocation.trim();
      const lower = label.toLowerCase();
      const locLower = loc.toLowerCase();
      // Already starts with the location? Leave alone (allow either
      // exact match, or `Loc — extra`, or `Loc - extra` with hyphen).
      const startsWithLoc =
        lower === locLower ||
        lower.startsWith(`${locLower} — `) ||
        lower.startsWith(`${locLower} - `);
      if (!startsWithLoc) {
        // Drop any leading location-like prefix the model invented so
        // we don't end up with "Living Room — Kitchen — radiator".
        const cleaned = label.replace(/^[^—-]+[—-]\s*/, "").trim();
        label = cleaned ? `${loc} — ${cleaned}` : loc;
      }
    }
    return label;
  }

  // Shared state + UI for bulk AI passes (label / tag). Each pass
  // shows the same floating banner with a Cancel button so the user
  // can stop a long run without having to hammer the back button.
  const bulkLabelState = { running: false, cancelRequested: false };

  function showBulkLabelBanner(text) {
    if (!els.bulkLabelBanner) return;
    if (els.bulkLabelText) els.bulkLabelText.textContent = text;
    els.bulkLabelBanner.hidden = false;
  }
  function updateBulkLabelBanner(text) {
    if (els.bulkLabelText) els.bulkLabelText.textContent = text;
  }
  function hideBulkLabelBanner() {
    if (!els.bulkLabelBanner) return;
    els.bulkLabelBanner.hidden = true;
  }

  // Walk every photo in the current property and optionally re-label it
  // via Claude. scope:"unlabelled" skips photos that already have a
  // user-provided label. scope:"default-or-empty" also targets photos
  // whose label is the auto-generated default ("Bedroom 1 — 3" etc.)
  // since those carry no real information. scope:"all" overwrites
  // every label. All three save per-photo and re-render at the end.
  async function runBulkLabel(opts) {
    if (!getClaudeApiKey()) {
      toast("Set a Claude API key in Settings first.", "err");
      return { processed: 0, failed: 0 };
    }
    return withPhotoDataUrls(() => runBulkLabelImpl(opts));
  }

  async function runBulkLabelImpl(opts) {
    const validScopes = new Set(["unlabelled", "default-or-empty", "all"]);
    const scope = opts && validScopes.has(opts.scope) ? opts.scope : "default-or-empty";
    const hasLabel = (p) => !!(p && p.label && p.label.trim());
    const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // The default label format used by commitBufferedPhotos /
    // addUploadedPhotos is `${group.name} — ${index}` where
    // group.name is room.name for rooms and the flat group's name
    // for flat groups.
    const isDefaultLabel = (p, baseName) => {
      if (!hasLabel(p) || !baseName) return false;
      return new RegExp(`^${escapeRe(baseName)} — \\d+$`).test(p.label.trim());
    };
    const skip = (photo, baseName) => {
      if (scope === "all") return false;
      if (scope === "unlabelled") return hasLabel(photo);
      // "default-or-empty": skip only when the label is real (i.e.
      // not blank and not the auto-generated default pattern).
      return hasLabel(photo) && !isDefaultLabel(photo, baseName);
    };
    const targets = [];
    for (const g of state.property.groups || []) {
      for (const pid of g.photoIds || []) {
        const photo = state.photos.get(pid);
        if (!photo) continue;
        if (skip(photo, g.name)) continue;
        targets.push({ photo, sourceName: g.name });
      }
    }
    for (const room of state.property.rooms || []) {
      for (const pid of room.photoIds || []) {
        const photo = state.photos.get(pid);
        if (!photo) continue;
        if (skip(photo, room.name)) continue;
        // Just the room name, not habitability — labels read better as
        // "Bedroom 1 — radiator" than "Bedroom 1 (Habitable) — radiator".
        targets.push({ photo, sourceName: room.name });
      }
    }
    if (!targets.length) {
      toast("No photos to label.");
      return { processed: 0, failed: 0 };
    }
    bulkLabelState.cancelRequested = false;
    bulkLabelState.running = true;
    showBulkLabelBanner(`Labelling 0/${targets.length}…`);
    let processed = 0;
    let failed = 0;
    let cancelled = false;
    for (const { photo, sourceName } of targets) {
      if (bulkLabelState.cancelRequested) { cancelled = true; break; }
      processed += 1;
      updateBulkLabelBanner(`Labelling ${processed}/${targets.length}…`);
      try {
        const label = await runPhotoLabel(photo, sourceName);
        if (label) {
          photo.label = label;
          try {
            await savePhotoNow(photo);
          } catch (err) {
            console.warn("Failed to persist labelled photo", err);
          }
        }
      } catch (err) {
        failed += 1;
        console.warn("Label failed for photo", photo.id, err);
      }
      // Small breather so the banner updates, and so we don't hammer
      // the API at full speed on large properties.
      await new Promise((r) => setTimeout(r, 30));
    }
    bulkLabelState.running = false;
    bulkLabelState.cancelRequested = false;
    hideBulkLabelBanner();
    renderGroups();
    if (cancelled) {
      toast(`Cancelled. Labelled ${processed - failed}/${targets.length} so far.`);
    } else {
      toast(
        failed
          ? `Labelled ${processed - failed}/${targets.length} (${failed} failed).`
          : `Labelled ${processed}/${targets.length}.`,
        failed ? "err" : undefined
      );
    }
    return { processed, failed };
  }

  // Walk every photo in the current property and tag it via Claude
  // (Heating / Meters / Windows / …). Mirrors runBulkLabel: same
  // banner + cancel UX, but uses the auto_tag preset and writes to
  // photo.roomTag instead of photo.label.
  async function runBulkTag(opts) {
    if (!getClaudeApiKey()) {
      toast("Set a Claude API key in Settings first.", "err");
      return { processed: 0, tagged: 0, failed: 0 };
    }
    return withPhotoDataUrls(() => runBulkTagImpl(opts));
  }

  async function runBulkTagImpl(opts) {
    const scope = opts && opts.scope === "all" ? "all" : "untagged";
    const targets = [];
    for (const g of state.property.groups || []) {
      for (const pid of g.photoIds || []) {
        const photo = state.photos.get(pid);
        if (!photo || isLaserCapturePhoto(photo)) continue;
        if (scope === "untagged" && photo.roomTag) continue;
        targets.push(photo);
      }
    }
    for (const room of state.property.rooms || []) {
      for (const pid of room.photoIds || []) {
        const photo = state.photos.get(pid);
        if (!photo || isLaserCapturePhoto(photo)) continue;
        if (scope === "untagged" && photo.roomTag) continue;
        targets.push(photo);
      }
    }
    if (!targets.length) {
      toast(scope === "all" ? "No photos to tag." : "Every photo already has a tag.");
      return { processed: 0, tagged: 0, failed: 0 };
    }
    bulkLabelState.cancelRequested = false;
    bulkLabelState.running = true;
    showBulkLabelBanner(`Tagging 0/${targets.length}…`);
    let processed = 0;
    let tagged = 0;
    let failed = 0;
    let cancelled = false;
    let firstErr = null;
    for (const photo of targets) {
      if (bulkLabelState.cancelRequested) { cancelled = true; break; }
      processed += 1;
      updateBulkLabelBanner(`Tagging ${processed}/${targets.length}…`);
      try {
        const data = await runPhotoAutoTag(photo);
        const tag = data && data.tag;
        if (tag && ROOM_TAGS.includes(tag)) {
          // Don't clobber a tag the user has just set manually.
          const fresh = state.photos.get(photo.id);
          if (fresh && (scope === "all" || !fresh.roomTag)) {
            fresh.roomTag = tag;
            tagged += 1;
            try { await savePhotoNow(fresh); }
            catch (err) { console.warn("Failed to persist auto-tag", err); }
            syncThumbRoomTagDropdowns(photo.id, tag);
          }
        }
      } catch (err) {
        failed += 1;
        if (!firstErr) firstErr = err;
        console.warn("Auto-tag failed for photo", photo.id, err);
      }
      await new Promise((r) => setTimeout(r, 30));
    }
    bulkLabelState.running = false;
    bulkLabelState.cancelRequested = false;
    hideBulkLabelBanner();
    saveProperty();
    renderGroups();
    if (cancelled) {
      toast(`Cancelled. Tagged ${tagged}/${targets.length} so far.`);
    } else if (failed === targets.length && firstErr) {
      // Every photo failed — surface the actual error so we don't
      // hide a misconfigured API key / schema rejection / etc.
      toast(firstErr.message || "Auto-tag failed.", "err");
    } else {
      toast(
        failed
          ? `Tagged ${tagged}/${targets.length} (${failed} failed).`
          : `Tagged ${tagged}/${targets.length}.`,
        failed ? "err" : undefined
      );
    }
    return { processed, tagged, failed };
  }

  // Build a compact one-line summary of an AI analysis for the PDF caption.
  function pdfSummariseAnalysis(a) {
    const d = (a && a.data) || {};
    const bits = [];
    if (d.make || d.model) {
      bits.push([d.make, d.model].filter(Boolean).join(" "));
    }
    if (a.preset === "boiler") {
      if (d.type) bits.push(d.type);
      if (d.fuel) bits.push(d.fuel);
      if (d.installed_year) bits.push(`installed ${d.installed_year}`);
      if (d.output_kw) bits.push(`${d.output_kw} kW`);
      if (d.efficiency_rating) bits.push(d.efficiency_rating);
    } else {
      if (typeof d.is_smart_meter === "boolean") {
        bits.push(d.is_smart_meter ? "smart" : "not smart");
      }
      if (d.smets_generation) bits.push(d.smets_generation);
      if (d.is_export_capable === true) bits.push("export-capable");
      if (d.is_export_capable === false) bits.push("not export-capable");
      if (d.current_reading) bits.push(`reading ${d.current_reading}`);
      if (d.serial) bits.push(`s/n ${d.serial}`);
    }
    return bits.length ? bits.join(", ") : "no identifying details";
  }

  // -------------------- PDF export with linked contents --------------------
  function reportBaseName() {
    const meta = state.property.meta;
    const parts = [
      "photo-evidence",
      slugify(state.property.name || "property"),
      meta.ref ? slugify(meta.ref) : null,
      meta.date || todayISO(),
    ].filter(Boolean);
    return parts.join("_");
  }

  // -------------------- Window schedule (shared by PDF + ZIP) --------------------
  const WINDOW_SCHEDULE_COLUMNS = [
    { key: "no", label: "No." },
    { key: "room", label: "Room" },
    { key: "windowLabel", label: "Window" },
    { key: "roof", label: "Roof" },
    { key: "type", label: "Type" },
    { key: "age", label: "Age" },
    { key: "orientation", label: "Orientation" },
    { key: "frame", label: "Frame" },
    { key: "gap", label: "Gap" },
    { key: "width", label: "Width" },
    { key: "height", label: "Height" },
  ];

  function buildWindowScheduleRows() {
    const rooms = (state.property && state.property.rooms) || [];
    const rows = [];
    let runningNo = 0;
    for (const room of rooms) {
      const wins = Array.isArray(room.windows) ? room.windows : [];
      if (!wins.length) {
        // Surface rooms with no recorded windows so the schedule still
        // shows them. Empty cells render as "—". The running counter
        // doesn't advance here — placeholder rows aren't real windows.
        rows.push({
          no: "",
          room: room.name || room.roomType || "Room",
          habitability: room.habitability || "",
          windowLabel: "—",
          roof: "",
          type: "", age: "", orientation: "",
          frame: "", gap: "", width: "", height: "",
        });
        continue;
      }
      wins.forEach((w, idx) => {
        runningNo += 1;
        rows.push({
          no: String(runningNo),
          room: room.name || room.roomType || "Room",
          habitability: room.habitability || "",
          // Always number windows by their position in the array, which
          // is also their addition order. Single-window rooms still
          // read "Window 1" so the column has consistent values.
          windowLabel: `Window ${idx + 1}`,
          roof: w.roofWindow === true ? "Yes" : "",
          type: w.type || "",
          age: w.age || "",
          orientation: w.orientation || "",
          frame: w.frame || "",
          gap: w.gap || "",
          width: w.width || "",
          height: w.height || "",
        });
      });
    }
    return rows;
  }

  function buildWindowMeasurementsHtml() {
    const meta = (state.property && state.property.meta) || {};
    const title = state.property && state.property.name
      ? `${state.property.name} — Window measurements`
      : "Window measurements";
    const rows = buildWindowScheduleRows();
    const cells = (row) =>
      WINDOW_SCHEDULE_COLUMNS.map(
        (c) => `<td>${escapeHtml(row[c.key] || "")}</td>`
      ).join("");
    const headers = WINDOW_SCHEDULE_COLUMNS.map(
      (c) => `<th scope="col">${escapeHtml(c.label)}</th>`
    ).join("");
    const tbody = rows.length
      ? rows.map((r) => `<tr>${cells(r)}</tr>`).join("")
      : `<tr><td colspan="${WINDOW_SCHEDULE_COLUMNS.length}" class="empty">No rooms recorded.</td></tr>`;
    return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
*{box-sizing:border-box}
body{margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;font-size:14px;line-height:1.5;color:#0f172a;background:#f7f8fa}
.wrap{max-width:1100px;margin:0 auto}
header{margin:0 0 18px}
h1{margin:0 0 4px;font-size:1.4rem;color:#0f172a}
.meta{margin:0;color:#64748b;font-size:0.88rem}
.meta strong{color:#0f172a;font-weight:600}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden}
th,td{padding:9px 12px;text-align:left;font-size:0.9rem;vertical-align:top;border-bottom:1px solid #e2e8f0}
th{background:#1e293b;color:#fff;font-weight:600;font-size:0.78rem;letter-spacing:0.3px;text-transform:uppercase;border-bottom:1px solid #1e293b}
tbody tr:nth-child(even){background:#f8fafc}
tbody tr:last-child td{border-bottom:none}
td:empty::before,td.empty{color:#94a3b8;content:"—"}
.empty{text-align:center;padding:24px;color:#94a3b8}
@media print{body{background:#fff}.wrap{max-width:none}}
</style>
</head>
<body><div class="wrap">
<header>
  <h1>${escapeHtml(title)}</h1>
  <p class="meta">
    <strong>Address:</strong> ${escapeHtml(meta.address || "—")} ·
    <strong>Assessor:</strong> ${escapeHtml(meta.assessor || "—")} ·
    <strong>Job ref:</strong> ${escapeHtml(meta.ref || "—")} ·
    <strong>Date:</strong> ${escapeHtml(meta.date || "—")}
  </p>
</header>
<table>
  <thead><tr>${headers}</tr></thead>
  <tbody>${tbody}</tbody>
</table>
</div></body></html>`;
  }

  async function buildPdf(options = {}) {
    const photoPaths = options.photoPaths instanceof Map ? options.photoPaths : null;
    const layout = options.layout === "tag" ? "tag" : "group";
    const includeAnalysis = options.includeAnalysis !== false;
    if (!window.jspdf || !window.jspdf.jsPDF) {
      throw new Error("PDF library failed to load.");
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "pt", format: "a4", compress: true });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 40;
    const meta = state.property.meta;

    // For the PDF we treat layout == "group" (the default) as one section per
    // real group plus one per non-empty room, and layout == "tag" as one
    // virtual section per building tag that actually has photos. Room
    // photos are tagged via photo.roomTag (Room Photos / Undercuts / ...)
    // rather than living in separate sub-groups.
    let groupsWithPhotos;
    if (layout === "tag") {
      // Bucket photos by their photo-tag (Room, Undercuts, Windows,
      // Lighting, Heating, Ventilation, Renewables, Meters, Other) —
      // matches the app's By Tag view. Untagged photos collect into a
      // trailing "Untagged" section so the report still covers
      // everything in the property.
      const buckets = new Map();
      const UNTAGGED_KEY = "__untagged__";
      const pushEntry = (photo, source) => {
        if (!photo || isLaserCapturePhoto(photo)) return;
        const key = ROOM_TAGS.includes(photo.roomTag) ? photo.roomTag : UNTAGGED_KEY;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push({ photo, source });
      };
      for (const g of state.property.groups) {
        for (const pid of g.photoIds) pushEntry(state.photos.get(pid), g);
      }
      for (const room of state.property.rooms || []) {
        for (const pid of room.photoIds || []) {
          pushEntry(state.photos.get(pid), { id: room.id, name: room.name });
        }
      }
      groupsWithPhotos = [];
      // Tagged sections in canonical ROOM_TAGS order, then Untagged at
      // the end if it has anything.
      for (const tag of ROOM_TAGS) {
        const entries = buckets.get(tag);
        if (!entries || !entries.length) continue;
        groupsWithPhotos.push({
          id: tagGroupId(tag),
          name: tag,
          photoIds: entries.map((e) => e.photo.id),
          virtual: true,
          entries,
        });
      }
      const untagged = buckets.get(UNTAGGED_KEY);
      if (untagged && untagged.length) {
        groupsWithPhotos.push({
          id: tagGroupId("Untagged"),
          name: "Untagged",
          photoIds: untagged.map((e) => e.photo.id),
          virtual: true,
          entries: untagged,
        });
      }
    } else {
      const visibleIds = (ids) =>
        (ids || []).filter((pid) => {
          const p = state.photos.get(pid);
          return p && !isLaserCapturePhoto(p);
        });
      groupsWithPhotos = state.property.groups
        .map((g) => ({ ...g, photoIds: visibleIds(g.photoIds) }))
        .filter((g) => g.photoIds.length > 0);
      for (const room of state.property.rooms || []) {
        const ids = visibleIds(room.photoIds);
        if (!ids.length) continue;
        groupsWithPhotos.push({
          id: `room-${room.id}`,
          name: `${room.name} (${room.habitability})`,
          photoIds: ids,
          room,
        });
      }
    }

    // Cover page (page 1)
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.text("Photo Evidence Report", margin, margin + 10);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    let y = margin + 44;
    const lines = [
      ["Property", state.property.name || "—"],
      ["Assessor", meta.assessor || "—"],
      ["Address", meta.address || "—"],
      ["Job ref", meta.ref || "—"],
      ["Date", meta.date || "—"],
      ["Generated", new Date().toLocaleString()],
    ];
    for (const [k, v] of lines) {
      doc.setFont("helvetica", "bold");
      doc.text(`${k}:`, margin, y);
      doc.setFont("helvetica", "normal");
      doc.text(String(v), margin + 80, y);
      y += 18;
    }

    // Reserve contents page (page 2) — heading only; we'll fill the list at the end.
    doc.addPage();
    const contentsPageNumber = doc.internal.getNumberOfPages();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("Contents", margin, margin + 6);
    doc.setDrawColor(18, 18, 18);
    doc.setLineWidth(1.2);
    doc.line(margin, margin + 12, pageW - margin, margin + 12);
    doc.setLineWidth(0.2);

    // Bookmarks / outline (always clickable in a viewer's sidebar, even when
    // inline annotation links are not honoured).
    const addOutline = (label, pageNumber) => {
      try {
        if (doc.outline && typeof doc.outline.add === "function") {
          doc.outline.add(null, label, { pageNumber });
        }
      } catch (_) {
        /* outline plugin unavailable */
      }
    };
    addOutline("Cover", 1);
    addOutline("Contents", contentsPageNumber);

    const groupStartPages = new Map();

    for (const g of groupsWithPhotos) {
      doc.addPage();
      const startPage = doc.internal.getNumberOfPages();
      groupStartPages.set(g.id, startPage);
      const displayName = g.name;
      addOutline(displayName, startPage);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.text(displayName, margin, margin + 6);
      doc.setDrawColor(18, 18, 18);
      doc.setLineWidth(1.2);
      doc.line(margin, margin + 12, pageW - margin, margin + 12);
      doc.setLineWidth(0.2);

      // In tag layout, iterate the prebuilt entries (so we can see the source
      // group) instead of plain photoIds. Sort the tag entries so photos from
      // the same source group land together — the render loop emits a
      // sub-heading when the source group changes.
      let iterator;
      if (g.virtual) {
        const byGroup = new Map();
        const order = [];
        for (const e of g.entries) {
          if (!byGroup.has(e.source.id)) {
            byGroup.set(e.source.id, []);
            order.push(e.source.id);
          }
          byGroup.get(e.source.id).push(e);
        }
        iterator = [];
        for (const sid of order) {
          for (const e of byGroup.get(sid)) {
            iterator.push({ photo: e.photo, source: e.source });
          }
        }
      } else {
        iterator = g.photoIds.map((pid) => ({
          photo: state.photos.get(pid),
          source: g,
        }));
      }

      let cursorY = margin + 32;
      let index = 0;
      let lastSourceGroupId = null;
      let groupIndex = 0;
      for (const entry of iterator) {
        const photo = entry.photo;
        const sourceGroup = entry.source;
        if (!photo) continue;

        // In tag layout, print a group sub-heading before the first photo
        // of each source group cluster so the reader still sees "Walls",
        // "Loft", etc. as a heading above the grid.
        if (layout === "tag" && sourceGroup.id !== lastSourceGroupId) {
          // Space budget: if the heading plus a reasonable photo won't
          // fit on this page, break first.
          if (cursorY + 200 > pageH - margin) {
            doc.addPage();
            doc.setFont("helvetica", "bold");
            doc.setFontSize(12);
            doc.text(`${displayName} (cont.)`, margin, margin - 8);
            cursorY = margin;
          }
          cursorY += groupIndex === 0 ? 0 : 8;
          doc.setFont("helvetica", "bold");
          doc.setFontSize(12);
          doc.setTextColor(18, 18, 18);
          doc.text(sourceGroup.name, margin, cursorY);
          doc.setDrawColor(190);
          doc.setLineWidth(0.4);
          doc.line(margin, cursorY + 3, pageW - margin, cursorY + 3);
          doc.setLineWidth(0.2);
          doc.setTextColor(0);
          cursorY += 14;
          lastSourceGroupId = sourceGroup.id;
          groupIndex += 1;
          index = 0; // restart photo numbering within each group cluster
        }

        index += 1;
        const isUpload = photo.source === "upload";
        const building = BUILDING_TAGS.includes(photo.building) ? photo.building : DEFAULT_BUILDING;
        // In group layout, prefix non-Main tags. In tag layout the sub-heading
        // above already states the source group, so we omit the group prefix.
        const prefix =
          layout === "tag"
            ? ""
            : building !== DEFAULT_BUILDING
              ? `[${building}] `
              : "";
        const defectTag = photo.defect ? "[DEFECT] " : "";
        const roomTagTxt = photo.roomTag ? `[${photo.roomTag}] ` : "";
        const labelText = `${index}. ${prefix}${defectTag}${roomTagTxt}${photo.label || sourceGroup.name}`;
        // Captions: single line for camera captures, a 3-line stack for
        // uploaded photos so Captured / Location / Uploaded each get their own line.
        const capH = isUpload ? 58 : 16;
        const maxImgW = pageW - margin * 2;
        const maxImgH = pageH - cursorY - margin - capH - 10;

        const ratio = photo.width / photo.height;
        let drawW = maxImgW;
        let drawH = drawW / ratio;
        if (drawH > maxImgH) {
          drawH = maxImgH;
          drawW = drawH * ratio;
        }

        if (drawH < 120) {
          doc.addPage();
          doc.setFont("helvetica", "bold");
          doc.setFontSize(12);
          doc.text(`${displayName} (cont.)`, margin, margin - 8);
          cursorY = margin;
          drawW = maxImgW;
          drawH = drawW / ratio;
          const avail = pageH - cursorY - margin - capH - 10;
          if (drawH > avail) {
            drawH = avail;
            drawW = drawH * ratio;
          }
        }

        const x = margin + (maxImgW - drawW) / 2;
        try {
          // Re-encode to a smaller / lower-quality JPEG just for PDF
          // embedding so the report stays compact, while the stored image
          // we use for ZIP / share exports keeps full fidelity.
          const pdfDataUrl = await reencodeForPdf(photo.dataUrl);
          doc.addImage(pdfDataUrl, "JPEG", x, cursorY, drawW, drawH, undefined, "FAST");
          // When built as part of a ZIP export, link the embedded image to
          // the corresponding full-resolution JPEG sitting alongside the PDF
          // in the archive. Tapping the photo in a PDF viewer opens the file
          // directly. Ignored silently by viewers that don't support it.
          if (photoPaths && photoPaths.has(photo.id)) {
            doc.link(x, cursorY, drawW, drawH, { url: photoPaths.get(photo.id) });
          }
        } catch (err) {
          console.error("addImage failed", err);
          continue;
        }

        doc.setFont("helvetica", photo.defect ? "bold" : "normal");
        doc.setFontSize(10);
        if (photo.defect) doc.setTextColor(178, 45, 45);
        else doc.setTextColor(40);
        doc.text(labelText, margin, cursorY + drawH + 14);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(40);

        if (isUpload) {
          doc.setFontSize(9);
          doc.setTextColor(110);
          const fmt = (iso) => (iso ? new Date(iso).toLocaleString() : "not in photo metadata");
          const uploadLines = [
            `Date taken: ${fmt(photo.takenAt)}`,
            `Location taken: ${photo.gps ? formatGps(photo.gps) : "not in photo metadata"}`,
            `Uploaded: ${fmt(photo.uploadedAt)}`,
          ];
          let infoY = cursorY + drawH + 28;
          for (const line of uploadLines) {
            doc.text(line, margin, infoY);
            infoY += 12;
          }
          doc.setFontSize(10);
        } else {
          const stampLine = [];
          if (photo.takenAt) stampLine.push(new Date(photo.takenAt).toLocaleString());
          if (photo.gps) stampLine.push(formatGps(photo.gps));
          if (stampLine.length) {
            doc.setTextColor(110);
            doc.text(stampLine.join("   ·   "), pageW - margin, cursorY + drawH + 14, { align: "right" });
          }
        }
        doc.setTextColor(0);

        // One short line per AI analysis, just below the caption block.
        // Non-invasive: if the photo has no analyses the cursor advance is
        // unchanged, so pagination math is only affected on analysed photos.
        let extraCap = 0;
        if (includeAnalysis && Array.isArray(photo.analyses) && photo.analyses.length) {
          const analysesBaseY = cursorY + drawH + capH + 2;
          let lineY = analysesBaseY;
          doc.setFontSize(9);
          for (const a of photo.analyses) {
            const preset = getAnalysisPreset(a.preset);
            const header = `AI analysis — ${preset ? preset.label : a.preset}`;
            const summary = pdfSummariseAnalysis(a);
            const conf = a.data && a.data.confidence ? ` (${a.data.confidence})` : "";
            const firstLine = `${header}${conf}: ${summary}`;
            const wrapped = doc.splitTextToSize(firstLine, pageW - margin * 2);
            doc.setTextColor(120, 82, 9); // amber-700-ish
            for (const ln of wrapped) {
              doc.text(ln, margin, lineY);
              lineY += 11;
            }
            if (a.data && a.data.notes) {
              doc.setTextColor(110);
              const noteWrap = doc.splitTextToSize(`Notes: ${a.data.notes}`, pageW - margin * 2);
              for (const ln of noteWrap) {
                doc.text(ln, margin, lineY);
                lineY += 11;
              }
            }
            // Manual URL — emit as a clickable annotation so tapping the
            // line in a PDF viewer opens the manufacturer page.
            if (a.data && typeof a.data.manual_url === "string" && /^https?:\/\//i.test(a.data.manual_url)) {
              const url = a.data.manual_url;
              const manualLine = `Manual: ${url}`;
              const wrapManual = doc.splitTextToSize(manualLine, pageW - margin * 2);
              doc.setTextColor(180, 83, 9); // amber-700, link-like
              for (const ln of wrapManual) {
                doc.text(ln, margin, lineY);
                // Make the whole rendered line a clickable external link.
                const w = doc.getTextWidth(ln);
                doc.link(margin, lineY - 9, Math.min(w, pageW - margin * 2), 12, { url });
                lineY += 11;
              }
            }
          }
          doc.setFontSize(10);
          doc.setTextColor(40);
          extraCap = lineY - analysesBaseY + 4;
        }

        cursorY += drawH + capH + 18 + extraCap;

        const isLast = entry === iterator[iterator.length - 1];
        if (!isLast && cursorY + 180 > pageH - margin) {
          doc.addPage();
          doc.setFont("helvetica", "bold");
          doc.setFontSize(12);
          doc.text(`${displayName} (cont.)`, margin, margin - 8);
          cursorY = margin;
        }
      }
    }

    // -------- Window schedule (after the photo sections) --------
    const scheduleRows = buildWindowScheduleRows();
    let scheduleStartPage = null;
    if (scheduleRows.length) {
      doc.addPage();
      scheduleStartPage = doc.internal.getNumberOfPages();
      addOutline("Window schedule", scheduleStartPage);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.setTextColor(0);
      doc.text("Window schedule", margin, margin + 6);
      doc.setDrawColor(18, 18, 18);
      doc.setLineWidth(1.2);
      doc.line(margin, margin + 12, pageW - margin, margin + 12);
      doc.setLineWidth(0.2);

      // Layout: 8 columns, 1st column (Room) gets the most space.
      const cols = WINDOW_SCHEDULE_COLUMNS;
      const tableLeft = margin;
      const tableRight = pageW - margin;
      const tableW = tableRight - tableLeft;
      // Weights for: No. | Room | Window | Roof | Type | Age |
      //              Orientation | Frame | Gap | Width | Height.
      const colWeights = [0.6, 2.2, 1.1, 0.7, 1.1, 1.3, 1.6, 1.2, 1.2, 1.4, 1.4];
      const totalWeight = colWeights.reduce((a, b) => a + b, 0);
      const colWidths = colWeights.map((w) => (w / totalWeight) * tableW);
      const colX = [tableLeft];
      for (let i = 0; i < colWidths.length - 1; i++) colX.push(colX[i] + colWidths[i]);

      const cellPadX = 4;
      const cellPadY = 4;
      const headerH = 22;
      const minRowH = 20;

      let yCursor = margin + 32;

      const drawHeader = () => {
        doc.setFillColor(241, 245, 249); // slate-100
        doc.rect(tableLeft, yCursor, tableW, headerH, "F");
        doc.setDrawColor(220);
        doc.line(tableLeft, yCursor + headerH, tableRight, yCursor + headerH);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.setTextColor(15, 23, 42);
        cols.forEach((c, i) => {
          doc.text(c.label, colX[i] + cellPadX, yCursor + headerH - cellPadY - 2);
        });
        doc.setFont("helvetica", "normal");
        doc.setTextColor(0);
        yCursor += headerH;
      };

      drawHeader();

      const rowFontSize = 9.5;
      doc.setFontSize(rowFontSize);

      const rowHeightFor = (row) => {
        let maxLines = 1;
        cols.forEach((c, i) => {
          const txt = String(row[c.key] || "—");
          const innerW = colWidths[i] - cellPadX * 2;
          const wrapped = doc.splitTextToSize(txt, innerW);
          if (wrapped.length > maxLines) maxLines = wrapped.length;
        });
        return Math.max(minRowH, cellPadY * 2 + maxLines * 12);
      };

      scheduleRows.forEach((row, idx) => {
        const rowH = rowHeightFor(row);
        if (yCursor + rowH > pageH - margin - 28) {
          doc.addPage();
          // Footer is added later for every page in a single sweep.
          doc.setFont("helvetica", "bold");
          doc.setFontSize(16);
          doc.text("Window schedule (cont.)", margin, margin + 6);
          doc.setDrawColor(18, 18, 18);
          doc.setLineWidth(1.2);
          doc.line(margin, margin + 12, pageW - margin, margin + 12);
          doc.setLineWidth(0.2);
          yCursor = margin + 32;
          drawHeader();
          doc.setFontSize(rowFontSize);
        }
        // Zebra striping for legibility.
        if (idx % 2 === 1) {
          doc.setFillColor(248, 250, 252); // slate-50
          doc.rect(tableLeft, yCursor, tableW, rowH, "F");
        }
        cols.forEach((c, i) => {
          const txt = String(row[c.key] || "—");
          const innerW = colWidths[i] - cellPadX * 2;
          const wrapped = doc.splitTextToSize(txt, innerW);
          let ty = yCursor + cellPadY + 10;
          for (const line of wrapped) {
            doc.text(line, colX[i] + cellPadX, ty);
            ty += 12;
          }
        });
        // Row separator.
        doc.setDrawColor(229, 231, 235);
        doc.line(tableLeft, yCursor + rowH, tableRight, yCursor + rowH);
        yCursor += rowH;
      });

      // Outer table border.
      doc.setDrawColor(203, 213, 225);
      doc.setLineWidth(0.4);
      doc.rect(tableLeft, margin + 32, tableW, yCursor - (margin + 32));
      doc.setLineWidth(0.2);
      doc.setTextColor(0);
      doc.setDrawColor(0);
    }

    // Fill in the contents page (clickable links)
    doc.setPage(contentsPageNumber);
    let cy = margin + 36;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(12);
    const colRight = pageW - margin;
    // Dark amber link colour (amber-700) to match the app's black + orange theme.
    const LINK_R = 180;
    const LINK_G = 83;
    const LINK_B = 9;

    if (!groupsWithPhotos.length) {
      doc.setTextColor(120);
      doc.text("No photos in this report.", margin, cy);
      doc.setTextColor(0);
    }

    doc.setTextColor(120);
    doc.setFontSize(9);
    doc.text(
      "Tap a section title to jump to that page. Bookmarks are also available in your PDF viewer's sidebar.",
      margin,
      cy
    );
    doc.setFontSize(12);
    doc.setTextColor(0);
    cy += 18;

    let total = 0;
    const ROW_HEIGHT = 26;
    for (const g of groupsWithPhotos) {
      const target = groupStartPages.get(g.id);
      const title = g.name;
      const countText = `${g.photoIds.length} photo${g.photoIds.length === 1 ? "" : "s"}`;
      const pageText = `p. ${target}`;
      total += g.photoIds.length;

      const rowLeft = margin;
      const titleW = doc.getTextWidth(title);
      const pageW_text = doc.getTextWidth(pageText);
      const countW = doc.getTextWidth(countText);

      // Title in blue, underlined
      doc.setTextColor(LINK_R, LINK_G, LINK_B);
      doc.text(title, rowLeft, cy);
      doc.setDrawColor(LINK_R, LINK_G, LINK_B);
      doc.setLineWidth(0.6);
      doc.line(rowLeft, cy + 2, rowLeft + titleW, cy + 2);

      // Right-aligned page number in blue, underlined
      const pageX = colRight - pageW_text;
      doc.text(pageText, pageX, cy);
      doc.line(pageX, cy + 2, colRight, cy + 2);

      // Count, muted grey, sits left of the page number
      doc.setTextColor(110);
      const countRightX = pageX - 10;
      doc.text(countText, countRightX, cy, { align: "right" });

      // Dotted leader between title and count
      const dotsStartX = rowLeft + titleW + 8;
      const dotsEndX = countRightX - countW - 8;
      if (dotsEndX > dotsStartX) {
        doc.setTextColor(170);
        doc.setFontSize(10);
        const dotStr = " .".repeat(Math.max(1, Math.floor((dotsEndX - dotsStartX) / 3)));
        doc.text(dotStr, dotsStartX, cy);
        doc.setFontSize(12);
      }

      // ONE generous clickable rectangle covering the whole row.
      doc.link(rowLeft - 4, cy - 14, colRight - rowLeft + 8, ROW_HEIGHT, {
        pageNumber: target,
      });

      doc.setLineWidth(0.2);
      doc.setTextColor(0);
      doc.setDrawColor(0);
      cy += ROW_HEIGHT;
      if (cy > pageH - margin - 40) break;
    }

    // Append the Window schedule as a final contents row if it was emitted.
    if (scheduleStartPage) {
      const rowLeft = margin;
      const title = "Window schedule";
      const countText = `${scheduleRows.length} row${scheduleRows.length === 1 ? "" : "s"}`;
      const pageText = `p. ${scheduleStartPage}`;
      const titleW = doc.getTextWidth(title);
      const pageW_text = doc.getTextWidth(pageText);
      const countW = doc.getTextWidth(countText);
      doc.setTextColor(LINK_R, LINK_G, LINK_B);
      doc.text(title, rowLeft, cy);
      doc.setDrawColor(LINK_R, LINK_G, LINK_B);
      doc.setLineWidth(0.6);
      doc.line(rowLeft, cy + 2, rowLeft + titleW, cy + 2);
      const pageX = colRight - pageW_text;
      doc.text(pageText, pageX, cy);
      doc.line(pageX, cy + 2, colRight, cy + 2);
      doc.setTextColor(110);
      const countRightX = pageX - 10;
      doc.text(countText, countRightX, cy, { align: "right" });
      const dotsStartX = rowLeft + titleW + 8;
      const dotsEndX = countRightX - countW - 8;
      if (dotsEndX > dotsStartX) {
        doc.setTextColor(170);
        doc.setFontSize(10);
        const dotStr = " .".repeat(Math.max(1, Math.floor((dotsEndX - dotsStartX) / 3)));
        doc.text(dotStr, dotsStartX, cy);
        doc.setFontSize(12);
      }
      doc.link(rowLeft - 4, cy - 14, colRight - rowLeft + 8, ROW_HEIGHT, {
        pageNumber: scheduleStartPage,
      });
      doc.setLineWidth(0.2);
      doc.setTextColor(0);
      doc.setDrawColor(0);
      cy += ROW_HEIGHT;
    }

    if (groupsWithPhotos.length) {
      doc.setDrawColor(210);
      doc.line(margin, cy + 2, pageW - margin, cy + 2);
      cy += 20;
      doc.setFont("helvetica", "bold");
      doc.text(`Total photos: ${total}`, margin, cy);
    }

    // Footer page numbers
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(130);
      doc.text(`Page ${i} of ${pageCount}`, pageW - margin, pageH - 18, { align: "right" });
      if (meta.ref) doc.text(meta.ref, margin, pageH - 18);
      doc.setTextColor(0);
    }

    return { doc, filename: `${reportBaseName()}.pdf` };
  }

  async function exportPdf(opts) {
    const layout = (opts && opts.layout) || "group";
    const includeAnalysis = opts ? opts.includeAnalysis !== false : true;
    const share = !!(opts && opts.share);
    try {
      // The build path needs every photo's dataUrl resident; wrap so
      // the visibility guard doesn't unload mid-build.
      const built = await withPhotoDataUrls(() => buildPdf({ layout, includeAnalysis }));
      // Differentiate the filename so the user can tell at a glance which
      // mode ran, and pick up a new download on subsequent exports instead
      // of the browser re-opening a cached copy with the same name.
      let filename = built.filename;
      if (!includeAnalysis) filename = filename.replace(/\.pdf$/, "_no-ai.pdf");
      if (layout === "tag") filename = filename.replace(/\.pdf$/, "_by-tag.pdf");
      const blob = built.doc.output("blob");
      const result = await deliverBlob(blob, filename, {
        share,
        title: filename,
        text: `Photo evidence — ${state.property.name || ""}`.trim(),
      });
      const layoutLabel = layout === "tag" ? "by tag" : "by group";
      const aiLabel = includeAnalysis ? "AI analysis included" : "AI analysis skipped";
      if (result === "shared") {
        toast(`PDF shared (${layoutLabel}, ${aiLabel}).`);
      } else if (result === "cancelled") {
        toast("Share cancelled.");
      } else {
        toast(`PDF saved (${layoutLabel}, ${aiLabel}).`);
      }
      // Once the file is in the user's hands, we don't need the
      // dataUrls in memory any more — let the visibility guard
      // reclaim them next time the PWA is backgrounded so opening
      // the PDF doesn't trigger a reload-on-return.
      if (document.visibilityState === "hidden" && !memGuard.manualPause && memGuard.busyCount === 0) {
        unloadAllPhotoDataUrls();
        memGuard.unloaded = true;
      }
    } catch (err) {
      console.error(err);
      toast(err.message || "Failed to build PDF.", "err");
    }
  }

  function openPdfLayoutDialog() {
    els.pdfLayoutDialog.hidden = false;
    els.pdfLayoutDialog.setAttribute("aria-hidden", "false");
  }
  function closePdfLayoutDialog() {
    els.pdfLayoutDialog.hidden = true;
    els.pdfLayoutDialog.setAttribute("aria-hidden", "true");
  }


  // -------------------- Export photos (share or photos-only ZIP) --------------------
  function photoExportItems() {
    const items = [];
    const addFrom = (group, opts) => {
      if (!group.photoIds.length) return;
      let index = 0;
      for (const pid of group.photoIds) {
        const photo = state.photos.get(pid);
        if (!photo) continue;
        index += 1;
        const dataUrl =
          photo.source === "upload" ? photo.dataUrl : buildExifDataUrl(photo);
        const bytes = dataUrlToBytes(dataUrl);
        const stamp = photo.takenAt || photo.uploadedAt || new Date().toISOString();
        items.push({
          photo,
          group,
          index,
          bytes,
          stamp,
          room: (opts && opts.room) || null,
        });
      }
    };
    for (const g of state.property.groups) addFrom(g, {});
    for (const room of state.property.rooms || []) {
      addFrom(room, { room });
    }
    return items;
  }

  function photosSupportShare(files) {
    try {
      return (
        typeof navigator !== "undefined" &&
        typeof navigator.canShare === "function" &&
        typeof navigator.share === "function" &&
        typeof File === "function" &&
        files.length > 0 &&
        navigator.canShare({ files })
      );
    } catch (_) {
      return false;
    }
  }

  // Build a single File for one photo with EXIF date / GPS stamped in.
  // Memory-light on purpose: we never hold more than one File at a time.
  function fileForPhoto(photo, group) {
    const dataUrl =
      photo.source === "upload" ? photo.dataUrl : buildExifDataUrl(photo);
    const bytes = dataUrlToBytes(dataUrl);
    const stamp = photo.takenAt || photo.uploadedAt || new Date().toISOString();
    const d = new Date(stamp);
    const pad = (n) => String(n).padStart(2, "0");
    const dateStr =
      `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_` +
      `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const groupName = group && group.name ? group.name : "photo";
    const labelSlug = slugify(photo.label || groupName);
    const defectPrefix = photo.defect ? "DEFECT_" : "";
    const tagPrefix = photo.roomTag ? `${slugify(photo.roomTag)}_` : "";
    const filename = `${defectPrefix}${tagPrefix}${slugify(groupName)}_${dateStr}_${labelSlug}.jpg`;
    return new File([new Blob([bytes], { type: "image/jpeg" })], filename, {
      type: "image/jpeg",
      lastModified: d.getTime(),
    });
  }

  // Save or share a single photo. Tries Web Share first (best on iOS — opens
  // the share sheet so the user taps "Save Image" to drop it into Photos),
  // then falls back to a regular download link for desktops / Android.
  async function savePhotoToDevice(photo, group) {
    let file;
    try {
      file = fileForPhoto(photo, group);
    } catch (err) {
      console.error(err);
      toast("Couldn't prepare photo.", "err");
      return;
    }
    if (photosSupportShare([file])) {
      try {
        await navigator.share({
          files: [file],
          title: photo.label || group.name || "Photo",
          text: photo.label || group.name || "",
        });
      } catch (err) {
        if (err && err.name !== "AbortError") {
          console.warn("Share failed", err);
          toast("Share failed — try again.", "err");
        }
      }
      return;
    }
    try {
      const blob = new Blob([file], { type: "image/jpeg" });
      saveBlob(blob, file.name);
      toast("Photo saved.");
    } catch (err) {
      console.error(err);
      toast("Couldn't save photo.", "err");
    }
  }
  function openExportPhotosDialog() {
    els.exportPhotosDialog.hidden = false;
    els.exportPhotosDialog.setAttribute("aria-hidden", "false");
    // Adjust the share button to reflect support so users aren't misled.
    const probeFile = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], "probe.jpg", {
      type: "image/jpeg",
    });
    const canShare =
      typeof navigator !== "undefined" &&
      typeof navigator.canShare === "function" &&
      navigator.canShare({ files: [probeFile] });
    els.exportPhotosShareBtn.disabled = !canShare;
    els.exportPhotosShareBtn.title = canShare
      ? ""
      : "Your browser can't share files — try the ZIP option.";
    if (!canShare) {
      els.exportPhotosHelp.innerHTML =
        "Your browser doesn't support sharing files to Photos. <strong>Download ZIP</strong> saves a single archive of all photos, grouped into folders.";
    }
  }

  function closeExportPhotosDialog() {
    els.exportPhotosDialog.hidden = true;
    els.exportPhotosDialog.setAttribute("aria-hidden", "true");
  }

  function exportPhotosShareNow() {
    // Called synchronously from a user click so navigator.share retains its
    // user-gesture credit on iOS / Android.
    const items = photoExportItems();
    if (!items.length) {
      toast("No photos to export.", "err");
      return;
    }
    const files = items.map(({ photo, group, index, bytes, stamp }) => {
      const d = new Date(stamp);
      const pad = (n) => String(n).padStart(2, "0");
      const dateStr =
        `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_` +
        `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
      const filename = `${slugify(group.name)}_${dateStr}_${String(index).padStart(2, "0")}.jpg`;
      return new File([new Blob([bytes], { type: "image/jpeg" })], filename, {
        type: "image/jpeg",
        lastModified: d.getTime(),
      });
    });
    if (!photosSupportShare(files)) {
      toast("This browser can't share these files — try Download ZIP.", "err");
      return;
    }
    const payload = {
      files,
      title: `${state.property.name || "Property"} — Photo evidence`,
      text: "Photo evidence",
    };
    navigator
      .share(payload)
      .then(() => {
        toast("Shared — tap Save Image / Save to Gallery in the sheet to back up.");
      })
      .catch((err) => {
        if (err && err.name !== "AbortError") {
          console.warn("Share failed", err);
          toast("Share failed — use Download ZIP instead.", "err");
        }
      });
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[c]);
  }

  function buildHtmlIndex(photoPaths) {
    const meta = state.property.meta || {};
    const title = state.property.name || meta.address || "Retrofit Photos";

    // Flatten every photo into a lean data record for the embedded viewer.
    // Groups list their photoIds in display order so filtering keeps the
    // same ordering the user is used to in the app.
    const photoData = {};
    const groups = [];
    const pushSection = (id, name, src, entries) => {
      if (!entries.length) return;
      groups.push({ id, name, photoIds: entries.map((e) => e.id) });
    };
    const addPhoto = (photo, sourceName) => {
      const path = photoPaths.get(photo.id);
      if (!path) return null;
      const takenIso = photo.takenAt || photo.uploadedAt || null;
      const analyses = Array.isArray(photo.analyses)
        ? photo.analyses.map((a) => {
            const preset = getAnalysisPreset(a.preset);
            return {
              preset: a.preset,
              presetLabel: preset ? preset.label : a.preset,
              model: a.model,
              generatedAt: a.generatedAt,
              data: a.data || {},
            };
          })
        : [];
      // "./" prefix keeps the path explicitly relative — some iOS /
      // quick-look style ZIP previewers resolve bare relative paths
      // against the wrong base.
      const relSrc = path.startsWith("./") || path.startsWith("/") ? path : "./" + path;
      photoData[photo.id] = {
        src: relSrc,
        label: photo.label || "",
        building: photoBuildingOf(photo),
        roomTag: photo.roomTag || "",
        defect: !!photo.defect,
        source: sourceName,
        dateStr: takenIso ? new Date(takenIso).toLocaleString() : "",
        gpsText: photo.gps ? formatGps(photo.gps) : "",
        uploaded: photo.source === "upload",
        analyses,
      };
      return { id: photo.id };
    };

    for (const g of state.property.groups || []) {
      const entries = (g.photoIds || [])
        .map((pid) => {
          const p = state.photos.get(pid);
          if (!p || isLaserCapturePhoto(p)) return null;
          return addPhoto(p, g.name);
        })
        .filter(Boolean);
      pushSection(`g-${g.id}`, g.name, g, entries);
    }
    for (const room of state.property.rooms || []) {
      const entries = (room.photoIds || [])
        .map((pid) => {
          const p = state.photos.get(pid);
          if (!p || isLaserCapturePhoto(p)) return null;
          return addPhoto(p, `${room.name} (${room.habitability})`);
        })
        .filter(Boolean);
      pushSection(`r-${room.id}`, `${room.name} (${room.habitability})`, room, entries);
    }

    const viewerData = {
      title,
      meta: {
        assessor: meta.assessor || "",
        address: meta.address || "",
        ref: meta.ref || "",
        date: meta.date || "",
        generated: new Date().toLocaleString(),
      },
      groups,
      photos: photoData,
    };

    // JSON can contain sequences that would close the <script> tag
    // prematurely if inserted raw. Escape the slashes that start tags.
    const dataJson = JSON.stringify(viewerData).replace(/</g, "\\u003c");

    const css = `
*{box-sizing:border-box}
html,body{margin:0;padding:0;height:100%;background:#f7f8fa;color:#0f172a;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;font-size:15px;line-height:1.45;-webkit-font-smoothing:antialiased;overflow:hidden}
body{display:flex;flex-direction:column}
.app{position:fixed;inset:0;display:grid;grid-template-columns:280px 1fr;grid-template-rows:1fr auto;grid-template-areas:"sidebar stage" "sidebar filmstrip";background:#f7f8fa}
.sidebar{grid-area:sidebar;background:#ffffff;border-right:1px solid #e2e8f0;display:flex;flex-direction:column;min-height:0;overflow:hidden}
.sidebar-top{padding:16px 18px 12px;padding-top:calc(16px + env(safe-area-inset-top));border-bottom:1px solid #e2e8f0;background:#1e293b;color:#ffffff}
.sidebar-top h1{margin:0;font-size:1.05rem;color:#5eead4;font-weight:700;letter-spacing:0.2px}
.sidebar-top dl{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;margin:10px 0 0;font-size:0.78rem;color:#cbd5e1}
.sidebar-top dt{font-weight:600;color:#94a3b8}
.sidebar-top dd{margin:0}
.sections{flex:1 1 auto;overflow-y:auto;padding:8px 10px;background:#f8fafc}
.section-head{margin:14px 0 6px;padding:0 8px;font-size:0.7rem;color:#64748b;font-weight:700;letter-spacing:0.6px;text-transform:uppercase}
.section-head:first-child{margin-top:4px}
.section-item{width:100%;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 10px;border-radius:8px;border:1px solid transparent;background:transparent;color:#0f172a;font:inherit;font-size:0.9rem;cursor:pointer;text-align:left}
.section-item:hover{background:#f1f5f9}
.section-item.is-active{background:#f0fdfa;border-color:#5eead4;color:#0f766e}
.section-item .count{color:#94a3b8;font-size:0.78rem;font-weight:600}
.section-item.is-active .count{color:#0f766e}
.section-item.is-danger .count{color:#dc2626}
.section-item.is-danger.is-active{background:#fee2e2;border-color:#fca5a5;color:#b91c1c}
.stage{grid-area:stage;position:relative;display:flex;align-items:center;justify-content:center;min-height:0;padding:20px;background:radial-gradient(ellipse at center,#ffffff 0%,#e2e8f0 100%)}
.stage-img-wrap{position:relative;width:100%;height:100%;display:flex;align-items:center;justify-content:center}
.main-img{max-width:100%;max-height:100%;object-fit:contain;border-radius:6px;background:#ffffff;box-shadow:0 12px 40px rgba(15,23,42,0.18)}
.stage-empty{color:#64748b;font-size:0.95rem;text-align:center}
.nav-btn{position:absolute;top:50%;transform:translateY(-50%);background:#ffffff;color:#0f172a;border:1px solid #e2e8f0;width:48px;height:48px;border-radius:999px;font-size:1.8rem;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(15,23,42,0.12);z-index:5}
.nav-btn:hover{background:#f0fdfa;border-color:#5eead4;color:#0f766e}
.nav-btn:disabled{opacity:0.35;cursor:not-allowed}
.prev{left:18px}
.next{right:18px}
.badges{position:absolute;top:18px;left:18px;display:flex;gap:6px;flex-wrap:wrap;max-width:calc(100% - 36px);z-index:4}
.badge{display:inline-flex;align-items:center;padding:4px 10px;border-radius:999px;font-size:0.72rem;font-weight:700;letter-spacing:0.3px;background:#ffffff;color:#0f172a;border:1px solid #e2e8f0;box-shadow:0 1px 3px rgba(15,23,42,0.08)}
.badge-defect{background:#fee2e2;color:#b91c1c;border-color:#fca5a5}
.badge-tag{background:#f0fdfa;color:#0f766e;border-color:#5eead4}
.badge-building{background:#f1f5f9;color:#0f172a;border-color:#e2e8f0}
.badge-ai{background:#ccfbf1;color:#0f766e;border-color:#5eead4;font-weight:700}
.stage-analyses{position:absolute;top:60px;right:18px;max-width:min(340px,38%);display:flex;flex-direction:column;gap:8px;z-index:4;pointer-events:auto;max-height:calc(100% - 140px);overflow-y:auto}
.stage-analyses:empty{display:none}
.stage-analysis{background:#ffffff;border:1px solid #e2e8f0;border-left:3px solid #0d9488;border-radius:8px;padding:10px 12px;color:#0f172a;font-size:0.82rem;box-shadow:0 4px 12px rgba(15,23,42,0.08)}
.stage-analysis.conf-low{border-left-color:#ea580c}
.stage-analysis.conf-medium{border-left-color:#eab308}
.stage-analysis.conf-high{border-left-color:#0d9488}
.stage-analysis-title{font-weight:700;color:#0f766e;font-size:0.9rem;display:flex;align-items:center;gap:8px;margin-bottom:6px}
.stage-analysis-conf{font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;padding:2px 7px;border-radius:999px;background:#ccfbf1;color:#0f766e}
.stage-analysis dl{margin:0;display:grid;grid-template-columns:max-content 1fr;gap:2px 10px;font-size:0.78rem}
.stage-analysis dt{color:#64748b}
.stage-analysis dd{margin:0;color:#0f172a}
.stage-analysis-notes{margin:6px 0 0;font-size:0.76rem;color:#64748b;line-height:1.35}
.stage-analysis-link{color:#0f766e;text-decoration:underline;font-weight:600}
.stage-analysis-link:hover{filter:brightness(1.1)}
@media (max-width:900px){.stage-analyses{position:static;margin:10px 10px 0;max-width:none;max-height:none}}
.caption{position:absolute;bottom:18px;left:50%;transform:translateX(-50%);padding:8px 14px;border-radius:10px;background:#ffffff;color:#0f172a;font-size:0.82rem;max-width:90%;text-align:center;border:1px solid #e2e8f0;box-shadow:0 4px 12px rgba(15,23,42,0.1);z-index:4}
.caption .counter{color:#64748b;margin-left:8px;font-weight:600}
.filmstrip{grid-area:filmstrip;display:flex;gap:6px;padding:14px 16px calc(20px + env(safe-area-inset-bottom));background:#ffffff;border-top:1px solid #e2e8f0;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x proximity;scrollbar-width:thin;scrollbar-color:#cbd5e1 #ffffff}
.filmstrip::-webkit-scrollbar{height:8px}
.filmstrip::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:999px}
.film-thumb{flex:0 0 auto;width:88px;height:66px;padding:0;border:2px solid transparent;border-radius:6px;background:#f1f5f9;cursor:pointer;overflow:hidden;position:relative;scroll-snap-align:center;transition:border-color 0.15s ease,box-shadow 0.15s ease}
.film-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.film-thumb:hover{border-color:#cbd5e1}
.film-thumb.is-active{border-color:#0d9488;box-shadow:0 0 0 2px rgba(13,148,136,0.25)}
.film-thumb.has-defect::after{content:"";position:absolute;top:4px;right:4px;width:8px;height:8px;border-radius:50%;background:#dc2626;box-shadow:0 0 0 2px rgba(255,255,255,0.9)}
.nojs-fallback{padding:20px;max-width:980px;margin:0 auto;color:#0f172a;font-family:inherit}
.nojs-fallback h2{color:#0f766e;margin:0 0 12px}
.nojs-fallback section{margin:0 0 24px}
.nojs-fallback h3{font-size:1.05rem;margin:0 0 10px;color:#0f172a;display:flex;align-items:baseline;gap:8px}
.nojs-fallback .nojs-count{font-size:0.82rem;color:#64748b;font-weight:500}
.nojs-fallback .nojs-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px}
.nojs-fallback .nojs-grid a{display:block;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;aspect-ratio:4/3}
.nojs-fallback .nojs-grid img{width:100%;height:100%;object-fit:cover;display:block}
body.js-ready .nojs-fallback{display:none}
body.js-ready .app{display:grid}
body:not(.js-ready) .app{display:none}
`;

    const js = `
(function(){
  var DATA = __VIEWER_DATA__;
  var state = { filter: "all", idx: 0, photoIds: [] };

  function allPhotoIds() {
    var ids = [];
    for (var i = 0; i < DATA.groups.length; i++) {
      var g = DATA.groups[i];
      for (var j = 0; j < g.photoIds.length; j++) ids.push(g.photoIds[j]);
    }
    return ids;
  }
  function defectIds() {
    return allPhotoIds().filter(function (id) { return DATA.photos[id] && DATA.photos[id].defect; });
  }
  function groupIds(id) {
    for (var i = 0; i < DATA.groups.length; i++) if (DATA.groups[i].id === id) return DATA.groups[i].photoIds.slice();
    return [];
  }

  var el = {};
  function $(sel) { return document.querySelector(sel); }

  function renderSidebar() {
    el.sections.innerHTML = "";
    var items = [
      { id: "all", name: "All photos", count: allPhotoIds().length, kind: "special" },
      { id: "defects", name: "Defects only", count: defectIds().length, kind: "danger" },
    ];
    el.sections.appendChild(header("Overview"));
    for (var i = 0; i < 2; i++) el.sections.appendChild(itemBtn(items[i]));

    var tagItems = tagBuckets();
    if (tagItems.length) {
      el.sections.appendChild(header("By Tag"));
      for (var t = 0; t < tagItems.length; t++) el.sections.appendChild(itemBtn(tagItems[t]));
    }

    var sections = DATA.groups.filter(function (g) { return g.photoIds.length > 0; });
    if (sections.length) {
      el.sections.appendChild(header("By room / group"));
      for (var k = 0; k < sections.length; k++) {
        var g = sections[k];
        el.sections.appendChild(itemBtn({ id: g.id, name: g.name, count: g.photoIds.length, kind: "group" }));
      }
    }
  }

  // Canonical tag order for the sidebar. Sync with ROOM_TAGS in the app.
  var TAG_ORDER = ["Room", "Undercuts", "Windows", "Lighting", "Heating", "Ventilation", "Renewables", "Meters", "Other"];

  function tagBuckets() {
    var counts = {};
    for (var id in DATA.photos) {
      if (!Object.prototype.hasOwnProperty.call(DATA.photos, id)) continue;
      var t = DATA.photos[id].roomTag;
      if (t) counts[t] = (counts[t] || 0) + 1;
    }
    var out = [];
    for (var i = 0; i < TAG_ORDER.length; i++) {
      var name = TAG_ORDER[i];
      if (counts[name]) out.push({ id: "tag:" + name, name: name, count: counts[name], kind: "tag" });
    }
    return out;
  }

  function tagIds(name) {
    return allPhotoIds().filter(function (id) {
      return DATA.photos[id] && DATA.photos[id].roomTag === name;
    });
  }
  function header(txt) {
    var h = document.createElement("div");
    h.className = "section-head";
    h.textContent = txt;
    return h;
  }
  function itemBtn(item) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "section-item" + (state.filter === item.id ? " is-active" : "") + (item.kind === "danger" ? " is-danger" : "");
    b.dataset.filter = item.id;
    var n = document.createElement("span");
    n.textContent = item.name;
    var c = document.createElement("span");
    c.className = "count";
    c.textContent = String(item.count);
    b.appendChild(n); b.appendChild(c);
    b.addEventListener("click", function () { setFilter(item.id); closeSidebar(); });
    return b;
  }

  function setFilter(f) {
    state.filter = f;
    state.idx = 0;
    if (f === "all") state.photoIds = allPhotoIds();
    else if (f === "defects") state.photoIds = defectIds();
    else if (f.indexOf("tag:") === 0) state.photoIds = tagIds(f.slice(4));
    else state.photoIds = groupIds(f);
    renderSidebar();
    renderStage();
    renderFilmstrip();
  }

  function renderStage() {
    var id = state.photoIds[state.idx];
    if (!id) {
      el.img.removeAttribute("src");
      el.img.alt = "";
      el.imgWrap.innerHTML = '<div class="stage-empty">No photos match this filter.</div>';
      el.caption.textContent = "";
      el.badges.innerHTML = "";
      el.prev.disabled = true; el.next.disabled = true;
      return;
    }
    if (!el.imgWrap.querySelector("img")) el.imgWrap.innerHTML = "";
    if (!el.imgWrap.contains(el.img)) {
      el.imgWrap.innerHTML = "";
      el.imgWrap.appendChild(el.img);
    }
    var p = DATA.photos[id];
    el.img.src = p.src;
    el.img.alt = p.label || "";
    el.badges.innerHTML = "";
    if (p.defect) el.badges.appendChild(badge("Defect", "badge badge-defect"));
    if (p.roomTag) el.badges.appendChild(badge(p.roomTag, "badge badge-tag"));
    if (p.building) el.badges.appendChild(badge(p.building, "badge badge-building"));
    if (Array.isArray(p.analyses) && p.analyses.length) {
      el.badges.appendChild(badge(p.analyses.length > 1 ? "AI × " + p.analyses.length : "AI", "badge badge-ai"));
    }

    var pieces = [];
    if (p.source) pieces.push(p.source);
    if (p.label) pieces.push(p.label);
    if (p.dateStr) pieces.push(p.dateStr);
    if (p.gpsText) pieces.push(p.gpsText);
    el.caption.innerHTML = "";
    var capText = document.createTextNode(pieces.join(" · "));
    el.caption.appendChild(capText);
    var counter = document.createElement("span");
    counter.className = "counter";
    counter.textContent = "(" + (state.idx + 1) + "/" + state.photoIds.length + ")";
    el.caption.appendChild(counter);

    renderStageAnalyses(p);

    el.prev.disabled = state.idx === 0;
    el.next.disabled = state.idx === state.photoIds.length - 1;
  }

  function renderStageAnalyses(p) {
    if (!el.analyses) return;
    el.analyses.innerHTML = "";
    if (!Array.isArray(p.analyses) || !p.analyses.length) return;
    var friendly = {
      make: "Make",
      model: "Model",
      serial: "Serial",
      is_smart_meter: "Smart meter",
      smets_generation: "SMETS",
      is_export_capable: "Export capable",
      export_capability_source: "Basis",
      current_reading: "Reading",
      type: "Type",
      fuel: "Fuel",
      installed_year: "Installed",
      efficiency_rating: "Efficiency",
      output_kw: "Output (kW)",
      manual_url: "Manual"
    };
    for (var i = 0; i < p.analyses.length; i++) {
      var a = p.analyses[i];
      var d = a.data || {};
      var card = document.createElement("div");
      card.className = "stage-analysis";
      if (d.confidence) card.className += " conf-" + d.confidence;
      var title = document.createElement("div");
      title.className = "stage-analysis-title";
      title.textContent = a.presetLabel || a.preset;
      if (d.confidence) {
        var conf = document.createElement("span");
        conf.className = "stage-analysis-conf";
        conf.textContent = d.confidence;
        title.appendChild(conf);
      }
      card.appendChild(title);
      var dl = document.createElement("dl");
      for (var key in friendly) {
        if (!Object.prototype.hasOwnProperty.call(d, key)) continue;
        var v = d[key];
        if (v === null || v === undefined || v === "") continue;
        var isLink = key === "manual_url" && typeof v === "string" && /^https?:\\/\\//i.test(v);
        if (typeof v === "boolean") v = v ? "Yes" : "No";
        var dt = document.createElement("dt");
        dt.textContent = friendly[key];
        var dd = document.createElement("dd");
        if (isLink) {
          var link = document.createElement("a");
          link.href = v;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = "Open ↗";
          link.className = "stage-analysis-link";
          dd.appendChild(link);
        } else {
          dd.textContent = String(v);
        }
        dl.appendChild(dt);
        dl.appendChild(dd);
      }
      if (dl.childNodes.length) card.appendChild(dl);
      if (d.notes) {
        var notes = document.createElement("p");
        notes.className = "stage-analysis-notes";
        notes.textContent = d.notes;
        card.appendChild(notes);
      }
      el.analyses.appendChild(card);
    }
  }

  function badge(text, cls) {
    var s = document.createElement("span");
    s.className = cls;
    s.textContent = text;
    return s;
  }

  function renderFilmstrip() {
    el.filmstrip.innerHTML = "";
    for (var i = 0; i < state.photoIds.length; i++) {
      (function (i) {
        var id = state.photoIds[i];
        var p = DATA.photos[id];
        var b = document.createElement("button");
        b.type = "button";
        b.className = "film-thumb" + (i === state.idx ? " is-active" : "") + (p.defect ? " has-defect" : "");
        var img = document.createElement("img");
        img.src = p.src; img.loading = "lazy"; img.alt = "";
        b.appendChild(img);
        b.addEventListener("click", function () { state.idx = i; renderStage(); highlightFilmstrip(); });
        el.filmstrip.appendChild(b);
      })(i);
    }
    scrollActiveIntoView();
  }
  function highlightFilmstrip() {
    var thumbs = el.filmstrip.querySelectorAll(".film-thumb");
    for (var i = 0; i < thumbs.length; i++) thumbs[i].classList.toggle("is-active", i === state.idx);
    scrollActiveIntoView();
  }
  function scrollActiveIntoView() {
    var a = el.filmstrip.querySelector(".is-active");
    if (a && a.scrollIntoView) a.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }

  function step(d) {
    var n = state.photoIds.length;
    if (!n) return;
    var next = state.idx + d;
    if (next < 0 || next >= n) return;
    state.idx = next;
    renderStage(); highlightFilmstrip();
  }

  function closeSidebar() { document.body.classList.remove("sidebar-open"); }

  document.addEventListener("DOMContentLoaded", function () {
    // Flag body so the CSS fallback (.nojs-fallback) is hidden and the
    // viewer (.app) becomes visible. If this line never runs, the static
    // fallback is what the user sees.
    document.body.classList.add("js-ready");
    el.sections = $(".sections");
    el.stage = $(".stage");
    el.imgWrap = $(".stage-img-wrap");
    el.img = $(".main-img");
    el.caption = $(".caption");
    el.badges = $(".badges");
    el.analyses = $(".stage-analyses");
    el.filmstrip = $(".filmstrip");
    el.prev = $(".prev");
    el.next = $(".next");

    el.prev.addEventListener("click", function () { step(-1); });
    el.next.addEventListener("click", function () { step(1); });

    document.addEventListener("keydown", function (e) {
      if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "Home") { state.idx = 0; renderStage(); highlightFilmstrip(); }
      else if (e.key === "End") { state.idx = state.photoIds.length - 1; renderStage(); highlightFilmstrip(); }
      else if (e.key === "Escape") closeSidebar();
    });

    // Touch-swipe support on the stage.
    var startX = 0, startY = 0, dragging = false;
    el.stage.addEventListener("touchstart", function (e) {
      if (!e.touches || e.touches.length !== 1) return;
      startX = e.touches[0].clientX; startY = e.touches[0].clientY; dragging = true;
    }, { passive: true });
    el.stage.addEventListener("touchend", function (e) {
      if (!dragging) return; dragging = false;
      var t = e.changedTouches[0];
      var dx = t.clientX - startX; var dy = t.clientY - startY;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) step(dx > 0 ? -1 : 1);
    });

    setFilter("all");
  });
})();
`;

    const safe = (v) => escapeHtml(v || "—");

    // Static no-JS fallback: every photo gets an anchor-wrapped <img>
    // grouped by section. Kept in the DOM so it renders in viewers that
    // don't execute JS (some iOS ZIP previewers) or if the viewer JS
    // fails mid-boot. CSS hides it the moment JS sets body.js-ready.
    let nojsFallback = '<div class="nojs-fallback"><h2>Photos</h2>';
    for (const g of groups) {
      if (!g.photoIds.length) continue;
      nojsFallback += `<section><h3>${escapeHtml(g.name)} <span class="nojs-count">${g.photoIds.length}</span></h3><div class="nojs-grid">`;
      for (const pid of g.photoIds) {
        const p = photoData[pid];
        if (!p) continue;
        // p.src already has the "./" prefix applied in addPhoto.
        const hrefEsc = escapeHtml(p.src);
        const altEsc = escapeHtml(p.label || "");
        nojsFallback += `<a href="${hrefEsc}" target="_blank" rel="noopener"><img src="${hrefEsc}" alt="${altEsc}" loading="lazy"></a>`;
      }
      nojsFallback += `</div></section>`;
    }
    nojsFallback += '</div>';
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<base href="./">
<title>${escapeHtml(title)} — Retrofit Photos</title>
<style>${css}</style>
</head>
<body>
<div class="app">
  <aside class="sidebar">
    <div class="sidebar-top">
      <h1>${escapeHtml(title)}</h1>
      <dl>
        <dt>Assessor</dt><dd>${safe(meta.assessor)}</dd>
        <dt>Property</dt><dd>${safe(meta.address)}</dd>
        <dt>Job ref</dt><dd>${safe(meta.ref)}</dd>
        <dt>Date</dt><dd>${safe(meta.date)}</dd>
        <dt>Generated</dt><dd>${escapeHtml(new Date().toLocaleString())}</dd>
      </dl>
    </div>
    <nav class="sections" aria-label="Photo filters"></nav>
  </aside>
  <div class="stage">
    <button class="nav-btn prev" type="button" aria-label="Previous">&#x2039;</button>
    <div class="stage-img-wrap"><img class="main-img" alt=""></div>
    <div class="stage-analyses" aria-label="AI analyses for this photo"></div>
    <button class="nav-btn next" type="button" aria-label="Next">&#x203A;</button>
    <div class="badges"></div>
    <div class="caption"></div>
  </div>
  <div class="filmstrip" aria-label="Photo filmstrip"></div>
</div>
${nojsFallback}
<script>${js.replace("__VIEWER_DATA__", dataJson)}</script>
</body>
</html>`;
  }

  // -------------------- Resumable originals export plan --------------------
  // iOS aggressively reclaims memory from a backgrounded PWA, so when
  // the user leaves the app to file a downloaded ZIP somewhere, the
  // page often reloads on return — taking the in-memory loop with it.
  // We persist a small plan in localStorage so the user can resume the
  // multi-part flow tap by tap, and a reload doesn't lose the place.
  const ORIGINALS_PLAN_KEY = "retrofit-photos:originals-plan";

  function loadOriginalsPlan() {
    try {
      const v = localStorage.getItem(ORIGINALS_PLAN_KEY);
      return v ? JSON.parse(v) : null;
    } catch (_) {
      return null;
    }
  }
  function saveOriginalsPlan(plan) {
    try {
      if (plan) localStorage.setItem(ORIGINALS_PLAN_KEY, JSON.stringify(plan));
      else localStorage.removeItem(ORIGINALS_PLAN_KEY);
    } catch (_) { /* noop */ }
  }
  function clearOriginalsPlan() { saveOriginalsPlan(null); }

  // Build the chunk plan from the property's current photos. Each
  // chunk is just a list of photo IDs — small enough to live in
  // localStorage, and we resolve them back to live photos at build
  // time.
  function buildOriginalsPlan(opts) {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent || "") ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const isStandalone =
      ("standalone" in navigator && navigator.standalone === true) ||
      (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
    const isIOSPwa = isIOS && isStandalone;
    const ORIGINALS_CHUNK = 100;

    const photoIds = [];
    for (const g of state.property.groups || []) {
      for (const pid of g.photoIds || []) {
        const photo = state.photos.get(pid);
        if (!photo || isLaserCapturePhoto(photo)) continue;
        photoIds.push(pid);
      }
    }
    for (const room of state.property.rooms || []) {
      for (const pid of room.photoIds || []) {
        const photo = state.photos.get(pid);
        if (!photo || isLaserCapturePhoto(photo)) continue;
        photoIds.push(pid);
      }
    }
    if (!photoIds.length) return null;
    const photoIdsByPart = [];
    for (let i = 0; i < photoIds.length; i += ORIGINALS_CHUNK) {
      photoIdsByPart.push(photoIds.slice(i, i + ORIGINALS_CHUNK));
    }
    return {
      propertyId: state.property.id,
      propertyName: state.property.name || "",
      photoIdsByPart,
      partsDone: [],
      share: !!(opts && opts.share),
      startedAt: new Date().toISOString(),
    };
  }

  function partIsDone(plan, partIdx) {
    return Array.isArray(plan && plan.partsDone) && plan.partsDone.includes(partIdx);
  }

  // Build and save a single part of the originals ZIP. Looks up live
  // photos by id from state.photos so that even if state changed since
  // the plan was created, only photos that still exist get included.
  async function saveOriginalsPart(plan, partIdx) {
    if (typeof JSZip === "undefined") throw new Error("ZIP library failed to load.");
    const partIds = plan.photoIdsByPart[partIdx] || [];
    if (!partIds.length) throw new Error("Empty part — nothing to save.");
    const numParts = plan.photoIdsByPart.length;
    const partLabel = numParts > 1 ? ` (part ${partIdx + 1}/${numParts})` : "";

    // Yield to UI between heavy steps so iOS doesn't kill the page.
    const yieldToUi = () => new Promise((r) => setTimeout(r, 0));
    toast(`Packaging photos${partLabel}…`);
    await yieldToUi();

    const zip = new JSZip();
    const dirForGroup = new Map();
    const dirTaken = new Map();
    const uniqueDir = (base) => {
      let dir = base;
      const n = (dirTaken.get(dir) || 0) + 1;
      dirTaken.set(dir, n);
      if (n > 1) dir = `${dir}-${n}`;
      return dir;
    };

    // Resolve each photo back to its current owner so the directory
    // structure mirrors what the user sees in the app.
    const ownerOf = (photoId) => {
      for (const g of state.property.groups || []) {
        if ((g.photoIds || []).includes(photoId)) return { group: g, room: null };
      }
      for (const r of state.property.rooms || []) {
        if ((r.photoIds || []).includes(photoId)) return { group: r, room: r };
      }
      return null;
    };

    const groupIndexCounter = new Map();
    let processed = 0;
    for (const pid of partIds) {
      // Read each photo straight from IDB — by this point the parts
      // dialog has dropped state.photos.dataUrl to keep iOS PWA
      // resident memory low. We only hold one photo's dataUrl at a
      // time, hand the bytes to JSZip, then null it.
      let photo;
      try {
        photo = await IDB.getPhoto(pid);
      } catch (err) {
        console.warn("Failed to read photo from IDB", pid, err);
      }
      if (!photo || !photo.dataUrl || isLaserCapturePhoto(photo)) continue;
      const owner = ownerOf(pid);
      if (!owner) continue;
      const { group, room } = owner;
      let dir = dirForGroup.get(group.id);
      if (!dir) {
        if (room) {
          const roomSlug = slugify(`${room.name || room.roomType} ${room.habitability}`);
          dir = uniqueDir(`rooms/${roomSlug}`);
        } else {
          dir = uniqueDir(slugify(group.name));
        }
        dirForGroup.set(group.id, dir);
      }
      const folder = zip.folder(dir);
      const indexInGroup = (groupIndexCounter.get(group.id) || 0) + 1;
      groupIndexCounter.set(group.id, indexInGroup);

      let dataUrl = insertExifInto(photo.dataUrl, photo);
      let bytes = dataUrlToBytes(dataUrl);
      dataUrl = null;
      const stamp = photo.takenAt || photo.uploadedAt || new Date().toISOString();
      const defectPrefix = photo.defect ? "DEFECT_" : "";
      const tagPrefix = room && photo.roomTag ? `${slugify(photo.roomTag)}_` : "";
      const labelSlug = slugify(photo.label || `${group.name}-${indexInGroup}`);
      const name = `${defectPrefix}${tagPrefix}${String(indexInGroup).padStart(2, "0")}_${labelSlug}.jpg`;
      folder.file(name, bytes, { date: new Date(stamp) });
      bytes = null;
      // Drop our local copy of the photo blob too — JSZip already has
      // its own reference to the bytes.
      photo = null;
      processed += 1;
      if (processed % 4 === 0 || processed === partIds.length) {
        toast(`Packaging photos${partLabel}… ${processed}/${partIds.length}`);
        await yieldToUi();
      }
    }

    if (numParts > 1) {
      zip.file(
        "README.txt",
        `Retrofit Photos — originals export\n` +
          `Part ${partIdx + 1} of ${numParts}\n` +
          `Photos in this archive: ${processed}\n`
      );
    }

    toast(`Compressing ZIP${partLabel}…`);
    await yieldToUi();
    let zipBlob = await zip.generateAsync({ type: "blob", compression: "STORE" });
    const suffix = numParts > 1
      ? `_photos_originals_part${partIdx + 1}_of_${numParts}.zip`
      : "_photos_originals.zip";
    const filename = `${reportBaseName()}${suffix}`;
    const result = await deliverBlob(zipBlob, filename, {
      share: plan.share,
      title: numParts > 1 ? `${filename} (part ${partIdx + 1}/${numParts})` : filename,
      text: `Retrofit Photos — ${plan.propertyName || ""}`.trim(),
    });
    zipBlob = null;
    if (result !== "cancelled") {
      // Mark this part as done and persist immediately so a reload
      // before the user taps the next part still remembers we got here.
      plan.partsDone = Array.from(new Set([...(plan.partsDone || []), partIdx])).sort((a, b) => a - b);
      saveOriginalsPlan(plan);
    }
    return result;
  }

  function openOriginalsPartsDialog(plan) {
    if (!els.originalsPartsDialog) return;
    // While the dialog is open, keep memory pressure low so iOS won't
    // reload the PWA when the user returns from saving a part to
    // Drive / Files / Dropbox. Each part's saveOriginalsPart re-reads
    // from IDB on demand, so state.photos can hold metadata only.
    setMemGuardManualPause(true);
    unloadAllPhotoDataUrls();
    memGuard.unloaded = true;
    renderOriginalsPartsDialog(plan);
    els.originalsPartsDialog.hidden = false;
    els.originalsPartsDialog.setAttribute("aria-hidden", "false");
  }
  function closeOriginalsPartsDialog() {
    if (!els.originalsPartsDialog) return;
    els.originalsPartsDialog.hidden = true;
    els.originalsPartsDialog.setAttribute("aria-hidden", "true");
    // Restore in-memory dataUrls so thumbs come back to life.
    setMemGuardManualPause(false);
    reloadAllPhotoDataUrls()
      .then(() => { memGuard.unloaded = false; })
      .catch((err) => console.warn("Failed to reload photo dataUrls", err));
  }

  // Drop dataUrls from state.photos to slash the PWA's resident memory
  // (each photo is a few MB; a 100-photo property is ~300-500 MB on
  // its own). Photos still exist in IndexedDB, so the export path can
  // read them back on demand.
  function unloadAllPhotoDataUrls() {
    for (const photo of state.photos.values()) {
      if (photo && photo.dataUrl) photo.dataUrl = null;
    }
    // Hide thumbs that have lost their src so we don't show broken
    // images while the dialog is open.
    document.querySelectorAll(".thumb img").forEach((img) => {
      img.removeAttribute("src");
    });
  }

  // Pull dataUrls back into state.photos from IDB so the rest of the
  // app keeps working after the parts dialog closes.
  async function reloadAllPhotoDataUrls() {
    if (!state.property) return;
    const ids = new Set();
    for (const g of state.property.groups || []) {
      for (const pid of g.photoIds || []) ids.add(pid);
    }
    for (const r of state.property.rooms || []) {
      for (const pid of r.photoIds || []) ids.add(pid);
    }
    for (const id of ids) {
      const photo = state.photos.get(id);
      if (!photo || photo.dataUrl) continue;
      try {
        const fresh = await IDB.getPhoto(id);
        if (fresh && fresh.dataUrl) photo.dataUrl = fresh.dataUrl;
      } catch (err) {
        console.warn("Failed to re-load photo", id, err);
      }
    }
    // Re-render so the now-restored thumbs appear again.
    if (typeof renderRooms === "function") renderRooms();
    if (typeof renderGroups === "function") renderGroups();
  }

  // -------------------- Memory guard for iOS PWA --------------------
  // iOS aggressively reclaims memory from a backgrounded PWA. Holding
  // every photo's dataUrl in JS heap (~3-5 MB each) puts the process
  // well above the threshold. When visibility flips to hidden we
  // proactively unload dataUrls so the process is small enough that
  // iOS doesn't reclaim it; on return we lazy-reload from IDB.
  const memGuard = {
    unloaded: false,
    busyCount: 0,    // > 0 → an export / camera op needs dataUrls in memory
    manualPause: false, // parts dialog is managing it itself
    pendingHide: null,
  };

  function setMemGuardManualPause(paused) {
    memGuard.manualPause = !!paused;
  }

  // Wrap an operation that needs every photo's dataUrl in memory
  // (PDF / ZIP build, lightbox preview, etc.). The wrapper lifts the
  // unload guard, makes sure data is loaded, runs the operation, then
  // releases. If the page was hidden mid-operation we leave the
  // dataUrls loaded — the next visibility-hidden event will cycle.
  async function withPhotoDataUrls(fn) {
    memGuard.busyCount += 1;
    try {
      if (memGuard.unloaded) {
        await reloadAllPhotoDataUrls();
        memGuard.unloaded = false;
      }
      return await fn();
    } finally {
      memGuard.busyCount = Math.max(0, memGuard.busyCount - 1);
    }
  }

  function setupVisibilityMemoryGuard() {
    if (typeof document === "undefined" || !("visibilityState" in document)) return;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        if (memGuard.manualPause) return;
        if (memGuard.busyCount > 0) return;
        if (memGuard.unloaded) return;
        // Slight delay so quick app-switches don't churn unnecessarily.
        if (memGuard.pendingHide) clearTimeout(memGuard.pendingHide);
        memGuard.pendingHide = setTimeout(() => {
          memGuard.pendingHide = null;
          if (document.visibilityState !== "hidden") return;
          if (memGuard.busyCount > 0 || memGuard.manualPause) return;
          unloadAllPhotoDataUrls();
          memGuard.unloaded = true;
        }, 250);
      } else if (document.visibilityState === "visible") {
        if (memGuard.pendingHide) {
          clearTimeout(memGuard.pendingHide);
          memGuard.pendingHide = null;
        }
        if (memGuard.unloaded && !memGuard.manualPause) {
          reloadAllPhotoDataUrls()
            .then(() => { memGuard.unloaded = false; })
            .catch((err) => console.warn("Failed to reload dataUrls on visible", err));
        }
      }
    });
    // Treat the BFCache pageshow/persisted as a visible event for our
    // purposes — Safari sometimes restores the page in this state
    // without firing visibilitychange.
    window.addEventListener("pageshow", (e) => {
      if (e.persisted && memGuard.unloaded && !memGuard.manualPause) {
        reloadAllPhotoDataUrls()
          .then(() => { memGuard.unloaded = false; })
          .catch((err) => console.warn("Failed to reload dataUrls on pageshow", err));
      }
    });
  }

  function renderOriginalsPartsDialog(plan) {
    if (!els.originalsPartsList || !els.originalsPartsTitle) return;
    const numParts = plan.photoIdsByPart.length;
    const doneCount = (plan.partsDone || []).length;
    els.originalsPartsTitle.textContent =
      numParts === 1 ? "1 part" : `${numParts} parts (${doneCount} saved)`;
    els.originalsPartsList.innerHTML = "";
    const nextIdx = plan.photoIdsByPart.findIndex((_p, i) => !partIsDone(plan, i));
    plan.photoIdsByPart.forEach((ids, i) => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "part-btn";
      const isDone = partIsDone(plan, i);
      const isNext = !isDone && i === nextIdx;
      btn.dataset.state = isDone ? "done" : isNext ? "next" : "pending";
      btn.disabled = isDone;
      btn.textContent = `Save part ${i + 1} of ${numParts}`;
      const meta = document.createElement("span");
      meta.className = "part-meta";
      meta.textContent = `${ids.length} photo${ids.length === 1 ? "" : "s"}`;
      btn.addEventListener("click", async () => {
        if (btn.disabled) return;
        btn.disabled = true;
        btn.dataset.state = "busy";
        btn.textContent = `Building part ${i + 1}…`;
        try {
          const result = await saveOriginalsPart(plan, i);
          if (result === "cancelled") {
            // User cancelled the share sheet — leave the part as
            // pending so they can try again.
            renderOriginalsPartsDialog(plan);
          } else {
            // Re-render so the next part lights up and finished parts
            // mark themselves complete.
            renderOriginalsPartsDialog(plan);
            // If everything is done, clear the plan and close.
            if ((plan.partsDone || []).length >= numParts) {
              clearOriginalsPlan();
              toast(`All ${numParts} parts saved.`);
              setTimeout(closeOriginalsPartsDialog, 800);
            }
          }
        } catch (err) {
          console.error(err);
          toast(err.message || `Failed to save part ${i + 1}.`, "err");
          renderOriginalsPartsDialog(plan);
        }
      });
      li.appendChild(btn);
      li.appendChild(meta);
      els.originalsPartsList.appendChild(li);
    });
  }

  function startOriginalsExport(opts) {
    const plan = buildOriginalsPlan(opts);
    if (!plan) {
      toast("No photos to export.", "err");
      return;
    }
    if (plan.photoIdsByPart.length === 1) {
      // Single part — just save it directly, no need for the parts dialog.
      saveOriginalsPart(plan, 0).catch((err) => {
        console.error(err);
        toast(err.message || "Failed to save originals.", "err");
      });
      return;
    }
    saveOriginalsPlan(plan);
    openOriginalsPartsDialog(plan);
  }

  // On boot, if a previous originals export was interrupted (page
  // reloaded mid-way), surface the partially-completed plan so the
  // user can resume.
  function maybeResumeOriginalsPlan() {
    const plan = loadOriginalsPlan();
    if (!plan || !plan.photoIdsByPart || !plan.photoIdsByPart.length) return;
    if (!state.property || plan.propertyId !== state.property.id) return;
    const numParts = plan.photoIdsByPart.length;
    const doneCount = (plan.partsDone || []).length;
    if (doneCount >= numParts) {
      clearOriginalsPlan();
      return;
    }
    openOriginalsPartsDialog(plan);
  }

  async function exportPhotosAsZip(options = {}) {
    // compress:true  — re-encode each photo on its way into the ZIP (iOS
    //   friendly; recommended for properties with 150+ photos).
    // compress:false — zip the stored dataUrl bytes verbatim so each
    //   photo is at its captured fidelity. The originals path is split
    //   into multiple ZIPs of at most ORIGINALS_CHUNK photos so iOS
    //   doesn't blow its memory ceiling on a single huge archive.
    const compress = options.compress !== false;
    const share = !!options.share;
    if (!compress) {
      // The originals path goes through the resumable parts dialog
      // instead of the auto-loop below, so iOS can't kill us mid-way.
      startOriginalsExport({ share });
      return;
    }
    // The compressed path needs every photo's dataUrl resident — wrap
    // the heavy build so the visibility guard doesn't unload during it.
    return withPhotoDataUrls(() => buildAndDeliverCompressedZip({ share }));
  }

  async function buildAndDeliverCompressedZip(options) {
    const share = !!(options && options.share);
    const compress = true;
    // iOS WebKit (and especially the standalone PWA process) gets a
    // much smaller memory ceiling than desktop Safari. Chunk size is
    // the main lever — every photo we add to a chunk holds ~2-5 MB
    // resident until generateAsync emits the blob.
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent || "") ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const isStandalone =
      ("standalone" in navigator && navigator.standalone === true) ||
      (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
    const isIOSPwa = isIOS && isStandalone;
    const ORIGINALS_CHUNK = 100;
    const interPartPauseMs = isIOSPwa ? 2200 : isIOS ? 1500 : 800;
    if (typeof JSZip === "undefined") {
      toast("ZIP library failed to load.", "err");
      return;
    }
    const total = totalPhotoCount();
    if (!total) {
      toast("No photos to export.", "err");
      return;
    }
    // Yield back to the event loop. iOS is quick to kill a PWA whose main
    // thread is busy for too long, so we pepper the heavy path with awaits
    // to give it room to breathe and update the UI.
    const yieldToUi = () => new Promise((r) => setTimeout(r, 0));

    // Flatten every photo into { group, room, photo, indexInGroup } so we
    // can slice the list into fixed-size chunks while still emitting
    // per-group folders and stable per-group indices inside each chunk.
    const walkItems = [];
    for (const g of state.property.groups || []) {
      let idx = 0;
      for (const pid of g.photoIds || []) {
        const photo = state.photos.get(pid);
        if (!photo || isLaserCapturePhoto(photo)) continue;
        idx += 1;
        walkItems.push({ group: g, room: null, photo, indexInGroup: idx });
      }
    }
    for (const room of state.property.rooms || []) {
      let idx = 0;
      for (const pid of room.photoIds || []) {
        const photo = state.photos.get(pid);
        if (!photo || isLaserCapturePhoto(photo)) continue;
        idx += 1;
        walkItems.push({ group: room, room, photo, indexInGroup: idx });
      }
    }

    const chunkSize = compress ? walkItems.length : ORIGINALS_CHUNK;
    const chunks = [];
    for (let i = 0; i < walkItems.length; i += chunkSize) {
      chunks.push(walkItems.slice(i, i + chunkSize));
    }
    const numParts = chunks.length;

    try {
      let doneOverall = 0;
      for (let partIdx = 0; partIdx < numParts; partIdx++) {
        const items = chunks[partIdx];
        const partLabel = numParts > 1 ? ` (part ${partIdx + 1}/${numParts})` : "";
        toast(
          compress
            ? `Preparing ${total} photo${total === 1 ? "" : "s"}…`
            : `Packaging photos${partLabel}…`
        );
        await yieldToUi();

        const zip = new JSZip();
        const dirForGroup = new Map();
        const dirTaken = new Map();
        const photoPaths = new Map();
        const uniqueDir = (base) => {
          let dir = base;
          const n = (dirTaken.get(dir) || 0) + 1;
          dirTaken.set(dir, n);
          if (n > 1) dir = `${dir}-${n}`;
          return dir;
        };

        for (const { group, room, photo, indexInGroup } of items) {
          let dir = dirForGroup.get(group.id);
          if (!dir) {
            if (room) {
              const roomSlug = slugify(`${room.name || room.roomType} ${room.habitability}`);
              dir = uniqueDir(`rooms/${roomSlug}`);
            } else {
              dir = uniqueDir(slugify(group.name));
            }
            dirForGroup.set(group.id, dir);
          }
          const folder = zip.folder(dir);
          doneOverall += 1;
          // Compressed mode re-encodes to ~2200 px / q0.82; originals mode
          // zips the stored bytes. Either way EXIF (date / GPS) is
          // re-stamped so the saved file still carries metadata.
          let dataUrl = compress
            ? await reencodeForZip(photo.dataUrl)
            : photo.dataUrl;
          dataUrl = insertExifInto(dataUrl, photo);
          let bytes = dataUrlToBytes(dataUrl);
          dataUrl = null;
          const stamp = photo.takenAt || photo.uploadedAt || new Date().toISOString();
          const defectPrefix = photo.defect ? "DEFECT_" : "";
          const tagPrefix = room && photo.roomTag ? `${slugify(photo.roomTag)}_` : "";
          const labelSlug = slugify(photo.label || `${group.name}-${indexInGroup}`);
          const name = `${defectPrefix}${tagPrefix}${String(indexInGroup).padStart(2, "0")}_${labelSlug}.jpg`;
          folder.file(name, bytes, { date: new Date(stamp) });
          // JSZip retains its own reference; drop ours so any GC cycle
          // that fires before generateAsync can reclaim our copy.
          bytes = null;
          photoPaths.set(photo.id, `${dir}/${name}`);
          if (doneOverall % 4 === 0 || doneOverall === total) {
            toast(`Packaging photos${partLabel}… ${doneOverall}/${total}`);
            await yieldToUi();
          }
        }

        // A single self-contained viewer (filter + filmstrip + big photo)
        // ships with the compressed ZIP. It covers what the old by-group
        // and by-tag HTML indices used to do and is much nicer to browse.
        if (compress) {
          try {
            zip.file("index.html", buildHtmlIndex(photoPaths));
          } catch (err) {
            console.warn("HTML index generation failed.", err);
          }
          try {
            zip.file("window-measurements.html", buildWindowMeasurementsHtml());
          } catch (err) {
            console.warn("Window measurements HTML generation failed.", err);
          }
        } else if (numParts > 1) {
          zip.file(
            "README.txt",
            `Retrofit Photos — originals export\n` +
              `Part ${partIdx + 1} of ${numParts}\n` +
              `Photos in this archive: ${items.length}\n` +
              `Total photos in the property: ${total}\n`
          );
        }

        toast(`Compressing ZIP${partLabel}…`);
        await yieldToUi();
        let zipBlob = await zip.generateAsync({ type: "blob", compression: "STORE" });
        let suffix;
        if (compress) {
          suffix = "_photos.zip";
        } else if (numParts > 1) {
          suffix = `_photos_originals_part${partIdx + 1}_of_${numParts}.zip`;
        } else {
          suffix = "_photos_originals.zip";
        }
        const filename = `${reportBaseName()}${suffix}`;
        const partTitle = numParts > 1 ? `${filename} (part ${partIdx + 1}/${numParts})` : filename;
        const result = await deliverBlob(zipBlob, filename, {
          share,
          title: partTitle,
          text: `Retrofit Photos — ${state.property.name || ""}`.trim(),
        });
        // Drop our refs so the browser can reclaim ~2 × chunk size of
        // memory before the next chunk starts building. On iOS PWA
        // this single line is the difference between "completes" and
        // "page reloads with no warning".
        zipBlob = null;
        // Give the browser a moment between downloads. iOS in particular
        // can drop subsequent anchor clicks if they come back-to-back,
        // and a longer pause gives WebKit room to actually GC.
        if (partIdx < numParts - 1) {
          const verb = result === "shared" ? "shared" : "saved";
          toast(`Part ${partIdx + 1}/${numParts} ${verb} — starting next part…`);
          await new Promise((r) => setTimeout(r, interPartPauseMs));
        }
      }
      toast(
        numParts > 1
          ? `All ${numParts} parts ${share ? "shared" : "saved"}.`
          : `Photos ZIP ${share ? "shared" : "saved"}.`
      );
      // Same as the PDF path: if the user is already in the receiving
      // app (Drive / Files / etc.), free dataUrls so iOS doesn't
      // reload the PWA when they come back.
      if (document.visibilityState === "hidden" && !memGuard.manualPause && memGuard.busyCount === 0) {
        unloadAllPhotoDataUrls();
        memGuard.unloaded = true;
      }
    } catch (err) {
      console.error(err);
      toast(err.message || "Failed to build photos ZIP.", "err");
    }
  }

  // -------------------- Wiring --------------------
  function wireMetaInputs() {
    const nameHandler = () => {
      state.property.name = els.metaName.value.trim() || "Untitled property";
      saveProperty();
    };
    els.metaName.addEventListener("input", nameHandler);
    const handler = () => {
      state.property.meta.assessor = els.metaAssessor.value.trim();
      state.property.meta.address = els.metaAddress.value.trim();
      state.property.meta.ref = els.metaRef.value.trim();
      state.property.meta.date = els.metaDate.value;
      saveProperty();
    };
    els.metaAssessor.addEventListener("input", handler);
    els.metaAddress.addEventListener("input", handler);
    els.metaRef.addEventListener("input", handler);
    els.metaDate.addEventListener("change", handler);

    if (els.metaHeader) {
      els.metaHeader.addEventListener("click", (e) => {
        // Don't collapse when the user is interacting with controls inside
        // the header (Delete property, the save-status badge, etc.).
        if (e.target.closest("button, input, select, a, [contenteditable='true']")) return;
        toggleMetaCollapsed();
      });
      els.metaHeader.addEventListener("keydown", (e) => {
        if (e.target !== els.metaHeader) return;
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          toggleMetaCollapsed();
        }
      });
    }

    if (els.totalsCard && els.totalsHeader) {
      // Default-collapsed; mirrors the rest of the accordions.
      els.totalsCard.classList.add("collapsed");
      els.totalsHeader.setAttribute("aria-expanded", "false");
      const toggleTotals = () => {
        const open = els.totalsCard.classList.toggle("collapsed");
        els.totalsHeader.setAttribute("aria-expanded", String(!open));
      };
      els.totalsHeader.addEventListener("click", toggleTotals);
      els.totalsHeader.addEventListener("keydown", (e) => {
        if (e.target !== els.totalsHeader) return;
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          toggleTotals();
        }
      });
    }
  }

  els.gpsBtn.addEventListener("click", enableGps);

  if (els.refreshBtn) {
    els.refreshBtn.addEventListener("click", async () => {
      // Flush any pending property save to IndexedDB before reloading so
      // in-flight edits (names, meta, collapse state) are not dropped.
      // Photos are saved per-capture already, so they don't need flushing.
      els.refreshBtn.disabled = true;
      try {
        if (state.property) {
          state.property.updatedAt = new Date().toISOString();
          await IDB.putProperty(state.property);
        }
      } catch (err) {
        console.warn("Pre-refresh save failed", err);
      }
      location.reload();
    });
  }

  // -------------------- Settings dialog --------------------
  function openSettingsDialog() {
    if (!els.settingsDialog) return;
    // Seed the fields from storage each time it opens.
    if (els.settingsApiKey) els.settingsApiKey.value = getClaudeApiKey();
    if (els.settingsModel) {
      if (!els.settingsModel.options.length) {
        for (const opt of CLAUDE_MODELS) {
          const o = document.createElement("option");
          o.value = opt.id;
          o.textContent = opt.label;
          els.settingsModel.appendChild(o);
        }
      }
      els.settingsModel.value = getClaudeModel();
    }
    if (els.settingsAutoTag) els.settingsAutoTag.checked = isAutoTagEnabled();
    els.settingsDialog.hidden = false;
    els.settingsDialog.setAttribute("aria-hidden", "false");
  }
  function closeSettingsDialog() {
    if (!els.settingsDialog) return;
    els.settingsDialog.hidden = true;
    els.settingsDialog.setAttribute("aria-hidden", "true");
  }
  if (els.settingsBtn) {
    els.settingsBtn.addEventListener("click", openSettingsDialog);
  }

  // -------------------- Auto-label dialog --------------------
  function openAutolabelDialog() {
    if (!els.autolabelDialog) return;
    els.autolabelDialog.hidden = false;
    els.autolabelDialog.setAttribute("aria-hidden", "false");
  }
  function closeAutolabelDialog() {
    if (!els.autolabelDialog) return;
    els.autolabelDialog.hidden = true;
    els.autolabelDialog.setAttribute("aria-hidden", "true");
  }
  if (els.autolabelBtn) {
    els.autolabelBtn.addEventListener("click", () => {
      if (!getClaudeApiKey()) {
        toast("Set a Claude API key in Settings first.", "err");
        openSettingsDialog();
        return;
      }
      openAutolabelDialog();
    });
  }
  if (els.autolabelCancelBtn) {
    els.autolabelCancelBtn.addEventListener("click", closeAutolabelDialog);
  }
  if (els.autolabelBackdrop) {
    els.autolabelBackdrop.addEventListener("click", closeAutolabelDialog);
  }
  if (els.autolabelRunBtn) {
    els.autolabelRunBtn.addEventListener("click", async () => {
      const scope = els.autolabelScope ? els.autolabelScope.value : "unlabelled";
      els.autolabelRunBtn.disabled = true;
      els.autolabelRunBtn.textContent = "Working…";
      try {
        closeAutolabelDialog();
        await runBulkLabel({ scope });
      } catch (err) {
        console.error(err);
        toast(err.message || "Auto-label failed.", "err");
      } finally {
        els.autolabelRunBtn.disabled = false;
        els.autolabelRunBtn.textContent = "Run";
      }
    });
  }
  if (els.bulkLabelCancelBtn) {
    els.bulkLabelCancelBtn.addEventListener("click", () => {
      if (!bulkLabelState.running) return;
      bulkLabelState.cancelRequested = true;
      els.bulkLabelCancelBtn.disabled = true;
      updateBulkLabelBanner("Cancelling…");
      // Re-enable on next tick so subsequent runs can use it.
      setTimeout(() => { els.bulkLabelCancelBtn.disabled = false; }, 1500);
    });
  }
  if (els.autotagRunBtn) {
    els.autotagRunBtn.addEventListener("click", async () => {
      const scope = els.autotagScope ? els.autotagScope.value : "untagged";
      els.autotagRunBtn.disabled = true;
      els.autotagRunBtn.textContent = "Working…";
      try {
        closeAutolabelDialog();
        await runBulkTag({ scope });
      } catch (err) {
        console.error(err);
        toast(err.message || "Auto-tag failed.", "err");
      } finally {
        els.autotagRunBtn.disabled = false;
        els.autotagRunBtn.textContent = "Run auto-tag";
      }
    });
  }
  if (els.settingsCancelBtn) {
    els.settingsCancelBtn.addEventListener("click", closeSettingsDialog);
  }
  if (els.settingsBackdrop) {
    els.settingsBackdrop.addEventListener("click", closeSettingsDialog);
  }
  if (els.settingsApiKeyToggle && els.settingsApiKey) {
    els.settingsApiKeyToggle.addEventListener("click", () => {
      const isPassword = els.settingsApiKey.type === "password";
      els.settingsApiKey.type = isPassword ? "text" : "password";
      els.settingsApiKeyToggle.textContent = isPassword ? "Hide" : "Show";
    });
  }
  if (els.settingsSaveBtn) {
    els.settingsSaveBtn.addEventListener("click", () => {
      const key = els.settingsApiKey ? els.settingsApiKey.value.trim() : "";
      const model = els.settingsModel ? els.settingsModel.value : DEFAULT_CLAUDE_MODEL;
      setClaudeApiKey(key);
      setClaudeModel(model);
      if (els.settingsAutoTag) setAutoTagEnabled(!!els.settingsAutoTag.checked);
      closeSettingsDialog();
      toast(key ? "Settings saved." : "API key cleared.");
      // Refresh the lightbox analyse button so the disabled state updates
      // if the user is currently inside the lightbox.
      refreshLightboxAnalysisUi();
    });
  }
  if (els.settingsTestBtn) {
    els.settingsTestBtn.addEventListener("click", async () => {
      const key = els.settingsApiKey ? els.settingsApiKey.value.trim() : "";
      if (!key) {
        toast("Enter an API key first.", "err");
        return;
      }
      els.settingsTestBtn.disabled = true;
      els.settingsTestBtn.textContent = "Testing…";
      try {
        const res = await fetch(CLAUDE_API_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true",
          },
          body: JSON.stringify({
            model: els.settingsModel ? els.settingsModel.value : DEFAULT_CLAUDE_MODEL,
            max_tokens: 8,
            messages: [{ role: "user", content: "hi" }],
          }),
        });
        if (res.ok) toast("API key works.");
        else if (res.status === 401) toast("Invalid API key.", "err");
        else toast(`API error (${res.status}).`, "err");
      } catch (_) {
        toast("Network error.", "err");
      } finally {
        els.settingsTestBtn.disabled = false;
        els.settingsTestBtn.textContent = "Test connection";
      }
    });
  }

  // -------------------- Lightbox: photo analysis --------------------
  function refreshLightboxAnalysisUi() {
    const photo = currentLightboxPhoto && currentLightboxPhoto();
    if (!photo) return;
    renderLightboxAnalyses(photo);
    if (els.lightboxAnalyseRun) {
      els.lightboxAnalyseRun.disabled = !getClaudeApiKey();
      els.lightboxAnalyseRun.title = els.lightboxAnalyseRun.disabled
        ? "Set a Claude API key in Settings first"
        : "";
    }
  }

  function renderLightboxAnalyses(photo) {
    if (!els.lightboxAnalyses) return;
    els.lightboxAnalyses.innerHTML = "";
    const list = Array.isArray(photo.analyses) ? photo.analyses : [];
    for (const entry of list) {
      els.lightboxAnalyses.appendChild(buildAnalysisCard(entry, photo, { editable: true }));
    }
  }

  function formatAnalysisField(key, value) {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value === "boolean") return value ? "Yes" : "No";
    return String(value);
  }

  function buildAnalysisCard(entry, photo, options) {
    const opts = options || {};
    const preset = getAnalysisPreset(entry.preset);
    const card = document.createElement("div");
    card.className = "analysis-card";
    card.dataset.analysisId = entry.id;
    const confidence = entry.data && entry.data.confidence;
    if (confidence) card.classList.add(`analysis-conf-${confidence}`);

    const header = document.createElement("div");
    header.className = "analysis-head";
    const title = document.createElement("span");
    title.className = "analysis-title";
    title.textContent = preset ? preset.label : entry.preset;
    header.appendChild(title);
    const modelTag = document.createElement("span");
    modelTag.className = "analysis-sub";
    const modelLabel = (CLAUDE_MODELS.find((m) => m.id === entry.model) || {}).label || entry.model;
    modelTag.textContent = modelLabel;
    header.appendChild(modelTag);
    if (confidence) {
      const confTag = document.createElement("span");
      confTag.className = `analysis-chip analysis-chip-${confidence}`;
      confTag.textContent = `${confidence} confidence`;
      header.appendChild(confTag);
    }
    if (opts.editable) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "analysis-remove";
      remove.title = "Remove this analysis";
      remove.setAttribute("aria-label", "Remove this analysis");
      remove.textContent = "×";
      remove.addEventListener("click", () => removeAnalysis(photo, entry.id));
      header.appendChild(remove);
    }
    card.appendChild(header);

    const dl = document.createElement("dl");
    dl.className = "analysis-fields";
    const data = entry.data || {};
    const friendlyKeys = {
      make: "Make",
      model: "Model",
      serial: "Serial",
      is_smart_meter: "Smart meter",
      smets_generation: "SMETS",
      is_export_capable: "Export capable",
      export_capability_source: "Basis",
      current_reading: "Reading",
      type: "Type",
      fuel: "Fuel",
      installed_year: "Installed",
      efficiency_rating: "Efficiency",
      output_kw: "Output (kW)",
      manual_url: "Manual",
    };
    // Keys whose value should render as a clickable link.
    const linkKeys = new Set(["manual_url"]);
    for (const key of Object.keys(friendlyKeys)) {
      if (!(key in data)) continue;
      const v = formatAnalysisField(key, data[key]);
      if (v == null) continue;
      const dt = document.createElement("dt");
      dt.textContent = friendlyKeys[key];
      const dd = document.createElement("dd");
      if (linkKeys.has(key) && typeof data[key] === "string" && /^https?:\/\//i.test(data[key])) {
        const a = document.createElement("a");
        a.href = data[key];
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = "Open ↗";
        a.className = "analysis-link";
        dd.appendChild(a);
      } else {
        dd.textContent = v;
      }
      dl.appendChild(dt);
      dl.appendChild(dd);
    }
    if (dl.childNodes.length) card.appendChild(dl);

    if (data.notes) {
      const notes = document.createElement("p");
      notes.className = "analysis-notes";
      notes.textContent = data.notes;
      card.appendChild(notes);
    }
    return card;
  }

  async function removeAnalysis(photo, analysisId) {
    if (!photo || !Array.isArray(photo.analyses)) return;
    const idx = photo.analyses.findIndex((a) => a.id === analysisId);
    if (idx === -1) return;
    photo.analyses.splice(idx, 1);
    try {
      await savePhotoNow(photo);
    } catch (err) {
      console.warn("Failed to save after analysis remove", err);
    }
    lightbox.dirty = true;
    renderLightboxAnalyses(photo);
    if (state.view === "analysis") renderGroups();
  }

  // Populate the preset dropdown. This wiring block runs once at boot,
  // so no idempotency guard is needed — and the HTML ships with a
  // single placeholder option, so an `options.length` check would skip
  // the append entirely.
  if (els.lightboxAnalysePreset) {
    for (const preset of ANALYSIS_PRESETS) {
      const o = document.createElement("option");
      o.value = preset.id;
      o.textContent = preset.label;
      els.lightboxAnalysePreset.appendChild(o);
    }
  }

  if (els.lightboxAnalyseRun) {
    els.lightboxAnalyseRun.addEventListener("click", async () => {
      const photo = currentLightboxPhoto();
      if (!photo) return;
      const presetId = els.lightboxAnalysePreset && els.lightboxAnalysePreset.value;
      if (!presetId) {
        toast("Pick what to analyse as first.", "err");
        return;
      }
      if (!getClaudeApiKey()) {
        toast("Set a Claude API key in Settings first.", "err");
        openSettingsDialog();
        return;
      }
      els.lightboxAnalyseRun.disabled = true;
      els.lightboxAnalyseRun.textContent = "Analysing…";
      try {
        const entry = await runPhotoAnalysis(photo, presetId);
        if (!Array.isArray(photo.analyses)) photo.analyses = [];
        photo.analyses.push(entry);
        await savePhotoNow(photo);
        lightbox.dirty = true;
        renderLightboxAnalyses(photo);
        toast(`${(getAnalysisPreset(presetId) || {}).label || "Analysis"} done.`);
        if (els.lightboxAnalysePreset) els.lightboxAnalysePreset.value = "";
        if (state.view === "analysis") renderGroups();
      } catch (err) {
        console.error(err);
        toast(err.message || "Analysis failed.", "err");
      } finally {
        els.lightboxAnalyseRun.disabled = !getClaudeApiKey();
        els.lightboxAnalyseRun.textContent = "Run analysis";
      }
    });
  }

  // Populate the "Add room" type selector once at boot.
  if (els.newRoomType) {
    for (const t of ROOM_TYPES) {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t;
      els.newRoomType.appendChild(opt);
    }
    // Default to Bedroom — most properties have several, so it's the
    // option the assessor is most likely to repeat.
    els.newRoomType.value = ROOM_TYPES.includes("Bedroom") ? "Bedroom" : DEFAULT_ROOM_TYPE;
  }
  if (els.addRoomBtn) {
    els.addRoomBtn.addEventListener("click", () => {
      if (!state.property) return;
      const type = (els.newRoomType && els.newRoomType.value) || DEFAULT_ROOM_TYPE;
      try {
        addRoomFromPreset(type);
      } catch (err) {
        console.error(err);
        toast("Couldn't add room.", "err");
      }
    });
  }

  for (const btn of els.viewToggleBtns) {
    btn.addEventListener("click", () => setView(btn.dataset.view));
  }

  els.exportBtn.addEventListener("click", () => {
    if (els.exportBtn.disabled) return;
    openPdfLayoutDialog();
  });

  els.pdfLayoutCancelBtn.addEventListener("click", closePdfLayoutDialog);
  els.pdfLayoutBackdrop.addEventListener("click", closePdfLayoutDialog);
  const pdfIncludeAnalysis = () =>
    !els.pdfIncludeAnalysis || els.pdfIncludeAnalysis.checked;
  const pdfShareWanted = () =>
    !!(els.pdfShare && !els.pdfShare.disabled && els.pdfShare.checked);
  // Reveal the share toggle on devices that can actually share files.
  // Default OFF — the share sheet path is opt-in; the regular download
  // route is well-tested and is what the user probably already trusts.
  if (canShareFiles() && els.pdfShareToggleWrap && els.pdfShare) {
    els.pdfShareToggleWrap.hidden = false;
    els.pdfShare.checked = false;
  }
  els.pdfLayoutGroupBtn.addEventListener("click", () => {
    const includeAnalysis = pdfIncludeAnalysis();
    const share = pdfShareWanted();
    closePdfLayoutDialog();
    exportPdf({ layout: "group", includeAnalysis, share });
  });
  els.pdfLayoutTagBtn.addEventListener("click", () => {
    const includeAnalysis = pdfIncludeAnalysis();
    const share = pdfShareWanted();
    closePdfLayoutDialog();
    exportPdf({ layout: "tag", includeAnalysis, share });
  });
  document.addEventListener("keydown", (e) => {
    if (!els.pdfLayoutDialog.hidden && e.key === "Escape") {
      e.preventDefault();
      closePdfLayoutDialog();
    }
  });

  els.exportPhotosBtn.addEventListener("click", () => {
    if (els.exportPhotosBtn.disabled) return;
    openExportPhotosDialog();
  });
  if (els.originalsPartsCancelBtn) {
    els.originalsPartsCancelBtn.addEventListener("click", () => {
      if (!confirm("Clear the saved parts plan? Saved parts stay where you put them — only the in-app progress is cleared.")) return;
      clearOriginalsPlan();
      closeOriginalsPartsDialog();
    });
  }
  if (els.originalsPartsBackdrop) {
    els.originalsPartsBackdrop.addEventListener("click", closeOriginalsPartsDialog);
  }
  els.exportPhotosCancelBtn.addEventListener("click", closeExportPhotosDialog);
  els.exportPhotosBackdrop.addEventListener("click", closeExportPhotosDialog);
  const exportShareWanted = () =>
    !!(els.exportShare && !els.exportShare.disabled && els.exportShare.checked);
  if (canShareFiles() && els.exportShareToggleWrap && els.exportShare) {
    els.exportShareToggleWrap.hidden = false;
    els.exportShare.checked = false;
  }
  els.exportPhotosShareBtn.addEventListener("click", () => {
    // Keep synchronous up to navigator.share() so iOS grants the gesture.
    closeExportPhotosDialog();
    exportPhotosShareNow();
  });
  els.exportPhotosZipBtn.addEventListener("click", () => {
    const share = exportShareWanted();
    closeExportPhotosDialog();
    exportPhotosAsZip({ compress: true, share });
  });
  if (els.exportPhotosZipOriginalBtn) {
    els.exportPhotosZipOriginalBtn.addEventListener("click", () => {
      const share = exportShareWanted();
      closeExportPhotosDialog();
      exportPhotosAsZip({ compress: false, share });
    });
  }
  document.addEventListener("keydown", (e) => {
    if (!els.exportPhotosDialog.hidden && e.key === "Escape") {
      e.preventDefault();
      closeExportPhotosDialog();
    }
  });

  els.propSelect.addEventListener("change", () => {
    const id = els.propSelect.value;
    if (id && id !== state.currentId) switchProperty(id);
  });

  els.newPropBtn.addEventListener("click", async () => {
    const name = prompt("Name for the new property (e.g. address or reference):", "");
    if (name === null) return;
    await createProperty(name.trim() || null);
    toast("New property created.");
  });

  els.delPropBtn.addEventListener("click", () => {
    deleteCurrentProperty().catch((err) => {
      console.error(err);
      toast("Failed to delete property.", "err");
    });
  });

  // Flush pending save if the user closes the tab mid-debounce
  window.addEventListener("beforeunload", () => {
    if (state.property) {
      try {
        IDB.putProperty(state.property);
      } catch (_) {
        /* noop */
      }
    }
  });

  wireMetaInputs();

  // Activate the iOS-friendly memory guard: drop photo dataUrls on
  // visibilitychange:hidden, re-load on visible. Keeps the resident
  // memory low while the PWA is backgrounded so iOS doesn't reload us.
  setupVisibilityMemoryGuard();

  // -------------------- Close-all FAB --------------------
  // Floating pill that appears whenever at least one accordion is open
  // and the user has scrolled below the top of the page. A tap
  // collapses every expanded card — Job details, all flat groups, and
  // all rooms — without changing the scroll position. The simple
  // "any-open + scrollY > 120" rule sidesteps iOS PWA scroll-event
  // quirks that made the previous per-card detection unreliable.
  (function wireCollapseFab() {
    const fab = document.getElementById("collapse-fab");
    if (!fab) return;

    const anyExpanded = () =>
      !!document.querySelector(
        ".card.meta:not(.collapsed), .card.totals-card:not(.collapsed), .card.group:not(.collapsed), .card.room:not(.collapsed)"
      );

    const scrolledPast = () => {
      // window.scrollY isn't always populated instantly on iOS PWAs;
      // fall back to documentElement / body scrollTop too.
      const y =
        window.scrollY ||
        window.pageYOffset ||
        (document.documentElement && document.documentElement.scrollTop) ||
        (document.body && document.body.scrollTop) ||
        0;
      return y > 120;
    };

    const update = () => {
      const show = anyExpanded() && scrolledPast();
      fab.hidden = !show;
    };

    let ticking = false;
    const scheduleUpdate = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        update();
        ticking = false;
      });
    };
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    // Also react when an accordion is toggled from anywhere in the app.
    document.addEventListener("click", scheduleUpdate, true);
    // iOS PWA sometimes fires scroll events on document instead of window.
    document.addEventListener("scroll", scheduleUpdate, { passive: true, capture: true });

    const collapseAll = () => {
      // Meta card (Job details).
      const metaCard = document.getElementById("meta-card");
      if (metaCard && !metaCard.classList.contains("collapsed")) {
        const header = metaCard.querySelector(".meta-header");
        if (header) header.click();
      }
      // Totals card.
      const totalsCard = document.getElementById("totals-card");
      if (totalsCard && !totalsCard.classList.contains("collapsed")) {
        const header = totalsCard.querySelector(".totals-header");
        if (header) header.click();
      }
      // Flat groups — click each open group's header.
      document
        .querySelectorAll(".card.group:not(.collapsed)")
        .forEach((node) => {
          const header = node.querySelector(":scope > .group-header");
          if (header) header.click();
        });
      // Rooms — same, but on .room-header.
      document
        .querySelectorAll(".card.room:not(.collapsed)")
        .forEach((node) => {
          const header = node.querySelector(":scope > .room-header");
          if (header) header.click();
        });
    };

    fab.addEventListener("click", () => {
      collapseAll();
      // Hide straight away — no scroll-to-top so the user keeps their
      // place on the page.
      fab.hidden = true;
    });

    // Kick a first check in case the user reloads mid-scroll.
    scheduleUpdate();
  })();

  // -------------------- Boot --------------------
  const GPS_INTRO_KEY = "retrofit-photos:gps-intro-seen";

  async function autoRequestGps() {
    if (!("geolocation" in navigator)) {
      setGpsStatus("err", "No GPS support");
      return;
    }
    let state_perm = null;
    if (navigator.permissions && navigator.permissions.query) {
      try {
        const res = await navigator.permissions.query({ name: "geolocation" });
        state_perm = res.state;
      } catch (_) {
        /* ignore */
      }
    }
    if (state_perm === "denied") {
      // Don't block boot with an alert — the header dot shows it's off
      // and the Enable GPS button can be tapped to retry.
      setGpsStatus("err", "GPS off");
      return;
    }
    if (state_perm !== "granted" && !localStorage.getItem(GPS_INTRO_KEY)) {
      // One-off, non-blocking nudge the very first time the user opens
      // the app. A toast instead of alert() so the main thread keeps
      // running — important on iOS PWAs where a blocking modal during
      // heavy work can contribute to the tab being reclaimed.
      toast("GPS will stamp each photo — allow when prompted.");
      localStorage.setItem(GPS_INTRO_KEY, "1");
    }
    enableGps();
  }

  // One-time import: if a previous build of this app (or the original
  // photo-evidence app on the same origin) left data in the legacy
  // "photo-evidence" IndexedDB, copy it into our namespaced DB on first
  // load so users don't appear to lose their properties. The flag is kept
  // in localStorage so the import runs at most once per browser.
  const LEGACY_IMPORT_FLAG = "retrofit-photos:legacy-import-done";
  const LEGACY_DB = "photo-evidence";

  async function importFromLegacyIfNeeded() {
    if (typeof indexedDB === "undefined") return;
    if (localStorage.getItem(LEGACY_IMPORT_FLAG)) return;
    // Only attempt the import if the legacy DB actually exists. Newer
    // browsers expose indexedDB.databases(); older ones don't, in which
    // case we just try to open it — an empty DB won't yield rows.
    let legacyExists = true;
    if (typeof indexedDB.databases === "function") {
      try {
        const dbs = await indexedDB.databases();
        legacyExists = dbs.some((d) => d.name === LEGACY_DB);
      } catch (_) {
        legacyExists = true;
      }
    }
    if (!legacyExists) {
      localStorage.setItem(LEGACY_IMPORT_FLAG, "1");
      return;
    }
    try {
      const legacy = await new Promise((resolve, reject) => {
        const req = indexedDB.open(LEGACY_DB);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        // If the legacy DB doesn't exist, onupgradeneeded fires and we
        // immediately bail out so we don't accidentally create it here.
        req.onupgradeneeded = () => {
          try { req.transaction.abort(); } catch (_) {}
          resolve(null);
        };
      });
      if (!legacy) {
        localStorage.setItem(LEGACY_IMPORT_FLAG, "1");
        return;
      }
      if (!legacy.objectStoreNames.contains("properties")) {
        legacy.close();
        localStorage.setItem(LEGACY_IMPORT_FLAG, "1");
        return;
      }
      const properties = await new Promise((resolve, reject) => {
        const tx = legacy.transaction("properties", "readonly");
        const r = tx.objectStore("properties").getAll();
        r.onsuccess = () => resolve(r.result || []);
        r.onerror = () => reject(r.error);
      });
      const photos = legacy.objectStoreNames.contains("photos")
        ? await new Promise((resolve, reject) => {
            const tx = legacy.transaction("photos", "readonly");
            const r = tx.objectStore("photos").getAll();
            r.onsuccess = () => resolve(r.result || []);
            r.onerror = () => reject(r.error);
          })
        : [];
      legacy.close();
      if (!properties.length && !photos.length) {
        localStorage.setItem(LEGACY_IMPORT_FLAG, "1");
        return;
      }
      const existing = await IDB.listProperties();
      const existingIds = new Set(existing.map((p) => p.id));
      let copiedProps = 0;
      let copiedPhotos = 0;
      for (const prop of properties) {
        if (existingIds.has(prop.id)) continue;
        await IDB.putProperty(prop);
        copiedProps += 1;
      }
      for (const photo of photos) {
        await IDB.putPhoto(photo);
        copiedPhotos += 1;
      }
      localStorage.setItem(LEGACY_IMPORT_FLAG, "1");
      if (copiedProps) {
        toast(`Imported ${copiedProps} propert${copiedProps === 1 ? "y" : "ies"} from the previous app.`);
      }
    } catch (err) {
      console.warn("Legacy import skipped:", err);
      // Don't set the flag so we can try again on the next load.
    }
  }

  (async function boot() {
    try {
      await importFromLegacyIfNeeded();
      const list = await IDB.listProperties();
      list.sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
      state.properties = list.map((p) => ({ id: p.id, name: p.name }));

      if (!list.length) {
        await createProperty("Property 1");
      } else {
        const savedId = localStorage.getItem(ACTIVE_KEY);
        const chosen = list.find((p) => p.id === savedId) || list[0];
        await switchProperty(chosen.id);
      }
    } catch (err) {
      console.error(err);
      toast("Couldn't load saved data — starting fresh.", "err");
      state.property = makeNewProperty("Property 1");
      state.properties = [{ id: state.property.id, name: state.property.name }];
      state.currentId = state.property.id;
      initExpandedForProperty();
      renderMeta();
      renderRooms();
      renderGroups();
      renderPropertySelect();
    }
    autoRequestGps();
  })();
})();
