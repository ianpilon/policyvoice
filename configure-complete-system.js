require('dotenv').config();
const fs = require('fs');

// Pass the backend URL (e.g. an ngrok tunnel or the Render URL) as the first argument.
const BACKEND_URL = process.argv[2] || 'https://shopvoice-invan-backend.onrender.com';

function assistantConfig(systemPrompt) {
  return {
    name: 'PolicyVoice',
    firstMessage: "PolicyVoice here. Tell me the insurer or policy form and what you need read, and I'll read the wording back to you.",
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
            name: 'lookup_coverage',
            description: "Look up the policy clause that covers a topic and return its exact wording with form, section, and page. Use whenever the caller asks what a policy says about a coverage, an exclusion, a deductible, or a condition (e.g. mold, wind-driven rain, sewer backup, hurricane deductible, loss of use, ordinance or law, duties after loss). Read the returned wording word for word; never paraphrase.",
            parameters: {
              type: 'object',
              properties: {
                topic: {
                  type: 'string',
                  description: "The coverage topic to read the clause for (e.g. 'mold from covered water damage', 'wind-driven rain interior', 'sewer or drain backup', 'hurricane deductible', 'duties after loss')"
                }
              },
              required: ['topic']
            }
          },
          server: {
            url: `${BACKEND_URL}/lookup-coverage`,
            timeoutSeconds: 45
          }
        },
        {
          type: 'function',
          async: false,
          function: {
            name: 'lookup_endorsement',
            description: 'Look up an endorsement or add-on by topic and return its exact wording plus how it modifies the base policy form. Use whenever the caller mentions an endorsement, an add-on, or asks whether something is changed by an add-on (e.g. water back-up, roof surfacing cosmetic, ordinance or law increase, limited mold coverage). Read the wording word for word.',
            parameters: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: "The endorsement topic (e.g. 'water back-up sump overflow', 'roof surfacing cosmetic damage', 'ordinance or law increased amount', 'limited fungi mold')"
                }
              },
              required: ['query']
            }
          },
          server: {
            url: `${BACKEND_URL}/lookup-endorsement`,
            timeoutSeconds: 45
          }
        },
        {
          type: 'function',
          async: false,
          function: {
            name: 'search_policy',
            description: "Search the full policy form documents (HO-3 homeowners, businessowners BOP, flood policy) and return the matching sections word for word. Use for any 'read me the section on' or 'what does the form say about' question when a specific clause lookup did not fit.",
            parameters: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: "Search query for policy form sections (e.g. 'loss settlement replacement cost', 'business income period of restoration', 'flood definition surface water')"
                }
              },
              required: ['query']
            }
          },
          server: {
            url: `${BACKEND_URL}/search-policy`,
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
      console.log('PolicyVoice assistant CREATED.');
      console.log(`Assistant ID: ${data.id}`);
      console.log('Add this to .env as VAPI_ASSISTANT_ID so future runs update instead of creating duplicates.');
    } else {
      console.log('PolicyVoice assistant updated.');
    }
    console.log('Backend:', BACKEND_URL);
    console.log('Tools wired: lookup_coverage, lookup_endorsement, search_policy');
  } catch (error) {
    console.error('Error:', error.message);
  }
}

configureAssistant();
