# JobPilot

Desktop app that reads your CV, pulls jobs from job APIs, keeps only the ones you're eligible for, alerts you on new matches, and collects recruiters for those jobs. See [SPEC.md](SPEC.md) for scope and assumptions.

## Run

```bash
npm install
pip install python-jobspy   # LinkedIn, Indeed, Glassdoor, Bdjobs, Bayt listings
npm start
```

`python` must be on PATH (or set `JOBPILOT_PYTHON` to the interpreter). Without it the other sources still work.

1. **Profile & CV** → Upload CV, check the extracted skills / years / roles / locations, Save.
2. Optional: add a JSearch key (LinkedIn, Indeed, Glassdoor listings) and Adzuna keys. Without keys it uses JobSpy, Remotive, Arbeitnow and RemoteOK.
3. **Portals** → sign in to LinkedIn once (session persists). Opening a LinkedIn job there saves its hiring team to **Recruiters**.

The feed refreshes every 30 minutes while the app is open.

## Test

```bash
npm test
```

## Data

Everything lives in `%APPDATA%/jobpilot/`: `jobpilot.db` (SQLite), `secrets.bin` (API keys, OS-encrypted), `app.log` (JSON lines; per-source fetch status).

## Corporate network

If `npm install` hangs on "Downloading Electron binary", the GitHub download is blocked for Node. Download `electron-v45.0.0-win32-x64.zip` from GitHub releases with a browser or curl and unzip it into `node_modules/electron/dist/`, then put `electron.exe` in `node_modules/electron/path.txt`.
