// Connect to Firebase services
const storage = firebase.storage();
const db = firebase.firestore();

/*
  UPLOAD RECIPE FILE
  ------------------
  1. Read file from browser
  2. Extract text (basic text extraction)
  3. Upload file to Firebase Storage
  4. Save recipe text + file URL to Firestore
*/

document.getElementById("uploadBtn").onclick = async () => {
  const file = document.getElementById("fileInput").files[0];

  if (!file) {
    alert("Please select a file first.");
    return;
  }

  // Read file text
  const reader = new FileReader();

  reader.onload = async () => {
    const text = reader.result;

    try {
      // Upload file to Firebase Storage
      const storageRef = storage.ref("recipes/" + file.name);
      await storageRef.put(file);

      // Get public download URL
      const fileUrl = await storageRef.getDownloadURL();

      // Save recipe text + metadata to Firestore
      await db.collection("recipes").add({
        text: text,
        fileUrl: fileUrl,
        filename: file.name,
        created: Date.now()
      });

      alert("Recipe uploaded to the cloud!");
    } catch (err) {
      console.error("Upload error:", err);
      alert("Upload failed. Check console.");
    }
  };

  reader.readAsText(file);
};


/*
  SEARCH RECIPES
  --------------
  1. User types in search box
  2. Query Firestore for all recipes
  3. Filter by text match
  4. Display results
*/

document.getElementById("searchBox").oninput = async (e) => {
  const query = e.target.value.toLowerCase();
  const resultsDiv = document.getElementById("results");
  resultsDiv.innerHTML = "";

  try {
    const snapshot = await db.collection("recipes").get();

    snapshot.forEach(doc => {
      const data = doc.data();

      if (data.text.toLowerCase().includes(query)) {
        resultsDiv.innerHTML += `
          <div>
            <p><strong>${data.filename}</strong></p>
            <p>${data.text}</p>
            <a href="${data.fileUrl}" target="_blank">Download original file</a>
            <hr>
          </div>
        `;
      }
    });
  } catch (err) {
    console.error("Search error:", err);
    resultsDiv.innerHTML = "<p>Error loading recipes.</p>";
  }
};
