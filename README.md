# W/Rhinos Cycling Club website

Single-page site for Birmingham W/Rhinos: how to join, the membership form link, and the full Framework and Constitution to read online.

Live: https://muthuvelur.github.io/wrhinos/ (GitHub Pages, served from `main`).

## Editing

- Page layout, text and links: `src/template.html`
- Document text: extracted from `source-docs/` into `src/framework.txt` and `src/constitution.xml`
- Rebuild `index.html`: `node src/build.js`

If a document changes, re-extract it:

```bash
pdftotext -layout -enc UTF-8 source-docs/WRhinos_Framework_v2_FINAL.pdf src/framework.txt
unzip -p source-docs/WRhinos_Constitution_.docx word/document.xml > src/constitution.xml
node src/build.js
```

## Custom domain

When a domain is bought, add it under repo Settings → Pages → Custom domain (this creates a `CNAME` file), then point the domain's DNS at GitHub Pages.
