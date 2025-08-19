// --------- Helpers (improved) ---------
const phoneRegex = /(?:(?:\+?6?0)[-\s]?)?(?:\(?0\d\)?[-\s]?)?\d{2,4}[-\s]?\d{3,4}[-\s]?\d{3,4}|\+?\d{1,4}[-\s]?\d{3,4}[-\s]?\d{3,4}/gi;
const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const urlRegex   = /(?:https?:\/\/)?(?:www\.)?[a-z0-9.-]+\.[a-z]{2,}(?:\/[\w#?=&.-]*)?/gi;

// title/company/address labels (BM + EN)
const TITLE_WORDS   = ["manager","director","sales","marketing","designer","engineer","executive","officer","consultant","owner","founder","ceo","cto","cfo","coo","assistant","associate","pengurus","jurutera","pereka","akaun","akauntan","admin","pengarah","penolong","ketua","pegawai","eksekutif","operation","operations","opration","oprations"];
const COMPANY_WORDS = ["sdn bhd","bhd","ltd","inc","enterprise","trading","resources","plc","holdings","co-op","coop","cooperative","koperasi","agency","agencies","solutions","merchandising"];
const ADDRESS_WORDS = ["jalan","jln.","lorong","kg.","kampung","tingkat","level","suite","no.","street","st.","ave.","avenue","seksyen","sek.","bandar","taman","menara","puduraya","pj","p.j.","petaling","shah alam","selangor","kuala lumpur","wilayah","persekutuan","johor","penang","pulau pinang","sabah","sarawak","perak","pahang","kedah","kelantan","terengganu","melaka","negeri sembilan","postcode","poskod","zip","malaysia"];
const LABEL_WORDS   = ["tel","phone","no tel","hp","mobile","fax","email","e-mail","website","www","alamat","address"];

const isAllCaps = (s) => s === s.toUpperCase() && /[A-Z]/.test(s);
const hasDigits = (s) => /\d/.test(s);
const any = (s, arr) => arr.some(w => new RegExp(`\\b${w}\\b`, "i").test(s));
const words = (s) => s.trim().split(/\s+/).filter(Boolean);

function scoreName(line) {
  let score = 0;
  const lc = line.toLowerCase();
  if (!/[A-Za-z]/.test(line)) return -999;
  if (hasDigits(line)) score -= 3;
  if (isAllCaps(line)) score -= 2;                 // ALL-CAPS usually company
  const wc = words(line).length;
  if (wc >= 2 && wc <= 4) score += 3;              // typical human name length
  if (/^[A-Z][a-z]+(\s[A-Z][a-z\-']+)+$/.test(line)) score += 2; // Proper case
  if (!any(lc, COMPANY_WORDS) && !any(lc, TITLE_WORDS) && !any(lc, LABEL_WORDS)) score += 2;
  return score;
}

function joinAddress(start, lines) {
  const out = [lines[start]];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i], lc = l.toLowerCase();
    if (any(lc, ADDRESS_WORDS) || /\d/.test(l)) out.push(l); else break;
  }
  return out.join(", ");
}

function pickBestPhone(phones) {
  // pilih mobile dahulu (01/ +601), kalau tak ada guna yang pertama
  const mobile = phones.find(p => /\b(\+?6?0?1\d)\b/.test(p.replace(/\D/g,"")));
  return mobile || phones[0] || "";
}

function parseContact(text) {
  const rawLines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const lines = Array.from(new Set(rawLines)).filter(l => l.length <= 120);
  const joined = lines.join("\n");

  const emails = joined.match(emailRegex) || [];
  const phones = joined.match(phoneRegex) || [];
  const urls   = (joined.match(urlRegex) || []).filter(u => !u.match(emailRegex));

  const company =
    lines.find(l => any(l.toLowerCase(), COMPANY_WORDS)) ||
    lines.find(l => isAllCaps(l) && l.length < 60) || "";

  const title = lines.find(l => any(l.toLowerCase(), TITLE_WORDS)) || "";

  let address = "";
  for (let i = 0; i < lines.length; i++) {
    if (any(lines[i].toLowerCase(), ADDRESS_WORDS)) { address = joinAddress(i, lines); break; }
  }

  // exclude obvious non-name lines
  const excluded = new Set([company, title, address].filter(Boolean));
  lines.forEach(l => {
    const ll = l.toLowerCase();
    if (emails.some(e => l.includes(e)) || phones.some(p => l.includes(p))) excluded.add(l);
    if (any(ll, LABEL_WORDS) || any(ll, COMPANY_WORDS)) excluded.add(l);
  });

  let bestName = ""; let bestScore = -999;
  lines.filter(l => !excluded.has(l)).forEach(c => {
    const s = scoreName(c);
    if (s > bestScore) { bestScore = s; bestName = c; }
  });

  // Fallback: derive name from email if empty
  if (!bestName && emails[0]) {
    const local = emails[0].split("@")[0].replace(/[._-]+/g," ").replace(/\d+/g," ").trim();
    if (local) bestName = local.split(" ").map(w => w? w[0].toUpperCase()+w.slice(1):"").join(" ").trim();
  }

  return {
    name: bestName || "",
    company,
    title,
    phone: pickBestPhone(phones),
    email: (emails[0] || "").toLowerCase(),
    website: urls[0] || "",
    address,
    notes: "",
    raw: text,
  };
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
