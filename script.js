import { Groq } from "groq-sdk";

const groq = new Groq({
  apiKey: "GROQ_API_KEY_PLACEHOLDER_2", // ⚠️ usa variable de entorno
});

console.log(process.env.GROQ_API_KEY);

// 🔧 Configuración global
const CONFIG = {
  temperature: 0.7,
  top_p: 1,
  max_completion_tokens: 400, // seguro para evitar errores TPM
};

// 📦 Lista de modelos (puedes agregar más aquí)
const MODELS = [
  "openai/gpt-oss-120b",
  // "qwen/qwen3-32b",
  // agrega más:
  // "llama-3.3-70b",
  // "mixtral-8x7b"
];

// 💬 Prompt base
const PROMPT = "Explícame qué es una API en 2 líneas";

// 🚀 Función para probar un modelo
async function testModel(model) {
  console.log(`\n\n===== 🧠 Probando modelo: ${model} =====\n`);

  try {
    const completion = await groq.chat.completions.create({
      model,
      messages: [
        {
          role: "user",
          content: PROMPT,
        },
      ],
      ...CONFIG,
      stream: true,
    });

    for await (const chunk of completion) {
      process.stdout.write(chunk.choices[0]?.delta?.content || "");
    }

    console.log("\n\n✅ Fin de respuesta\n");

  } catch (error) {
    console.error(`\n❌ Error con modelo ${model}:`);
    console.error(error.message);
  }
}

// 🔁 Ejecutar todos los modelos en serie
async function main() {
  for (const model of MODELS) {
    await testModel(model);
  }
}

main();