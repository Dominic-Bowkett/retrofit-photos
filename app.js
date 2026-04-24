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
    "renewables": "Other",
    "mains heating": "Heating",
    "secondary heating": "Heating",
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
    "Kitchen",
    "Utility Room",
    "Bedroom",
    "Bathroom",
    "WC",
    "Other",
  ];
  const DEFAULT_ROOM_TYPE = "Living Room";
  const HABITABILITY_OPTIONS = ["Habitable", "Non Habitable", "Wet Room"];
  const DEFAULT_HABITABILITY_BY_TYPE = {
    "Living Room": "Habitable",
    "Dining Room": "Habitable",
    "Kitchen": "Habitable",
    "Utility Room": "Non Habitable",
    "Bedroom": "Habitable",
    "Bathroom": "Wet Room",
    "WC": "Wet Room",
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
    "Ventilation",
    "Meters",
    "Other",
  ];
  const NO_ROOM_TAG = "";
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
      setGpsStatus("ok", `GPS on (±${Math.round(pos.coords.accuracy)}m)`);
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
      photoIds: [],
    };
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

  function totalPhotoCount() {
    let n = 0;
    for (const { group } of allPhotoGroups()) n += group.photoIds.length;
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

    initExpandedForProperty();
    renderMeta();
    renderRooms();
    renderGroups();
    renderPropertySelect();
    updateExportButton();
    setSaveStatus("saved");
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
    state.expanded.clear();
    if (state.view === "tag") {
      for (const t of BUILDING_TAGS) state.expanded.add(tagGroupId(t));
    } else {
      const ext = (state.property.groups || []).find(
        (g) => !g.section && (g.name || "").toLowerCase() === "external elevations"
      );
      if (ext) state.expanded.add(ext.id);
    }
  }

  function tagGroupId(tag) {
    return `tag-${tag}`;
  }

  function photoBuildingOf(photo) {
    return BUILDING_TAGS.includes(photo.building) ? photo.building : DEFAULT_BUILDING;
  }

  function setView(view) {
    if (view !== "group" && view !== "tag" && view !== "defects") return;
    if (state.view === view) return;
    state.view = view;
    document.body.classList.toggle("view-defects", view === "defects");
    document.body.classList.toggle("view-tag", view === "tag");
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
    } else {
      for (const group of state.property.groups) {
        renderGroup(group, els.groups);
      }
    }
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
    // Bucket every photo by its building tag, tracking the originating group
    // so the thumb can still show a hint and delete/reorder correctly. Room
    // sub-group photos are included too; their source carries a display name
    // that prefixes the room for clarity.
    const buckets = new Map();
    for (const t of BUILDING_TAGS) buckets.set(t, []);
    for (const group of state.property.groups) {
      for (const pid of group.photoIds) {
        const photo = state.photos.get(pid);
        if (!photo) continue;
        buckets.get(photoBuildingOf(photo)).push({ group, photo });
      }
    }
    for (const room of state.property.rooms || []) {
      for (const pid of room.photoIds || []) {
        const photo = state.photos.get(pid);
        if (!photo) continue;
        const displayGroup = {
          id: room.id,
          name: room.name,
          photoIds: room.photoIds,
        };
        buckets.get(photoBuildingOf(photo)).push({ group: displayGroup, photo });
      }
    }
    for (const tag of BUILDING_TAGS) {
      const entries = buckets.get(tag);
      if (!entries.length) continue;
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
      return;
    }
    for (const room of rooms) renderRoom(room);
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
    });

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
    if (!Array.isArray(state.property.rooms)) state.property.rooms = [];
    state.property.rooms.push(room);
    state.expanded.add(room.id);
    renderRooms();
    updateExportButton();
    saveProperty();
    const el = document.querySelector(`[data-room-id="${room.id}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
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
      `[data-room-id="${room.id}"] .room-count`
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
    for (const file of imageFiles) {
      try {
        const photo = await processUploadedFile(file);
        photo.propertyId = state.property.id;
        photo.label = `${group.name} — ${group.photoIds.length + 1}`;
        state.photos.set(photo.id, photo);
        group.photoIds.push(photo.id);
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
  (function wireLightboxSwipe() {
    const stage = document.querySelector(".lightbox-stage");
    if (!stage) return;
    let startX = 0;
    let startY = 0;
    let active = false;
    stage.addEventListener("touchstart", (e) => {
      if (!e.touches || e.touches.length !== 1) {
        active = false;
        return;
      }
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      active = true;
    }, { passive: true });
    stage.addEventListener("touchend", (e) => {
      if (!active) return;
      active = false;
      const t = e.changedTouches && e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      // Require a clear horizontal swipe so taps and vertical scrolls
      // don't trigger navigation.
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        stepLightbox(dx > 0 ? -1 : 1);
      }
    });
    // Cancel tracking if the gesture is interrupted (e.g. a call).
    stage.addEventListener("touchcancel", () => { active = false; });
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

    if (save && camera.buffer.length && camera.group) {
      commitBufferedPhotos(camera.group, camera.buffer);
    }
    camera.buffer = [];
    camera.group = null;
    renderCameraBuffer();
    updateCameraCount();
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

  async function buildPdf(options = {}) {
    const photoPaths = options.photoPaths instanceof Map ? options.photoPaths : null;
    const layout = options.layout === "tag" ? "tag" : "group";
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
      const buckets = new Map();
      for (const t of BUILDING_TAGS) buckets.set(t, []);
      for (const g of state.property.groups) {
        for (const pid of g.photoIds) {
          const photo = state.photos.get(pid);
          if (!photo) continue;
          buckets.get(photoBuildingOf(photo)).push({ photo, source: g });
        }
      }
      for (const room of state.property.rooms || []) {
        for (const pid of room.photoIds || []) {
          const photo = state.photos.get(pid);
          if (!photo) continue;
          buckets.get(photoBuildingOf(photo)).push({
            photo,
            source: { id: room.id, name: room.name },
          });
        }
      }
      groupsWithPhotos = [];
      for (const tag of BUILDING_TAGS) {
        const entries = buckets.get(tag);
        if (!entries.length) continue;
        groupsWithPhotos.push({
          id: tagGroupId(tag),
          name: tag,
          photoIds: entries.map((e) => e.photo.id),
          virtual: true,
          entries,
        });
      }
    } else {
      groupsWithPhotos = state.property.groups.filter((g) => g.photoIds.length > 0);
      for (const room of state.property.rooms || []) {
        if (!(room.photoIds || []).length) continue;
        groupsWithPhotos.push({
          id: `room-${room.id}`,
          name: `${room.name} (${room.habitability})`,
          photoIds: room.photoIds.slice(),
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

        cursorY += drawH + capH + 18;

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
    try {
      const { doc, filename } = await buildPdf({ layout });
      doc.save(filename);
      toast(`PDF saved (${layout === "tag" ? "by tag" : "by group"}).`);
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
      photoData[photo.id] = {
        src: path,
        label: photo.label || "",
        building: photoBuildingOf(photo),
        roomTag: photo.roomTag || "",
        defect: !!photo.defect,
        source: sourceName,
        dateStr: takenIso ? new Date(takenIso).toLocaleString() : "",
        gpsText: photo.gps ? formatGps(photo.gps) : "",
        uploaded: photo.source === "upload",
      };
      return { id: photo.id };
    };

    for (const g of state.property.groups || []) {
      const entries = (g.photoIds || [])
        .map((pid) => {
          const p = state.photos.get(pid);
          return p ? addPhoto(p, g.name) : null;
        })
        .filter(Boolean);
      pushSection(`g-${g.id}`, g.name, g, entries);
    }
    for (const room of state.property.rooms || []) {
      const entries = (room.photoIds || [])
        .map((pid) => {
          const p = state.photos.get(pid);
          return p ? addPhoto(p, `${room.name} (${room.habitability})`) : null;
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
html,body{margin:0;padding:0;height:100%;background:#0f0f0f;color:#f4f2ed;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;font-size:15px;line-height:1.45;-webkit-font-smoothing:antialiased;overflow:hidden}
body{display:flex;flex-direction:column}
.app{position:fixed;inset:0;display:grid;grid-template-columns:280px 1fr;grid-template-rows:auto 1fr;grid-template-areas:"sidebar stage" "sidebar filmstrip";background:#0f0f0f}
.sidebar{grid-area:sidebar;background:#161616;border-right:1px solid #262626;display:flex;flex-direction:column;min-height:0;overflow:hidden}
.sidebar-top{padding:16px 18px 12px;padding-top:calc(16px + env(safe-area-inset-top));border-bottom:1px solid #262626}
.sidebar-top h1{margin:0;font-size:1.05rem;color:#f59e0b;font-weight:700;letter-spacing:0.2px}
.sidebar-top dl{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;margin:10px 0 0;font-size:0.78rem;color:#b9b4ab}
.sidebar-top dt{font-weight:600;color:#8e8a82}
.sidebar-top dd{margin:0}
.sections{flex:1 1 auto;overflow-y:auto;padding:8px 10px}
.section-head{margin:14px 0 6px;padding:0 8px;font-size:0.7rem;color:#7a7670;font-weight:700;letter-spacing:0.6px;text-transform:uppercase}
.section-head:first-child{margin-top:4px}
.section-item{width:100%;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 10px;border-radius:8px;border:1px solid transparent;background:transparent;color:#e2ddd3;font:inherit;font-size:0.9rem;cursor:pointer;text-align:left}
.section-item:hover{background:#1f1f1f}
.section-item.is-active{background:#2b2410;border-color:#f59e0b;color:#f59e0b}
.section-item .count{color:#7a7670;font-size:0.78rem;font-weight:600}
.section-item.is-active .count{color:#f59e0b}
.section-item.is-danger .count{color:#ff8a8a}
.section-item.is-danger.is-active{background:#3a1515;border-color:#ff6b6b;color:#ff6b6b}
.stage{grid-area:stage;position:relative;display:flex;align-items:center;justify-content:center;min-height:0;padding:20px;background:radial-gradient(ellipse at center,#1b1b1b 0%,#0f0f0f 80%)}
.stage-img-wrap{position:relative;width:100%;height:100%;display:flex;align-items:center;justify-content:center}
.main-img{max-width:100%;max-height:100%;object-fit:contain;border-radius:4px;background:#000;box-shadow:0 12px 60px rgba(0,0,0,0.6)}
.stage-empty{color:#7a7670;font-size:0.95rem;text-align:center}
.nav-btn{position:absolute;top:50%;transform:translateY(-50%);background:rgba(255,255,255,0.1);color:#fff;border:1px solid rgba(255,255,255,0.18);width:48px;height:48px;border-radius:999px;font-size:1.8rem;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);z-index:5}
.nav-btn:hover{background:rgba(255,255,255,0.18)}
.nav-btn:disabled{opacity:0.25;cursor:not-allowed}
.prev{left:18px}
.next{right:18px}
.badges{position:absolute;top:18px;left:18px;display:flex;gap:6px;flex-wrap:wrap;max-width:calc(100% - 36px);z-index:4}
.badge{display:inline-flex;align-items:center;padding:4px 10px;border-radius:999px;font-size:0.72rem;font-weight:700;letter-spacing:0.3px;background:rgba(0,0,0,0.55);color:#fff;border:1px solid rgba(255,255,255,0.15);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
.badge-defect{background:rgba(178,45,45,0.35);color:#ffd4d4;border-color:rgba(255,107,107,0.55)}
.badge-tag{background:rgba(245,158,11,0.2);color:#f8c464;border-color:rgba(245,158,11,0.45)}
.badge-building{background:rgba(255,255,255,0.12);color:#fff}
.caption{position:absolute;bottom:18px;left:50%;transform:translateX(-50%);padding:8px 14px;border-radius:10px;background:rgba(0,0,0,0.55);color:#e7e3db;font-size:0.82rem;max-width:90%;text-align:center;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);z-index:4}
.caption .counter{color:#9a948a;margin-left:8px;font-weight:600}
.filmstrip{grid-area:filmstrip;display:flex;gap:6px;padding:10px 14px calc(10px + env(safe-area-inset-bottom));background:#121212;border-top:1px solid #262626;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x proximity;scrollbar-width:thin;scrollbar-color:#2f2f2f #121212}
.filmstrip::-webkit-scrollbar{height:8px}
.filmstrip::-webkit-scrollbar-thumb{background:#2f2f2f;border-radius:999px}
.film-thumb{flex:0 0 auto;width:88px;height:66px;padding:0;border:2px solid transparent;border-radius:6px;background:#000;cursor:pointer;overflow:hidden;position:relative;scroll-snap-align:center;transition:border-color 0.15s ease}
.film-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.film-thumb:hover{border-color:#4a4a4a}
.film-thumb.is-active{border-color:#f59e0b;box-shadow:0 0 0 2px rgba(245,158,11,0.25)}
.film-thumb.has-defect::after{content:"";position:absolute;top:4px;right:4px;width:8px;height:8px;border-radius:50%;background:#ff6b6b;box-shadow:0 0 0 2px rgba(0,0,0,0.6)}
.sidebar-toggle{position:absolute;top:calc(12px + env(safe-area-inset-top));left:12px;width:40px;height:40px;border-radius:999px;background:rgba(0,0,0,0.55);color:#fff;border:1px solid rgba(255,255,255,0.2);font-size:1.1rem;cursor:pointer;z-index:30;display:none;align-items:center;justify-content:center;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
.sidebar-toggle.show{display:flex}
@media (max-width:900px){
  .app{grid-template-columns:1fr;grid-template-areas:"stage" "filmstrip"}
  .sidebar{position:absolute;top:0;bottom:0;left:0;width:84%;max-width:320px;transform:translateX(-100%);transition:transform 0.22s ease;z-index:20;box-shadow:0 0 40px rgba(0,0,0,0.6)}
  body.sidebar-open .sidebar{transform:translateX(0)}
  body.sidebar-open::before{content:"";position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:15}
  .sidebar-toggle{display:flex}
  .stage{padding:56px 10px 10px}
  .nav-btn{width:42px;height:42px;font-size:1.5rem}
  .prev{left:10px}
  .next{right:10px}
  .badges{top:54px;left:10px}
  .caption{bottom:10px}
}
@media (max-width:520px){
  .film-thumb{width:68px;height:52px}
  .filmstrip{padding:8px 10px calc(8px + env(safe-area-inset-bottom))}
}
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
    var sections = DATA.groups.filter(function (g) { return g.photoIds.length > 0; });
    if (sections.length) {
      el.sections.appendChild(header("By room / group"));
      for (var k = 0; k < sections.length; k++) {
        var g = sections[k];
        el.sections.appendChild(itemBtn({ id: g.id, name: g.name, count: g.photoIds.length, kind: "group" }));
      }
    }
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

    el.prev.disabled = state.idx === 0;
    el.next.disabled = state.idx === state.photoIds.length - 1;
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
    el.sections = $(".sections");
    el.stage = $(".stage");
    el.imgWrap = $(".stage-img-wrap");
    el.img = $(".main-img");
    el.caption = $(".caption");
    el.badges = $(".badges");
    el.filmstrip = $(".filmstrip");
    el.prev = $(".prev");
    el.next = $(".next");

    el.prev.addEventListener("click", function () { step(-1); });
    el.next.addEventListener("click", function () { step(1); });
    $(".sidebar-toggle").addEventListener("click", function () { document.body.classList.toggle("sidebar-open"); });

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
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
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
  <button class="sidebar-toggle show" type="button" aria-label="Open filters">☰</button>
  <div class="stage">
    <button class="nav-btn prev" type="button" aria-label="Previous">&#x2039;</button>
    <div class="stage-img-wrap"><img class="main-img" alt=""></div>
    <button class="nav-btn next" type="button" aria-label="Next">&#x203A;</button>
    <div class="badges"></div>
    <div class="caption"></div>
  </div>
  <div class="filmstrip" aria-label="Photo filmstrip"></div>
</div>
<script>${js.replace("__VIEWER_DATA__", dataJson)}</script>
</body>
</html>`;
  }

  async function exportPhotosAsZip(options = {}) {
    // compress:true  — re-encode each photo on its way into the ZIP (iOS
    //   friendly; recommended for properties with 150+ photos).
    // compress:false — zip the stored dataUrl bytes verbatim so each
    //   photo is at its captured fidelity. The originals path is split
    //   into multiple ZIPs of at most ORIGINALS_CHUNK photos so iOS
    //   doesn't blow its memory ceiling on a single huge archive.
    const compress = options.compress !== false;
    const ORIGINALS_CHUNK = 100;
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
        if (!photo) continue;
        idx += 1;
        walkItems.push({ group: g, room: null, photo, indexInGroup: idx });
      }
    }
    for (const room of state.property.rooms || []) {
      let idx = 0;
      for (const pid of room.photoIds || []) {
        const photo = state.photos.get(pid);
        if (!photo) continue;
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
          const bytes = dataUrlToBytes(dataUrl);
          dataUrl = null;
          const stamp = photo.takenAt || photo.uploadedAt || new Date().toISOString();
          const defectPrefix = photo.defect ? "DEFECT_" : "";
          const tagPrefix = room && photo.roomTag ? `${slugify(photo.roomTag)}_` : "";
          const labelSlug = slugify(photo.label || `${group.name}-${indexInGroup}`);
          const name = `${defectPrefix}${tagPrefix}${String(indexInGroup).padStart(2, "0")}_${labelSlug}.jpg`;
          folder.file(name, bytes, { date: new Date(stamp) });
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
        const zipBlob = await zip.generateAsync({ type: "blob", compression: "STORE" });
        let suffix;
        if (compress) {
          suffix = "_photos.zip";
        } else if (numParts > 1) {
          suffix = `_photos_originals_part${partIdx + 1}_of_${numParts}.zip`;
        } else {
          suffix = "_photos_originals.zip";
        }
        saveBlob(zipBlob, `${reportBaseName()}${suffix}`);
        // Give the browser a moment between downloads. iOS in particular
        // can drop subsequent anchor clicks if they come back-to-back.
        if (partIdx < numParts - 1) {
          toast(`Part ${partIdx + 1}/${numParts} saved — starting next part…`);
          await new Promise((r) => setTimeout(r, 800));
        }
      }
      toast(
        numParts > 1
          ? `All ${numParts} parts saved.`
          : "Photos ZIP saved."
      );
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

  // Populate the "Add room" type selector once at boot.
  if (els.newRoomType) {
    for (const t of ROOM_TYPES) {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t;
      els.newRoomType.appendChild(opt);
    }
    els.newRoomType.value = DEFAULT_ROOM_TYPE;
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
  els.pdfLayoutGroupBtn.addEventListener("click", () => {
    closePdfLayoutDialog();
    exportPdf({ layout: "group" });
  });
  els.pdfLayoutTagBtn.addEventListener("click", () => {
    closePdfLayoutDialog();
    exportPdf({ layout: "tag" });
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
  els.exportPhotosCancelBtn.addEventListener("click", closeExportPhotosDialog);
  els.exportPhotosBackdrop.addEventListener("click", closeExportPhotosDialog);
  els.exportPhotosShareBtn.addEventListener("click", () => {
    // Keep synchronous up to navigator.share() so iOS grants the gesture.
    closeExportPhotosDialog();
    exportPhotosShareNow();
  });
  els.exportPhotosZipBtn.addEventListener("click", () => {
    closeExportPhotosDialog();
    exportPhotosAsZip({ compress: true });
  });
  if (els.exportPhotosZipOriginalBtn) {
    els.exportPhotosZipOriginalBtn.addEventListener("click", () => {
      closeExportPhotosDialog();
      exportPhotosAsZip({ compress: false });
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

  // -------------------- Close-section FAB --------------------
  // Floating pill that appears once the user has scrolled past the top
  // of an expanded accordion (Job details, a flat group, or a room). A
  // tap collapses that card and jumps the viewport back to its header,
  // saving the scroll back up through a long section.
  (function wireCollapseFab() {
    const fab = document.getElementById("collapse-fab");
    if (!fab) return;
    let currentHeader = null;
    let currentCard = null;

    const findExpanded = () => {
      const candidates = [
        ...document.querySelectorAll(".card.meta:not(.collapsed) .meta-header"),
        ...document.querySelectorAll(".card.group:not(.collapsed) > .group-header"),
        ...document.querySelectorAll(".card.room:not(.collapsed) > .room-header"),
      ];
      const pad = 10;
      const viewportTop = pad;
      let best = null;
      for (const header of candidates) {
        const card = header.closest(".card");
        if (!card) continue;
        const rect = card.getBoundingClientRect();
        // User is scrolled past the header (it's above the viewport top)
        // AND the card's body still extends below the viewport top —
        // i.e. they are "inside" this section.
        if (rect.top < viewportTop && rect.bottom > viewportTop + 60) {
          if (!best || rect.top > best.rect.top) {
            best = { header, card, rect };
          }
        }
      }
      return best;
    };

    const update = () => {
      const hit = findExpanded();
      if (!hit) {
        currentHeader = null;
        currentCard = null;
        fab.hidden = true;
        return;
      }
      currentHeader = hit.header;
      currentCard = hit.card;
      fab.hidden = false;
    };

    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        update();
        ticking = false;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", update);

    fab.addEventListener("click", () => {
      if (!currentHeader || !currentCard) return;
      const card = currentCard;
      currentHeader.click();
      // Land the collapsed card back in view so the user sees it close.
      if (card && typeof card.scrollIntoView === "function") {
        card.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      update();
    });
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
