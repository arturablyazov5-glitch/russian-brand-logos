# Publish checklist

Run manually when the repository is published. Nothing here is run by scripts or CI.

1. `node scripts/sync.mjs && node scripts/validate.mjs --online` — green.
2. Create the repository and set topics (topics match the "Topics" section of README.md):

```bash
gh repo create <owner>/russian-brand-logos --public --source . --push \
  --description "SVG logos of Russian brands · SVG-логотипы российских брендов" \
  --homepage "https://trace-logos.ru/logos/?utm_source=github&utm_medium=repository&utm_campaign=russian-brand-logos"

gh repo edit <owner>/russian-brand-logos \
  --add-topic svg --add-topic logos --add-topic brand-logos --add-topic russian-brands \
  --add-topic russia --add-topic svg-icons --add-topic icons --add-topic figma \
  --add-topic design-resources --add-topic brand-assets
```

3. Settings → Actions → General → Workflow permissions: "Read and write permissions" (the sync workflow commits and opens issues).
4. Actions → "Sync logos" → Run workflow once; check that the run is green and makes no commit when nothing changed.
