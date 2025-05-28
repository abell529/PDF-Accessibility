# PDF-Remediation

CLI tool that turns any PDF into a more accessible version  
by adding alt-text, a tag tree, page bookmarks, and metadata  
— all powered by the OpenAI API.

```bash
# Quick start (after Codex generates the files)
cp .env.example .env            # paste your OpenAI key
npm install                     # Codex already ran this once
node src/cli.js remediate \
     --in sample.pdf \
     --out sample_a11y.pdf \
     --alt --tags --summaries
```

What it does
Stage	Model	Result
Alt-text	gpt-4o-mini (vision)	Adds /Alt text to every image
Tag tree & bookmarks	gpt-4.1-nano	Detects H1/H2/… → bookmarks
Summaries & metadata	gpt-4.1-nano	≤ 35-word summaries, title, keywords

Requirements on your machine
Node 20+ and npm

Internet access for the OpenAI API

OPENAI_API_KEY in .env (billing-enabled)

(Optional) Adobe PDF Accessibility API keys if you later extend the workflow.

MIT License · © 2025
