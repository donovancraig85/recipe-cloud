(async () => {
  const url = "https://cdn.jsdelivr.net/npm/@xenova/transformers/dist/transformers-lite.umd.min.js";

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error("Failed to fetch Transformers.js: " + response.status);
    }

    const code = await response.text();

    // Create a Blob containing the JS code
    const blob = new Blob([code], { type: "application/javascript" });

    // Create a temporary URL for the Blob
    const blobUrl = URL.createObjectURL(blob);

    // Load the script from the Blob URL
    const script = document.createElement("script");
    script.src = blobUrl;
    document.head.appendChild(script);

    console.log("Transformers.js Lite runtime loaded from jsDelivr");
  } catch (err) {
    console.error("Transformers loader error:", err);
  }
})();
