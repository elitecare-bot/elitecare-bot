const http = require("http");
const https = require("https");

// ============ CONFIGURATION ============
const PORT = process.env.PORT || 3000;
const GROQ_API_KEY = process.env.GROQ_API_KEY || "YOUR_GROQ_API_KEY_HERE";
const GROQ_MODEL = "llama-3.1-8b-instant";

const SYSTEM_PROMPT = `You are the WhatsApp receptionist for Elitecare Medical Center in Abu Dhabi. Talk like a real, friendly human receptionist — not a robot.

RULES:
- Keep messages SHORT — 1 to 2 sentences max
- Be warm and natural, like texting a friend
- Ask ONE question at a time, never multiple
- Do NOT list all services or doctors unless specifically asked
- Do NOT share clinic details upfront — only when relevant to what the patient needs
- If someone says hi, just greet them and ask how you can help
- Use their name once you know it
- Switch to Arabic if they write in Arabic

CLINIC DETAILS (use only when needed):
- Location: Al Falah Tower, 1st Floor, Next to Elite Motors, Al Falah St - Muroor Rd, Zone 1, Abu Dhabi
- Hours: Every day, 8 AM to 10 PM

CONVERSATION STYLE:
- Someone says 'Hi' → Reply: 'Hi there! How can I help you today?'
- They mention a problem → Ask what kind of issue, then suggest the right doctor
- They want an appointment → Ask what day and time works for them
- They ask about price → Say 'It depends on the treatment — the doctor will explain everything during your visit. Would you like to book a consultation?'
- They ask for location/hours → Share only what they asked about
- If something sounds urgent → Say 'That sounds like it needs quick attention, let me connect you with our team right away'

You are having a WhatsApp chat. Respond with ONLY the message text. Nothing else.`;

// ============ GROQ API CALL ============
function callGroq(userMessage) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage || "hi" }
      ],
      max_tokens: 150
    });

    const options = {
      hostname: "api.groq.com",
      path: "/openai/v1/chat/completions",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_API_KEY}`,
        "Content-Length": Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (json.choices && json.choices[0] && json.choices[0].message) {
            resolve(json.choices[0].message.content);
          } else if (json.error) {
            console.error("Groq API error:", json.error.message);
            resolve("Sorry, I'm having trouble right now. Please call us at +971585835312.");
          } else {
            console.error("Unexpected response:", data);
            resolve("Sorry, I'm having trouble right now. Please call us at +971585835312.");
          }
        } catch (e) {
          console.error("Parse error:", e.message);
          resolve("Sorry, I'm having trouble right now. Please call us at +971585835312.");
        }
      });
    });

    req.on("error", (e) => {
      console.error("Request error:", e.message);
      resolve("Sorry, I'm having trouble right now. Please call us at +971585835312.");
    });

    req.write(body);
    req.end();
  });
}

// ============ HTTP SERVER ============
const server = http.createServer(async (req, res) => {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  // Health check
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "Elitecare AI Bot" }));
    return;
  }

  // Main chat endpoint - WhatAPI External API calls this
  if (req.method === "POST" && req.url === "/chat") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", async () => {
      try {
        const data = JSON.parse(body);

        // Accept message from multiple possible field names
        const userMessage = data.message || data.text || data.content ||
                           (data.messages && data.messages[1] && data.messages[1].content) ||
                           "hi";

        console.log("Received message:", userMessage);

        const reply = await callGroq(userMessage);
        console.log("AI reply:", reply);

        // Return simple flat JSON
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ reply: reply }));
      } catch (e) {
        console.error("Error:", e.message);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          reply: "Sorry, I'm having trouble right now. Please call us at +971585835312."
        }));
      }
    });
    return;
  }

  // 404
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, () => {
  console.log(`Elitecare AI Bot server running on port ${PORT}`);
});
