import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../src/index.js';

const env = { CALLBACK_SECRET: 'test-secret' };
const callbackUrl = 'https://nasabot.test/receive?secret=test-secret';

test('health endpoint responds without calling external services', async () => {
  const result = await worker.fetch(new Request('https://nasabot.test/health'), {});

  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { status: 'ok' });
});

test('ignores messages without the command prefix', async () => {
  const result = await worker.fetch(
    new Request(callbackUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender_type: 'user', text: 'hello' }),
    }),
    env,
  );

  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { message: 'Ignored message' });
});

test('fetches APOD and posts both replies to GroupMe', async (context) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.startsWith('https://science.nasa.gov/wp-json/')) {
      return Response.json([{
        date: '2026-11-12',
        media_type: 'image',
        explanation: '<strong>Explanation:</strong> A NASA &amp; space image.',
        url: 'https://science.nasa.gov/image-article/example/',
        hdurl: 'https://images.example/apod.jpg',
      }]);
    }
    return new Response('{}', { status: 201 });
  };
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await worker.fetch(
    new Request(callbackUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender_type: 'user', text: 'NASA please', bot_id: 'test-bot-id' }),
    }),
    env,
  );

  assert.equal(result.status, 200);
  assert.equal(requests.length, 3);
  assert.equal(new URL(requests[0].url).searchParams.get('per_page'), '1');
  assert.deepEqual(
    requests.slice(1).map(({ init }) => JSON.parse(init.body)),
    [
      {
        bot_id: 'test-bot-id',
        text: 'NASA Image of the Day 2026-11-12\n\nA NASA & space image.',
      },
      { bot_id: 'test-bot-id', text: 'https://images.example/apod.jpg' },
    ],
  );
});

test('rejects malformed JSON', async () => {
  const result = await worker.fetch(
    new Request(callbackUrl, {
      method: 'POST',
      body: '{',
    }),
    env,
  );

  assert.equal(result.status, 400);
});

test('requires a callback secret before processing messages', async () => {
  const request = () => new Request('https://nasabot.test/receive', { method: 'POST', body: '{}' });
  assert.equal((await worker.fetch(request(), env)).status, 401);
  assert.equal((await worker.fetch(request(), {})).status, 500);
});

test('splits long explanations into GroupMe-sized messages without splitting emoji', async (context) => {
  const originalFetch = globalThis.fetch;
  const posts = [];
  globalThis.fetch = async (input, init = {}) => {
    if (String(input).startsWith('https://science.nasa.gov/wp-json/')) {
      return Response.json([{ date: '2026-11-12', media_type: 'image', explanation: 'x'.repeat(980) + '🚀'.repeat(20), hdurl: 'https://example.com/image' }]);
    }
    posts.push(JSON.parse(init.body).text);
    return new Response(null, { status: 201 });
  };
  context.after(() => { globalThis.fetch = originalFetch; });

  const result = await worker.fetch(new Request(callbackUrl, {
    method: 'POST',
    body: JSON.stringify({ sender_type: 'user', text: 'nasa', bot_id: 'bot' }),
  }), env);

  assert.equal(result.status, 200);
  assert.ok(posts.every((text) => text.length <= 1000));
  assert.equal(posts.slice(0, -1).join(''), `NASA Image of the Day 2026-11-12\n\n${'x'.repeat(980)}${'🚀'.repeat(20)}`);
});

test('splits long explanations at word boundaries without losing text', async (context) => {
  const originalFetch = globalThis.fetch;
  const posts = [];
  const explanation = `${'word '.repeat(195)}a longer final word`;
  globalThis.fetch = async (input, init = {}) => {
    if (String(input).startsWith('https://science.nasa.gov/wp-json/')) {
      return Response.json([{ date: '2026-11-12', media_type: 'image', explanation, hdurl: 'https://example.com/image' }]);
    }
    posts.push(JSON.parse(init.body).text);
    return new Response(null, { status: 201 });
  };
  context.after(() => { globalThis.fetch = originalFetch; });

  const result = await worker.fetch(new Request(callbackUrl, {
    method: 'POST',
    body: JSON.stringify({ sender_type: 'user', text: 'nasa', bot_id: 'bot' }),
  }), env);

  assert.equal(result.status, 200);
  const descriptionPosts = posts.slice(0, -1);
  assert.equal(descriptionPosts.length, 2);
  assert.ok(descriptionPosts.every((text) => text.length <= 1000));
  assert.ok(/\s$/u.test(descriptionPosts[0]));
  assert.equal(descriptionPosts.join(''), `NASA Image of the Day 2026-11-12\n\n${explanation}`);
});

test('prefers a sentence boundary over splitting a sentence between messages', async (context) => {
  const originalFetch = globalThis.fetch;
  const posts = [];
  const explanation = `${'word '.repeat(185)}A complete sentence. Then another: what's next?`;
  globalThis.fetch = async (input, init = {}) => {
    if (String(input).startsWith('https://science.nasa.gov/wp-json/')) {
      return Response.json([{ date: '2026-11-12', media_type: 'image', explanation, hdurl: 'https://example.com/image' }]);
    }
    posts.push(JSON.parse(init.body).text);
    return new Response(null, { status: 201 });
  };
  context.after(() => { globalThis.fetch = originalFetch; });

  const result = await worker.fetch(new Request(callbackUrl, {
    method: 'POST',
    body: JSON.stringify({ sender_type: 'user', text: 'nasa', bot_id: 'bot' }),
  }), env);

  assert.equal(result.status, 200);
  assert.equal(posts.length, 3);
  assert.ok(posts[0].endsWith('A complete sentence. '));
  assert.equal(posts[1], "Then another: what's next?");
  assert.equal(posts[0] + posts[1], `NASA Image of the Day 2026-11-12\n\n${explanation}`);
});

test('links to the article for video entries rather than the thumbnail', async (context) => {
  const originalFetch = globalThis.fetch;
  const posts = [];
  globalThis.fetch = async (input, init = {}) => {
    if (String(input).startsWith('https://science.nasa.gov/wp-json/')) {
      return Response.json([{
        date: '2026-10-28',
        media_type: 'video',
        explanation: 'A video.',
        hdurl: 'https://example.com/thumbnail.jpg',
        permalink: 'https://science.nasa.gov/image-article/video/',
      }]);
    }
    posts.push(JSON.parse(init.body).text);
    return new Response(null, { status: 201 });
  };
  context.after(() => { globalThis.fetch = originalFetch; });

  const result = await worker.fetch(new Request(callbackUrl, {
    method: 'POST',
    body: JSON.stringify({ sender_type: 'user', text: 'nasa', bot_id: 'bot' }),
  }), env);
  assert.equal(result.status, 200);
  assert.equal(posts[1], 'https://science.nasa.gov/image-article/video/');
});

test('reports downstream failure instead of claiming success', async (context) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 429 });
  context.after(() => { globalThis.fetch = originalFetch; });
  const result = await worker.fetch(new Request(callbackUrl, {
    method: 'POST',
    body: JSON.stringify({ sender_type: 'user', text: 'nasa', bot_id: 'bot' }),
  }), env);
  assert.equal(result.status, 502);
});

async function runWithApod(context, apodResponse) {
  const originalFetch = globalThis.fetch;
  const posts = [];
  globalThis.fetch = async (input, init = {}) => {
    if (String(input).startsWith('https://science.nasa.gov/wp-json/')) return apodResponse();
    posts.push(JSON.parse(init.body).text);
    return new Response(null, { status: 201 });
  };
  context.after(() => { globalThis.fetch = originalFetch; });
  const result = await worker.fetch(new Request(callbackUrl, {
    method: 'POST',
    body: JSON.stringify({ sender_type: 'user', text: 'nasa', bot_id: 'bot' }),
  }), env);
  return { result, posts };
}

test('never exceeds the message limit when a part starts with whitespace', async (context) => {
  const explanation = `${'x'.repeat(964)}.<br><br>${'y'.repeat(999)}🚀`;
  const { result, posts } = await runWithApod(context, () => Response.json([{ date: '2026-11-12', media_type: 'image', explanation, hdurl: 'https://example.com/image' }]));
  assert.equal(result.status, 200);
  assert.deepEqual(posts.filter((text) => text.length > 1000), []);
});

test('does not send a tiny fragment when the only sentence end is early', async (context) => {
  const explanation = `Hi. ${'word '.repeat(300)}`;
  const { result, posts } = await runWithApod(context, () => Response.json([{ date: '2026-11-12', media_type: 'image', explanation, hdurl: 'https://example.com/image' }]));
  assert.equal(result.status, 200);
  assert.ok(posts[0].length > 500, `first post was ${posts[0].length} characters`);
});

test('falls back to the article link when an image has no hdurl', async (context) => {
  const { result, posts } = await runWithApod(context, () => Response.json([{ date: '2026-11-12', media_type: 'image', explanation: 'An image.', url: 'https://science.nasa.gov/image-article/example/' }]));
  assert.equal(result.status, 200);
  assert.equal(posts[1], 'https://science.nasa.gov/image-article/example/');
});

test('falls back to url when a video has no permalink', async (context) => {
  const { result, posts } = await runWithApod(context, () => Response.json([{ date: '2026-11-12', media_type: 'video', explanation: 'A video.', url: 'https://science.nasa.gov/image-article/video/' }]));
  assert.equal(result.status, 200);
  assert.equal(posts[1], 'https://science.nasa.gov/image-article/video/');
});

test('collapses HTML source whitespace in explanations', async (context) => {
  const explanation = '<p>Hello\n   world</p>\n<p>Next</p>';
  const { result, posts } = await runWithApod(context, () => Response.json([{ date: '2026-11-12', media_type: 'image', explanation, hdurl: 'https://example.com/image' }]));
  assert.equal(result.status, 200);
  assert.equal(posts[0], 'NASA Image of the Day 2026-11-12\n\nHello world\nNext');
});

test('strips the Explanation label and Tomorrow\'s picture teaser', async (context) => {
  const explanation = '<strong>Explanation:</strong> Planets wander.<br><br><strong>Tomorrow\'s picture:</strong> what\'s next?';
  const { result, posts } = await runWithApod(context, () => Response.json([{ date: '2026-11-12', media_type: 'image', explanation, hdurl: 'https://example.com/image' }]));
  assert.equal(result.status, 200);
  assert.deepEqual(posts, ['NASA Image of the Day 2026-11-12\n\nPlanets wander.', 'https://example.com/image']);
});

test('uses GROUPME_BOT_ID for direct GroupMe callbacks without a bot_id', async (context) => {
  const originalFetch = globalThis.fetch;
  const botIds = [];
  globalThis.fetch = async (input, init = {}) => {
    if (String(input).startsWith('https://science.nasa.gov/wp-json/')) {
      return Response.json([{ date: '2026-11-13', media_type: 'image', explanation: 'An image.', hdurl: 'https://example.com/image' }]);
    }
    botIds.push(JSON.parse(init.body).bot_id);
    return new Response(null, { status: 202 });
  };
  context.after(() => { globalThis.fetch = originalFetch; });

  const result = await worker.fetch(new Request(callbackUrl, {
    method: 'POST',
    body: JSON.stringify({ sender_type: 'user', text: 'nasa' }),
  }), { ...env, GROUPME_BOT_ID: 'direct-bot' });

  assert.equal(result.status, 200);
  assert.deepEqual(botIds, ['direct-bot', 'direct-bot']);
});

test('rejects a callback with no bot_id when GROUPME_BOT_ID is not set', async () => {
  const result = await worker.fetch(new Request(callbackUrl, {
    method: 'POST',
    body: JSON.stringify({ sender_type: 'user', text: 'nasa' }),
  }), env);
  assert.equal(result.status, 400);
});

test('reports a non-JSON APOD response as an upstream failure', async (context) => {
  const { result } = await runWithApod(context, () => new Response('<html>maintenance</html>', { status: 200 }));
  assert.equal(result.status, 502);
});
