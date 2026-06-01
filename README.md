# InstructionsCrafter

Turn a screen recording with voice narration into a polished Microsoft Word step-by-step instruction document.

A Chrome extension records the screen + microphone and uploads to a FastAPI backend, which sends the whole recording (video + audio) to Google's Gemini API in a single call. Gemini watches the recording and returns the document's introduction plus one step per action — each with its instruction, a caption, and the moment to screenshot. The backend extracts those screenshots (FFmpeg) and assembles them into a `.docx` file. No long-term storage — everything is processed and discarded after each request.

**Internal tool** for ≤5 users. Forked from [Screenity](https://github.com/alyssaxuu/screenity) (GPLv3).

---

## Project layout

```
.
├── backend/            # Python FastAPI server
│   ├── app/            # Pipeline modules (gemini, pipeline, screenshots, etc.)
│   ├── templates/      # Word document template
│   ├── requirements.txt
│   └── .env.example
└── extension/          # Chrome extension (Screenity fork)
    ├── src/            # Source
    ├── build/          # `npm run build` output (load this into Chrome)
    └── package.json
```

---

## Production deployment

The backend is live at **`https://instructionscrafter.com`** on Azure (East US, `Standard_D2s_v3`, 24/7 always-on).

---

## Installing the extension (for end users)

1. **Get the built extension folder** from a team member (the `extension/build/` directory after running `npm run build`).
2. Open Chrome → navigate to **`chrome://extensions`**.
3. Turn on **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the `build/` directory.
5. The InstructionsCrafter icon should appear in the toolbar. Pin it for easy access.

The backend URL is set to production (`https://instructionscrafter.com`) by default. To change it (e.g. point at a local dev server), open the extension's **Options** page from `chrome://extensions` or right-click the toolbar icon → *Options*.

The shared password lives in the backend's `.env`. Ask the team for it.

### Using the extension

1. Click the InstructionsCrafter icon → **Start**.
2. Choose what to record (entire screen, window, or tab).
3. **Narrate every step out loud** — the instructions are built from what you *say*. Your clicks are captured automatically to time the screenshots; if a click can't be captured (a desktop app, an embedded frame), just say **"screenshot"** out loud at the moment you want captured.
4. Click **Stop** when done.
5. The post-recording page opens. Enter a document title, the shared password, and click **Generate Document**.
6. A `.docx` file downloads in a few seconds.

---

## Local development

### Backend

```bash
cd backend
python3.11 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Copy and fill in your Gemini API key + a shared password
cp .env.example .env
# edit .env

# Run the server
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

`test_local.sh` at the project root sends a sample `~/Desktop/test.mov` to the local server.

### Extension

```bash
cd extension
npm install
npm run build       # dev build with watch (or just `build` for one-shot)
```

Load `extension/build/` as an unpacked extension in Chrome (see *Installing the extension* above). After source changes, rerun `npm run build`, then click the **reload** icon on the extension card in `chrome://extensions`.

To point the extension at the local backend, open the Options page and set the backend URL to `http://127.0.0.1:8000`.

---

## Deploying the backend (for operators)

The production VM is already provisioned and running. This section covers how to deploy a *fresh* instance — useful if the existing VM is decommissioned or you want a staging environment.

### Provisioning

Pick any Linux VPS with ~2 vCPU / 4–8 GB RAM. The production deployment uses Azure `Standard_D2s_v3` (East US), but Hetzner CPX22 or DigitalOcean's equivalents work the same. Ubuntu 24.04 LTS is the tested baseline.

### Install system dependencies

```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip ffmpeg nginx certbot python3-certbot-nginx fail2ban ufw
```

### Deploy the backend code

```bash
# On your local machine, rsync the backend to the server
rsync -avz --exclude='.env' --exclude='venv' --exclude='__pycache__' --exclude='*.pyc' \
  backend/ user@your-server:/opt/instruction-generator/

# On the server
cd /opt/instruction-generator
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Create production .env (file mode 600, owner-only)
sudo nano .env
# Fill in GEMINI_API_KEY, SHARED_PASSWORD,
# MAX_VIDEO_SIZE_MB=500, TEMP_DIR=/tmp/instruction-generator,
# ALLOWED_ORIGINS=chrome-extension://<your-extension-id>
sudo chmod 600 .env
```

### systemd service

Create `/etc/systemd/system/instruction-generator.service`:

```ini
[Unit]
Description=InstructionsCrafter API
After=network.target

[Service]
User=azureuser
WorkingDirectory=/opt/instruction-generator
Environment="PATH=/opt/instruction-generator/venv/bin:/usr/local/bin:/usr/bin:/bin"
ExecStart=/opt/instruction-generator/venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

**Gotcha:** the `PATH` line *must* include `/usr/local/bin:/usr/bin:/bin`. Without those, `subprocess` calls to apt-installed tools (ffmpeg) fail with "FFmpeg is not installed on the server".

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now instruction-generator
sudo systemctl status instruction-generator   # confirm "active (running)"
```

### nginx reverse proxy

Create `/etc/nginx/sites-available/instructionscrafter`:

```nginx
server {
    listen 80;
    server_name your-domain.com www.your-domain.com;
    client_max_body_size 500M;
    proxy_read_timeout 300s;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/instructionscrafter /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

### TLS via Let's Encrypt

```bash
sudo certbot --nginx -d your-domain.com -d www.your-domain.com
# Follow prompts. Certbot adds a 301 redirect from HTTP → HTTPS.
```

Certs auto-renew via the systemd timer certbot installs.

### Firewall + fail2ban

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable

sudo systemctl enable --now fail2ban
```

### Point the extension at the new backend

Open the extension's Options page → set the **Backend URL** to `https://your-domain.com`. Add `chrome-extension://<your-extension-id>` to the backend's `ALLOWED_ORIGINS` and `sudo systemctl restart instruction-generator` to pick up the change.

### Verify

```bash
curl https://your-domain.com/api/health    # should return {"status": "ok"}
```

Then record a short narrated screen capture via the extension and confirm the `.docx` downloads.

---

## Costs

Annual operating cost (production estimate):

| Item | Cost |
|---|---|
| Azure VM (`Standard_D2s_v3`, always-on) | ~$70/mo |
| Disk + IP + bandwidth | ~$6/mo |
| Domain (Namecheap, year-2 onward) | ~$15/yr |
| Google Gemini 3.5 Flash (one call per document, ~$0.03 each on the paid tier) | ~$10–30/yr |
| **Total** | **~$940–960/yr** |

Gemini 3.5 Flash processes the whole recording in one call (~3¢ per document on the paid tier). The free tier (20 requests/day) also covers light internal use, but Google may use free-tier content to improve its models, so production uses the paid tier.

---

## Distribution

The team distributes via **Chrome Web Store unlisted** — every team member installs from a private link that only people with the URL can access; the extension auto-updates when a new version is published.

To publish a new version (or set up the listing for the first time), follow [docs/CHROME_WEB_STORE.md](./docs/CHROME_WEB_STORE.md). The guide covers: the GPLv3 disclosure obligation that comes with distributing publicly, hosting the privacy policy, ZIP packaging, store listing copy, permission justifications, screenshot guidelines, and post-publish backend `ALLOWED_ORIGINS` updates.

## License

**GNU General Public License v3.0** — see [`LICENSE`](./LICENSE) for the full text and [`NOTICE.md`](./NOTICE.md) for component attribution.

The extension is forked from [Screenity](https://github.com/alyssaxuu/screenity) (also GPLv3). The backend is original code, distributed under the same GPLv3 for consistency. Because the project is distributed via the Chrome Web Store, GPLv3 source-disclosure obligations apply — every recipient of the extension must be able to obtain the source. This repository is public for that purpose.
