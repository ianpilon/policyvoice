require('dotenv').config();
const fs = require('fs');

// Pass the backend URL (e.g. an ngrok tunnel or the Render URL) as the first argument.
const BACKEND_URL = process.argv[2] || 'https://shopvoice-backend.onrender.com';

function assistantConfig(systemPrompt) {
  return {
    name: 'In-Van Co-Pilot',
    firstMessage: "Co-Pilot here. Want a briefing for your next stop, an inventory check, or should I log something?",
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
            name: 'pre_stop_briefing',
            description: "Assemble a spoken pre-stop briefing for an upcoming stop or a specific customer: who is there, outstanding balances and days past due, open special orders, warranty items ready to hand off, and last-visit context. Use whenever the operator asks 'what's the story at this stop', asks about a stop or shop by name, or asks about a specific customer.",
            parameters: {
              type: 'object',
              properties: {
                stop: {
                  type: 'string',
                  description: "The stop or customer the operator named — a shop/location like 'Hennepin' or 'Lakeside', or a customer name like 'Mike' or 'Sam Whitfield'."
                }
              },
              required: ['stop']
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
            name: 'inventory_check',
            description: "Check whether an item is on the van right now, how many, where it is stored, and whether it is below the minimum stock level. Use for any 'do I have', 'is there', or 'how many' question about tools or stock on the van.",
            parameters: {
              type: 'object',
              properties: {
                item: {
                  type: 'string',
                  description: "The item the operator named, e.g. '3/8 torque wrench', '18 volt ratchet', '1/2 inch impact'."
                }
              },
              required: ['item']
            }
          },
          server: {
            url: `${BACKEND_URL}/inventory-check`,
            timeoutSeconds: 45
          }
        },
        {
          type: 'function',
          async: false,
          function: {
            name: 'capture_order',
            description: "Log a special order, follow-up, or note dictated by the operator while driving. Extract the customer, the item, the action (special order, follow-up, note), and any date. Item or action alone is enough. Use whenever the operator says to log, note, order, or follow up on something.",
            parameters: {
              type: 'object',
              properties: {
                customer: { type: 'string', description: "Customer the item is for, if named (e.g. 'Mike')." },
                item: { type: 'string', description: "The product or thing involved (e.g. 'KRA roll cab')." },
                action: { type: 'string', description: "What to do (e.g. 'special order', 'follow up', 'note')." },
                date: { type: 'string', description: "Any timing the operator gave (e.g. 'next Tuesday')." }
              },
              required: []
            }
          },
          server: {
            url: `${BACKEND_URL}/capture-order`,
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
      console.log('In-Van Co-Pilot assistant CREATED.');
      console.log(`Assistant ID: ${data.id}`);
      console.log('Add this to .env as INVAN_ASSISTANT_ID, and put it in index.html (APPS.invan.assistantId).');
    } else {
      console.log('In-Van Co-Pilot assistant updated.');
    }
    console.log('Backend:', BACKEND_URL);
    console.log('Tools wired: pre_stop_briefing, inventory_check, capture_order');
  } catch (error) {
    console.error('Error:', error.message);
  }
}

configureAssistant();
