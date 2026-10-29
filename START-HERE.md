# Open your Python website

1. Extract **parking-studio-python.zip** completely.
2. Install Python 3.12 or newer from https://www.python.org/downloads/ if needed.
3. Double-click **start-windows.bat**. First startup downloads dependencies and needs internet access.
4. Keep that terminal open and visit http://127.0.0.1:8000/.

Alternatively run `python run.py --setup` from the extracted folder. To stop, press Ctrl+C in its terminal. If the port is occupied, run `python run.py --setup --port 8001` and open http://127.0.0.1:8001/.

The release ZIP includes the built UI, so you do not need Node.js to run it. The **parking-studio-python-github.zip** contains clean source and needs a frontend build first, as explained in README.md.

For GitHub, preserve all folders, including backend, src, examples, tests and .github. Upload the contents of the project folder so README.md is directly in the repository root. GitHub Desktop avoids the problems caused by uploading individual files. Do not upload .venv or node_modules.

A public version needs Python hosting; GitHub Pages alone cannot run it. See README.md for Docker/Render instructions. No new public site has been deployed. Your original app is separate.
