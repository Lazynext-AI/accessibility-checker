# A2A Probe Findings: Accessibility Checker Repository Audit
## Introduction
As part of the A2A audit probe, this document outlines the findings from reviewing the Accessibility Checker repository's README file, focusing on the documentation of the GET /rules endpoint. The Accessibility Checker is an AI-powered tool designed to scan small business websites for accessibility compliance issues and provide recommendations for improvement.

## Overview of the Repository
The repository contains a comprehensive set of files and directories, including documentation, marketing materials, and source code. The documentation directory (`docs/research`) houses various markdown files detailing different aspects of the Accessibility Checker, such as its algorithm, technical debt, and performance optimization strategies.

## Review of README.md
The `README.md` file serves as the primary entry point for users and developers alike, providing an overview of the project, its purpose, and how to get started. However, upon reviewing the `README.md` file, it appears that there is no explicit mention of the GET /rules endpoint or its functionality. This omission could potentially confuse or mislead users who are looking for information on how to interact with the Accessibility Checker's rules.

## Expected Documentation for GET /rules
Given the importance of the GET /rules endpoint in retrieving the rules used by the Accessibility Checker, it is expected that the README file would include:
- A description of the endpoint's purpose and functionality.
- Details on how to use the endpoint, including any required parameters or headers.
- Examples of successful responses and any error handling mechanisms.

## Actual Findings
Upon closer inspection of the repository, it becomes apparent that while there is extensive documentation on various aspects of the Accessibility Checker, the specific documentation for the GET /rules endpoint is lacking in the README file. However, there are files such as `docs/research/accessibility_checker_advanced_wcag.md` and `docs/research/accessibility_checker_algorithm.md` that touch upon the rules and algorithms used by the Accessibility Checker, albeit not directly documenting the GET /rules endpoint.

## Recommendations
To improve the documentation and usability of the Accessibility Checker, the following recommendations are made:
1. **Include GET /rules Endpoint Documentation**: Add a section to the `README.md` file that clearly documents the GET /rules endpoint, including its purpose, usage, and expected responses.
2. **Link to Relevant Documentation**: Provide links to relevant documentation files within the `docs/research` directory that offer more detailed insights into the rules and algorithms used by the Accessibility Checker.
3. **Example Use Cases**: Incorporate example use cases or code snippets that demonstrate how to effectively use the GET /rules endpoint, enhancing the overall user experience.

## Conclusion
The Accessibility Checker repository demonstrates a strong commitment to documentation and user guidance. However, the lack of explicit documentation for the GET /rules endpoint in the README file presents an opportunity for improvement. By addressing this gap, the Accessibility Checker can further enhance its usability and accessibility, aligning with its core mission of promoting web accessibility for small businesses and solo entrepreneurs.

## Resolution — fixed
`README.md` now documents `GET /rules` explicitly (purpose, response shape —
the 75-rule manifest with name/level/WCAG-version/detection-path fields),
plus SDK access (`a11y.rules()` / `c.Rules()`) and the MCP `list_rules` tool.
This finding is closed.