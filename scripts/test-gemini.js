const https = require('https');

const key = process.env.GEMINI_API_KEY || 'YOUR_GEMINI_API_KEY';

const data = JSON.stringify({
  contents: [
    {
      parts: [
        { text: "Hello! Answer in 5 words." }
      ]
    }
  ]
});

// Test gemini-2.5-flash or gemini-2.0-flash or gemini-1.5-flash
const models = [
  'gemini-3.8-flash',
  'gemini-3.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-pro-latest'
];

function testModel(modelName) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'generativelanguage.googleapis.com',
      port: 443,
      path: `/v1beta/models/${modelName}:generateContent?key=${key}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        console.log(`\n=== MODEL: ${modelName} === Status: ${res.statusCode}`);
        try {
          const parsed = JSON.parse(body);
          if (parsed.candidates && parsed.candidates[0]) {
            console.log('SUCCESS! Reply:', parsed.candidates[0].content.parts[0].text);
          } else {
            console.log('Response:', JSON.stringify(parsed, null, 2));
          }
        } catch {
          console.log('Raw body:', body);
        }
        resolve();
      });
    });

    req.on('error', (e) => {
      console.error(`Error on ${modelName}:`, e.message);
      resolve();
    });

    req.write(data);
    req.end();
  });
}

async function run() {
  for (const m of models) {
    await testModel(m);
  }
}

run();
