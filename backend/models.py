"""Validated API contract; coordinates and dimensions are in feet."""
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator
from shapely.geometry import Polygon

Number = Annotated[float, Field(strict=True, allow_inf_nan=False)]
Coordinate = Annotated[Number, Field(ge=-1000, le=1000)]

class Model(BaseModel):
    model_config = ConfigDict(extra='forbid')

class Point(Model):
    x: Coordinate
    z: Coordinate

class Building(Model):
    id: str = Field(min_length=1, max_length=120)
    x: Coordinate
    z: Coordinate
    w: Annotated[Number, Field(ge=1, le=300)]
    d: Annotated[Number, Field(ge=1, le=300)]
    height: Annotated[Number, Field(ge=1, le=200)]
    rotation: Annotated[Number, Field(ge=-360, le=360)]

class DrivePath(Model):
    id: str = Field(min_length=1, max_length=120)
    name: str = Field(max_length=80)
    points: list[Point] = Field(min_length=2, max_length=40)
    closed: bool = Field(strict=True)
    smooth: bool = Field(strict=True)
    width: Annotated[Number, Field(ge=16, le=36)]
    parking: Literal['both', 'left', 'right', 'none']

    @model_validator(mode='after')
    def valid_path(self):
        if self.closed and len(self.points) < 3:
            raise ValueError('Closed aisles require at least three points.')
        return self

class Settings(Model):
    boundary: list[Point] = Field(min_length=3, max_length=60)
    buildings: list[Building] = Field(max_length=12)
    layoutMode: Literal['fill', 'paths'] = 'fill'
    paths: list[DrivePath] = Field(default_factory=list, max_length=12)
    setback: Annotated[Number, Field(ge=0, le=40)]
    stallWidth: Annotated[Number, Field(ge=8, le=14)]
    stallDepth: Annotated[Number, Field(ge=16, le=24)]
    aisle: Annotated[Number, Field(ge=20, le=36)]
    angle: Literal[45, 60, 90]
    orientation: Annotated[Number, Field(ge=0, le=180)]
    accessible: int = Field(strict=True, ge=0, le=30)
    evPercent: Annotated[Number, Field(ge=0, le=100)]
    compactPercent: Annotated[Number, Field(ge=0, le=100)]
    loading: bool = Field(strict=True)
    loadingX: Coordinate
    loadingZ: Coordinate
    mode: Literal['surface', 'garage']
    levels: int = Field(strict=True, ge=1, le=8)
    floorHeight: Annotated[Number, Field(ge=9, le=16)]
    rampSlope: Annotated[Number, Field(ge=5, le=15)]
    slopeX: Annotated[Number, Field(ge=-10, le=10)]
    slopeZ: Annotated[Number, Field(ge=-10, le=10)]
    target: Annotated[Number, Field(ge=0, le=3000)]
    removed: list[Annotated[str, Field(max_length=180)]] = Field(max_length=10000)
    entranceSide: Literal['south', 'north']

    @model_validator(mode='after')
    def valid_geometry(self):
        coords = [(p.x, p.z) for p in self.boundary]
        poly = Polygon(coords)
        if not poly.is_valid or poly.area < 500:
            raise ValueError('Site must be a simple polygon of at least 500 square feet.')
        for a, b in zip(coords, coords[1:] + coords[:1]):
            if (a[0]-b[0])**2 + (a[1]-b[1])**2 < .01:
                raise ValueError('Site vertices must be at least 0.1 ft apart.')
        for items in (self.paths, self.buildings):
            if len({p.id for p in items}) != len(items):
                raise ValueError('Object IDs must be unique.')
        return self

class SolveRequest(Model):
    settings: Settings
