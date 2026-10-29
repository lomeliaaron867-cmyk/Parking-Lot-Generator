"""Release regressions for edge cases and repeated user edits."""
from copy import deepcopy
import json
import pytest
from shapely.ops import unary_union
from backend.solver import solve, polygon, rectangle, collision
from test_solver import example


@pytest.mark.parametrize('name', ['surface', 'irregular', 'curved-drive', 'loop-parking'])
@pytest.mark.parametrize('angle', [45, 60, 90])
def test_angle_matrix(name, angle):
    settings = example(name)
    settings['angle'] = angle
    original = deepcopy(settings)
    result = solve(settings)
    assert settings == original, 'Solving must not mutate the saved project'
    assert result == solve(settings), 'The same project must produce the same layout'
    json.dumps(result, allow_nan=False)
    site = polygon(settings['boundary'])
    inset = site.buffer(-settings['setback']).buffer(.0001)
    obstacles = [polygon(p) for p in result['buildingPolys']]
    roads = unary_union([polygon(p['poly']) for p in result['aisles']])
    occupied = []
    for stall in result['stalls']:
        for points in [stall['poly']] + ([stall['access']] if stall.get('access') else []):
            shape = polygon(points)
            assert shape.is_valid and shape.area > 0
            assert inset.covers(shape)
            assert not collision(shape, roads)
            assert not any(collision(shape, other) for other in obstacles + occupied)
            occupied.append(shape)
    assert sum(result['counts'].values()) == len(result['stalls'])


def test_setback_consumes_entire_site():
    settings = example()
    settings.update(boundary=rectangle(80, 80), setback=40)
    result = solve(settings)
    assert not result['stalls'] and not result['connected']
    assert result['warnings']
    json.dumps(result, allow_nan=False)


def test_repeated_curve_points_do_not_crash():
    settings = example('curved-drive')
    settings['paths'][0]['points'] = [dict(x=0, z=0)] * 3
    result = solve(settings)
    json.dumps(result, allow_nan=False)
    assert not result['stalls']


@pytest.mark.parametrize('levels', [1, 8])
def test_garage_level_extremes(levels):
    settings = example('garage')
    settings['levels'] = levels
    result = solve(settings)
    assert result['stalls']
    assert {p['level'] for p in result['stalls']} == set(range(levels))
    assert len(result['ramps']) == levels - 1
    assert len({p['id'] for p in result['stalls']}) == len(result['stalls'])
    assert sum(result['counts'].values()) == len(result['stalls'])
