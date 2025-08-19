// /api/ocr.js — Vercel Serverless Function (CommonJS)
const Busboy = require("busboy");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.json({ error: "Method not allowed" });
  }

  try {
    const { files } = await parseMultipart(req);
    const img = files?.image;
    if (!img) {
      res.statusCode = 400;
      return res.json({ error: "No image uploaded (field 'image' missing)" });
    }

    // Build multipart form for Optiic
    const form = new FormData();
    form.append("apiKey", process.env.OPTIIC_API_KEY || ""); // boleh kosong (akaun free tanpa key)
    form.append("image", new Blob([img.buffer], { type: img.mime }), img.filename);

    // **Official endpoint per README:** https://api.optiic.dev/process
    const upstream = await fetch("https://api.optiic.dev/process", {
      method: "POST",
      body: form,
      // header Content-Type akan di-set automatik oleh fetch untuk multipart boundary
    });

    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      res.statusCode = upstream.status || 502;
      return res.json({ error: "Optiic error", raw: data });
    }

    // README tunjuk output ada `text` (contoh “We love Optiic!”)
    const text = data.text || data.ocr || data.result || data.data?.text || "";
    return res.status(200).json({ text, raw: data });
  } catch (e) {
    console.error(e);
    res.statusCode = 500;
    return res.json({ error: "Server error", detail: String(e) });
  }
};

// ---------- helpers ----------
function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const bb = Busboy({ headers: req.headers });
    const files = {};
    const fields = {};
    bb.on("file", (name, file, info) => {
      const chunks = [];
      file.on("data", (d) => chunks.push(d));
      file.on("end", () => {
        files[name] = {
          buffer: Buffer.concat(chunks),
          filename: info.filename || "upload",
          mime: info.mimeType || "application/octet-stream",
        };
      });
    });
    bb.on("field", (name, val) => (fields[name] = val));
    bb.on("close", () => resolve({ files, fields }));
    bb.on("error", reject);
    req.pipe(bb);
  });
}
