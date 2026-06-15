require('dotenv').config();
const fs = require('fs');

// Pass the backend URL (e.g. an ngrok tunnel or the Render URL) as the first argument.
const BACKEND_URL = process.argv[2] || 'https://shopvoice-invan-backend.onrender.com';

function assistantConfig(systemPrompt) {
  return {
    name: 'PolicyVoice',
    firstMessage: "Hi, this is PolicyVoice. I'm reading the homeowner's policy you've got on file. What can I read for you, a coverage, an exclusion, or an endorsement?",
    model: {
      provider: 'openai',
      model: 'gpt-4o',
      temperature: 0.3,
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
            description: "Look up the policy clause that covers a topic in the SE Mutual Homeowner's Package and return its exact wording with section and page. Use whenever the caller asks what the policy says about a coverage, an exclusion, a deductible, or a condition (e.g. water or sewer backup, wind-driven rain, fungi or mould, by-law, additional living expense, deductible, requirements after loss). Read the returned wording word for word; never paraphrase.",
            parameters: {
              type: 'object',
              properties: {
                topic: {
                  type: 'string',
                  description: "The coverage topic to read the clause for (e.g. 'water or sewer backup', 'wind-driven rain interior', 'fungi or mould', 'by-law increased cost', 'additional living expense', 'requirements after loss')"
                }
              },
              required: ['topic']
            }
          },
          messages: [
            { type: 'request-start', content: 'One moment, pulling that clause.' }
          ],
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
            description: 'Look up an endorsement or restriction by topic and return its exact wording plus how it changes the base policy. Use whenever the caller mentions an endorsement, an add-on, or a restriction of coverage (e.g. sewer backup, building by-law, roof restriction, ice damming, collapse). Read the wording word for word.',
            parameters: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: "The endorsement or restriction topic (e.g. 'sewer backup', 'building by-law coverage', 'roof restriction windstorm hail', 'ice damming', 'collapse')"
                }
              },
              required: ['query']
            }
          },
          messages: [
            { type: 'request-start', content: 'One moment, pulling that endorsement.' }
          ],
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
            description: "Search the full SE Mutual Homeowner's Package sections (Section I property coverage, Section III statutory conditions, Section IV and V restrictions and endorsements) and return the matching wording word for word. Use for any 'read me the section on' or 'what does the policy say about' question when a specific clause lookup did not fit.",
            parameters: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: "Search query for policy sections (e.g. 'additional living expense unfit for occupancy', 'tear out water damage', 'proof of loss requirements after loss')"
                }
              },
              required: ['query']
            }
          },
          messages: [
            { type: 'request-start', content: 'One moment, searching the policy.' }
          ],
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
