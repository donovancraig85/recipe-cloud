const functions = require("firebase-functions");
const { pipeline } = require("@xenova/transformers");

exports.RecipeParser = functions.https.onRequest(async (req, res) => {
  try {
    const text = req.body.text;

    if (!text) {
      return res.status(400).json({ error: "Missing text" });
    }

    const generator = await pipeline("text-generation", "Xenova/distilgpt2");

    const prompt = `
Extract the recipe from the following text and return JSON with:
title, ingredients[], steps[], tags[], categories[].

Text:
${text}

JSON:
`;

    const output = await generator(prompt, {
      max_new_tokens: 300,
      temperature: 0.2,
    });

    const generated = output[0].generated_text;
    const jsonStart = generated.indexOf("{");
    const jsonEnd = generated.lastIndexOf("}");

    let parsed = {};
    if (jsonStart !== -1 && jsonEnd !== -1) {
      parsed = JSON.parse(generated.substring(jsonStart, jsonEnd + 1));
    }

    res.json(parsed);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.toString() });
  }
});
