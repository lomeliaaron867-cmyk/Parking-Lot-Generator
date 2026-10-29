"""Serve the API and built React app from one origin; no Node server needed."""
import asyncio
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor
from contextlib import asynccontextmanager
import logging
import os
from pathlib import Path
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError
from .models import SolveRequest
from .solver import solve, alternatives

ROOT = Path(__file__).resolve().parents[1]
logger = logging.getLogger(__name__)
MAX_BODY = 256 * 1024

def create_executor():
    mode = os.environ.get('PARKING_EXECUTOR', 'process')
    if mode == 'thread':
        return ThreadPoolExecutor(max_workers=2)
    if mode == 'process':
        return ProcessPoolExecutor(max_workers=2)
    raise ValueError('PARKING_EXECUTOR must be process or thread.')

@asynccontextmanager
async def lifespan(app):
    app.state.pool = create_executor()
    app.state.active = 0
    try:
        yield
    finally:
        app.state.pool.shutdown(wait=True, cancel_futures=True)

app = FastAPI(title='Parking Studio Python API', version='1.0.0', lifespan=lifespan)

@app.get('/api/health')
def health():
    return {'status': 'ok', 'engine': 'python-shapely', 'version': '1.0.0'}

async def calculate(request: Request, operation):
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > MAX_BODY:
            raise HTTPException(413, 'Project is too large (maximum 256 KiB).')
    try:
        payload = SolveRequest.model_validate_json(body)
    except ValidationError as error:
        errors = [{'field': '.'.join(map(str, e['loc'])), 'message': e['msg']} for e in error.errors()]
        return JSONResponse(status_code=422, content={'detail': errors})
    settings = payload.settings.model_dump()
    # Bound CPU jobs, including work still running after a client disconnects.
    if app.state.active >= 2:
        raise HTTPException(503, 'The solver is busy. Please retry in a moment.', headers={'Retry-After': '2'})
    app.state.active += 1
    try:
        future = asyncio.get_running_loop().run_in_executor(app.state.pool, operation, settings)
    except Exception:
        app.state.active -= 1
        raise
    def completed(task):
        app.state.active -= 1
        if not task.cancelled(): task.exception()  # Consume exceptions after timeouts/disconnects.
    future.add_done_callback(completed)
    try:
        result = await asyncio.wait_for(asyncio.shield(future), timeout=60)
    except asyncio.TimeoutError:
        raise HTTPException(504, 'Calculation took too long. Simplify the site or paths and retry.')
    except Exception:
        logger.exception('Solver failed')
        raise HTTPException(500, 'The solver could not process this layout. Adjust the geometry and retry.')
    return {'layout' if operation is solve else 'options': result, 'engine': 'python-shapely'}

@app.post('/api/solve')
async def solve_endpoint(request: Request):
    return await calculate(request, solve)

@app.post('/api/alternatives')
async def alternatives_endpoint(request: Request):
    return await calculate(request, alternatives)

# Unknown API routes must return JSON 404, never the frontend HTML.
@app.api_route('/api/{path:path}', methods=['GET','POST','PUT','DELETE','PATCH'])
async def missing_api(path: str):
    raise HTTPException(404, 'API route not found.')

if (ROOT / 'dist/index.html').exists():
    app.mount('/', StaticFiles(directory=ROOT/'dist', html=True), name='editor')
else:
    @app.get('/')
    def build_required():
        return JSONResponse(status_code=503, content={'detail': 'Build the editor first: npm install && npm run build. For development, use the Vite URL on port 5173.'})
