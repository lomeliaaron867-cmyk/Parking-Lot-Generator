# GitHub readiness review — October 29, 2026

## Assessment

Suitable for a portfolio prototype upload, with the limitations below disclosed. This review does not certify professional site design, guarantee maximum parking yield, or establish parity with TestFit. The original JavaScript project was not modified. No repository or public deployment was changed.

## Results

| Check | Result |
| --- | --- |
| Python regression suite | 48 passed in explicit thread-worker mode; one non-failing Starlette/httpx deprecation warning |
| Geometry matrix | Surface, irregular, curved and loop examples at 45°, 60° and 90°: containment, non-overlap, deterministic results and count consistency passed |
| Edge cases | Fully consumed setback, repeated curve points, one/eight garage levels passed |
| API | Validation, body size, overload rejection, failure recovery and static serving passed |
| TypeScript | Passed |
| Camera/pointer tests | Frustum fit, bounded zoom, release/blur/capture-loss/Escape/visibility recovery and cleanup passed |
| Frontend build | Portable production build passed; standard Vite build blocked by local sandbox `spawn EPERM` |
| Default process-worker execution | Blocked locally by Windows named-pipe permissions; GitHub Actions retains default-process tests and adds thread-mode tests |
| Browser | Saved 282-space garage loaded; numeric validation preserved geometry; edit/undo restored setback; Plan/3D controls, zoom, Pan selection, mouse orbit, drawing Escape and six alternatives worked |
| Exports | Actual browser JSON, CSV, DXF and GLB downloads succeeded; JSON re-solved to 282 spaces; CSV matched; DXF feet and three level layers present; GLB v2 header, length and scene parsed |
| Browser errors | None observed during the smoke checks |

The garage comparison returned 390, 363, 348, 333, 306 and 282 spaces. These are this solver's conceptual counts for the saved project, not TestFit results. Higher counts still require circulation and design review. The original project settings were restored after the numeric test.

## Comparison with TestFit

Based on [TestFit's published Parking Solver page](https://www.testfit.io/product/parking-solver), accessed October 29, 2026. No licensed TestFit session or identical-site benchmark was available; runtime, yield quality and full UI equivalence were not measured.

| Capability | TestFit publishes | Parking Studio |
| --- | --- | --- |
| Layout generation | Surface and structured parking | Surface fill, curved paths, conceptual rectangular garages |
| Context | Building massing and setbacks | Editable footprints, heights and uniform setback; garage massing exclusions limited |
| Editing | Stall types, aisles and access | Standard/compact/accessible/EV allocations, dimensions, angles, path editing and removal; no trailer/custom type editor |
| Alternatives | Saved schemes | Saved schemes and six ranked heuristic options |
| Metrics | Counts and project ratios | Actual counts, density and mix; goal UI intentionally removed |
| Handoff | Revit add-in, DXF, SKP and CSV | DXF, CSV, JSON and GLB; no native Revit/SketchUp integration |

## Remaining release limits

- Standard dependency installation/build and default process-worker mode need a green GitHub Actions run outside this sandbox. The included workflow checks both executor modes.
- Docker and public hosting were not exercised. GitHub Pages cannot serve the Python API.
- Mouse orbit was exercised, but every handle/tool/device combination, mobile touch and extended multi-user load have not been exhaustively tested.
- Export structure checks do not replace opening models in each external CAD application.
- Accessible allocations, garage ramps, dead-end circulation and vehicle turns remain conceptual. No zoning, structural or accessibility certification is implied.

## Upload

Extract `parking-studio-python-github.zip` and upload its contents with the folders intact. Keep `.github/workflows/ci.yml`, `backend`, `src`, `tests` and `examples` in their existing locations. The ZIP excludes dependencies, virtual environments, caches and environment files. Use the separate run-ready ZIP for local use without Node.js.
