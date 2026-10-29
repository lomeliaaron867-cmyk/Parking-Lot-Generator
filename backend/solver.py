"""Deterministic parking layout heuristics implemented in Python.

Shapely/GEOS performs polygon containment, clipping and road unions. This is a
concept-design solver, not a traffic or building-code compliance checker.
"""
from copy import deepcopy
from math import ceil, cos, sin, radians, hypot, floor
from shapely import constrained_delaunay_triangles
from shapely.geometry import Polygon, Point as SPoint, GeometryCollection
from shapely.ops import unary_union
from .models import Settings

KINDS = ('standard', 'accessible', 'ev', 'compact')
EPS = 1e-6

def rectangle(w, d, x=0, z=0):
    return [{'x': x-w/2, 'z': z-d/2}, {'x': x+w/2, 'z': z-d/2},
            {'x': x+w/2, 'z': z+d/2}, {'x': x-w/2, 'z': z+d/2}]

def transform(poly, degrees, x=0, z=0):
    c, s = cos(radians(degrees)), sin(radians(degrees))
    return [{'x': p['x']*c-p['z']*s+x, 'z': p['x']*s+p['z']*c+z} for p in poly]

def polygon(points):
    return Polygon([(p['x'], p['z']) for p in points])

def points(poly):
    return [{'x': x, 'z': z} for x, z in list(poly.exterior.coords)[:-1]]

def parts(geometry):
    if geometry.is_empty:
        return []
    if geometry.geom_type == 'Polygon':
        return [geometry]
    if hasattr(geometry, 'geoms'):
        return [p for g in geometry.geoms for p in parts(g)]
    return []

def render_polys(geometry):
    # The existing Three.js/DXF contract has no holes on aisle polygons.
    for p in parts(geometry):
        if p.interiors:
            yield from constrained_delaunay_triangles(p).geoms
        else:
            yield p

def collision(a, b):
    return a.intersects(b) and a.intersection(b).area > EPS

def sequence(start, stop, step, inclusive=False):
    value = start
    while value <= stop + EPS if inclusive else value < stop:
        yield value
        value += step

def jsround(n):
    return floor(n + .5)

def base(s):
    buildings = [transform(rectangle(b['w'], b['d']), b['rotation'], b['x'], b['z']) for b in s['buildings']]
    loading = {'id': 'loading', 'poly': rectangle(14, 40, s['loadingX'], s['loadingZ'])} if s['loading'] else None
    return dict(stalls=[], aisles=[], ramps=[], columns=[], loading=loading,
                entrance=None, warnings=[], area=polygon(s['boundary']).area,
                paved=0, levelCount=s['levels'] if s['mode']=='garage' else 1,
                connected=False, buildingPolys=buildings,
                counts=dict.fromkeys(KINDS, 0), rampLength=0, floor=[])

def stall_dimensions(s, counts, index):
    cycle = index * 37 % 100
    kind = ('accessible' if counts['accessible'] < s['accessible'] else
            'ev' if cycle < s['evPercent'] else
            'compact' if cycle < s['evPercent']+s['compactPercent'] else 'standard')
    w = min(8, s['stallWidth']) if kind=='compact' else max(9, s['stallWidth']) if kind=='accessible' else s['stallWidth']
    d = min(16, s['stallDepth']) if kind=='compact' else s['stallDepth']
    return kind, w, d, 8 if kind=='accessible' else 0

def finish(s, r):
    removed = set(s['removed'])
    r['stalls'] = [p for p in r['stalls'] if p['id'].split('-L')[0] not in removed]
    r['counts'] = {kind: sum(p['kind']==kind for p in r['stalls']) for kind in KINDS}
    short = s['accessible']-r['counts']['accessible']/r['levelCount']
    if short > 0:
        r['warnings'].append(f'Accessible-space target short by {short:g} per level.')
    site = polygon(s['boundary']).buffer(-s['setback'])
    buildings = [polygon(p) for p in r['buildingPolys']]
    for i, p in enumerate(buildings):
        if not site.buffer(EPS).covers(p):
            r['warnings'].append(f'Building {i+1} crosses the site setback.')
        if any(collision(p,q) for q in buildings[i+1:]):
            r['warnings'].append(f'Building {i+1} overlaps another building.')
    if r['loading']:
        p = polygon(r['loading']['poly'])
        if not site.buffer(EPS).covers(p) or any(collision(p,b) for b in buildings):
            r['warnings'].append('Loading zone overlaps a building or site setback.')
    if abs(s['slopeX'])+abs(s['slopeZ']) > 2:
        r['warnings'].append('Terrain slopes require accessible-route and grading review.')
    if s['angle'] < 90:
        r['warnings'].append('Angled rows need a reviewed one-way circulation plan.')
    if s['angle']==90 and s['aisle']<24:
        r['warnings'].append('Aisle is below the 24 ft concept reference for 90-degree parking.')
    r['warnings'].append('Turning envelopes, pedestrian routes, fire access and jurisdictional compliance are not certified.')
    surfaces = [polygon(a['poly']) for a in r['aisles']]
    for p in r['stalls']:
        if p['level']==0:
            surfaces.append(polygon(p['poly']))
            if p.get('access'): surfaces.append(polygon(p['access']))
    r['paved'] = unary_union(surfaces).area if surfaces else 0
    return r

def solve(settings):
    # Validation is part of the solver contract, including direct Python use.
    s = (settings if isinstance(settings, Settings) else Settings.model_validate(settings)).model_dump()
    return solve_curved(s) if s['layoutMode']=='paths' and s['mode']=='surface' else solve_rows(s)

def solve_rows(s):
    r = base(s)
    site_points = transform(s['boundary'], -s['orientation'])
    site = polygon(site_points)
    usable = site.buffer(-s['setback'], join_style='mitre').buffer(EPS)
    x0,z0,x1,z1 = site.bounds
    obstacles = [polygon(transform(p,-s['orientation'])) for p in r['buildingPolys']]
    if r['loading']: obstacles.append(polygon(transform(r['loading']['poly'],-s['orientation'])))
    def free(p):
        g = polygon(p)
        return usable.covers(g) and not any(collision(g,o) for o in obstacles)
    def world(p): return transform(p, s['orientation'])
    setback, aisle, levels = s['setback'], s['aisle'], r['levelCount']
    ramp_length = s['floorHeight']/(s['rampSlope']/100)
    r['rampLength'] = ramp_length
    ramp = rectangle(aisle, ramp_length, x1-setback-aisle/2, z0+setback+aisle+ramp_length/2)
    garage_ok = True
    if s['mode']=='garage':
        deck = rectangle(x1-x0-2*setback,z1-z0-2*setback,(x0+x1)/2,(z0+z1)/2)
        r['floor'] = world(deck)
        if x1-x0<=2*setback or z1-z0<=2*setback or not usable.covers(polygon(deck)):
            garage_ok=False
            r['warnings'].append('Garage envelope does not fit this boundary. Use a rectangular site.')
        if s['buildings']:
            garage_ok=False
            r['warnings'].append('Remove building massing before generating a garage envelope.')
        if levels>1:
            if not free(ramp) or z0+setback+2*aisle+ramp_length>z1-setback:
                garage_ok=False
                r['warnings'].append('Ramp and end landings do not fit. Increase site depth or reduce floor height.')
            obstacles.append(polygon(ramp))
            r['ramps']=[{'id':f'ramp-{l}','poly':world(ramp),'level':l} for l in range(levels-1)]
        r['warnings'].append('Garage ramps are conceptual: transitions, headroom, structure and egress require design review.')
        if s['slopeX'] or s['slopeZ']:
            r['warnings'].append('Garage floors remain level; terrain cut/fill is not calculated.')
    low, high = z0+setback,z1-setback
    spine = None
    if high>low:
        for x in sequence(x0+setback,x1-setback-aisle,4,True):
            candidate=rectangle(aisle,high-low,x+aisle/2,(low+high)/2)
            if free(candidate): spine=candidate; break
    if spine is None and s['mode']=='surface':
        best=2*s['stallDepth']+aisle
        for x in sequence(x0+setback,x1-setback-aisle,4,True):
            run=None
            for z in sequence(low,high,4,True):
                fits=z+4<=high and free(rectangle(aisle,4,x+aisle/2,z+2))
                if fits and run is None: run=z
                if not fits and run is not None:
                    if z-run>best:
                        best=z-run; spine=rectangle(aisle,best,x+aisle/2,(run+z)/2)
                    run=None
    if spine is None:
        r['warnings'].append('No continuous access spine fits. Move obstacles, simplify the boundary, or rotate the layout.')
    elif garage_ok:
        spine_geom=polygon(spine)
        sx0,sz0,sx1,sz1=spine_geom.bounds
        r['aisles'].append({'id':'spine','poly':world(spine)})
        if s['mode']=='garage' and levels>1:
            rx0,rz0,rx1,rz1=polygon(ramp).bounds
            for i,z in enumerate([rz0-aisle/2,rz1+aisle/2]):
                landing=rectangle(rx1-sx0,aisle,(rx1+sx0)/2,z)
                if not free(landing):
                    garage_ok=False
                    r['warnings'].append('A ramp landing is obstructed; move loading or change the site.')
                r['aisles'].append({'id':f'landing-{i}','poly':world(landing)})
                obstacles.append(polygon(landing))
        north=s['entranceSide']=='north'
        entry_start=sz0 if north else sz1
        def boundary_at(x):
            crossings=[]
            for p,q in zip(site_points,site_points[1:]+site_points[:1]):
                if abs(q['x']-p['x'])<1e-8: continue
                t=(x-p['x'])/(q['x']-p['x'])
                if not 0<=t<=1: continue
                z=p['z']+t*(q['z']-p['z'])
                if (z<=entry_start if north else z>=entry_start): crossings.append(z)
            return (max(crossings) if north else min(crossings)) if crossings else entry_start
        entry=[{'x':sx0,'z':entry_start},{'x':sx1,'z':entry_start},
               {'x':sx1,'z':boundary_at(sx1)},{'x':sx0,'z':boundary_at(sx0)}]
        entry_geom=polygon(entry)
        if site.buffer(EPS).covers(entry_geom) and not any(collision(entry_geom,o) for o in obstacles):
            r['entrance']={'id':'entrance','poly':world(entry)}
        else: r['warnings'].append('Entrance is blocked at the selected edge. Try the other entrance edge.')
        sn,cs=sin(radians(s['angle'])),cos(radians(s['angle']))
        bank=s['stallDepth']*sn
        serial=0
        for z in sequence(sz0+bank,sz1-aisle-bank,2*bank+aisle,True):
            left,right=sx0,sx1
            x=sx0-2
            while x>=x0+setback:
                if not free(rectangle(sx1-x,aisle,(x+sx1)/2,z+aisle/2)): break
                left=x; x-=2
            for x in sequence(sx1+2,x1-setback,2,True):
                if not free(rectangle(x-left,aisle,(left+x)/2,z+aisle/2)): break
                right=x
            if right-left<aisle+8: continue
            r['aisles'].append({'id':f'aisle-{serial}','poly':world(rectangle(right-left,aisle,(left+right)/2,z+aisle/2))})
            serial+=1
            for side in [-1,1]:
                x=left
                for _ in range(150):
                    if x>=right: break
                    kind,w,d,access=stall_dimensions(s,r['counts'],len(r['stalls']))
                    pitch=(w+access)/sn
                    zz=z if side<0 else z+aisle
                    def shape(start,width):
                        return [{'x':start,'z':zz},{'x':start+width/sn,'z':zz},
                                {'x':start+width/sn+d*cs,'z':zz+side*d*sn},
                                {'x':start+d*cs,'z':zz+side*d*sn}]
                    full=shape(x,w+access)
                    if x+pitch<=right+.001 and free(full) and not collision(polygon(full),spine_geom):
                        p={'id':f'stall-{jsround(z*100)}-{side}-{jsround(x*100)}','poly':world(shape(x,w)),'kind':kind,'level':0}
                        if access: p['access']=world(shape(x+w/sn,access))
                        r['stalls'].append(p); r['counts'][kind]+=1
                    x+=pitch
        if s['mode']=='garage' and garage_ok:
            base_stalls=list(r['stalls'])
            for level in range(1,levels):
                r['stalls'].extend([{**p,'id':f"{p['id']}-L{level}",'level':level} for p in base_stalls])
            occupied=[polygon(p['poly']) for p in base_stalls+r['aisles']+r['ramps']]
            occupied.extend(polygon(p['access']) for p in base_stalls if p.get('access'))
            for x in sequence(x0+setback+3,x1-setback-3,30):
                for z in sequence(z0+setback+3,z1-setback-3,30):
                    p=polygon(world(rectangle(2,2,x,z)))
                    if polygon(s['boundary']).buffer(-setback).buffer(EPS).covers(p) and not any(collision(p,q) for q in occupied):
                        r['columns'].append({'x':p.centroid.x,'z':p.centroid.y})
    if not garage_ok:
        for key in ['stalls','aisles','ramps','floor']: r[key]=[]
        r['entrance']=None
    r['connected']=r['entrance'] is not None and spine is not None and garage_ok
    if any(a['id'].startswith('aisle-') for a in r['aisles']):
        r['warnings'].append('Row aisles terminate without a loop. Turnaround space at each dead end needs review.')
    if not r['entrance'] and r['stalls']:
        r['warnings'].append('Parking has no verified boundary entrance.')
    return finish(s,r)

def sample_path(path):
    p=path['points']; result=[]; n=len(p)
    def at(i): return p[i%n if path['closed'] else max(0,min(n-1,i))]
    for i in range(n if path['closed'] else n-1):
        a,b,c,d=at(i-1),at(i),at(i+1),at(i+2)
        steps=max(3,min(120,ceil(hypot(c['x']-b['x'],c['z']-b['z'])/3)))
        for j in range(steps):
            t=j/steps
            result.append({k: .5*(2*b[k]+(-a[k]+c[k])*t+(2*a[k]-5*b[k]+4*c[k]-d[k])*t*t+(-a[k]+3*b[k]-3*c[k]+d[k])*t*t*t)
                           if path['smooth'] else b[k]+(c[k]-b[k])*t for k in ['x','z']})
    result.append(at(0 if path['closed'] else n-1).copy())
    return result

def solve_curved(s):
    r=base(s); site=polygon(s['boundary']); usable=site.buffer(-s['setback']).buffer(EPS)
    obstacles=[polygon(p) for p in r['buildingPolys']]
    if r['loading']: obstacles.append(polygon(r['loading']['poly']))
    obstacle_union=unary_union(obstacles)
    sampled=[(p,sample_path(p)) for p in s['paths']]
    roads=[]
    for path,pts in sampled:
        frames=[]; tight=False
        for i,p in enumerate(pts):
            before=pts[i-1 if i else len(pts)-2 if path['closed'] else 0]
            after=pts[i+1 if i<len(pts)-1 else 1 if path['closed'] else i]
            dx,dz=after['x']-before['x'],after['z']-before['z']
            length=hypot(dx,dz) or 1
            nx,nz=-dz/length*path['width']/2,dx/length*path['width']/2
            frames.append([{'x':p['x']+nx,'z':p['z']+nz},{'x':p['x']-nx,'z':p['z']-nz}])
            if 0<i<len(pts)-1:
                a,b,c=pts[i-1],p,pts[i+1]
                ab=hypot(a['x']-b['x'],a['z']-b['z']); bc=hypot(c['x']-b['x'],c['z']-b['z']); ac=hypot(c['x']-a['x'],c['z']-a['z'])
                cross=abs((b['x']-a['x'])*(c['z']-a['z'])-(b['z']-a['z'])*(c['x']-a['x']))
                if cross>1e-5 and ab*bc*ac/(2*cross)<path['width']: tight=True
        tiles=[]
        for a,b in zip(frames,frames[1:]):
            for triangle in [[a[0],a[1],b[1]],[a[0],b[1],b[0]]]:
                g=polygon(triangle)
                if g.area>EPS: tiles.append(g)
        road=unary_union(tiles).intersection(site)
        if collision(road,obstacle_union): r['warnings'].append(f"{path['name']}: aisle intersects a building or loading zone; blocked pavement is removed.")
        roads.append(road.difference(obstacle_union))
        if tight: r['warnings'].append(f"{path['name']}: tight curvature relative to aisle width; review vehicle paths.")
    all_roads=unary_union(roads)
    components=parts(all_roads)
    connected=[p for p in components if p.distance(site.boundary)<.05]
    reachable=unary_union(connected)
    detached=len(components)-len(connected)
    for i,p in enumerate(render_polys(all_roads)):
        r['aisles'].append({'id':f'road-{i}','poly':points(p)})
    if connected:
        first=next(render_polys(connected[0]))
        r['entrance']={'id':'entrance','poly':points(first)}
    r['connected']=bool(connected) and not detached
    if detached: r['warnings'].append(f'{detached} road component(s) have no boundary connection. Parking beside them is omitted.')
    if not components: r['warnings'].append('Draw an aisle through the site to generate parking.')
    occupied=[]
    for path,pts in sampled:
        if path['parking']=='none': continue
        lengths=[0.]
        for a,b in zip(pts,pts[1:]): lengths.append(lengths[-1]+hypot(b['x']-a['x'],b['z']-a['z']))
        sn,cs=sin(radians(s['angle'])),cos(radians(s['angle']))
        step=s['stallWidth']/sn; segment=0
        for at in sequence(step/2,lengths[-1]-step/2,step):
            while segment<len(pts)-2 and lengths[segment+1]<at: segment+=1
            a,b=pts[segment:segment+2]; length=lengths[segment+1]-lengths[segment]
            if length<.001: continue
            tx,tz=(b['x']-a['x'])/length,(b['z']-a['z'])/length
            u=(at-lengths[segment])/length
            cx,cz=a['x']+(b['x']-a['x'])*u,a['z']+(b['z']-a['z'])*u
            if not reachable.covers(SPoint(cx,cz)): continue
            for side in [1] if path['parking']=='left' else [-1] if path['parking']=='right' else [1,-1]:
                kind,w,d,access=stall_dimensions(s,r['counts'],len(r['stalls']))
                nx,nz=-tz*side,tx*side
                fx,fz=cx+nx*(path['width']/2+1),cz+nz*(path['width']/2+1)
                def shape(start,width):
                    px,pz=fx+tx*start,fz+tz*start
                    qx,qz=px+tx*width/sn,pz+tz*width/sn
                    ox,oz=nx*d*sn+tx*d*cs,nz*d*sn+tz*d*cs
                    return [{'x':px,'z':pz},{'x':qx,'z':qz},{'x':qx+ox,'z':qz+oz},{'x':px+ox,'z':pz+oz}]
                start=-(w+access)/(2*sn); full=polygon(shape(start,w+access))
                if not usable.covers(full) or collision(full,obstacle_union) or collision(full,all_roads) or any(collision(full,q) for q in occupied): continue
                p={'id':f"curve-{path['id']}-{side}-{jsround(at*10)}",'poly':shape(start,w),'kind':kind,'level':0}
                if access: p['access']=shape(start+w/sn,access)
                r['stalls'].append(p); occupied.append(full); r['counts'][kind]+=1
    if any(not p['closed'] for p in s['paths']): r['warnings'].append('Open path ends need a reviewed entrance or turnaround; geometric connectivity does not verify vehicle turns.')
    r['warnings'].append('Curves use sampled splines. Narrow connections and tight bends require vehicle-path review.')
    return finish(s,r)

def alternatives(settings):
    s=(settings if isinstance(settings,Settings) else Settings.model_validate(settings)).model_dump()
    options=[]
    curved=s['layoutMode']=='paths' and s['mode']=='surface'
    for variation in ([0,4] if curved else [0,90]):
        for angle in [90,60,45]:
            candidate=deepcopy(s); candidate.update(angle=angle,removed=[])
            if curved:
                for p in candidate['paths']: p['width']=min(36,p['width']+variation)
                label=f"{angle}° stalls · {'wider' if variation else 'current'} aisles"
            else:
                candidate['orientation']=variation
                label=f'{angle}° stalls · {variation}° orientation'
            options.append({'settings':candidate,'layout':solve(candidate),'label':label})
    return sorted(options,key=lambda p:-len(p['layout']['stalls']))
