import { Parser } from 'htmlparser2';

const APOD_ENDPOINT = 'https://science.nasa.gov/wp-json/wp/v2/apod-basic?per_page=1';
const GROUPME_ENDPOINT = 'https://api.groupme.com/v3/bots/post';
const PREFIX = 'nasa';
const MAX_MESSAGE_LENGTH = 1000;

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function getApod() {
  const result = await fetch(APOD_ENDPOINT);
  if (!result.ok) {
    console.error(`NASA APOD request failed: HTTP ${result.status}`);
    return null;
  }

  try {
    const entries = await result.json();
    return Array.isArray(entries) ? entries[0] : null;
  } catch {
    console.error('NASA APOD response was not valid JSON');
    return null;
  }
}

function plainText(html) {
  let text = '';
  const parser = new Parser({
    ontext(chunk) { text += chunk.replace(/\s+/gu, ' '); },
    onopentag(name) { if (name === 'br' || name === 'p') text += '\n'; },
  });
  parser.end(html);
  return text
    .replace(/ *\n */gu, '\n')
    .replace(/^\s*Explanation:\s*/u, '')
    .replace(/\s*Tomorrow['’]s picture:[^\n]*$/u, '')
    .trim();
}

async function postToGroupMe(botId, text) {
  const result = await fetch(GROUPME_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bot_id: botId, text }),
  });
  if (!result.ok) {
    console.error(`GroupMe rejected the reply: HTTP ${result.status}`);
  }
  return result.ok;
}

// Splits at the last sentence end, else the last whitespace, in the back half of
// the part so no message is a tiny fragment; otherwise splits at the limit.
function splitPoint(part) {
  const minimum = MAX_MESSAGE_LENGTH / 2;
  let sentenceEnd = 0;
  let whitespaceEnd = 0;
  for (const match of part.matchAll(/[.!?]["')\]]*\s+/gu)) sentenceEnd = match.index + match[0].length;
  for (const match of part.matchAll(/\s+/gu)) whitespaceEnd = match.index + match[0].length;
  if (sentenceEnd > minimum) return sentenceEnd;
  if (whitespaceEnd > minimum) return whitespaceEnd;
  return part.length;
}

function splitMessage(text) {
  const parts = [];
  let part = '';
  for (const character of text) {
    if (part.length + character.length > MAX_MESSAGE_LENGTH) {
      const splitAt = splitPoint(part);
      parts.push(part.slice(0, splitAt));
      part = part.slice(splitAt);
    }
    part += character;
  }
  if (part) parts.push(part);
  return parts;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/health' && request.method === 'GET') {
      return response({ status: 'ok' });
    }

    if (url.pathname !== '/receive') {
      return response({ error: 'Not found' }, 404);
    }

    if (request.method !== 'POST') {
      return response({ error: 'Method not allowed' }, 405);
    }

    if (!env.CALLBACK_SECRET) {
      console.error('CALLBACK_SECRET is not configured');
      return response({ error: 'Callback is not configured' }, 500);
    }
    if (url.searchParams.get('secret') !== env.CALLBACK_SECRET) {
      return response({ error: 'Unauthorized' }, 401);
    }

    let message;
    try {
      message = await request.json();
    } catch (error) {
      if (error instanceof SyntaxError) {
        return response({ error: 'Invalid JSON body' }, 400);
      }
      throw error;
    }

    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      return response({ error: 'Expected a JSON object' }, 400);
    }

    if (message.sender_type !== 'user') {
      return response({ message: 'Ignored non-user message' });
    }

    if (typeof message.text !== 'string' || !message.text.toLowerCase().startsWith(PREFIX)) {
      return response({ message: 'Ignored message' });
    }

    // MeBots adds bot_id to each callback; direct GroupMe bots use the configured one.
    const botId = typeof message.bot_id === 'string' && message.bot_id ? message.bot_id : env.GROUPME_BOT_ID;
    if (!botId) {
      return response({ error: 'bot_id is required (MeBots) or set GROUPME_BOT_ID (direct GroupMe bot)' }, 400);
    }

    const apod = await getApod();
    if (!apod || typeof apod.date !== 'string' || typeof apod.explanation !== 'string') {
      return response({ error: 'NASA APOD request failed' }, 502);
    }

    const imageUrl = (apod.media_type === 'image' && apod.hdurl) || apod.permalink || apod.url;
    if (typeof imageUrl !== 'string') {
      return response({ error: 'NASA APOD response did not include a media URL' }, 502);
    }

    const replies = splitMessage(`NASA Image of the Day ${apod.date}\n\n${plainText(apod.explanation)}`);
    replies.push(...splitMessage(imageUrl));

    for (const text of replies) {
      if (!(await postToGroupMe(botId, text))) {
        return response({ error: 'GroupMe rejected the reply' }, 502);
      }
    }

    return response({ message: 'Message received' });
  },
};
