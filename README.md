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
Runs on any OS where Node 20+ is available (Ubuntu, Debian, macOS, Windows, etc.)

Internet access for the OpenAI API

OPENAI_API_KEY in .env (billing-enabled)

(Optional) Adobe PDF Accessibility API keys if you later extend the workflow.

## Web server setup

These files include a small PHP front end so the tool can run behind an
Apache web server on Ubuntu. The PHP page uploads your PDF, then calls the
CLI to generate the remediated version.

1. Install dependencies:
   ```bash
   sudo apt update
   sudo apt install apache2 php nodejs npm
   ```
2. Clone this repository somewhere Apache can read (e.g. `/var/www/html/pdf-remediation`).
3. In the repository directory run:
   ```bash
   cp .env.example .env   # add your OpenAI key
   npm install
   ```
4. Ensure the `web/` directory is served by Apache. If the repository lives
   in `/var/www/html/pdf-remediation`, you can access `http://your-server/pdf-remediation/web/`.
5. Upload a PDF using the form and download the remediated file when processing completes.

MIT License · © 2025
