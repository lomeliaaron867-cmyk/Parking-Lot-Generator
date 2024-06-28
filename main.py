# Parking Lot Planner - run this file to start the program

import copy
import math
import tkinter as tk
from tkinter import messagebox, ttk
from shapely.geometry import Point, Polygon, box

import planner

GRID = 10   # points snap to every 10 feet
GRASS = "#cfe8c0"

# help text for each tool, shown at the bottom of the window
HELP = {
    "Select": "Click to select. Drag to move. Drag a square to resize, or a road's middle square to curve it.",
    "Road": "Drag to draw a road. Start or end it on the property line to make an entrance.",
    "Circle": "Drag from the center out to draw a round road.",
    "Parking": "Drag a box to fill it with parking.",
    "Property": "Click each corner. Click the first corner again to finish.",
}


class App:
    def __init__(self, window):
        self.window = window
        window.title("Parking Lot Planner")
        window.geometry("1000x720")
        window.minsize(860, 680)

        self.corners = planner.make_property("Rectangle", 400, 300)
        self.roads = []
        self.areas = []
        self.results = []      # the parking that fits in each area
        self.layouts = []      # what Find layouts came up with
        self.history = []      # old versions for Undo
        self.selected = None
        self.drag = None       # what the mouse is doing right now
        self.new_corners = []  # corners of a property being drawn
        self.mouse = None

        # the bottom bar is packed first so it always shows
        self.info = ttk.Label(window, padding=6)
        self.info.pack(side="bottom", fill="x")
        self.total = ttk.Label(window, padding=(6, 4, 6, 0), font=("Arial", 14, "bold"))
        self.total.pack(side="bottom", fill="x")
        self.make_panel()
        self.canvas = tk.Canvas(window, bg="white", highlightthickness=0)
        self.canvas.pack(side="right", fill="both", expand=True)

        self.canvas.bind("<Configure>", lambda event: self.draw())
        self.canvas.bind("<Button-1>", self.mouse_down)
        self.canvas.bind("<B1-Motion>", self.mouse_drag)
        self.canvas.bind("<Motion>", self.mouse_move)
        self.canvas.bind("<ButtonRelease-1>", self.mouse_up)
        window.bind("<Delete>", self.delete_key)
        window.bind("<Control-z>", self.undo_key)
        self.update()

    def make_panel(self):
        panel = ttk.Frame(self.window, padding=10, width=240)
        panel.pack(side="left", fill="y")
        panel.pack_propagate(False)

        box1 = ttk.LabelFrame(panel, text="1. Property (feet)", padding=6)
        box1.pack(fill="x")
        self.length = self.add_entry(box1, "Length", 400)
        self.width = self.add_entry(box1, "Width", 300)
        self.shape = self.add_choice(box1, "Shape", planner.SHAPES)
        ttk.Button(box1, text="Set property", command=self.set_property).pack(fill="x", pady=(4, 0))

        box2 = ttk.LabelFrame(panel, text="2. Tool", padding=6)
        box2.pack(fill="x", pady=8)
        self.tool = tk.StringVar(value="Select")
        tools = [("Select", "Select and move"), ("Road", "Draw road"), ("Circle", "Draw circle road"),
                 ("Parking", "Draw parking"), ("Property", "Draw my own property")]
        for name, label in tools:
            ttk.Radiobutton(box2, text=label, value=name, variable=self.tool,
                            command=self.change_tool).pack(anchor="w")
        row = ttk.Frame(box2)
        row.pack(fill="x", pady=(4, 0))
        ttk.Button(row, text="Undo", command=self.undo, width=7).pack(side="left", expand=True, fill="x")
        ttk.Button(row, text="Delete", command=self.delete, width=7).pack(side="left", expand=True, fill="x")
        ttk.Button(row, text="Clear", command=self.clear, width=7).pack(side="left", expand=True, fill="x")

        self.settings = ttk.LabelFrame(panel, text="3. Selected item", padding=6)
        self.settings.pack(fill="x")

        box4 = ttk.LabelFrame(panel, text="4. Automatic layouts", padding=6)
        box4.pack(fill="both", expand=True, pady=(8, 0))
        ttk.Button(box4, text="Find layouts", command=self.find_layouts).pack(fill="x")
        self.layout_list = tk.Listbox(box4, height=5, exportselection=False)
        self.layout_list.pack(fill="both", expand=True, pady=(4, 0))
        self.layout_list.bind("<<ListboxSelect>>", self.use_layout)

    def add_entry(self, parent, label, value):
        row = ttk.Frame(parent)
        row.pack(fill="x", pady=1)
        ttk.Label(row, text=label, width=10).pack(side="left")
        entry = ttk.Entry(row, width=10)
        entry.insert(0, f"{value:g}")
        entry.pack(side="right", fill="x", expand=True)
        return entry

    def add_choice(self, parent, label, values, start=None):
        row = ttk.Frame(parent)
        row.pack(fill="x", pady=1)
        ttk.Label(row, text=label, width=10).pack(side="left")
        choice = ttk.Combobox(row, values=values, state="readonly", width=14)
        if start is None:
            start = values[0]
        choice.set(start)
        choice.pack(side="right", fill="x", expand=True)
        return choice

    def get_number(self, entry, name, low, high):
        # returns None and shows a message if it isn't a good number
        try:
            number = float(entry.get())
            if low <= number <= high:
                return number
        except ValueError:
            pass
        messagebox.showerror("Check your number", f"{name} must be from {low} to {high}.")
        return None

    def show_settings(self):
        # show the options for whatever is selected
        for widget in self.settings.winfo_children():
            widget.destroy()
        item = self.selected
        if item is None:
            ttk.Label(self.settings, text="Nothing selected").pack(anchor="w")
        elif "p1" in item:
            # it's a road
            self.road_width = self.add_entry(self.settings, "Width", item["width"])
            self.road_ends = self.add_choice(self.settings, "Ends", ["Entrance and exit", "Entrance only", "Exit only"],
                                             item["access"])
            self.road_width.bind("<Return>", lambda event: self.apply_road())
            ttk.Button(self.settings, text="Apply", command=self.apply_road).pack(fill="x", pady=(4, 0))
        else:
            # it's a parking area
            self.area_type = self.add_choice(self.settings, "Type", list(planner.PARKING_TYPES), item["type"])
            self.area_rows = self.add_choice(self.settings, "Rows", list(planner.DIRECTIONS), item["direction"])
            self.area_lanes = self.add_choice(self.settings, "Lanes", ["Sides", "Middle", "Around"], item["lanes"])
            self.space_width = self.add_entry(self.settings, "Space wide", item["width"])
            self.space_length = self.add_entry(self.settings, "Space long", item["length"])
            self.aisle_width = self.add_entry(self.settings, "Aisle", item["aisle"])
            self.row_angle = self.add_entry(self.settings, "Angle", item["angle"])   # only used by diagonal rows
            self.area_type.bind("<<ComboboxSelected>>", self.new_type)
            for entry in (self.space_width, self.space_length, self.aisle_width, self.row_angle):
                entry.bind("<Return>", lambda event: self.apply_area())
            ttk.Button(self.settings, text="Apply", command=self.apply_area).pack(fill="x", pady=(4, 0))

    def apply_road(self):
        width = self.get_number(self.road_width, "Road width", 10, 100)
        if width is None:
            return
        self.remember()
        self.selected["width"] = width
        self.selected["access"] = self.road_ends.get()
        self.update()

    def new_type(self, event):
        # put in the normal sizes for this type of parking
        sizes = planner.PARKING_TYPES[self.area_type.get()]
        for entry, key in ((self.space_width, "width"), (self.space_length, "length"), (self.aisle_width, "aisle")):
            entry.delete(0, "end")
            entry.insert(0, sizes[key])

    def apply_area(self):
        width = self.get_number(self.space_width, "Width", 7, 20)
        if width is None:
            return
        length = self.get_number(self.space_length, "Length", 14, 40)
        if length is None:
            return
        aisle = self.get_number(self.aisle_width, "Aisle", 10, 60)
        if aisle is None:
            return
        angle = self.get_number(self.row_angle, "Diagonal angle", 10, 80)
        if angle is None:
            return
        self.remember()
        area = self.selected
        area["width"] = width
        area["length"] = length
        area["aisle"] = aisle
        area["angle"] = angle
        area["type"] = self.area_type.get()
        area["direction"] = self.area_rows.get()
        area["lanes"] = self.area_lanes.get()
        self.update()

    def land(self):
        return Polygon(self.corners)

    def state(self):
        # a copy of everything Undo needs to put back
        return copy.deepcopy((self.corners, self.roads, self.areas))

    def remember(self):
        self.history.append(self.state())

    def undo(self):
        # don't undo in the middle of dragging something
        if self.history and self.drag is None:
            old_corners = self.corners
            self.corners, self.roads, self.areas = self.history.pop()
            if self.corners != old_corners:
                self.clear_layouts()     # they were for a different property
            self.new_corners = []
            self.select(None)
            self.update()

    def set_property(self):
        length = self.get_number(self.length, "Length", 50, 1000)
        if length is None:
            return
        if self.shape.get() == "Square":
            width = length   # a square doesn't use the width box
        else:
            width = self.get_number(self.width, "Width", 50, 1000)
            if width is None:
                return
        self.new_land(planner.make_property(self.shape.get(), length, width))

    def new_land(self, corners):
        # old roads and parking might not fit, so start over (undo brings them back)
        self.remember()
        self.corners = corners
        self.roads = []
        self.areas = []
        self.clear_layouts()
        self.select(None)
        self.update()

    def clear(self):
        if self.roads or self.areas:
            self.new_land(self.corners)

    def delete(self):
        if self.selected is not None and self.drag is None:
            self.remember()
            if self.selected in self.roads:
                self.roads.remove(self.selected)
            else:
                self.areas.remove(self.selected)
            self.select(None)
            self.update()

    def delete_key(self, event):
        # the Delete key should still work normally while typing in a box
        if event.widget.winfo_class() not in ("TEntry", "TCombobox"):
            self.delete()

    def undo_key(self, event):
        # same idea, Ctrl+Z in a box shouldn't undo the drawing
        if event.widget.winfo_class() not in ("TEntry", "TCombobox"):
            self.undo()

    def change_tool(self):
        self.new_corners = []
        self.select(None)
        self.show_total()
        self.draw()

    def clear_layouts(self):
        self.layouts = []
        self.layout_list.delete(0, "end")

    def find_layouts(self):
        # the window can't redraw while it searches, so say what's happening first
        self.window.config(cursor="watch")
        self.info.config(text="Finding layouts... big properties can take up to a minute.")
        self.window.update_idletasks()
        self.clear_layouts()
        # use a copy so editing the roads later doesn't change the layouts
        self.layouts = planner.find_layouts(self.land(), copy.deepcopy(self.roads))
        self.window.config(cursor="")
        self.show_total()     # put the normal text back
        for layout in self.layouts:
            self.layout_list.insert("end", layout["name"])
        if len(self.layouts) == 0:
            messagebox.showinfo("No layouts", "Nothing fit. Try a bigger property, or a road that "
                                              "starts on the property line and goes further in.")

    def use_layout(self, event):
        picked = self.layout_list.curselection()
        if picked:
            layout = copy.deepcopy(self.layouts[picked[0]])
            self.remember()
            self.roads = layout["roads"]
            self.areas = [layout["area"]]
            self.select(None)
            self.update()

    def select(self, item):
        self.selected = item
        self.show_settings()

    def to_screen(self, point):
        # feet to pixels (y is flipped because the screen counts down)
        return (point[0] * self.scale + self.left, self.bottom - point[1] * self.scale)

    def to_feet(self, event):
        # pixels to feet
        return ((event.x - self.left) / self.scale, (self.bottom - event.y) / self.scale)

    def snap(self, event):
        x, y = self.to_feet(event)
        return (round(x / GRID) * GRID, round(y / GRID) * GRID)

    def snap_inside(self, event):
        return planner.keep_inside(self.snap(event), self.land())

    def near(self, event, point):
        # is the mouse within a few pixels of this point?
        x, y = self.to_screen(point)
        return abs(x - event.x) < 9 and abs(y - event.y) < 9

    def handles(self):
        # the little squares you can drag on the selected item
        item = self.selected
        if item is None:
            return []
        if "p1" in item:
            if item["circle"]:
                return [item["p1"], item["p2"]]
            middle = item["bend"]
            if middle is None:
                middle = planner.straight_middle(item)
            return [item["p1"], item["p2"], middle]
        x1, y1, x2, y2 = item["box"]
        return [(x1, y1), (x2, y1), (x2, y2), (x1, y2)]

    def mouse_down(self, event):
        self.canvas.focus_set()
        tool = self.tool.get()
        if tool == "Property":
            self.add_corner(event)
        elif tool == "Select":
            # grabbing a square resizes the item (or bends a road)
            handles = self.handles()
            for i in range(len(handles)):
                if self.near(event, handles[i]):
                    self.drag = {"kind": "resize", "handle": i, "before": self.state()}
                    if "box" in self.selected:
                        # the corner across from this one stays where it is
                        self.drag["opposite"] = handles[(i + 2) % 4]
                    return
            # otherwise select what was clicked, and get ready to move it
            self.select(self.item_at(event))
            if self.selected is not None:
                self.drag = {"kind": "move", "start": self.to_feet(event), "before": self.state(),
                             "item": copy.deepcopy(self.selected)}
            self.draw()
        else:
            # start drawing a road, circle, or parking box
            point = self.snap_inside(event)
            self.drag = {"kind": tool, "start": point, "end": point}

    def item_at(self, event):
        # roads are checked first because they are drawn on top
        point = Point(self.to_feet(event))
        for road in reversed(self.roads):
            if planner.road_shape(road, self.land()).distance(point) < 3:
                return road
        for area in reversed(self.areas):
            if box(*area["box"]).contains(point):
                return area
        return None

    def mouse_drag(self, event):
        if self.drag is None:
            return
        if self.drag["kind"] == "resize":
            self.resize(event)
        elif self.drag["kind"] == "move":
            self.move(event)
        else:
            self.drag["end"] = self.snap_inside(event)
        self.draw()

    def resize(self, event):
        item = self.selected
        point = self.snap_inside(event)
        if "p1" in item and self.drag["handle"] == 2:
            # the middle square bends the road, and dragging it back in line makes it straight again
            if math.dist(point, planner.straight_middle(item)) >= GRID:
                item["bend"] = point
            else:
                item["bend"] = None
        elif "p1" in item:
            # move one end, but don't let the road get too short
            if self.drag["handle"] == 0:
                end, other = "p1", item["p2"]
            else:
                end, other = "p2", item["p1"]
            if math.dist(point, other) >= 10:
                item[end] = point
        else:
            x, y = self.drag["opposite"]
            if abs(point[0] - x) >= 20 and abs(point[1] - y) >= 20:
                item["box"] = [min(x, point[0]), min(y, point[1]), max(x, point[0]), max(y, point[1])]

    def move(self, event):
        # how far the mouse moved, snapped to the grid
        x, y = self.to_feet(event)
        dx = round((x - self.drag["start"][0]) / GRID) * GRID
        dy = round((y - self.drag["start"][1]) / GRID) * GRID
        old = self.drag["item"]
        item = self.selected
        edge = self.land().buffer(0.01)
        if "p1" in item:
            # move both ends, and the bend if it has one
            p1 = (old["p1"][0] + dx, old["p1"][1] + dy)
            p2 = (old["p2"][0] + dx, old["p2"][1] + dy)
            points = [p1, p2]
            bend = None
            if old["bend"] is not None:
                bend = (old["bend"][0] + dx, old["bend"][1] + dy)
                points.append(bend)
            inside = True
            for p in points:
                if edge.covers(Point(p)) == False:
                    inside = False
            if inside == True:
                item["p1"] = p1
                item["p2"] = p2
                item["bend"] = bend
        else:
            x1, y1, x2, y2 = old["box"]
            new = [x1 + dx, y1 + dy, x2 + dx, y2 + dy]
            # stay inside, unless it already stuck out (like a box over an L-shape)
            if edge.covers(box(*new)) or not edge.covers(box(*old["box"])):
                item["box"] = new

    def mouse_up(self, event):
        if self.drag is None:
            return
        drag = self.drag
        self.drag = None
        if drag["kind"] in ("move", "resize"):
            # only make an undo step if something really changed
            if self.state() != drag["before"]:
                self.history.append(drag["before"])
                self.show_settings()
                self.update()
            return

        x1, y1 = drag["start"]
        x2, y2 = drag["end"]
        if drag["kind"] in ("Road", "Circle") and math.dist((x1, y1), (x2, y2)) >= 10:
            self.remember()
            road = planner.make_road((x1, y1), (x2, y2), circle=(drag["kind"] == "Circle"))
            self.roads.append(road)
            self.finish_drawing(road)
        elif drag["kind"] == "Parking" and abs(x2 - x1) >= 20 and abs(y2 - y1) >= 20:
            self.remember()
            area = planner.make_area([min(x1, x2), min(y1, y2), max(x1, x2), max(y1, y2)])
            self.areas.append(area)
            self.finish_drawing(area)
        else:
            self.draw()     # too small, so it isn't kept

    def finish_drawing(self, item):
        self.tool.set("Select")
        self.select(item)
        self.update()

    def add_corner(self, event):
        # clicking the first corner again finishes the property
        if len(self.new_corners) >= 3 and self.near(event, self.new_corners[0]):
            shape = Polygon(self.new_corners)
            corners = self.new_corners
            self.new_corners = []
            if shape.is_valid and shape.area >= 2500:
                self.tool.set("Select")
                self.new_land(corners)
            else:
                messagebox.showerror("Try again", "The sides can't cross, and it must be at least 2,500 square feet.")
                self.draw()
            return
        point = self.snap(event)
        if point not in self.new_corners:
            self.new_corners.append(point)
        self.draw()

    def mouse_move(self, event):
        # show a line to the mouse while drawing a property
        if self.new_corners:
            self.mouse = self.snap(event)
            self.draw()

    def update(self):
        # redo the parking math, then redraw
        self.results = planner.fill_all(self.areas, self.land(), self.roads)
        self.show_total()
        self.draw()

    def show_total(self):
        total = 0
        connected = True
        for result in self.results:
            total += len(result["stalls"])
            if not result["connected"]:
                connected = False
        self.total.config(text="%d parking spaces" % total)
        if connected:
            text = f"Property: {self.land().area:,.0f} sq ft.  {HELP[self.tool.get()]}"
        else:
            text = "Warning: some parking has no way in and out. Connect it with roads to the property line."
        self.info.config(text=text)

    def set_scale(self):
        # fit the property in the canvas with some room around it
        x1, y1, x2, y2 = self.land().bounds
        # the canvas has no size until the window opens
        w = max(self.canvas.winfo_width(), 200)
        h = max(self.canvas.winfo_height(), 200)
        self.scale = min((w - 100) / (x2 - x1), (h - 100) / (y2 - y1))
        self.left = (w - (x2 - x1) * self.scale) / 2 - x1 * self.scale
        self.bottom = (h + (y2 - y1) * self.scale) / 2 + y1 * self.scale

    def polygon(self, points, **options):
        # tkinter wants a flat list: x1, y1, x2, y2, ...
        flat = []
        for point in points:
            x, y = self.to_screen(point)
            flat.append(x)
            flat.append(y)
        self.canvas.create_polygon(flat, **options)

    def circle_corners(self, center, edge):
        # tkinter does circles with a box around them
        x, y = self.to_screen(center)
        r = math.dist(center, edge) * self.scale
        return x - r, y - r, x + r, y + r

    def draw_shape(self, shape, color):
        for piece in planner.get_pieces(shape):
            self.polygon(piece.exterior.coords, fill=color, outline="")
            for hole in piece.interiors:
                self.polygon(hole.coords, fill="#cfe8c0", outline="")  # grass color

    def labelSpot(self, x, y, distance_x, distance_y):
        # move a label away from the middle of the property so it sits outside it
        center = self.land().centroid
        cx, cy = self.to_screen((center.x, center.y))
        away = math.dist((x, y), (cx, cy))
        if away == 0:
            away = 1    # can't divide by zero
        return x + (x - cx) / away * distance_x, y + (y - cy) / away * distance_y

    def draw(self):
        c = self.canvas
        c.delete("all")
        self.set_scale()
        self.polygon(self.corners, fill=GRASS, outline="")
        self.draw_grid()

        # parking is hidden while dragging so it doesn't lag
        if self.drag is None:
            for result in self.results:
                self.draw_shape(result["lanes"], "gray60")
                for stall in result["stalls"]:
                    self.polygon(stall, fill="gray75", outline="white")
                for start, end in result["arrows"]:
                    c.create_line(*self.to_screen(start), *self.to_screen(end), fill="white", arrow="last", width=2)

        for road in self.roads:
            self.draw_shape(planner.road_shape(road, self.land()), "gray35")
        # yellow dashes down the middle of each road
        for road in self.roads:
            if road["circle"]:
                c.create_oval(*self.circle_corners(road["p1"], road["p2"]), outline="yellow", dash=(6, 6))
            else:
                points = []
                for point in planner.road_line(road):
                    points.append(self.to_screen(point))
                c.create_line(points, fill="yellow", dash=(6, 6))
        self.polygon(self.corners, fill="", outline="darkgreen", width=2)

        for point, access in planner.entrances(self.roads, self.land()):
            x, y = self.to_screen(point)
            if access == "Entrance only":
                label = "IN"
            elif access == "Exit only":
                label = "OUT"
            else:
                label = "IN/OUT"
            c.create_oval(x - 5, y - 5, x + 5, y + 5, fill="red", outline="white")
            label_x, label_y = self.labelSpot(x, y, 26, 16)
            c.create_text(label_x, label_y, text=label, fill="red", font=("Arial", 9, "bold"))

        self.draw_lengths()
        #c.create_text(10, 10, text=str(self.scale), anchor="nw")   # was for checking the zoom
        for area in self.areas:
            x1, y1, x2, y2 = area["box"]
            c.create_rectangle(*self.to_screen((x1, y1)), *self.to_screen((x2, y2)), outline="blue", dash=(4, 4))
        for point in self.handles():
            x, y = self.to_screen(point)
            c.create_rectangle(x - 5, y - 5, x + 5, y + 5, fill="white", outline="blue", width=2)
        self.draw_new_item()

    def draw_grid(self):
        # make the grid wider when zoomed out so the lines aren't too close
        step = GRID
        while step * self.scale < 8:
            step *= 2
        w = self.canvas.winfo_width()
        h = self.canvas.winfo_height()
        x = self.left % (step * self.scale)
        while x < w:
            self.canvas.create_line(x, 0, x, h, fill="gray90")
            x += step * self.scale
        y = self.bottom % (step * self.scale)
        while y < h:
            self.canvas.create_line(0, y, w, y, fill="gray90")
            y += step * self.scale

    def draw_lengths(self):
        # write the length of each side next to it
        for i in range(len(self.corners)):
            a = self.corners[i]
            b = self.corners[(i + 1) % len(self.corners)]   # the last side goes back to the first corner
            # not at the middle, because driveways usually go there
            x, y = self.to_screen((a[0] * 0.7 + b[0] * 0.3, a[1] * 0.7 + b[1] * 0.3))
            label_x, label_y = self.labelSpot(x, y, 28, 28)
            self.canvas.create_text(label_x, label_y, text=f"{math.dist(a, b):.0f} ft")

    def draw_new_item(self):
        # the thing being drawn right now, with its size
        c = self.canvas
        if self.drag is not None and self.drag["kind"] in ("Road", "Circle", "Parking"):
            a = self.drag["start"]
            b = self.drag["end"]
            x1, y1 = self.to_screen(a)
            x2, y2 = self.to_screen(b)
            if self.drag["kind"] == "Road":
                c.create_line(x1, y1, x2, y2, width=max(2, 24 * self.scale), fill="gray50")
                size = f"{math.dist(a, b):.0f} ft"
            elif self.drag["kind"] == "Circle":
                c.create_oval(*self.circle_corners(a, b), width=max(2, 24 * self.scale), outline="gray50")
                size = f"{math.dist(a, b) * 2:.0f} ft across"
            else:
                c.create_rectangle(x1, y1, x2, y2, outline="blue", width=2)
                size = f"{abs(b[0] - a[0]):.0f} x {abs(b[1] - a[1]):.0f} ft"
            c.create_text((x1 + x2) / 2, (y1 + y2) / 2, text=size, font=("Arial", 11, "bold"))

        # the property being drawn, with a line to the mouse
        if self.new_corners:
            points = []
            for corner in self.new_corners:
                points.append(self.to_screen(corner))
            if self.mouse:
                points.append(self.to_screen(self.mouse))
            if len(points) > 1:
                c.create_line(points, fill="blue", width=2)
            for x, y in points:
                c.create_oval(x - 4, y - 4, x + 4, y + 4, fill="blue")


if __name__ == "__main__":
    window = tk.Tk()
    App(window)
    window.mainloop()
