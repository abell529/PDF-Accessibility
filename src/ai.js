import OpenAI from "openai";
export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/** Simple wrapper around Chat Completions. */
export async function chat(model, system, user) {
const { choices } = await openai.chat.completions.create({
model,
messages: [
{ role: "system", content: system },
{ role: "user", content: user }
],
temperature: 0.2
});
return choices[0].message.content.trim();
}
