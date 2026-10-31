# Security policy

## Reporting a vulnerability

Please do not open a public issue for security problems. Email
**samithmendis.01@gmail.com** with a description and steps to reproduce. You should get a reply within a few days.

## Scope notes

- Page content you pass as React is rendered by React; the library never injects untrusted HTML.
- Image and (later) PDF URLs are loaded by the browser under its normal same-origin and CORS rules. The library does not proxy requests.
