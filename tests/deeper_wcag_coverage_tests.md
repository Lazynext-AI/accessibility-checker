Deeper WCAG Coverage Tests
==========================

> **Status note (2026-09-28):** all seven scenarios below are implemented as
> live rules — rendered-layer contrast census, `wcag-1.1.1` alt text,
> `wcag-2.4.4`/`wcag-2.4.6` link purpose, `wcag-1.3.1` headings/labels/table
> structure, `wcag-1.2.2` captions. The `AccessibilityChecker.scan` API in
> the example is illustrative, not the real interface — scans run through
> the worker `/scan` route and `src/rules/`. Kept as the original test plan;
> `docs/wcag-coverage.md` is the authoritative coverage map.

## Introduction

The Accessibility Checker aims to provide a comprehensive scanning tool for small business websites to ensure compliance with accessibility regulations. To achieve this, we need to ensure that our tool covers a wide range of Web Content Accessibility Guidelines (WCAG) criteria. This document outlines the deeper WCAG coverage tests that will be implemented to guarantee the tool's effectiveness.

## Test Scenarios

The following test scenarios will be used to evaluate the tool's ability to identify accessibility issues:

### 1. Color Contrast

* Test case: Insufficient color contrast between background and foreground elements
* Expected result: The tool should identify the elements with insufficient color contrast and provide recommendations for improvement
* Test data:
	+ Background color: #f2f2f2
	+ Foreground color: #ccc
	+ Expected contrast ratio: 4.5:1

### 2. Image Alt Text

* Test case: Missing or incomplete alt text for images
* Expected result: The tool should identify images without alt text and provide recommendations for adding descriptive text
* Test data:
	+ Image file: example.jpg
	+ Expected alt text: "Example image description"

### 3. Link Text

* Test case: Insufficient link text
* Expected result: The tool should identify links with insufficient text and provide recommendations for improvement
* Test data:
	+ Link text: "Click here"
	+ Expected link text: "Learn more about our services"

### 4. Headings

* Test case: Missing or incorrect headings
* Expected result: The tool should identify headings that are missing or incorrectly ordered and provide recommendations for improvement
* Test data:
	+ Heading structure: h1, h2, h3, h4, h5, h6
	+ Expected heading order: h1, h2, h3

### 5. Form Labels

* Test case: Missing or incomplete form labels
* Expected result: The tool should identify form fields without labels and provide recommendations for adding descriptive text
* Test data:
	+ Form field: input type="text"
	+ Expected label text: "Full name"

### 6. Table Structure

* Test case: Incorrect table structure
* Expected result: The tool should identify tables with incorrect structure and provide recommendations for improvement
* Test data:
	+ Table structure: table, tr, td
	+ Expected table structure: table, caption, thead, tbody, tfoot

### 7. Video Captions

* Test case: Missing or incomplete video captions
* Expected result: The tool should identify videos without captions and provide recommendations for adding descriptive text
* Test data:
	+ Video file: example.mp4
	+ Expected caption text: "Example video description"

## Test Implementation

The tests will be implemented using the `node:test` framework. Each test scenario will be written as a separate test function, and the expected results will be verified using assertions.

```javascript
import { test } from 'node:test';
import { AccessibilityChecker } from '../src/accessibility-checker.js';

test('Color Contrast', async () => {
  const html = '<div style="background-color: #f2f2f2; color: #ccc">Example text</div>';
  const result = await AccessibilityChecker.scan(html);
  console.assert(result.colorContrast === 'insufficient');
});

test('Image Alt Text', async () => {
  const html = '<img src="example.jpg" alt="">';
  const result = await AccessibilityChecker.scan(html);
  console.assert(result.imageAltText === 'missing');
});

test('Link Text', async () => {
  const html = '<a href="#">Click here</a>';
  const result = await AccessibilityChecker.scan(html);
  console.assert(result.linkText === 'insufficient');
});

test('Headings', async () => {
  const html = '<h2>Example heading</h2>';
  const result = await AccessibilityChecker.scan(html);
  console.assert(result.headings === 'incorrect');
});

test('Form Labels', async () => {
  const html = '<input type="text">';
  const result = await AccessibilityChecker.scan(html);
  console.assert(result.formLabels === 'missing');
});

test('Table Structure', async () => {
  const html = '<table><tr><td>Example table</td></tr></table>';
  const result = await AccessibilityChecker.scan(html);
  console.assert(result.tableStructure === 'incorrect');
});

test('Video Captions', async () => {
  const html = '<video src="example.mp4"></video>';
  const result = await AccessibilityChecker.scan(html);
  console.assert(result.videoCaptions === 'missing');
});
```

## Conclusion

The deeper WCAG coverage tests will ensure that the Accessibility Checker tool provides comprehensive scanning and recommendations for small business websites. By implementing these tests, we can guarantee that the tool identifies a wide range of accessibility issues and provides accurate recommendations for improvement.