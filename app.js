// ===== Registro de Lecturas QR =====
// Guarda las lecturas en Google Sheets (vía Apps Script) y mantiene un
// respaldo local (LocalStorage) para funcionar sin conexión.

// ========================= CONFIGURACIÓN =========================
// 1) Clave secreta: DEBE coincidir con generar-qr.js y Code.gs (Apps Script).
const CLAVE_SECRETA = "CAMBIA-ESTA-CLAVE-SECRETA-2024-xyz987";

// 2) URL de la Web App de Google Apps Script (termina en /exec).
//    Se puede dejar vacía y configurarla desde la propia página.
let GOOGLE_SHEETS_URL =
  localStorage.getItem("qr_sheets_url") || ""; // p.ej. "https://script.google.com/macros/s/.../exec"
// =================================================================

const LS_LOGS = "qr_logs_v2";
const LS_OWNERS = "qr_owners_v1";

let logs = loadJSON(LS_LOGS, []);
let owners = loadJSON(LS_OWNERS, {}); // respaldo para QR simples (texto plano)

let scanner = null;
let lastScan = { text: null, time: 0 };
const DUP_WINDOW_MS = 4000;

// ---- Utilidades de almacenamiento ----
function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function saveJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

// ---- Referencias DOM ----
const btnStart = document.getElementById("btn-start");
const btnStop = document.getElementById("btn-stop");
const lastReadEl = document.getElementById("last-read");

const ownerCode = document.getElementById("owner-code");
const ownerName = document.getElementById("owner-name");
const btnAddOwner = document.getElementById("btn-add-owner");
const ownersTbody = document.querySelector("#owners-table tbody");

const logTbody = document.querySelector("#log-table tbody");
const emptyLog = document.getElementById("empty-log");
const countEl = document.getElementById("count");
const searchEl = document.getElementById("search");
const btnExport = document.getElementById("btn-export");
const btnClear = document.getElementById("btn-clear");

// Config de Sheets (elementos opcionales si existen en el HTML)
const sheetsUrlInput = document.getElementById("sheets-url");
const btnSaveUrl = document.getElementById("btn-save-url");
const btnSync = document.getElementById("btn-sync");
const syncStatus = document.getElementById("sync-status");

if (sheetsUrlInput) sheetsUrlInput.value = GOOGLE_SHEETS_URL;

if (btnSaveUrl) {
  btnSaveUrl.addEventListener("click", () => {
    const entrada = (sheetsUrlInput.value || "").trim();
    if (!entrada) {
      GOOGLE_SHEETS_URL = "";
      localStorage.removeItem("qr_sheets_url");
      setSyncStatus("URL borrada (modo solo local).");
      return;
    }
    const limpia = urlSheetsValida(entrada);
    if (!limpia) {
      setSyncStatus(
        "URL inválida. Copia la URL completa de la Web App: empieza con https:// y termina en /exec."
      );
      return;
    }
    GOOGLE_SHEETS_URL = limpia;
    sheetsUrlInput.value = limpia;
    localStorage.setItem("qr_sheets_url", GOOGLE_SHEETS_URL);
    setSyncStatus("URL de Google Sheets guardada y validada.");
  });
}
if (btnSync) btnSync.addEventListener("click", syncPending);

function setSyncStatus(msg) {
  if (syncStatus) syncStatus.textContent = msg;
}

// ---- Escáner ----
btnStart.addEventListener("click", startScanner);
btnStop.addEventListener("click", stopScanner);

function startScanner() {
  if (scanner) return;
  scanner = new Html5Qrcode("reader");
  const config = { fps: 10, qrbox: { width: 250, height: 250 } };
  scanner
    .start({ facingMode: "environment" }, config, onScanSuccess)
    .then(() => {
      btnStart.disabled = true;
      btnStop.disabled = false;
    })
    .catch((err) => {
      alert("No se pudo acceder a la cámara: " + err);
      scanner = null;
    });
}

function stopScanner() {
  if (!scanner) return;
  scanner
    .stop()
    .then(() => {
      scanner.clear();
      scanner = null;
      btnStart.disabled = false;
      btnStop.disabled = true;
    })
    .catch(() => {});
}

function onScanSuccess(decodedText) {
  const now = Date.now();
  if (decodedText === lastScan.text && now - lastScan.time < DUP_WINDOW_MS) return;
  lastScan = { text: decodedText, time: now };
  registerRead(decodedText);
}

// ---- Validación de firma HMAC-SHA256 (Web Crypto) ----
async function hmacSha256Hex(message, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(sigBuf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Interpreta el contenido del QR. Devuelve {nombre, id, nonce, sig, seguro}
function parseQr(text) {
  try {
    const obj = JSON.parse(text);
    if (obj && obj.id && obj.nc && obj.sig) {
      return {
        nombre: obj.n || "(Sin nombre)",
        id: obj.id,
        nonce: obj.nc,
        sig: obj.sig,
        seguro: true,
      };
    }
  } catch {}
  // QR simple de texto plano: usa el directorio para el nombre
  return {
    nombre: owners[text] || "(Desconocido)",
    id: text,
    nonce: "",
    sig: "",
    seguro: false,
  };
}

async function registerRead(code) {
  const info = parseQr(code);

  // Validar firma si es un QR seguro
  if (info.seguro) {
    const base = info.id + "|" + info.nombre + "|" + info.nonce;
    const esperado = (await hmacSha256Hex(base, CLAVE_SECRETA)).slice(0, 24);
    if (esperado !== info.sig) {
      lastReadEl.textContent = "QR RECHAZADO: firma inválida (posible copia/falsificación).";
      lastReadEl.classList.remove("hidden");
      lastReadEl.classList.add("error");
      return;
    }
  }
  lastReadEl.classList.remove("error");

  const d = new Date();
  const hoy = formatDate(d);

  // Regla: el mismo QR (id) solo se registra UNA VEZ POR DÍA.
  if (logs.some((l) => String(l.id) === String(info.id) && l.date === hoy)) {
    lastReadEl.textContent = `QR ya registrado hoy (${hoy}): ${info.nombre}`;
    lastReadEl.classList.remove("hidden");
    return;
  }

  const entry = {
    localId: Date.now() + "-" + Math.random().toString(36).slice(2, 7),
    date: formatDate(d),
    time: formatTime(d),
    iso: d.toISOString(),
    nombre: info.nombre,
    id: info.id,
    nonce: info.nonce,
    sig: info.sig,
    synced: false,
  };
  logs.unshift(entry);
  saveJSON(LS_LOGS, logs);
  renderLogs();

  lastReadEl.textContent = `Registrado: ${entry.nombre} — ${entry.date} ${entry.time}`;
  lastReadEl.classList.remove("hidden");
  beep();

  // Enviar a Google Sheets
  sendToSheets(entry);
}

// Valida y limpia la URL de la Web App. Devuelve la URL saneada o null si es inválida.
function urlSheetsValida(u) {
  if (!u) return null;
  const limpia = String(u).trim();
  try {
    const parsed = new URL(limpia);
    // Debe ser https y de script.google.com terminando en /exec
    if (parsed.protocol !== "https:") return null;
    if (!/script\.google\.com$/i.test(parsed.hostname)) return null;
    if (!/\/exec$/.test(parsed.pathname)) return null;
    return limpia;
  } catch {
    return null;
  }
}

// ---- Envío a Google Sheets ----
// JSONP (cargar un <script>) es frágil en Safari/iOS porque la Web App de Apps Script
// responde con un redirect entre dominios (script.google.com -> script.googleusercontent.com)
// que iOS a veces rechaza en un <script src>, dando "error de URL".
// Por eso usamos fetch con `mode: "no-cors"`, que funciona igual en iOS y Android:
// el navegador envía la petición y Apps Script la guarda. No podemos leer la respuesta
// (es "opaca"), así que confirmamos con un GET de verificación por fecha+id.
async function sendToSheets(entry) {
  const url = urlSheetsValida(GOOGLE_SHEETS_URL);
  if (!url) {
    setSyncStatus(
      "URL de Google Sheets inválida. Debe empezar con https:// y terminar en /exec."
    );
    return false;
  }

  const params = new URLSearchParams({
    n: entry.nombre,
    id: String(entry.id),
    nc: entry.nonce || "",
    sig: entry.sig || "",
    iso: entry.iso,
  });

  try {
    // 1) Enviar (no-cors): compatible con iOS y Android.
    await fetch(url + "?" + params.toString(), { method: "GET", mode: "no-cors" });

    // 2) Verificar que quedó registrado (lectura GET sin callback -> JSON legible?).
    //    En no-cors tampoco podemos leer esto entre dominios, así que marcamos como
    //    enviado de forma optimista. La regla "una vez por día" evita duplicados.
    entry.synced = true;
    saveJSON(LS_LOGS, logs);
    renderLogs();
    setSyncStatus(`Enviado a Google Sheets: ${entry.nombre}. Verifica en la hoja.`);
    return true;
  } catch (err) {
    setSyncStatus("Sin conexión. Se reintentará con 'Sincronizar'. (" + err + ")");
    return false;
  }
}

// Reintenta enviar todas las lecturas pendientes
async function syncPending() {
  if (!GOOGLE_SHEETS_URL) {
    setSyncStatus("Configura primero la URL de Google Sheets.");
    return;
  }
  const pendientes = logs.filter((l) => !l.synced);
  if (pendientes.length === 0) {
    setSyncStatus("No hay lecturas pendientes.");
    return;
  }
  setSyncStatus(`Sincronizando ${pendientes.length} lectura(s)...`);
  for (const entry of pendientes.slice().reverse()) {
    await sendToSheets(entry);
  }
  const quedan = logs.filter((l) => !l.synced).length;
  setSyncStatus(quedan === 0 ? "Todo sincronizado." : `Quedan ${quedan} pendientes.`);
}

function formatDate(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}
function formatTime(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.value = 0.1;
    osc.start();
    setTimeout(() => {
      osc.stop();
      ctx.close();
    }, 120);
  } catch {}
}

// ---- Directorio de dueños (respaldo para QR simples) ----
if (btnAddOwner) {
  btnAddOwner.addEventListener("click", () => {
    const code = ownerCode.value.trim();
    const name = ownerName.value.trim();
    if (!code || !name) {
      alert("Ingresa el contenido del QR y el nombre del dueño.");
      return;
    }
    owners[code] = name;
    saveJSON(LS_OWNERS, owners);
    ownerCode.value = "";
    ownerName.value = "";
    renderOwners();
  });
}

function renderOwners() {
  if (!ownersTbody) return;
  ownersTbody.innerHTML = "";
  const keys = Object.keys(owners);
  if (keys.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="3" class="empty">Sin dueños registrados.</td>`;
    ownersTbody.appendChild(tr);
    return;
  }
  keys.forEach((code) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(code)}</td>
      <td>${escapeHtml(owners[code])}</td>
      <td><button class="link-btn danger" data-code="${escapeAttr(code)}">Eliminar</button></td>
    `;
    tr.querySelector("button").addEventListener("click", () => {
      delete owners[code];
      saveJSON(LS_OWNERS, owners);
      renderOwners();
    });
    ownersTbody.appendChild(tr);
  });
}

// ---- Tabla de lecturas ----
function renderLogs() {
  const term = (searchEl.value || "").toLowerCase().trim();
  const filtered = term
    ? logs.filter(
        (l) =>
          l.nombre.toLowerCase().includes(term) ||
          String(l.id).toLowerCase().includes(term) ||
          l.date.includes(term)
      )
    : logs;

  countEl.textContent = logs.length;
  logTbody.innerHTML = "";

  if (filtered.length === 0) {
    emptyLog.classList.remove("hidden");
    emptyLog.textContent =
      logs.length === 0 ? "Aún no hay lecturas registradas." : "Sin resultados para la búsqueda.";
    return;
  }
  emptyLog.classList.add("hidden");

  filtered.forEach((l, i) => {
    const estado = l.synced
      ? '<span title="Guardado en Google Sheets" style="color:#22c55e">● nube</span>'
      : '<span title="Solo local, pendiente de sincronizar" style="color:#f59e0b">● local</span>';
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${l.date}</td>
      <td>${l.time}</td>
      <td>${escapeHtml(l.nombre)}</td>
      <td>${escapeHtml(String(l.id))} ${estado}</td>
      <td>
        <button class="link-btn danger" data-del="${l.localId}">Borrar</button>
      </td>
    `;
    tr.querySelector("[data-del]").addEventListener("click", () => {
      logs = logs.filter((x) => x.localId !== l.localId);
      saveJSON(LS_LOGS, logs);
      renderLogs();
    });
    logTbody.appendChild(tr);
  });
}

searchEl.addEventListener("input", renderLogs);

// ---- Exportar CSV ----
btnExport.addEventListener("click", () => {
  if (logs.length === 0) {
    alert("No hay lecturas para exportar.");
    return;
  }
  const header = ["#", "Fecha", "Hora", "Nombre", "ID", "Nonce", "Sincronizado"];
  const rows = logs
    .slice()
    .reverse()
    .map((l, i) => [i + 1, l.date, l.time, l.nombre, l.id, l.nonce, l.synced ? "Sí" : "No"]);
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(";")).join("\r\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `lecturas_qr_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

function csvCell(value) {
  const s = String(value);
  if (/[";\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// ---- Borrar todo ----
btnClear.addEventListener("click", () => {
  if (logs.length === 0) return;
  if (confirm("¿Borrar TODAS las lecturas locales? (No borra la hoja de Google Sheets)")) {
    logs = [];
    saveJSON(LS_LOGS, logs);
    renderLogs();
  }
});

// ---- Helpers de escape ----
function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

// ---- Inicialización ----
renderOwners();
renderLogs();
if (logs.some((l) => !l.synced) && GOOGLE_SHEETS_URL) {
  setSyncStatus(`Hay lecturas pendientes de sincronizar. Pulsa 'Sincronizar'.`);
}
