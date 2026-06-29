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
  apiKey: "AIzaSyD-ZVROybS5c3O6kJhe8LVcXNZ0KbYTmvg",
  authDomain: "recipes-83727.firebaseapp.com",
  projectId: "recipes-83727",
  storageBucket: "recipes-83727.appspot.com",
  messagingSenderId: "97445031584",
  appId: "1:97445031584:web:a463b119a272531f51a3c5",
  measurementId: "G-4LERX7EWB7"
};

const app = initializeApp(firebaseConfig);
const storage = getStorage(app);
const db = getFirestore(app);

let lunrIndex = null;
let recipeDocs = [];

/* ---------------------------------------------------------
   Local LLM (WebLLM) Setup
--------------------------------------------------------- */
let llmEnginePromise = null;

function getLlmEngine() {
  if (!llmEnginePromise) {
    llmEnginePromise = webllm.createEngine("Llama-3-8B-Instruct-q4f32_1-MLC");
  }
  return llmEnginePromise;
}

/* ---------------------------------------------------------
   Semantic Recipe Parsing with Local LLM
--------------------------------------------------------- */
async function semanticParseRecipe(fullText) {
  const engine = await getLlmEngine();

  const prompt = `
You are a recipe-structure parser.
Extract ONLY the following fields from the text:

- title (string)
- ingredients (array of strings)
- steps (array of strings)
- metadata (object with prepTime, cookTime, totalTime, servings)
- tags (array of strings)
- categories (array of strings)

Ignore ALL dialogue, page headers, commentary, and noise.

Return ONLY valid JSON. Do not include any explanation.

Recipe text:
${fullText}
`;

  const result = await engine.chatCompletion({
    messages: [
      { role: "user", content: prompt }
    ],
    temperature: 0.2,
    max_tokens: 1024
  });

  const content = result.choices[0].message.content;

  try {
    return JSON.parse(content);
  } catch (e) {
    return parseRecipeTextFallback(fullText);
  }
}

/* ---------------------------------------------------------
   Heuristic Fallback Parser (generic)
--------------------------------------------------------- */
function parseRecipeTextFallback(fullText) {
  fullText = fullText
    .replace(/Page\s*\d+/gi, "")
    .replace(/continued on next page/gi, "")
    .replace(/THREE GUYS FROM MIAMI COOK CUBAN/gi, "")
    .replace(/DESSERTS/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  const lines = fullText
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

  const title = lines[0] || "Untitled Recipe";
  const ingredients = extractIngredientsGeneric(lines);
  const steps = extractStepsGeneric(lines);
  const metadata = extractMetadataGeneric(lines);
  const tags = inferTags(fullText);
  const categories = inferCategories(fullText);

  return { title, ingredients, steps, metadata, tags, categories };
}

function extractIngredientsGeneric(lines) {
  const start = lines.findIndex(l =>
    /^ingredients\b[:]?$/i.test(l)
  );
  if (start === -1) return [];

  const ingredients = [];

  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];

    if (/^(cake|syrup|frosting|directions?|instructions?|method|steps|variations)/i.test(line)) {
      break;
    }
    if (/^serves\b/i.test(line)) continue;

    ingredients.push(line);
  }

  return ingredients;
}

function extractStepsGeneric(lines) {
  const start = lines.findIndex(l => /^\s*1\./.test(l));
  if (start === -1) return [];

  const steps = [];

  for (let i = start; i < lines.length; i++) {
    const line = lines[i];

    if (/^variations|notes|tips|serving suggestions/i.test(line)) break;

    steps.push(line);
  }

  return steps;
}

function extractMetadataGeneric(lines) {
  return {
    prepTime: findLine(lines, /(prep|preparation)\s*time[:\-]\s*(.+)/i),
    cookTime: findLine(lines, /(cook)\s*time[:\-]\s*(.+)/i),
    totalTime: findLine(lines, /(total)\s*time[:\-]\s*(.+)/i),
    servings: findLine(lines, /(servings?|yield)[:\-]\s*(.+)/i)
  };
}

function findLine(lines, regex) {
  for (const line of lines) {
    const m = line.match(regex);
    if (m) return m[2] || m[1];
  }
  return null;
}

function inferTags(text) {
  const t = text.toLowerCase();
  const tags = [];

  if (t.includes("chicken")) tags.push("chicken");
  if (t.includes("beef")) tags.push("beef");
  if (t.includes("vegan")) tags.push("vegan");
  if (t.includes("gluten")) tags.push("gluten-free");

  return tags;
}

function inferCategories(text) {
  const t = text.toLowerCase();
  const cats = [];

  if (t.includes("cake") || t.includes("cookie")) cats.push("dessert");
  if (t.includes("soup")) cats.push("soup");
  if (t.includes("salad")) cats.push("salad");

  return cats;
}

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
   Unified Ingestion Engine
--------------------------------------------------------- */
async function extractRecipeFromFile(file) {
  let pages = [];
  let fullText = "";
  let sourceType = "";

  if (isDOCX(file)) {
    sourceType = "docx";
    fullText = await extractTextFromDOCX(file);
    pages = [{ pageNumber: 1, text: fullText }];

  } else if (isPDF(file)) {
    sourceType = "pdf";
    pages = await extractPagesFromPDF(file);
    fullText = pages.map(p => p.text).join("\n");

    if (fullText.trim().length < 20) {
      fullText = await extractTextFromScannedPDF(file);
      pages = [{ pageNumber: 1, text: fullText }];
    }

  } else if (isImage(file)) {
    sourceType = "image";
    fullText = await extractTextWithOCR(file);
    pages = [{ pageNumber: 1, text: fullText }];

  } else {
    sourceType = "text";
    fullText = await extractTextFromTextFile(file);
    pages = [{ pageNumber: 1, text: fullText }];
  }

  const parsed = await semanticParseRecipe(fullText);

  return {
    ...parsed,
    pages,
    fullText,
    filename: file.name,
    sourceType,
    created: Date.now()
  };
}

/* ---------------------------------------------------------
   Upload Button Handler
--------------------------------------------------------- */
document.getElementById("uploadBtn").onclick = async () => {
  const file = document.getElementById("fileInput").files[0];
  if (!file) return alert("Select a file first.");

  const recipe = await extractRecipeFromFile(file);

  const fileName = Date.now() + "_" + file.name;
  const storageRef = ref(storage, "recipes/" + fileName);

  const uploadTask = uploadBytesResumable(storageRef, file);

  uploadTask.on(
    "state_changed",
    null,
    (error) => console.error("Upload error:", error),
    async () => {
      const fileUrl = await getDownloadURL(uploadTask.snapshot.ref);
      recipe.fileUrl = fileUrl;

      await addDoc(collection(db, "recipes"), recipe);

      displayFile(fileUrl);
      alert("Recipe uploaded!");

      buildSearchIndex();
    }
  );
};

/* ---------------------------------------------------------
   Display Uploaded File
--------------------------------------------------------- */
function displayFile(url) {
  const preview = document.getElementById("preview");

  if (url.toLowerCase().includes(".pdf")) {
    preview.innerHTML = `
      <iframe src="${url}" width="100%" height="600px"></iframe>
    `;
    return;
  }

  if (
    url.toLowerCase().includes(".jpg") ||
    url.toLowerCase().includes(".jpeg") ||
    url.toLowerCase().includes(".png") ||
    url.toLowerCase().includes(".gif") ||
    url.toLowerCase().includes(".webp")
  ) {
    preview.innerHTML = `
      <img src="${url}" style="max-width:100%; height:auto;" />
    `;
    return;
  }

  preview.innerHTML = `
    <a href="${url}" target="_blank">Open Uploaded File</a>
  `;
}

/* ---------------------------------------------------------
   Lunr.js Search Index
--------------------------------------------------------- */
async function buildSearchIndex() {
  const snapshot = await getDocs(collection(db, "recipes"));
  recipeDocs = [];

  snapshot.forEach(doc => {
    recipeDocs.push({ id: doc.id, ...doc.data() });
  });

  lunrIndex = lunr(function () {
    this.ref("id");
    this.field("title");
    this.field("ingredients");
    this.field("steps");
    this.field("tags");
    this.field("categories");
    this.field("fullText");

    recipeDocs.forEach(r => this.add(r));
  });
}

buildSearchIndex();

/* ---------------------------------------------------------
   Search Box Handler
--------------------------------------------------------- */
document.getElementById("searchBox").oninput = (e) => {
  const query = e.target.value.trim();
  const resultsDiv = document.getElementById("results");
  resultsDiv.innerHTML = "";

  if (!query || !lunrIndex) return;

  const results = lunrIndex.search(query);

  results.forEach(result => {
    const r = recipeDocs.find(x => x.id === result.ref);

    resultsDiv.innerHTML += `
      <div>
        <h3>${r.title}</h3>
        <p><strong>Ingredients:</strong> ${r.ingredients.join(", ")}</p>
        <p><strong>Steps:</strong> ${r.steps.join(" ")}</p>
        <p><strong>Tags:</strong> ${r.tags.join(", ")}</p>
        <p><strong>Categories:</strong> ${r.categories.join(", ")}</p>
        <a href="${r.fileUrl}" target="_blank">Download Original File</a>
        <hr>
      </div>
    `;
  });
};
