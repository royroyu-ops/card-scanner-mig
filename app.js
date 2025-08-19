async function ocrWithOptiic(file) {
  const form = new FormData();
  form.append("image", file, file.name);

  const resp = await fetch("/api/ocr", { method: "POST", body: form });
  if (!resp.ok) throw new Error("OCR API error");
  const { text } = await resp.json();
  return text || "";
}
