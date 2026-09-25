const http = require("http");
const https = require("https");

// ============ CONFIGURATION ============
const PORT = process.env.PORT || 3000;
const GROQ_API_KEY = process.env.GROQ_API_KEY || "YOUR_GROQ_API_KEY_HERE";
const GROQ_MODEL = "llama-3.1-8b-instant";
const WHATAPI_TOKEN = process.env.WHATAPI_TOKEN || "YOUR_WHATAPI_TOKEN_HERE";
const WHATAPI_URL = process.env.WHATAPI_URL || "https://api.whatapi.in";
const WEBHOOK_VERIFY_TOKEN = "elitecare2024";

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

// ============ SEND WHATSAPP MESSAGE VIA WHATAPI ============
function sendWhatsAppMessage(phone, message) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      to: phone,
      type: "text",
      text: { body: message }
    });

    // Parse the WHATAPI_URL to get hostname and path
    const url = new URL(WHATAPI_URL + "/api/v1/message/send");

    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${WHATAPI_TOKEN}`,
        "Content-Length": Buffer.byteLength(body)
      }
    };

    console.log(`Sending reply to ${phone}: ${message}`);
    console.log(`API URL: ${url.hostname}${url.pathname}`);

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        console.log(`Send message response (${res.statusCode}):`, data);
        resolve(data);
      });
    });

    req.on("error", (e) => {
      console.error("Send message error:", e.message);
      reject(e);
    });

    req.write(body);
    req.end();
  });
}

// ============ EXTRACT MESSAGE FROM WEBHOOK ============
function extractMessage(data) {
  // Try WhatAPI / WhatsApp Cloud API format
  try {
    if (data.entry && data.entry[0]) {
      const changes = data.entry[0].changes;
      if (changes && changes[0] && changes[0].value && changes[0].value.messages) {
        const msg = changes[0].value.messages[0];
        const from = msg.from;
        const text = msg.text ? msg.text.body : null;
        const type = msg.type;
        return { from, text, type };
      }
    }
  } catch (e) {}

  // Try flat format: { from: "phone", message: "text" }
  try {
    if (data.from && (data.message || data.text || data.body)) {
      return {
        from: data.from,
        text: data.message || data.text || data.body,
        type: "text"
      };
    }
  } catch (e) {}

  // Try WhatAPI specific: { phone, message }
  try {
    if (data.phone && (data.message || data.text)) {
      return {
        from: data.phone,
        text: data.message || data.text,
        type: "text"
      };
    }
  } catch (e) {}

  // Try: { data: { from, body } }
  try {
    if (data.data && data.data.from) {
      return {
        from: data.data.from,
        text: data.data.body || data.data.message || data.data.text,
        type: "text"
      };
    }
  } catch (e) {}

  return null;
}

// ============ PARSE URL QUERY PARAMS ============
function parseQuery(url) {
  const params = {};
  const qIndex = url.indexOf("?");
  if (qIndex === -1) return params;
  const query = url.substring(qIndex + 1);
  query.split("&").forEach((pair) => {
    const [key, val] = pair.split("=");
    params[decodeURIComponent(key)] = decodeURIComponent(val || "");
  });
  return params;
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

  const urlPath = req.url.split("?")[0];

  // ---- Health check ----
  if (req.method === "GET" && urlPath === "/") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "Elitecare AI Bot" }));
    return;
  }

  // ---- Webhook verification (GET) ----
  if (req.method === "GET" && urlPath === "/webhook") {
    const params = parseQuery(req.url);
    console.log("Webhook verification request:", params);

    // Meta/WhatsApp standard format
    const challenge = params["hub.challenge"] || params["challenge"];
    if (challenge) {
      console.log("Returning challenge:", challenge);
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(challenge);
      return;
    }

    // If no challenge param, just return 200 OK
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("OK");
    return;
  }

  // ---- Webhook incoming message (POST) ----
  if (req.method === "POST" && urlPath === "/webhook") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", async () => {
      // Respond immediately with 200 so WhatAPI knows we got it
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "received" }));

      try {
        const data = JSON.parse(body);
        console.log("=== WEBHOOK RECEIVED ===");
        console.log(JSON.stringify(data, null, 2));

        const msg = extractMessage(data);

        if (msg && msg.text && msg.from) {
          console.log(`Message from ${msg.from}: ${msg.text}`);

          // Get AI reply
          const reply = await callGroq(msg.text);
          console.log(`AI reply: ${reply}`);

          // Send reply back via WhatAPI
          await sendWhatsAppMessage(msg.from, reply);
        } else {
          console.log("Could not extract message from webhook data");
        }
      } catch (e) {
        console.error("Webhook processing error:", e.message);
        console.error("Raw body:", body);
      }
    });
    return;
  }

  // ---- Legacy chat endpoint (keep for testing) ----
  if (req.method === "POST" && urlPath === "/chat") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", async () => {
      try {
        const data = JSON.parse(body);
        const userMessage = data.message || data.text || "hi";
        console.log("Chat received:", userMessage);
        const reply = await callGroq(userMessage);
        console.log("Chat reply:", reply);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ reply: reply }));
      } catch (e) {
        console.error("Chat error:", e.message);
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
  console.log(`Webhook URL: /webhook`);
  console.log(`Chat URL: /chat`);
});
