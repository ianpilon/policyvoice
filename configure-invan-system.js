require('dotenv').config();
const fs = require('fs');

// Pass the backend URL (e.g. an ngrok tunnel or the Render URL) as the first argument.
const BACKEND_URL = process.argv[2] || 'https://shopvoice-invan-backend.onrender.com';

function assistantConfig(systemPrompt) {
  return {
    name: 'Voice Operating System',
    firstMessage: "Voice Operating System here. Want a briefing on a claim file, an adjuster check for an area, or should I log a follow-up?",
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
            name: 'claim_briefing',
            description: "Assemble a spoken brief on a claim file: claim number, claimant, insurer and policy form, the loss, current status, the next deadline and days remaining, the assigned adjuster, and a working note. Use whenever the operator asks 'what's the story on this file', asks about a claim by number, or asks about a claimant or location.",
            parameters: {
              type: 'object',
              properties: {
                claim: {
                  type: 'string',
                  description: "The claim the operator named — a claim number like 'GCC-2287', a claimant like 'the Calloway file', or a location like 'Naples'."
                }
              },
              required: ['claim']
            }
          },
          server: {
            url: `${BACKEND_URL}/briefing`,
            timeoutSeconds: 45
          }
        },
        {
          type: 'function',
          async: false,
          function: {
            name: 'roster_check',
            description: "Check which adjusters are available in an area right now, how many open files each has, and who is full or deployed. Use for any 'do I have an adjuster', 'who's free', or 'who can take this' question about a region.",
            parameters: {
              type: 'object',
              properties: {
                region: {
                  type: 'string',
                  description: "The area the operator named, e.g. 'Fort Myers', 'Naples', 'Tampa'."
                }
              },
              required: ['region']
            }
          },
          server: {
            url: `${BACKEND_URL}/roster-check`,
            timeoutSeconds: 45
          }
        },
        {
          type: 'function',
          async: false,
          function: {
            name: 'capture_task',
            description: "Log a follow-up, dispatch, or note dictated by the operator while driving. Extract the claim, the task, the action (order, follow up, dispatch, note), and any date. Task or action alone is enough. Use whenever the operator says to log, note, order, dispatch, or follow up on something.",
            parameters: {
              type: 'object',
              properties: {
                claim: { type: 'string', description: "Claim the task is for, if named (e.g. 'GCC-2287' or 'the Calloway file')." },
                task: { type: 'string', description: "The thing to do (e.g. 'order an engineer report')." },
                action: { type: 'string', description: "What kind of action (e.g. 'order', 'follow up', 'dispatch', 'note')." },
                date: { type: 'string', description: "Any timing the operator gave (e.g. 'next Tuesday')." }
              },
              required: []
            }
          },
          server: {
            url: `${BACKEND_URL}/capture-task`,
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

    const systemPrompt = fs.readFileSync('./invan-system-prompt.txt', 'utf8');
    const config = assistantConfig(systemPrompt);

    // Separate assistant ID from ShopVoice so the two products stay independent.
    const assistantId = process.env.INVAN_ASSISTANT_ID;
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
      console.log('Voice Operating System assistant CREATED.');
      console.log(`Assistant ID: ${data.id}`);
      console.log('Add this to .env as INVAN_ASSISTANT_ID, and put it in index.html (APPS.invan.assistantId).');
    } else {
      console.log('Voice Operating System assistant updated.');
    }
    console.log('Backend:', BACKEND_URL);
    console.log('Tools wired: claim_briefing, roster_check, capture_task');
  } catch (error) {
    console.error('Error:', error.message);
  }
}

configureAssistant();
