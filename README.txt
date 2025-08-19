# Business Card Scanner — PWA

Zero-build PWA that scans business card images (OCR via Tesseract.js) and exports CSV/Excel/VCF.
Works offline after first load.

## Quick Start
1. Host the folder (Vercel/Netlify/GitHub Pages or any static hosting).
2. Open on phone or desktop. You'll see an **Install App** button (or use Add to Home Screen).
3. Upload a card image → OCR → adjust fields → export CSV/XLSX/VCF.

## Notes
- All processing is client-side. For higher OCR accuracy use cloud OCR APIs (Google Vision, AWS Textract).
- Service worker pre-caches the app shell and CDN deps for offline use.
