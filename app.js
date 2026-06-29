// Firebase config
const firebaseConfig = {
  apiKey: "YOUR_KEY",
  authDomain: "YOUR_DOMAIN",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_BUCKET",
};

firebase.initializeApp(firebaseConfig);

const storage = firebase.storage();
const db = firebase.firestore();

// Upload file + extract text
document.getElementById("uploadBtn").onclick = async () => {
  const file = document.getElementById("fileInput").files[0];
  const reader = new FileReader();

  reader.onload = async () => {
    const text = reader.result;

    // Upload file to Firebase Storage
    const ref = storage.ref("recipes/" + file.name);
    await ref.put(file);
    const url = await ref.getDownloadURL();

    // Save recipe text + file URL
    await db.collection("recipes").add({
      text,
      fileUrl: url,
      created: Date.now()
    });

    alert("Uploaded to cloud!");
  };

  reader.readAsText(file);
};

// Search
document.getElementById("searchBox").oninput = async e => {
  const q = e.target.value.toLowerCase();
  const resultsDiv = document.getElementById("results");
  resultsDiv.innerHTML = "";

  const snap = await db.collection("recipes").get();
  snap.forEach(doc => {
    const data = doc.data();
    if (data.text.toLowerCase().includes(q)) {
      resultsDiv.innerHTML += `<p>${data.text}</p><hr>`;
    }
  });
};
