(async () => {
  const url = "https://raw.githubusercontent.com/xenova/transformers.js/main/dist/transformers-micro.umd.min.js";

  const response = await fetch(url);
  const code = await response.text();

  const script = document.createElement("script");
  script.type = "text/javascript";
  script.textContent = code;
  document.head.appendChild(script);

  console.log("Transformers.js micro runtime loaded");
})();
