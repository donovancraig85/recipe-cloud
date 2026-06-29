(async () => {
  const url = "https://raw.githubusercontent.com/xenova/transformers.js/main/dist/transformers-micro.umd.min.js";

  const response = await fetch(url);
  const code = await response.text();

  // Create a Blob containing the JS code
  const blob = new Blob([code], { type: "application/javascript" });

  // Create a temporary URL for the Blob
  const blobUrl = URL.createObjectURL(blob);

  // Load the script from the Blob URL
  const script = document.createElement("script");
  script.src = blobUrl;
  document.head.appendChild(script);

  console.log("Transformers.js micro runtime loaded");
})();
