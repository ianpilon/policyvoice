require('dotenv').config();
const fs = require('fs');

// Pass the backend URL (e.g. an ngrok tunnel or the Render URL) as the first argument.
const BACKEND_URL = process.argv[2] || 'https://shopvoice-backend.onrender.com';

function assistantConfig(systemPrompt) {
  return {
    name: 'ShopVoice',
    firstMessage: "ShopVoice here. Give me a trouble code, a torque spec, or a procedure — what are you working on?",
    model: {
      provider: 'openai',
      model: 'gpt-4o',
      temperature: 0.5,
      messages: [
        {
          role: 'system',
          content: systemPrompt
        }
      ],
      tools: [
        {
          type: 'function',
          async: false,
          function: {
            name: 'lookup_dtc',
            description: "Look up an OBD-II diagnostic trouble code. Returns the code's meaning, system, severity, common causes, verified real fixes ranked by frequency, and a tech note. Use whenever the caller mentions a trouble code, a check engine light code, or asks what a code means or how to fix it.",
            parameters: {
              type: 'object',
              properties: {
                code: {
                  type: 'string',
                  description: 'The DTC, normalized to letter plus four digits (e.g. P0420, U0100, C0035). Convert spoken forms: "P oh four twenty" becomes P0420.'
                }
              },
              required: ['code']
            }
          },
          server: {
            url: `${BACKEND_URL}/lookup-dtc`,
            timeoutSeconds: 45
          }
        },
        {
          type: 'function',
          async: false,
          function: {
            name: 'lookup_spec',
            description: 'Look up a torque spec or fluid capacity by vehicle and component. ALWAYS include both the vehicle (year, make, model) and the component in the query. Use for any question about torque values, oil capacities, spark plug gaps, or fastener specs.',
            parameters: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: "Vehicle plus component (e.g. '2019 F-150 front caliper bracket bolts', 'Silverado 5.3 oil capacity', 'Civic lug nut torque')"
                }
              },
              required: ['query']
            }
          },
          server: {
            url: `${BACKEND_URL}/lookup-spec`,
            timeoutSeconds: 45
          }
        },
        {
          type: 'function',
          async: false,
          function: {
            name: 'search_procedures',
            description: "Search step-by-step repair and relearn procedures: crankshaft position (CASE) relearn, front brake jobs, TPMS relearn, serpentine belt replacement, O2 sensor replacement, EVAP smoke testing. ALWAYS use this for any 'how do I' or 'walk me through' question rather than answering from general knowledge.",
            parameters: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: "Search query for procedures (e.g. 'crank sensor relearn GM', 'TPMS relearn F-150', 'EVAP smoke test pressure')"
                }
              },
              required: ['query']
            }
          },
          server: {
            url: `${BACKEND_URL}/search-procedures`,
            timeoutSeconds: 45
          }
        }
      ]
    }
  };
}

async function configureAssistant() {
  try {
    if (!process.env.VAPI_API_KEY) {
      console.error('VAPI_API_KEY is not set. Copy .env.example to .env and fill it in.');
      return;
    }

    const systemPrompt = fs.readFileSync('./system-prompt.txt', 'utf8');
    const config = assistantConfig(systemPrompt);

    const assistantId = process.env.VAPI_ASSISTANT_ID;
    const creating = !assistantId;

    const response = await fetch(
      creating ? 'https://api.vapi.ai/assistant' : `https://api.vapi.ai/assistant/${assistantId}`,
      {
        method: creating ? 'POST' : 'PATCH',
        headers: {
          'Authorization': `Bearer ${process.env.VAPI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(config)
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error('Failed to configure assistant');
      console.error('Status:', response.status);
      console.error('Error:', JSON.stringify(data, null, 2));
      return;
    }

    if (creating) {
      console.log('ShopVoice assistant CREATED.');
      console.log(`Assistant ID: ${data.id}`);
      console.log('Add this to .env as VAPI_ASSISTANT_ID so future runs update instead of creating duplicates.');
    } else {
      console.log('ShopVoice assistant updated.');
    }
    console.log('Backend:', BACKEND_URL);
    console.log('Tools wired: lookup_dtc, lookup_spec, search_procedures');
  } catch (error) {
    console.error('Error:', error.message);
  }
}

configureAssistant();
