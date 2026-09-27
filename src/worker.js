// File: src/worker.js
import { calculateScoreBenchmark } from './benchmark.js';

addEventListener('fetch', (event) => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const url = new URL(request.url);
  const reportId = url.pathname.split('/').pop();

  if (request.method === 'GET' && url.pathname.startsWith('/score/')) {
    try {
      const score = await calculateScoreBenchmark(reportId);
      return new Response(JSON.stringify({ score }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      return new Response(error.message, { status: 500 });
    }
  }

  return new Response('Not Found', { status: 404 });
}