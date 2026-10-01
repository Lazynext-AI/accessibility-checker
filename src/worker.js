// File: src/worker.js
import { scanMobileElements } from './scanner.js';

// Handle the /scan endpoint
addEventListener('fetch', (event) => {
  if (event.request.method === 'POST' && event.request.url.includes('/scan')) {
    event.respondWith(handleScanRequest(event.request));
  }
});

// Handle the /scan request
async function handleScanRequest(request) {
  try {
    const html = await request.text();
    const issues = await scanMobileElements(html);
    return new Response(JSON.stringify(issues), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error handling /scan request:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}