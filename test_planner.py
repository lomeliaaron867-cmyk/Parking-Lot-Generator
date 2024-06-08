# Checks the planner math. Run: python test_planner.py

import math
from shapely.geometry import Point, Polygon

import planner

# a lot small enough to count by hand: 10 spaces on each side of one aisle
land = Polygon(planner.make_property("Rectangle", 148, 70))
area = planner.make_area([5, 5, 143, 65])
assert len(planner.fill_area(area, land, [])["stalls"]) == 20

used = set()
angles = set()
for shape in planner.SHAPES:
    land = Polygon(planner.make_property(shape, 400, 300))
    x1, y1, x2, y2 = land.bounds
    assert land.is_valid and (round(x1), round(y1), round(x2)) == (0, 0, 400)
    assert round(y2) == (400 if shape == "Square" else 300)   # the size that was typed in
    layouts = planner.find_layouts(land, [])
    assert layouts, shape
    for layout in layouts:
        result = planner.fill_area(layout["area"], land, layout["roads"])
        spaces = [Polygon(s) for s in result["stalls"]]
        road = planner.road_shape(layout["roads"][0], land)
        used.add(layout["area"]["direction"])
        angles.add(layout["area"]["angle"])
        assert result["connected"]
        for i, space in enumerate(spaces):
            assert land.contains(space)                                  # inside the property
            assert space.intersection(road).area < 0.1                   # not on a road
            assert space.intersection(result["lanes"]).area < 0.1        # not on a lane
            for other in spaces[i + 1:]:
                assert space.intersection(other).area < 0.1              # not on another space

assert used == {"Across", "Down", "Diagonal /", "Diagonal \\"}
assert angles == {15, 30, 45, 60, 75}           # every diagonal angle shows up somewhere
assert len(layouts) <= planner.MAX_LAYOUTS

# an exit-only road is not a way in
land = Polygon(planner.make_property("Rectangle", 400, 300))
road = planner.make_road((200, 0), (200, 40))
area = planner.make_area([5, 5, 395, 295])
assert planner.fill_area(area, land, [road])["connected"]
road["access"] = "Exit only"
assert not planner.fill_area(area, land, [road])["connected"]

# two areas on top of each other never share a spot
first, second = planner.fill_all([area, planner.make_area([100, 100, 395, 295])], land, [road])
assert first["stalls"] and not second["stalls"]

# a circle road is a ring with a hole, and joins onto a straight road
ring = planner.make_road((200, 150), (200, 90), circle=True)
assert not planner.road_shape(ring, land).contains(Point(200, 150))
road["access"] = "Entrance and exit"
road["p2"] = (200, 90)
assert planner.entrances([ring], land) == []
area["direction"] = "Diagonal \\"
assert planner.fill_area(area, land, [road, ring])["connected"]

# a curved road goes through its bend instead of straight across
road = planner.make_road((100, 0), (300, 0))
road["bend"] = (200, 100)
curve = planner.road_shape(road, land)
assert curve.is_valid and curve.contains(Point(200, 100)) and not curve.contains(Point(200, 20))
assert len(planner.entrances([road], land)) == 2
result = planner.fill_area(area, land, [road])
assert result["connected"]
assert all(Polygon(s).intersection(curve).area < 0.1 for s in result["stalls"])

# diagonal rows at other angles still fit inside the area without overlapping
land = Polygon(planner.make_property("Rectangle", 400, 300))
road = planner.make_road((200, 0), (200, 60))
for angle in (20, 30, 60, 75):
    for direction in ("Diagonal /", "Diagonal \\"):
        area = planner.make_area([5, 5, 395, 295])
        area["direction"] = direction
        area["angle"] = angle
        result = planner.fill_area(area, land, [road])
        spaces = [Polygon(s) for s in result["stalls"]]
        assert result["connected"] and len(spaces) > 100, (angle, direction, len(spaces))
        for i, space in enumerate(spaces):
            assert land.contains(space)
            assert space.intersection(result["lanes"]).area < 0.1
            for other in spaces[i + 1:]:
                assert space.intersection(other).area < 0.1

# the first and last space of a row should line up with the angle
area["angle"] = 30
first = planner.make_rows(area)[0][0]
dx = first[1][0] - first[0][0]
dy = first[1][1] - first[0][1]
assert round(math.degrees(math.atan2(dy, dx))) == -30

print("All checks passed")
