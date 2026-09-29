// File: script.js
// Function to dynamically update meta tags
function updateMetaTags(title, description, keywords) {
  document.title = title;
  document.querySelector('meta[name="description"]').setAttribute('content', description);
  document.querySelector('meta[name="keywords"]').setAttribute('content', keywords);
}

// Function to dynamically update Open Graph tags
function updateOpenGraphTags(title, description, image) {
  document.querySelector('meta[property="og:title"]').setAttribute('content', title);
  document.querySelector('meta[property="og:description"]').setAttribute('content', description);
  document.querySelector('meta[property="og:image"]').setAttribute('content', image);
}

// Example usage:
updateMetaTags('New Title', 'New description', 'new keywords');
updateOpenGraphTags('New Title', 'New description', 'new image.png');