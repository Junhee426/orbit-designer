from pathlib import Path
import numpy as np
import trimesh
from trimesh.transformations import rotation_matrix, translation_matrix

OUT = Path(__file__).resolve().parents[1] / 'app' / 'static'
OUT.mkdir(parents=True, exist_ok=True)

COLORS = {
    'bus': [205, 212, 220, 255],
    'bus_dark': [105, 118, 132, 255],
    'panel': [27, 73, 148, 255],
    'panel_alt': [35, 95, 170, 255],
    'boom': [125, 130, 137, 255],
    'gold': [230, 188, 67, 255],
    'dark': [55, 61, 70, 255],
    'array': [70, 80, 95, 255],
    'white': [225, 230, 236, 255],
}


def color(mesh, rgba):
    mesh.visual.face_colors = np.tile(np.array(rgba, dtype=np.uint8), (len(mesh.faces), 1))
    return mesh


def box(extents, center=(0, 0, 0), rgba=None):
    m = trimesh.creation.box(extents=extents)
    m.apply_translation(center)
    return color(m, rgba or COLORS['bus'])


def cyl(radius, height, center=(0, 0, 0), axis='z', rgba=None, sections=32):
    m = trimesh.creation.cylinder(radius=radius, height=height, sections=sections)
    if axis == 'x':
        m.apply_transform(rotation_matrix(np.pi/2, [0, 1, 0]))
    elif axis == 'y':
        m.apply_transform(rotation_matrix(np.pi/2, [1, 0, 0]))
    m.apply_translation(center)
    return color(m, rgba or COLORS['boom'])


def sphere(radius, center=(0,0,0), rgba=None):
    m = trimesh.creation.icosphere(subdivisions=2, radius=radius)
    m.apply_translation(center)
    return color(m, rgba or COLORS['gold'])


def export_scene(name, geometries):
    scene = trimesh.Scene()
    for geom_name, mesh in geometries:
        scene.add_geometry(mesh, geom_name=geom_name, node_name=geom_name)
    path = OUT / name
    scene.export(path)
    print(path.name, path.stat().st_size)


def compact_bus():
    g=[]
    g.append(('bus', box([1.1, 0.95, 0.9], rgba=COLORS['bus'])))
    g.append(('top_deck', box([0.85, 0.65, 0.10], center=[0,0,0.50], rgba=COLORS['gold'])))
    g.append(('panel_left', box([1.85,0.07,0.72], center=[-1.55,0,0], rgba=COLORS['panel'])))
    g.append(('panel_right', box([1.85,0.07,0.72], center=[1.55,0,0], rgba=COLORS['panel'])))
    g.append(('boom_left', box([0.55,0.09,0.09], center=[-0.82,0,0], rgba=COLORS['boom'])))
    g.append(('boom_right', box([0.55,0.09,0.09], center=[0.82,0,0], rgba=COLORS['boom'])))
    g.append(('antenna', cyl(0.28,0.08,center=[0,0.52,0.15],axis='y',rgba=COLORS['gold'])))
    g.append(('feed', cyl(0.045,0.34,center=[0,0.73,0.15],axis='y',rgba=COLORS['dark'])))
    export_scene('kleo_satellite_compact.glb',g)


def broadband():
    g=[]
    g.append(('bus', box([1.55,1.15,1.0], rgba=COLORS['white'])))
    g.append(('payload', box([1.15,0.25,0.75], center=[0,0.70,0], rgba=COLORS['array'])))
    g.append(('panel_left', box([2.85,0.08,0.92], center=[-2.28,0,0], rgba=COLORS['panel_alt'])))
    g.append(('panel_right', box([2.85,0.08,0.92], center=[2.28,0,0], rgba=COLORS['panel_alt'])))
    g.append(('boom_left', box([0.95,0.11,0.11], center=[-1.20,0,0], rgba=COLORS['boom'])))
    g.append(('boom_right', box([0.95,0.11,0.11], center=[1.20,0,0], rgba=COLORS['boom'])))
    # Broad dish represented as a thin golden cylinder plus central feed.
    g.append(('dish', cyl(0.58,0.10,center=[0,-0.66,0.05],axis='y',rgba=COLORS['gold'])))
    g.append(('feed', cyl(0.05,0.42,center=[0,-0.93,0.05],axis='y',rgba=COLORS['dark'])))
    g.append(('feeder_a', sphere(0.09,center=[-0.42,0.76,0.25],rgba=COLORS['gold'])))
    g.append(('feeder_b', sphere(0.09,center=[0.42,0.76,0.25],rgba=COLORS['gold'])))
    export_scene('kleo_satellite_broadband.glb',g)


def flatpanel():
    g=[]
    g.append(('bus', box([1.7,0.78,0.48], rgba=COLORS['bus_dark'])))
    g.append(('array_nadir', box([1.45,0.10,0.95], center=[0,0.48,0], rgba=COLORS['array'])))
    g.append(('array_top', box([1.1,0.08,0.62], center=[0,-0.45,0], rgba=COLORS['gold'])))
    g.append(('panel_left', box([2.15,0.06,0.58], center=[-1.92,0,0], rgba=COLORS['panel'])))
    g.append(('panel_right', box([2.15,0.06,0.58], center=[1.92,0,0], rgba=COLORS['panel'])))
    g.append(('boom_left', box([0.70,0.08,0.08], center=[-1.10,0,0], rgba=COLORS['boom'])))
    g.append(('boom_right', box([0.70,0.08,0.08], center=[1.10,0,0], rgba=COLORS['boom'])))
    g.append(('sensor_left', sphere(0.10,center=[-0.58,0.49,0.36],rgba=COLORS['gold'])))
    g.append(('sensor_right', sphere(0.10,center=[0.58,0.49,0.36],rgba=COLORS['gold'])))
    export_scene('kleo_satellite_flatpanel.glb',g)


if __name__ == '__main__':
    compact_bus()
    broadband()
    flatpanel()
