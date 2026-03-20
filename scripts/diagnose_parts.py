"""
diagnose_parts.py — Blender headless diagnostic script.
Imports each tile STL, separates by loose parts, and prints detailed
geometry stats for each part to inform color classification.

Usage:
    blender --background --python scripts/diagnose_parts.py
"""

import bpy
import os
import math

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
ASSETS_DIR = os.path.join(PROJECT_DIR, "public", "assets")

TILES = ["wool", "wood", "wheet", "brick", "ore", "desert", "water", "harbor_water"]


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in bpy.data.meshes:
        bpy.data.meshes.remove(block)
    for block in bpy.data.materials:
        bpy.data.materials.remove(block)


def analyze_part(obj):
    mesh = obj.data
    verts = [v.co for v in mesh.vertices]
    if not verts:
        return None

    xs = [v.x for v in verts]
    ys = [v.y for v in verts]
    zs = [v.z for v in verts]

    x_min, x_max = min(xs), max(xs)
    y_min, y_max = min(ys), max(ys)
    z_min, z_max = min(zs), max(zs)

    x_span = x_max - x_min
    y_span = y_max - y_min
    z_span = z_max - z_min

    centroid_x = sum(xs) / len(xs)
    centroid_y = sum(ys) / len(ys)
    centroid_z = sum(zs) / len(zs)

    xy_footprint = x_span * y_span
    aspect_ratio = z_span / math.sqrt(xy_footprint) if xy_footprint > 1e-6 else 999.0

    # Convexity hint: check if roughly equidimensional
    spans = sorted([x_span, y_span, z_span])
    if spans[2] > 1e-6:
        equidim_ratio = spans[0] / spans[2]  # 1.0 = perfect cube/sphere
    else:
        equidim_ratio = 0.0

    return {
        "name": obj.name,
        "vert_count": len(verts),
        "face_count": len(mesh.polygons),
        "centroid": (centroid_x, centroid_y, centroid_z),
        "x_span": x_span,
        "y_span": y_span,
        "z_span": z_span,
        "xy_footprint": xy_footprint,
        "aspect_ratio": aspect_ratio,
        "equidim_ratio": equidim_ratio,
        "z_min": z_min,
        "z_max": z_max,
    }


def diagnose_tile(tile_name):
    stl_path = os.path.join(ASSETS_DIR, tile_name + ".stl")
    if not os.path.exists(stl_path):
        print(f"  SKIP: {stl_path} not found")
        return

    clear_scene()

    bpy.ops.wm.stl_import(filepath=stl_path)
    obj = bpy.context.selected_objects[0]
    obj.name = tile_name

    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)

    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.separate(type='LOOSE')
    bpy.ops.object.mode_set(mode='OBJECT')

    parts = list(bpy.context.selected_objects)

    # Analyze all parts
    infos = []
    for p in parts:
        info = analyze_part(p)
        if info:
            infos.append(info)

    # Sort by vertex count descending
    infos.sort(key=lambda x: x["vert_count"], reverse=True)

    print(f"\n{'='*80}")
    print(f"TILE: {tile_name}  |  {len(infos)} loose parts")
    print(f"{'='*80}")
    for i, info in enumerate(infos):
        cx, cy, cz = info["centroid"]
        print(f"  Part {i}: verts={info['vert_count']:6d}  faces={info['face_count']:6d}")
        print(f"    centroid=({cx:8.2f}, {cy:8.2f}, {cz:8.2f})")
        print(f"    X_span={info['x_span']:8.2f}  Y_span={info['y_span']:8.2f}  Z_span={info['z_span']:8.2f}")
        print(f"    XY_footprint={info['xy_footprint']:10.2f}")
        print(f"    aspect_ratio(Z/sqrt(XY))={info['aspect_ratio']:.4f}")
        print(f"    equidim_ratio={info['equidim_ratio']:.4f}")
        print(f"    Z_range=[{info['z_min']:.2f}, {info['z_max']:.2f}]")


def main():
    print(f"\n{'#'*80}")
    print(f"# TILE PART GEOMETRY DIAGNOSTIC")
    print(f"{'#'*80}")

    for tile in TILES:
        diagnose_tile(tile)

    print(f"\n{'#'*80}")
    print(f"# DIAGNOSTIC COMPLETE")
    print(f"{'#'*80}")


if __name__ == "__main__":
    main()
