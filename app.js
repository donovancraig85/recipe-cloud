// ------------------------------
// Firebase Initialization
// ------------------------------
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Your Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyC-5n0z0qQvJxW8e8u8gYk5F8Yk5F8Yk5F8",
  authDomain: "recipes-cloud-6f09d.firebaseapp.com",
  projectId: "recipes-cloud-6f09d",
  storageBucket: "recipes-cloud-6f09d.firebasestorage.app",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef123456"
};

const app = initializeApp(firebaseConfig);
const storage = getStorage(app);
const db = getFirestore(app);

// ------------------------------
// DOM Elements
// ------------------------------
const fileInput = document.getElementById("fileInput");
const uploadBtn = document.getElementById("uploadBtn");
const previewDiv = document.getElementById("preview");
const searchBox = document.getElementById("searchBox");
const resultsDiv = document.getElementById("results");

// Lunr search index
let lunrIndex = null;
let allRecipes = [];

// ------------------------------
// Upload Button Handler
// ------------------------------
uploadBtn.addEventListener("click", async () => {
  const file = fileInput.files[0];
  if (!file) {
    alert("Please select a file first.");
    return;
  }

  previewDiv.innerHTML = "Processing file…";

  const extractedText = await extractTextFromFile(file);
  previewDiv.innerHTML = `<pre>${extractedText}</pre>`;

  const parsed = await semanticParseRecipe(extractedText);

  await saveRecipeToFirestore(parsed);

  await rebuildSearchIndex();

  alert("Recipe uploaded and parsed successfully!");
});

// ------------------------------
// Extract Text From File
// ------------------------------
async function extractTextFromFile(file) {
  const ext = file.name.toLowerCase();

  if (ext.endsWith(".pdf")) {
    return await extractPDF(file);
  } else if (ext.endsWith(".docx")) {
    return await extractDOCX(file);
  } else if (ext.endsWith(".jpg") || ext.endsWith(".png")) {
    return await extractImageOCR(file);
  } else if (ext.endsWith(".txt")) {
    return await file.text();
  } else {
    return "Unsupported file type.";
  }
}

// ------------------------------
// PDF Extraction
// ------------------------------
async function extractPDF(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(item => item.str).join(" ") + "\n";
  }
  return text;
}

// ------------------------------
// DOCX Extraction
// ------------------------------
async function extractDOCX(file) {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
}

// ------------------------------
// OCR Extraction
// ------------------------------
async function extractImageOCR(file) {
  const result = await Tesseract.recognize(file, "eng");
  return result.data.text;
}

// ------------------------------
// Semantic Parsing (Backend LLM)
// ------------------------------
async function semanticParseRecipe(text) {
  try {
    const response = await fetch(
      "https://us-east1-recipes-cloud-6f09d.cloudfunctions.net/RecipeParser",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text })
      }
    );

    const data = await response.json();
    return data;
  } catch (err) {
    console.error("RecipeParser error:", err);
    return fallbackParseRecipe(text);
  }
}

// ------------------------------
// Fallback Parser (Basic Heuristics)
// ------------------------------
function fallbackParseRecipe(text) {
  return {
    title: "Untitled Recipe",
    ingredients: text.split("\n").slice(0, 10),
    steps: text.split("\n").slice(10, 20),
    tags: [],
    categories: []
  };
}

// ------------------------------
// Save to Firestore
// ------------------------------
async function saveRecipeToFirestore(recipe) {
  await addDoc(collection(db, "recipes"), recipe);
}

// ------------------------------
// Rebuild Lunr Search Index
// ------------------------------
async function rebuildSearchIndex() {
  const snapshot = await getDocs(collection(db, "recipes"));
  allRecipes = snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));

  lunrIndex = lunr(function () {
    this.ref("id");
    this.field("title");
    this.field("ingredients");
    this.field("steps");

    allRecipes.forEach(r => this.add(r));
  });
}

// ------------------------------
// Search Handler
// ------------------------------
searchBox.addEventListener("input", () => {
  const query = searchBox.value.trim();
  if (!query || !lunrIndex) {
    resultsDiv.innerHTML = "";
    return;
  }

  const matches = lunrIndex.search(query);

  const html = matches
    .map(m => {
      const r = allRecipes.find(x => x.id === m.ref);
      return `
        <div class="result">
          <h3>${r.title}</h3>
          <p><strong>Ingredients:</strong> ${r.ingredients.join(", ")}</p>
        </div>
      `;
    })
    .join("");

  resultsDiv.innerHTML = html;
});
