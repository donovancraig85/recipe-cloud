/* ---------------------------------------------------------
   PDF.js Worker Fix (required for GitHub Pages)
--------------------------------------------------------- */
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

/* ---------------------------------------------------------
   Firebase References
--------------------------------------------------------- */
const storage = firebase.storage();
const db = firebase.firestore();

let lunrIndex = null;
let recipeDocs = [];

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
   Scanned PDF OCR (Render each page to image)
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
   DOCX Extraction (Mammoth)
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
  const categories = inferCategories(fullText);

  return { title, ingredients, steps, metadata, tags, categories };
}

function findLine(lines, regex) {
  for (const line of lines) {
    const m = line.match(regex);
    if (m) return m[2] || m[1];
  }
  return null;
}

function extractSection(lines, headerRegex) {
  const idx = lines.findIndex(l => headerRegex.test(l));
  if (idx === -1) return [];
  const section = [];
  for (let i = idx + 1; i < lines.length; i++) {
    if (/^[A-Z][A-Za-z\s]+:$/.test(lines[i])) break;
    section.push(lines[i]);
  }
  return section;
}

function inferTags(text) {
  const tags = [];
  const lower = text.toLowerCase();
  if (lower.includes("chicken")) tags.push("chicken");
  if (lower.includes("beef")) tags.push("beef");
  if (lower.includes("vegan")) tags.push("vegan");
  if (lower.includes("gluten")) tags.push("gluten-free");
  return tags;
}

function inferCategories(text) {
  const cats = [];
  const lower = text.toLowerCase();
  if (lower.includes("cake") || lower.includes("cookie")) cats.push("dessert");
  if (lower.includes("soup")) cats.push("soup");
  if (lower.includes("salad")) cats.push("salad");
  return cats;
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

  const parsed = parseRecipeText(fullText);

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

  const storageRef = storage.ref("recipes/" + file.name);
  await storageRef.put(file);
  const fileUrl = await storageRef.getDownloadURL();

  recipe.fileUrl = fileUrl;

  await db.collection("recipes").add(recipe);

  alert("Recipe uploaded!");
  buildSearchIndex();
};

/* ---------------------------------------------------------
   Lunr.js Search Index
--------------------------------------------------------- */
async function buildSearchIndex() {
  const snapshot = await db.collection("recipes").get();
  recipeDocs = [];

  snapshot.forEach(doc => {
    const data = doc.data();
    recipeDocs.push({ id: doc.id, ...data });
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
