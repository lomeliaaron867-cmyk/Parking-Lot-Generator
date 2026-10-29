# Parking Studio — Python edition

A parking layout exploration website powered by Python, with an interactive 2D/3D browser editor. Independent educational project inspired by parking feasibility tools; not affiliated with TestFit.

## Architecture

### Guided editor

Use **Start → Refine → Results**. Start can keep your current site or apply a rectangular site brief with an optional building. Refine exposes site, aisle, stall and garage settings. Results contains the measured dashboard, six-way comparison, checks and exports.

Numeric settings apply on Enter or blur, so clearing a field while typing does not regenerate the layout. Invalid values show inline errors. Editing tools retain visible names; Escape exits the active tool. The dashboard reports actual solver counts, density, parking mix, assumptions and supported export formats. It does not claim separate front/rear/side setbacks, automated turning-radius optimization, or native RVT/SKP export.

The compact count shows parking spaces without a large target card. In 3D, choose **Orbit** to rotate or **Pan** to move sideways; use the wheel or **+ / −** to zoom and **Fit site** to reset the framing. Switching from Plan back to 3D restores your previous angle and position. In editing modes, empty-space drags pan; handles move only when selected. Instructions and Finish/Cancel actions live in the sidebar so they do not cover the geometry.

- Python/FastAPI serves the website and layout APIs.
- Python/Shapely generates rows, curved-aisle parking, garage levels and ramps, checks setbacks and obstacles, and calculates metrics and alternatives.
- React/TypeScript/Three.js provides the interactive editor, rendering, visual turning studies and exports. This is a Python-powered website, with a JavaScript browser interface.

The editor retains irregular boundaries, curved paths, buildings, parking mixes, saved schemes, undo/redo, and JSON/CSV/DXF/GLB exports. Loading/error states prevent exports of stale results. Layouts are heuristic feasibility studies, not certified construction or accessibility plans. Geometry handling differs from the old solver, so imported projects may have different stall counts.

## Run the release

Requires Python 3.12 or newer. Extract `parking-studio-python.zip` completely and double-click `start-windows.bat`, or run:

```sh
python run.py --setup
```

Open http://127.0.0.1:8000/ and keep the terminal running. First startup installs Python dependencies from PyPI. The release includes the compiled frontend (`dist`), so Node.js is not needed to run it. Later starts can use `python run.py`. Press Ctrl+C to stop. If the port is occupied, use `python run.py --port 8001`.

## Build from GitHub source

Requires Python 3.12+ and Node.js 24+:

```sh
npm install --global pnpm@11.19.0
pnpm install --frozen-lockfile
pnpm build
python run.py --setup
```

Python serves `dist` and `/api` on the same origin. Rebuild after changing frontend code.

For a restricted local environment that denies Python worker-process pipes, explicitly set `PARKING_EXECUTOR=thread` before starting the server or running tests. In Windows Command Prompt: `set PARKING_EXECUTOR=thread`, then `python run.py`. Process workers remain the default for normal installations and deployment. Thread mode retains the two-job limit and timeout handling, but CPU throughput can differ; neither mode forcibly terminates a running calculation on timeout.

If a restricted environment prevents launching native build helpers, run `pnpm test` followed by `node build-portable.mjs`. This optional TypeScript/Vite build produces an unminified frontend; the standard build remains preferred for deployment.

For development, create the environment, install test dependencies and start Python:

```sh
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements-dev.txt
.venv/Scripts/python -m uvicorn backend.app:app --reload --host 127.0.0.1 --port 8000
```

On macOS/Linux, replace `.venv/Scripts/python` with `.venv/bin/python`. In a second terminal run `pnpm dev` and open its URL (normally http://127.0.0.1:5173/). Vite proxies API calls to Python on port 8000.

## Checks

```sh
.venv/Scripts/python -m pytest -q
pnpm test
pnpm test:interactions
pnpm build
```

Python tests cover example layouts, containment, setbacks, collisions, curved-path access, garages, removals, alternatives, validation and API limits. `pnpm test` checks TypeScript, not browser interactions. GitHub Actions runs these checks on pushes and pull requests.

See [READINESS.md](READINESS.md) for the dated test results, TestFit feature comparison, and remaining validation limits. Treat a green GitHub Actions run as the next release check after uploading.

## API and saved projects

- `GET /api/health`: engine status.
- `POST /api/solve`: returns `{ "layout": ..., "engine": "python-shapely" }`.
- `POST /api/alternatives`: returns `{ "options": [...], "engine": "python-shapely" }`.

POST bodies use `{ "settings": <project settings> }`. See `examples` and `backend/models.py` for fields and limits. Requests are limited to 256 KiB, two active calculations per server process, and a 60-second response timeout. Timed-out work keeps its worker slot until completion. Busy responses return 503; use Retry in the editor.

Projects save in browser storage or exported JSON, not a server database. Export JSON from the original editor and import here to migrate. This edition uses separate browser storage. On a public host, layout settings are sent to that host for calculation.

## GitHub and public hosting

Extract `parking-studio-python-github.zip` and add its contents to a new repository called `parking-studio-python`, preferably using GitHub Desktop. Keep `backend`, `src`, `examples`, `tests`, and `.github` as folders. `README.md`, `requirements.txt`, `package.json`, and `Dockerfile` should sit directly at the repository root. Do not flatten directories. The gitignore excludes dependencies, compiled output, virtual environments and environment files.

GitHub Pages cannot run the Python server. Keep the original Pages site separate and deploy this edition to a Python/container host for a shareable link. Localhost links only work on the computer running the app.

```sh
docker build -t parking-studio-python .
docker run --rm -p 8000:8000 parking-studio-python
```

The Dockerfile builds the frontend and serves it with Python as a non-root user on `PORT` (default 8000). Connect the new GitHub repository as a Docker web service on Render, or use the included `render.yaml` Blueprint. Review the selected plan before deploying. Health check: `/api/health`. The Dockerfile provides the start command. See [Render Blueprint documentation](https://render.com/docs/blueprint-spec) for current options.

Deployment configuration is included but no new public site has been deployed. Docker execution has not been verified locally because Docker is unavailable on the development machine.

## Source guide

| File | Purpose |
| --- | --- |
| backend/models.py | Validated settings and limits |
| backend/solver.py | Python geometry and alternatives |
| backend/app.py | API, worker pool and static serving |
| src/api.ts | Requests, cancellation and status |
| src/App.tsx | Editor interface |
| src/solver.ts | Frontend types and display helpers |
| tests/ | Python regression tests |
| run.py | Local launcher |

Developed with AI coding assistance. For a portfolio, accurately describe your own decisions, testing and contributions. No TestFit source code or assets are included. Third-party dependencies retain their licenses; select a license for your original code before inviting reuse.
