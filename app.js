/* ---------------------------------------------------------
   PDF.js Worker Fix (required for GitHub Pages)
--------------------------------------------------------- */
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

/* ---------------------------------------------------------
   Firebase v9 Modular Imports
--------------------------------------------------------- */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { 
  getStorage, ref, uploadBytesResumable, getDownloadURL 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { 
  getFirestore, collection, addDoc, getDocs 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/* ---------------------------------------------------------
   Firebase Initialization
--------------------------------------------------------- */
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "recipes-cloud-6f09d.firebaseapp.com",
  projectId: "recipes-cloud-6f09d",
  storageBucket: "recipes-cloud-6f09d.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

const app = initializeApp(firebaseConfig);
const storage = getStorage(app);
const db = getFirestore(app);

/* ---------------------------------------------------------
   File Type Helpers
--------------------------------------------------------- */
function isImage(file) { return file.type.startsWith("image/"); }
function isPDF(file) { return file.type === "application/pdf"; }
function isDOCX(file) { return file.name.endsWith(".docx"); }

/* ---------------------------------------------------------
   OCR Extraction (Images Only)
--------------------------------------------------------- */
async function extractTextWithOCR(fileOrDataUrl) {
  const result = await Tesseract.recognize(fileOrDataUrl, "eng");
  return result.data.text;
}

/* ---------------------------------------------------------
   PDF.js Multi-page Extraction
--------------------------------------------------------- */
async function extractPagesFromPDF(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map(item => item.str).join(" ");
    pages.push({ pageNumber: i, text: text.trim() });
  }
  return pages;
}

/* ---------------------------------------------------------
   Scanned PDF OCR
--------------------------------------------------------- */
async function extractTextFromScannedPDF(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  let fullText = "";

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2 });

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({ canvasContext: context, viewport }).promise;

    const dataUrl = canvas.toDataURL("image/png");
    const result = await Tesseract.recognize(dataUrl, "eng");
    fullText += result.data.text + "\n";
  }

  return fullText.trim();
}

/* ---------------------------------------------------------
   DOCX Extraction
--------------------------------------------------------- */
async function extractTextFromDOCX(file) {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value.trim();
}

/* ---------------------------------------------------------
   Text File Extraction
--------------------------------------------------------- */
function extractTextFromTextFile(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsText(file);
  });
}

/* ---------------------------------------------------------
   Metadata + Ingredient Extraction
--------------------------------------------------------- */
function parseRecipeText(fullText) {
  const lines = fullText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  const title = lines[0] || "Untitled Recipe";

  const metadata = {
    prepTime: findLine(lines, /(prep|preparation)\s*time[:\-]\s*(.+)/i),
    cookTime: findLine(lines, /(cook)\s*time[:\-]\s*(.+)/i),
    totalTime: findLine(lines, /(total)\s*time[:\-]\s*(.+)/i),
    servings: findLine(lines, /(servings?|yield)[:\-]\s*(.+)/i)
  };

  const ingredients = extractSection(lines, /ingredients?/i);
  const steps = extractSection(lines, /(directions?|instructions?|method)/i);

  const tags = inferTags(fullText);
  const categories = infer