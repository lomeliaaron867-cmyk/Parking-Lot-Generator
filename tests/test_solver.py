import json
from copy import deepcopy
from pathlib import Path
import pytest
from pydantic import ValidationError
from shapely.geometry import Point
from shapely.ops import unary_union
from backend.models import Settings
from backend.solver import solve, alternatives, polygon, rectangle, collision

ROOT = Path(__file__).resolve().parents[1]
def example(name='surface'):
    return json.loads((ROOT/'examples'/f'{name}.json').read_text())['settings']

@pytest.mark.parametrize('name',['surface','garage','irregular','curved-drive','loop-parking'])
def test_examples_have_valid_parking(name):
    s=example(name); r=solve(s)
    assert r['stalls'], name
    assert r['connected'], r['warnings']
    site=polygon(s['boundary']); inset=site.buffer(-s['setback']).buffer(.0001)
    obstacles=[polygon(p) for p in r['buildingPolys']]
    if r['loading']: obstacles.append(polygon(r['loading']['poly']))
    roads=unary_union([polygon(p['poly']) for p in r['aisles']+r['ramps']])
    footprints=[]
    for stall in r['stalls']:
        if stall['level']!=0: continue
        for pts in [stall['poly']]+([stall['access']] if stall.get('access') else []):
            g=polygon(pts)
            assert g.is_valid and g.area>0
            assert inset.covers(g), (name,stall['id'])
            assert not collision(g,roads), (name,stall['id'])
            assert not any(collision(g,o) for o in obstacles)
            assert not any(collision(g,o) for o in footprints)
            footprints.append(g)
    assert sum(r['counts'].values())==len(r['stalls'])
    assert len({p['id'] for p in r['stalls']})==len(r['stalls'])
    assert r['paved']<=r['area']+.001

@pytest.mark.parametrize('name',['surface','curved-drive'])
def test_six_ranked_alternatives(name):
    options=alternatives(example(name))
    assert len(options)==6
    counts=[len(o['layout']['stalls']) for o in options]
    assert counts==sorted(counts,reverse=True)
    for o in options: assert o['layout']==solve(o['settings'])

@pytest.mark.parametrize('name',['surface','garage','curved-drive'])
def test_removal_preserves_other_stalls(name):
    s=example(name); before=solve(s)
    removed=next(p['id'] for p in before['stalls'] if p['level']==0)
    s['removed']=[removed]; after=solve(s)
    assert after['stalls']==[p for p in before['stalls'] if p['id'].split('-L')[0]!=removed]

def test_internal_loop_needs_entrance():
    s=example('loop-parking'); s['paths']=[p for p in s['paths'] if p['closed']]
    r=solve(s)
    assert not r['connected'] and not r['stalls'] and r['aisles']

def test_curved_road_building_exclusion():
    s=example('curved-drive')
    s['buildings']=[dict(id='block',x=0,z=0,w=40,d=60,height=30,rotation=0)]
    r=solve(s); obstacle=polygon(r['buildingPolys'][0])
    assert not any(collision(polygon(p['poly']),obstacle) for p in r['aisles']+r['stalls'])

def test_concave_boundary_and_empty_drive_only():
    s=example('curved-drive')
    s['boundary']=[dict(x=x,z=z) for x,z in [(-180,-140),(180,-140),(180,50),(0,50),(0,140),(-180,140)]]
    r=solve(s); site=polygon(s['boundary'])
    assert all(site.buffer(1e-6).covers(polygon(p['poly'])) for p in r['stalls']+r['aisles'])
    for path in s['paths']: path['parking']='none'
    assert not solve(s)['stalls']

def test_garage_levels_and_invalid_envelope():
    s=example('garage'); s['levels']=1; a=solve(s)
    s['levels']=3; b=solve(s)
    assert len(b['ramps'])==2
    assert all(sum(p['level']==i for p in b['stalls'])==len(b['stalls'])//3 for i in range(3))
    s['boundary']=rectangle(60,60)
    bad=solve(s)
    assert not bad['stalls'] and not bad['ramps'] and not bad['connected']

@pytest.mark.parametrize('field,value',[
    ('stallWidth',0),('angle',30),('levels',1.5),('loading','yes'),
    ('setback',float('nan')),('orientation',float('inf')),('boundary',rectangle(1,1)),
    ('removed',['x']*10001),('buildings',[{}]*13),
])
def test_invalid_input(field,value):
    s=example(); s[field]=value
    with pytest.raises(ValidationError): solve(s)

def test_invalid_paths_and_duplicate_ids():
    s=example('curved-drive'); s['paths']*=2
    with pytest.raises(ValidationError): solve(s)
    s=example('curved-drive'); s['paths'][0]['points'][0]['x']=1001
    with pytest.raises(ValidationError): solve(s)

def test_backward_compatible_import():
    s=example(); s.pop('paths',None); s.pop('layoutMode',None)
    assert solve(s)['stalls']
