# Parking Lot Planner

A simple program for planning roads and parking on a piece of land.

## How to start it

Run `main.py`, or use `run.bat`. It needs Python and Shapely (`pip install shapely`).

## How to use it

1. Type the length and width, pick a shape, and press **Set property**. You can also draw your own.
2. Pick a tool. Drag to draw roads, circle roads, and parking boxes. Select something to move it, resize it, or change its settings. Drag the middle square of a road to curve it.
3. Press **Find layouts** to have the program try different layouts. Click one in the list to see it. This replaces the roads and parking you have, but Undo brings it back.

A road that touches the property line becomes an entrance or exit.

## What it can't do

- It doesn't save or export anything.
- Diagonal rows can be turned from 10 to 80 degrees with the Angle box, but they always use a lane around the edge. Find layouts tries every 15 degrees from 15 to 75.
- Find layouts shows at most 100 layouts.
- Very large properties can take a while to find layouts.
- It checks that each space connects to an entrance, but not how wide that path is or which way one-way aisles go.
- It doesn't plan accessible spaces.
- It is for planning only, not real construction.

## Files

- `main.py` is the window.
- `planner.py` is the math.
- `test_planner.py` checks the math.
