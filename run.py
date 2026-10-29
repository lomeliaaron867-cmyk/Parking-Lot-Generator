"""Run from the extracted ZIP with Python 3.12+: python run.py --setup."""
import argparse
import hashlib
from pathlib import Path
import os
import subprocess
import sys
import venv

ROOT = Path(__file__).resolve().parent

def main():
    parser=argparse.ArgumentParser(description='Start Parking Studio with its Python solver.')
    parser.add_argument('--setup',action='store_true',help='Create the local environment and install Python dependencies.')
    parser.add_argument('--port',type=int,default=8000)
    args=parser.parse_args()
    os.chdir(ROOT)
    if sys.version_info<(3,12):
        raise SystemExit('Install Python 3.12 or newer first.')
    env=ROOT/'.venv'
    python=env/('Scripts/python.exe' if os.name=='nt' else 'bin/python')
    marker=env/'.parking-requirements'
    fingerprint=hashlib.sha256((ROOT/'requirements.txt').read_bytes()).hexdigest()
    if args.setup:
        if not python.exists():
            print('Creating the local Python environment…',flush=True)
            venv.EnvBuilder(with_pip=True).create(env)
        if not marker.exists() or marker.read_text()!=fingerprint:
            subprocess.run([str(python),'-m','pip','install','--index-url','https://pypi.org/simple','-r','requirements.txt'],check=True)
            marker.write_text(fingerprint)
    if not python.exists():
        raise SystemExit('First run: python run.py --setup')
    if not (ROOT/'dist/index.html').exists():
        raise SystemExit('Build the frontend first with: npm install, then npm run build. The release ZIP includes a prebuilt frontend.')
    print(f'Open http://127.0.0.1:{args.port}/ — keep this terminal open. Ctrl+C stops the server.',flush=True)
    subprocess.run([str(python),'-m','uvicorn','backend.app:app','--host','127.0.0.1','--port',str(args.port)],check=True)

if __name__=='__main__':
    try: main()
    except KeyboardInterrupt: pass
    except subprocess.CalledProcessError as e: raise SystemExit(e.returncode)
