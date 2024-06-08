# Math for the parking lot planner. All sizes are in feet.

import math
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import nearest_points, unary_union

SETBACK = 5       # parking stays this far from the property line
CROSS_LANE = 24   # width of the lane that connects the aisles
ROUNDING = 0.02   # decimals aren't exact, so shapes that should touch can be off by a tiny bit
NEAR = 0.5        # a space counts as next to a lane if it is this close

# normal sizes for each kind of parking space
PARKING_TYPES = {
    "Straight":  {"angle": 90, "width": 9, "length": 18, "aisle": 24},
    "Angled 60": {"angle": 60, "width": 9, "length": 18, "aisle": 18},
    "Angled 45": {"angle": 45, "width": 9, "length": 18, "aisle": 13},
    "Parallel":  {"angle": 0,  "width": 8, "length": 22, "aisle": 12},
}

# which way the rows go
DIRECTIONS = ["Across", "Down", "Diagonal /", "Diagonal \\"]

SHAPES = ["Rectangle", "Square", "L-shape", "T-shape", "Triangle", "Trapezoid"]

# the rows and lanes that Find layouts tries
LAYOUTS = [("Across", "Sides"), ("Across", "Around"), ("Across", "Middle"),
           ("Down", "Sides"), ("Down", "Around"), ("Down", "Middle")]
DIAGONAL_ANGLES = [15, 30, 45, 60, 75]   # Find layouts tries diagonal rows at these angles, both ways
MAX_LAYOUTS = 100                        # the most layouts to show in the list


def make_property(shape, length, width):
    # returns the corners of the property
    if shape == "Square":
        width = length
    if shape == "Triangle":
        return [(0, 0), (length, 0), (length / 2, width)]
    if shape == "Trapezoid":
        return [(0, 0), (length, 0), (length * 0.75, width), (length * 0.25, width)]
    if shape == "L-shape":
        return [(0, 0), (length, 0), (length, width / 2),
                (length / 2, width / 2), (length / 2, width), (0, width)]
    if shape == "T-shape":
        return [(length * 0.3, 0), (length * 0.7, 0), (length * 0.7, width / 2), (length, width / 2),
                (length, width), (0, width), (0, width / 2), (length * 0.3, width / 2)]
    return [(0, 0), (length, 0), (length, width), (0, width)]


def keep_inside(point, land):
    # if a point is outside the property, move it to the closest edge
    if land.covers(Point(point)):
        return point
    closest = nearest_points(land, Point(point))[0]
    return (closest.x, closest.y)


def make_road(p1, p2, width=24, circle=False):
    # for a circle, p1 is the center and p2 is on the edge
    # bend is the point a curved road goes through halfway, or None if it is straight
    return {"p1": p1, "p2": p2, "bend": None, "width": width, "access": "Entrance and exit", "circle": circle}


def straight_middle(road):
    # the point halfway between the two ends
    x1, y1 = road["p1"]
    x2, y2 = road["p2"]
    return ((x1 + x2) / 2, (y1 + y2) / 2)


def road_line(road):
    # the points along the middle of a road
    p1 = road["p1"]
    p2 = road["p2"]
    bend = road["bend"]
    if bend is None:
        return [p1, p2]

    # a Bezier curve is pulled toward a control point but only gets halfway there,
    # so the control point is twice as far out as the bend
    middle = straight_middle(road)
    cx = 2 * bend[0] - middle[0]
    cy = 2 * bend[1] - middle[1]
    points = []
    for i in range(21):
        t = i / 20
        x = (1 - t) ** 2 * p1[0] + 2 * (1 - t) * t * cx + t ** 2 * p2[0]
        y = (1 - t) ** 2 * p1[1] + 2 * (1 - t) * t * cy + t ** 2 * p2[1]
        points.append((x, y))
    return points


def make_area(corners, kind="Straight"):
    # a parking area starts with the normal sizes for its type
    info = PARKING_TYPES[kind]
    return {"box": corners, "type": kind, "width": info["width"], "length": info["length"],
            "aisle": info["aisle"], "direction": "Across", "lanes": "Sides", "angle": 45}


def row_angle(area):
    # how far the rows are turned, in degrees
    if area["direction"] == "Down":
        return 90
    if area["direction"] == "Diagonal /":
        return area["angle"]
    if area["direction"] == "Diagonal \\":
        return -area["angle"]
    return 0


def around_edge(area):
    # diagonal rows only connect with a lane that goes all the way around
    return area["lanes"] == "Around" or area["direction"].startswith("Diagonal")


def road_shape(road, land):
    if road["circle"]:
        # a ring is a big circle with a smaller circle cut out of the middle
        radius = math.dist(road["p1"], road["p2"])
        inner = radius - road["width"] / 2
        if inner < 0:
            inner = 0
        outside = Point(road["p1"]).buffer(radius + road["width"] / 2)
        hole = Point(road["p1"]).buffer(inner)
        return outside.difference(hole).intersection(land)

    # a road is its middle line made wider
    # square ends make it a little longer so it meets the property line and other roads
    line = LineString(road_line(road))
    return line.buffer(road["width"] / 2, cap_style="square").intersection(land)


def entrances(roads, land):
    # a road end that touches the property line is an entrance or exit
    found = []
    for road in roads:
        if road["circle"]:
            continue
        for point in (road["p1"], road["p2"]):
            if land.exterior.distance(Point(point)) < 1:
                found.append((point, road["access"]))
    return found


def get_pieces(shape):
    # Shapely can give back one polygon or a group of shapes, so turn it into a list of polygons
    if shape.geom_type == "Polygon":
        shapes = [shape]
    elif shape.geom_type in ("MultiPolygon", "GeometryCollection"):
        shapes = shape.geoms
    else:
        shapes = []

    pieces = []
    for piece in shapes:
        if piece.geom_type == "Polygon" and not piece.is_empty:
            pieces.append(piece)
    return pieces


def stall_size(area):
    # returns spacing, depth, lean
    # (got the angled parking formulas from drawing it out on paper)
    angle = PARKING_TYPES[area["type"]]["angle"]
    if angle == 0:
        return area["length"], area["width"], 0   # parallel
    a = math.radians(angle)
    spacing = area["width"]/math.sin(a)
    depth = area["length"]*math.sin(a) + area["width"]*math.cos(a)
    lean = depth/math.tan(a)
    return spacing, depth, lean


def turn(points, center, degrees):
    # rotate points around the center with the rotation formula
    angle = math.radians(degrees)
    cx, cy = center
    turned = []
    for x, y in points:
        new_x = cx + (x - cx) * math.cos(angle) - (y - cy) * math.sin(angle)
        new_y = cy + (x - cx) * math.sin(angle) + (y - cy) * math.cos(angle)
        turned.append((new_x, new_y))
    return turned


def make_row(area, left, right, front, back, travel):
    # one row of spaces, leaning the way the cars are going (travel is 1 or -1)
    spacing, depth, lean = stall_size(area)
    stalls = []
    if travel == 1:
        x = left
        last = right - lean
    else:
        x = left + lean
        last = right
    while x + spacing <= last + 0.01:
        move = lean * travel
        stalls.append([(x, front), (x + spacing, front), (x + spacing + move, back), (x + move, back)])
        x += spacing
    return stalls


def make_rows(area):
    # returns the spaces, lanes, and arrows for an area
    # every row is made going across, then everything is turned at the end
    x1, y1, x2, y2 = area["box"]
    center = ((x1 + x2) / 2, (y1 + y2) / 2)
    width = x2 - x1
    height = y2 - y1
    degrees = row_angle(area)
    if area["direction"] == "Down":
        width, height = height, width
    elif area["direction"].startswith("Diagonal"):
        # make the box big enough that it still covers the whole area after it is turned
        cos = abs(math.cos(math.radians(degrees)))
        sin = abs(math.sin(math.radians(degrees)))
        width, height = width * cos + height * sin, width * sin + height * cos
    x1 = center[0] - width / 2
    x2 = center[0] + width / 2
    y1 = center[1] - height / 2
    y2 = center[1] + height / 2

    # lanes that connect the aisles, and the parts in between that get spaces
    one_way = area["type"] != "Straight"
    if around_edge(area):
        cross = []
        parts = [(x1, x2)]
    elif area["lanes"] == "Middle" and not one_way:
        middle = center[0] - CROSS_LANE / 2
        cross = [middle]
        parts = [(x1, middle), (middle + CROSS_LANE, x2)]
    else:
        cross = [x1, x2 - CROSS_LANE]
        parts = [(x1 + CROSS_LANE, x2 - CROSS_LANE)]
    lanes = []
    for x in cross:
        lanes.append([(x, y1), (x + CROSS_LANE, y1), (x + CROSS_LANE, y2), (x, y2)])

    # spaces, aisle, spaces, then repeat
    depth = stall_size(area)[1]
    stalls = []
    arrows = []
    y = y1
    travel = 1
    while y + depth + area["aisle"] <= y2 + 0.01:
        bottom = y + depth
        top = y + depth + area["aisle"]
        lanes.append([(x1, bottom), (x2, bottom), (x2, top), (x1, top)])
        if one_way:
            middle = (bottom + top) / 2
            arrows.append([(center[0] - 8 * travel, middle), (center[0] + 8 * travel, middle)])
        for left, right in parts:
            stalls += make_row(area, left, right, bottom, y, travel)
            if top + depth <= y2 + 0.01:
                stalls += make_row(area, left, right, top, top + depth, travel)
        y = top + depth
        travel = -travel     # every other aisle goes the other way

    #print("stalls before turning:", len(stalls))

    # Turn everything
    turned_stalls = []
    for stall in stalls:
        turned_stalls.append(turn(stall, center, degrees))
    turned_lanes = []
    for lane in lanes:
        turned_lanes.append(Polygon(turn(lane, center, degrees)))
    turned_arrows = []
    for arrow in arrows:
        turned_arrows.append(turn(arrow, center, degrees))
    return turned_stalls, turned_lanes, turned_arrows


def free_space(area, land, road_area, blocked):
    x1, y1, x2, y2 = area["box"]
    inside = land.buffer(-SETBACK, join_style="mitre")   # mitre keeps the corners square
    free = inside.intersection(box(x1, y1, x2, y2))
    free = free.difference(road_area)
    for other in blocked:
        free = free.difference(box(*other))
    return free


def has_door(piece, doors, not_allowed):
    for point, access in doors:
        if access != not_allowed and piece.distance(Point(point)) < 1:
            return True
    return False


def connected_lanes(lanes, road_area, doors):
    # the pavement that is joined to a way in and a way out
    # TODO check if lanes are wide enough + one way direction
    reached = []
    pavement = unary_union([lanes, road_area]).buffer(ROUNDING)
    for piece in get_pieces(pavement):
        way_in = has_door(piece, doors, "Exit only")
        way_out = has_door(piece, doors, "Entrance only")
        if piece.intersects(lanes) and way_in and way_out:
            reached.append(piece)
    return unary_union(reached)


def fill_area(area, land, roads, blocked=()):
    # fill an area with parking, and check if it connects to a road
    stalls, lanes, arrows = make_rows(area)
    road_area = unary_union([road_shape(r, land) for r in roads])
    free = free_space(area, land, road_area, blocked)
    spots = free       # where spaces can go
    if around_edge(area):
        spots = free.buffer(-CROSS_LANE, join_style="mitre")
        lanes.append(free.difference(spots))
    lanes = unary_union(lanes).intersection(free)

    reached = connected_lanes(lanes, road_area, entrances(roads, land))
    if reached.is_empty:
        connected = False
    else:
        connected = True
    if connected == True:
        lanes = lanes.intersection(reached)
        near_lane = reached.buffer(NEAR)
    else:
        near_lane = lanes.buffer(NEAR)     # still show the spaces, with a warning

    # keep the spaces that fit and have a lane in front
    spots = spots.buffer(ROUNDING)
    good_stalls = []
    for s in stalls:
        front_middle = Point((s[0][0] + s[1][0]) / 2, (s[0][1] + s[1][1]) / 2)
        if near_lane.contains(front_middle) and spots.contains(Polygon(s)):
            good_stalls.append(s)

    # only keep arrows that are on a lane
    good_arrows = []
    for arrow in arrows:
        if lanes.contains(LineString(arrow)):
            good_arrows.append(arrow)

    if len(good_stalls) == 0:
        connected = False
    return {"stalls": good_stalls, "lanes": lanes, "arrows": good_arrows, "connected": connected}


def fill_all(areas, land, roads):
    # earlier areas block later ones so spaces never overlap
    results = []
    for i in range(len(areas)):
        blocked = []
        for other in areas[:i]:
            blocked.append(other["box"])
        results.append(fill_area(areas[i], land, roads, blocked))
    return results


def make_driveways(land):
    # One short driveway from the middle of each side.
    corners = list(land.exterior.coords)
    driveways = []
    for i in range(len(corners) - 1):
        a = corners[i]
        b = corners[i + 1]
        length = math.dist(a, b)
        if length < 60:
            continue
        mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)

        # a direction at a right angle to the side, flipped if it points outside
        dx = -(b[1] - a[1]) / length
        dy = (b[0] - a[0]) / length
        if not land.contains(Point(mid[0] + dx, mid[1] + dy)):
            dx = -dx
            dy = -dy

        end = (mid[0] + dx * 40, mid[1] + dy * 40)
        if land.contains(Point(end)):
            driveways.append(make_road(mid, end))
    return driveways


def find_layouts(land, roads):
    # try different layouts and return them with the most spaces first
    x1, y1, x2, y2 = land.bounds
    whole = [x1 + SETBACK, y1 + SETBACK, x2 - SETBACK, y2 - SETBACK]

    # use the roads that are drawn, or else try a driveway on each side
    if roads:
        road_choices = [roads]
    else:
        road_choices = []
        for driveway in make_driveways(land):
            road_choices.append([driveway])

    # every way to set up the rows: direction, lanes, and angle (the angle only matters for diagonals)
    setups = []
    for direction, lanes in LAYOUTS:
        setups.append((direction, lanes, 45))
    for angle in DIAGONAL_ANGLES:
        setups.append(("Diagonal /", "Around", angle))
        setups.append(("Diagonal \\", "Around", angle))

    layouts = []
    for kind in PARKING_TYPES:
        for direction, lanes, angle in setups:
            if lanes == "Middle" and kind != "Straight":
                continue      # one-way aisles can't have dead ends
            best = None
            for choice in road_choices:
                area = make_area(list(whole), kind)
                area["direction"] = direction
                area["lanes"] = lanes
                area["angle"] = angle
                result = fill_area(area, land, choice)
                count = len(result["stalls"])
                if result["connected"] and (best is None or count > best["count"]):
                    if lanes == "Middle":
                        name = f"{count} - {kind}, {direction} (dead ends)"
                    elif direction.startswith("Diagonal"):
                        name = f"{count} - {kind}, {direction} {angle}°, {lanes}"
                    else:
                        name = f"{count} - {kind}, {direction}, {lanes}"
                    best = {"count": count, "name": name, "roads": choice, "area": area}
            if best is not None:
                layouts.append(best)

    layouts.sort(key=lambda layout: layout["count"], reverse=True)
    return layouts[:MAX_LAYOUTS]
