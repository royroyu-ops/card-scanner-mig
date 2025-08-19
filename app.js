
// --------- Helpers ---------
const phoneRegex = /(?:(?:\+?6?0)[-\s]?)?(?:\d{2,3}[-\s]?)?\d{3,4}[-\s]?\d{3,4}|\+?\d{1,4}[-\s]?\d{3,4}[-\s]?\d{3,4}/gi;
const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const urlRegex = /(?:https?:\/\/)?(?:www\.)?[a-z0-9.-]+\.[a-z]{2,}(?:\/[\w#?=&.-]*)?/gi;

function parseContact(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const joined = lines.join("\n");
  const emails = joined.match(emailRegex) || [];
  const phones = joined.match(phoneRegex) || [];
  const urls = (joined.match(urlRegex) || []).filter(u => !u.match(emailRegex));

  const likelyName = lines.find(l =>
    /[A-Za-z]/.test(l) &&
    !/\d/.test(l) &&
    l.length <= 50 &&
    !(l === l.toUpperCase()) &&
    !/^(tel|phone|mobile|fax|email|e-?mail|website|alamat|address|www|hp|jabatan|dept|department|company|co\.?|sdn bhd|plc|ltd|inc|bhd|ent|enterprise|resources|trading)/i.test(l)
  );

  const likelyCompany =
    lines.find(l => /sdn\s*bhd|bhd\b|ltd\b|inc\b|enterprise|trading|resources/i.test(l)) ||
    lines.find(l => l === l.toUpperCase() && /[A-Z]/.test(l) && l.length < 60);

  const likelyTitle = lines.find(l =>
    /(manager|director|sales|marketing|designer|engineer|executive|officer|consultant|owner|founder|ceo|cto|cfo|coo|pengurus|jurutera|pereka|akaun|akauntan|admin)/i.test(l)
  );

  const likelyAddress = lines.find(l =>
    /(jalan|jln\.|lorong|kg\.|kampung|tingkat|blkg|no\.|suite|street|st\.|ave\.|avenue|bandar|taman|selangor|kuala lumpur|wilayah|persekutuan|johor|penang|pulau pinang|sabah|sarawak|perak|pahang|kedah|kelantan|terengganu|melaka|negeri sembilan|postcode|poskod|zip)/i.test(l)
  );

  return {
    name: likelyName || "",
    company: likelyCompany || "",
    title: likelyTitle || "",
    phone: phones[0] || "",
    email: (emails[0] || "").toLowerCase(),
    website: urls[0] || "",
    address: likelyAddress || "",
    notes: "",
    raw: text,
  };
}

function contactsToCSV(contacts) {
  const headers = ["name","company","title","phone","email","website","address","notes"];
  const rows = contacts.map(c => headers.map(h => `"${String(c[h] ?? "").replace(/"/g,'""')}"`).join(","));
  return [headers.join(","), ...rows].join("\n");
}

function contactToVCard(c) {
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${c.name||""}`,
    c.company ? `ORG:${c.company}` : "",
    c.title ? `TITLE:${c.title}` : "",
    c.phone ? `TEL;TYPE=CELL:${c.phone}` : "",
    c.email ? `EMAIL;TYPE=INTERNET:${c.email}` : "",
    c.website ? `URL:${c.website}` : "",
    c.address ? `ADR;TYPE=WORK:;;${c.address};;;;` : "",
    c.notes ? `NOTE:${c.notes}` : "",
    "END:VCARD",
  ].filter(Boolean).join("\n");
  return lines;
}

function download(filename, data, type="text/plain;charset=utf-8") {
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// --------- State ---------
let contacts = [];

// --------- DOM ---------
const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const previewWrap = document.getElementById("previewWrap");
const preview = document.getElementById("preview");
const ocrText = document.getElementById("ocrText");
const progressWrap = document.getElementById("progressWrap");
const progressBar = document.getElementById("progressBar");
const progressLabel = document.getElementById("progressLabel");
const addBtn = document.getElementById("addBtn");

const emptyState = document.getElementById("emptyState");
const tableWrap = document.getElementById("tableWrap");
const tbody = document.getElementById("tbody");

const csvBtn = document.getElementById("csvBtn");
const xlsxBtn = document.getElementById("xlsxBtn");
const vcfBtn = document.getElementById("vcfBtn");

function enableExports(enable) {
  csvBtn.disabled = !enable;
  xlsxBtn.disabled = !enable;
  vcfBtn.disabled = !enable;
}

// Drag & drop
dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("dragover", e => { e.preventDefault(); dropzone.classList.add("bg-gray-50"); });
dropzone.addEventListener("dragleave", e => dropzone.classList.remove("bg-gray-50"));
dropzone.addEventListener("drop", e => {
  e.preventDefault();
  dropzone.classList.remove("bg-gray-50");
  const file = e.dataTransfer.files?.[0];
  if (file) handleFile(file);
});

fileInput.addEventListener("change", e => {
  const file = e.target.files?.[0];
  if (file) handleFile(file);
});

async function handleFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    preview.src = reader.result;
    previewWrap.classList.remove("hidden");
  };
  reader.readAsDataURL(file);

  progressWrap.classList.remove("hidden");
  progressBar.style.width = "0%";
  progressLabel.textContent = "Memproses OCR… 0%";
  addBtn.disabled = true;

  try {
    const worker = await Tesseract.createWorker("eng", 1, {
      logger: m => {
        if (m.status === "recognizing text" && m.progress != null) {
          const pct = Math.round(m.progress * 100);
          progressBar.style.width = pct + "%";
          progressLabel.textContent = "Memproses OCR… " + pct + "%";
        }
      }
    });
    const { data } = await worker.recognize(file);
    await worker.terminate();
    ocrText.value = data.text || "";
    addBtn.disabled = !ocrText.value.trim();
  } catch (e) {
    console.error(e);
    alert("Maaf, OCR gagal. Cuba guna gambar yang lebih jelas / terang.");
  } finally {
    progressWrap.classList.add("hidden");
  }
}

addBtn.addEventListener("click", () => {
  const parsed = parseContact(ocrText.value || "");
  contacts = [parsed, ...contacts];
  renderTable();
  // reset input
  ocrText.value = "";
  preview.src = "";
  previewWrap.classList.add("hidden");
  fileInput.value = "";
});

function renderTable() {
  if (contacts.length === 0) {
    emptyState.classList.remove("hidden");
    tableWrap.classList.add("hidden");
    enableExports(false);
    return;
  }
  emptyState.classList.add("hidden");
  tableWrap.classList.remove("hidden");
  enableExports(true);

  tbody.innerHTML = "";
  contacts.forEach((c, i) => {
    const row = document.createElement("tr");
    row.className = "border-t";
    const keys = ["name","company","title","phone","email","website","address","notes"];
    keys.forEach(k => {
      const td = document.createElement("td");
      td.className = "px-3 py-2 align-top";
      const input = document.createElement("input");
      input.className = "w-64 max-w-full border rounded-lg px-2 py-1";
      input.value = c[k] || "";
      input.addEventListener("input", (e) => {
        c[k] = e.target.value;
      });
      td.appendChild(input);
      row.appendChild(td);
    });
    tbody.appendChild(row);
  });
}

// Exports
csvBtn.addEventListener("click", () => {
  const csv = contactsToCSV(contacts);
  download("contacts.csv", csv, "text/csv;charset=utf-8");
});

xlsxBtn.addEventListener("click", () => {
  /* global XLSX */
  const ws = XLSX.utils.json_to_sheet(contacts);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Contacts");
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  download("contacts.xlsx", new Blob([out], { type: "application/octet-stream" }));
});

vcfBtn.addEventListener("click", () => {
  const content = contacts.map(contactToVCard).join("\n");
  download("contacts.vcf", content, "text/vcard;charset=utf-8");
});

// Install prompt (PWA)
let deferredPrompt = null;
const installBtn = document.getElementById("installBtn");

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installBtn.classList.remove("hidden");
});

installBtn.addEventListener("click", async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  installBtn.classList.add("hidden");
});
