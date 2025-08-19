// ===== Helpers: OCR (Optiic via our API) =====
async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

async function ocrWithOptiic(file) {
  const base64 = await fileToBase64(file);
  const resp = await fetch('/api/ocr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageBase64: base64 })
  });
  if (!resp.ok) throw new Error('OCR API error');
  const { text } = await resp.json();
  return text || '';
}

// ===== Regex =====
const phoneRegex = /(?:(?:\+?6?0)[-\s]?)?(?:\(?0\d\)?[-\s]?)?\d{2,4}[-\s]?\d{3,4}[-\s]?\d{3,4}|\+?\d{1,4}[-\s]?\d{3,4}[-\s]?\d{3,4}/gi;
const emailRegex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const urlRegex   = /(?:https?:\/\/)?(?:www\.)?[a-z0-9.-]+\.[a-z]{2,}(?:\/[\w#?=&.-]*)?/gi;

// ===== Heuristics =====
const TITLE_WORDS   = ["manager","director","sales","marketing","designer","engineer","executive","officer","consultant","owner","founder","ceo","cto","cfo","coo","assistant","associate","pengurus","jurutera","pereka","akaun","akauntan","admin","pengarah","penolong","ketua","pegawai","eksekutif","operation","operations","assistant"];
const COMPANY_WORDS = ["sdn bhd","bhd","ltd","inc","enterprise","trading","resources","plc","holdings","co-op","coop","koperasi","solutions","merchandising","agency","agencies"];
const ADDRESS_WORDS = ["jalan","jln.","lorong","kg.","kampung","tingkat","level","suite","no.","street","st.","ave.","avenue","seksyen","sek.","bandar","taman","menara","kwsp","pj","petaling","shah alam","selangor","kuala lumpur","wilayah","persekutuan","johor","penang","pulau pinang","sabah","sarawak","perak","pahang","kedah","kelantan","terengganu","melaka","negeri sembilan","postcode","poskod","zip","malaysia"];
const LABEL_WORDS   = ["tel","phone","no tel","hp","mobile","fax","email","e-mail","website","www","alamat","address"];

const isAllCaps = (s) => s === s.toUpperCase() && /[A-Z]/.test(s);
const hasDigits = (s) => /\d/.test(s);
const any = (s, arr) => arr.some(w => new RegExp(`\\b${w}\\b`,'i').test(s));
const words = (s) => s.trim().split(/\s+/).filter(Boolean);

function scoreName(line) {
  let score = 0;
  const lc = line.toLowerCase();
  if (!/[A-Za-z]/.test(line)) return -999;
  if (hasDigits(line)) score -= 3;

  const wc = words(line).length;
  if (wc >= 2 && wc <= 4) score += 3;

  // Benarkan ALL CAPS untuk nama (kad bisnes banyak guna)
  if (isAllCaps(line) && wc <= 4) score += 2;
  else if (isAllCaps(line)) score -= 2;

  if (/^[A-Z][a-z]+(\s[A-Z][a-z\-']+)+$/.test(line)) score += 2;
  if (!any(lc, COMPANY_WORDS) && !any(lc, TITLE_WORDS) && !any(lc, LABEL_WORDS)) score += 2;
  return score;
}

function joinAddress(start, lines) {
  const out = [lines[start]];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i], lc = l.toLowerCase();
    if (any(lc, ADDRESS_WORDS) || /\d/.test(l)) out.push(l); else break;
  }
  return out.join(', ');
}

function pickBestPhone(phones) {
  const digits = (s) => (s || '').replace(/\D/g, '');
  const mobile = phones.find(p => /^(\+?6?0?1\d)/.test(digits(p)));
  return mobile || phones[0] || '';
}

function parseContact(text) {
  const rawLines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const lines = Array.from(new Set(rawLines)).filter(l => l.length <= 160);
  const joined = lines.join('\n');

  const emails = joined.match(emailRegex) || [];
  const phones = joined.match(phoneRegex) || [];
  const urls   = (joined.match(urlRegex) || []).filter(u => !u.match(emailRegex));

  const company = lines.find(l => any(l.toLowerCase(), COMPANY_WORDS))
               || lines.find(l => isAllCaps(l) && l.length < 60) || '';

  const title = lines.find(l => any(l.toLowerCase(), TITLE_WORDS)) || '';

  let address = '';
  for (let i = 0; i < lines.length; i++) {
    if (any(lines[i].toLowerCase(), ADDRESS_WORDS)) { address = joinAddress(i, lines); break; }
  }

  const excluded = new Set([company, title, address].filter(Boolean));
  lines.forEach(l => {
    const ll = l.toLowerCase();
    if (emails.some(e => l.includes(e)) || phones.some(p => l.includes(p))) excluded.add(l);
    if (any(ll, LABEL_WORDS) || any(ll, COMPANY_WORDS)) excluded.add(l);
  });

  let bestName = ''; let bestScore = -999;
  lines.filter(l => !excluded.has(l)).forEach(c => {
    const s = scoreName(c);
    if (s > bestScore) { bestScore = s; bestName = c; }
  });

  if (!bestName && emails[0]) {
    const local = emails[0].split('@')[0].replace(/[._-]+/g,' ').replace(/\d+/g,' ').trim();
    if (local) bestName = local.split(' ').map(w => w ? w[0].toUpperCase() + w.slice(1) : '').join(' ').trim();
  }

  if (bestName && emailRegex.test(bestName)) bestName = '';

  return {
    name: bestName || '',
    company,
    title,
    phone: pickBestPhone(phones),
    email: (emails[0] || '').toLowerCase(),
    website: urls[0] || '',
    address,
    notes: '',
    raw: text,
  };
}

// ===== State & DOM =====
let contacts = [];

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const previewWrap = document.getElementById('previewWrap');
const preview = document.getElementById('preview');
const ocrText = document.getElementById('ocrText');
const progressWrap = document.getElementById('progressWrap');
const progressBar = document.getElementById('progressBar');
const progressLabel = document.getElementById('progressLabel');
const addBtn = document.getElementById('addBtn');

const emptyState = document.getElementById('emptyState');
const tableWrap = document.getElementById('tableWrap');
const tbody = document.getElementById('tbody');

const csvBtn = document.getElementById('csvBtn');
const xlsxBtn = document.getElementById('xlsxBtn');
const vcfBtn = document.getElementById('vcfBtn');

function enableExports(enable) {
  csvBtn.disabled = !enable;
  xlsxBtn.disabled = !enable;
  vcfBtn.disabled = !enable;
}

// Drag & drop
dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('bg-gray-50'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('bg-gray-50'));
dropzone.addEventListener('drop', e => {
  e.preventDefault();
  dropzone.classList.remove('bg-gray-50');
  const file = e.dataTransfer.files?.[0];
  if (file) handleFile(file);
});
fileInput.addEventListener('change', e => {
  const file = e.target.files?.[0];
  if (file) handleFile(file);
});

async function handleFile(file) {
  const r = new FileReader();
  r.onload = () => { preview.src = r.result; previewWrap.classList.remove('hidden'); };
  r.readAsDataURL(file);

  progressWrap.classList.remove('hidden');
  progressBar.style.width = '25%';
  progressLabel.textContent = 'Upload & hantar ke OCR…';
  addBtn.disabled = true;

  try {
    const txt = await ocrWithOptiic(file);
    progressBar.style.width = '100%';
    progressLabel.textContent = 'Siap OCR.';
    ocrText.value = txt;
    addBtn.disabled = !ocrText.value.trim();
  } catch (e) {
    console.error(e);
    alert('Maaf, OCR gagal. Cuba lagi atau guna gambar yang lebih jelas.');
  } finally {
    setTimeout(() => progressWrap.classList.add('hidden'), 500);
  }
}

addBtn.addEventListener('click', () => {
  const parsed = parseContact(ocrText.value || '');
  contacts = [parsed, ...contacts];
  renderTable();
  ocrText.value = '';
  preview.src = '';
  previewWrap.classList.add('hidden');
  fileInput.value = '';
});

function renderTable() {
  if (contacts.length === 0) {
    emptyState.classList.remove('hidden');
    tableWrap.classList.add('hidden');
    enableExports(false);
    return;
  }
  emptyState.classList.add('hidden');
  tableWrap.classList.remove('hidden');
  enableExports(true);

  tbody.innerHTML = '';
  contacts.forEach((c) => {
    const row = document.createElement('tr');
    row.className = 'border-t';
    ['name','company','title','phone','email','website','address','notes'].forEach(k => {
      const td = document.createElement('td');
      td.className = 'px-3 py-2 align-top';
      const input = document.createElement('input');
      input.className = 'w-64 max-w-full border rounded-lg px-2 py-1';
      input.value = c[k] || '';
      input.addEventListener('input', (e) => { c[k] = e.target.value; });
      td.appendChild(input);
      row.appendChild(td);
    });
    tbody.appendChild(row);
  });
}

// Exports
csvBtn.addEventListener('click', () => {
  const headers = ['name','company','title','phone','email','website','address','notes'];
  const rows = contacts.map(c => headers.map(h => `"${String(c[h] ?? '').replace(/"/g,'""')}"`).join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  download('contacts.csv', csv, 'text/csv;charset=utf-8');
});

xlsxBtn.addEventListener('click', () => {
  const ws = XLSX.utils.json_to_sheet(contacts);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Contacts');
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  download('contacts.xlsx', new Blob([out], { type: 'application/octet-stream' }));
});

vcfBtn.addEventListener('click', () => {
  const v = (c) => [
    'BEGIN:VCARD','VERSION:3.0',
    `FN:${c.name||''}`,
    c.company ? `ORG:${c.company}` : '',
    c.title ? `TITLE:${c.title}` : '',
    c.phone ? `TEL;TYPE=CELL:${c.phone}` : '',
    c.email ? `EMAIL;TYPE=INTERNET:${c.email}` : '',
    c.website ? `URL:${c.website}` : '',
    c.address ? `ADR;TYPE=WORK:;;${c.address};;;;` : '',
    c.notes ? `NOTE:${c.notes}` : '',
    'END:VCARD'
  ].filter(Boolean).join('\n');
  const content = contacts.map(v).join('\n');
  download('contacts.vcf', content, 'text/vcard;charset=utf-8');
});

function download(filename, data, type='text/plain;charset=utf-8') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// PWA install button
let deferredPrompt = null;
const installBtn = document.getElementById('installBtn');
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); deferredPrompt = e; installBtn.classList.remove('hidden');
});
installBtn?.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt(); await deferredPrompt.userChoice;
  deferredPrompt = null; installBtn.classList.add('hidden');
});
