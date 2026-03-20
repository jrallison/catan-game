"""
add_vertex_colors.py — Blender headless script.

Imports each tile STL, separates by loose parts, assigns per-component
vertex colors based on tile type and component characteristics, then
rejoins and exports as GLB.

Usage:
    blender --background --python scripts/add_vertex_colors.py
"""

import bpy
import os
import math

# ─── Configuration ────────────────────────────────────────────────────────────

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
ASSETS_DIR = os.path.join(PROJECT_DIR, "public", "assets")


def hex_to_linear(h):
    """Convert '#rrggbb' to (r, g, b) in linear color space."""
    h = h.lstrip("#")
    r, g, b = int(h[0:2], 16) / 255.0, int(h[2:4], 16) / 255.0, int(h[4:6], 16) / 255.0

    def srgb_to_linear(c):
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    return (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b))


# ─── Color palette from Color-composition.pdf ────────────────────────────────
# Colors listed as approximate filament descriptions. No exact RGB in the doc;
# these are faithful digital approximations of the named colors.
# Index matches the number system in the PDF (1–12).

PALETTE = {
    1:  "#FF6600",  # Orange       — exact pixel from PDF swatch
    2:  "#D9CF74",  # Beige        — exact pixel from PDF swatch
    3:  "#CC6600",  # Brown        — exact pixel from PDF swatch
    4:  "#C00000",  # Red          — exact pixel from PDF swatch
    5:  "#FFCC00",  # Gold         — exact pixel from PDF swatch
    6:  "#66FF33",  # Light green  — exact pixel from PDF swatch
    7:  "#FFFFFF",  # White        — exact pixel from PDF swatch
    8:  "#009900",  # Green        — exact pixel from PDF swatch
    9:  "#BFBFBF",  # Grey         — exact pixel from PDF swatch
    10: "#FFFF00",  # Yellow       — exact pixel from PDF swatch
    11: "#00716B",  # Blue/green   — exact pixel from PDF swatch
    12: "#27FFF5",  # Turquoise    — exact pixel from PDF swatch
}

def p(n):
    """Return linear RGB tuple for palette color n."""
    return hex_to_linear(PALETTE[n])

# Per-tile ordered color lists from Color-composition.pdf.
# Parts are sorted largest→smallest by vertex count; index 0 is the base.
# If a tile has more parts than listed, the last color repeats.
# Doc source: "Landscape-bases" (index 0) + named part assignments (_1.._4).
#
# wool:   base=7(White), parts: 6,3,8,7  → White base, Light-green/Brown/Green/White features
# wood:   base=3(Brown), parts: 6,8,2,3  → Brown base, Light-green/Green/Beige/Brown features
# wheet:  base=10(Yellow),parts:5,10,4,8 → Yellow base, Gold/Yellow/Red/Green features
# brick:  base=1(Orange), parts: 2,3,8,4 → Orange base, Beige/Brown/Green/Red features
# ore:    base=9(Grey),  parts: 2,9,3,8  → Grey base,  Beige/Grey/Brown/Green features
# desert: base=5(Gold),  parts: 5,3,8,7  → Gold base,  Gold/Brown/Green/White features
# water:  base=11,        parts: 11,12,7  → Blue/green base, Blue/Turquoise/White features

TILE_PART_COLORS = {
    "wool":         [p(7), p(6), p(3), p(8), p(7)],
    "wood":         [p(3), p(6), p(8), p(2), p(3)],
    "wheet":        [p(10), p(5), p(10), p(4), p(8)],
    "brick":        [p(1), p(2), p(3), p(8), p(4)],
    "ore":          [p(9), p(2), p(9), p(3), p(8)],
    "desert":       [p(5), p(5), p(3), p(8), p(7)],
    "water":        [p(11), p(11), p(12), p(7)],
    "harbor_water": [p(11), p(11), p(12), p(7)],
}

def get_part_color(tile_type, part_index):
    """Return the color for the nth part (0=base, 1..n=features)."""
    colors = TILE_PART_COLORS[tile_type]
    return colors[min(part_index, len(colors) - 1)]


def get_part_info(obj):
    """Compute stats for a mesh object."""
    mesh = obj.data
    verts = [v.co for v in mesh.vertices]
    if not verts:
        return {"vert_count": 0, "centroid_z": 0, "z_span": 0, "xy_span": 0,
                "min_z": 0, "max_z": 0}

    xs = [v.x for v in verts]
    ys = [v.y for v in verts]
    zs = [v.z for v in verts]

    centroid_z = sum(zs) / len(zs)
    z_min, z_max = min(zs), max(zs)
    x_span = max(xs) - min(xs)
    y_span = max(ys) - min(ys)
    xy_span = max(x_span, y_span)

    return {
        "vert_count": len(verts),
        "centroid_z": centroid_z,
        "z_span": z_max - z_min,
        "xy_span": xy_span,
        "min_z": z_min,
        "max_z": z_max,
    }


def paint_object_solid(obj, color):
    """Paint all vertex colors of an object with a solid color."""
    mesh = obj.data
    if not mesh.color_attributes:
        mesh.color_attributes.new(name="Col", type='BYTE_COLOR', domain='CORNER')
    color_attr = mesh.color_attributes["Col"]
    rgba = (color[0], color[1], color[2], 1.0)
    for poly in mesh.polygons:
        for loop_idx in poly.loop_indices:
            color_attr.data[loop_idx].color = rgba


def paint_object_step(obj, ground_color, feature_color, threshold_pct=0.15):
    """Paint with hard step function: below threshold% = ground, above = feature."""
    mesh = obj.data
    zs = [v.co.z for v in mesh.vertices]
    if not zs:
        return
    z_min, z_max = min(zs), max(zs)
    z_range = z_max - z_min
    if z_range < 1e-6:
        z_range = 1.0
    cutoff = z_min + z_range * threshold_pct

    if not mesh.color_attributes:
        mesh.color_attributes.new(name="Col", type='BYTE_COLOR', domain='CORNER')
    color_attr = mesh.color_attributes["Col"]

    for poly in mesh.polygons:
        for loop_idx in poly.loop_indices:
            vert_idx = mesh.loops[loop_idx].vertex_index
            z = mesh.vertices[vert_idx].co.z
            if z < cutoff:
                color_attr.data[loop_idx].color = (*ground_color, 1.0)
            else:
                color_attr.data[loop_idx].color = (*feature_color, 1.0)


def create_vertex_color_material(name):
    """Create a material that reads vertex colors."""
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links

    for node in nodes:
        nodes.remove(node)

    output_node = nodes.new("ShaderNodeOutputMaterial")
    output_node.location = (400, 0)

    bsdf_node = nodes.new("ShaderNodeBsdfPrincipled")
    bsdf_node.location = (0, 0)
    bsdf_node.inputs["Metallic"].default_value = 0.1
    bsdf_node.inputs["Roughness"].default_value = 0.8

    color_node = nodes.new("ShaderNodeVertexColor")
    color_node.location = (-300, 0)
    color_node.layer_name = "Col"

    links.new(color_node.outputs["Color"], bsdf_node.inputs["Base Color"])
    links.new(bsdf_node.outputs["BSDF"], output_node.inputs["Surface"])

    return mat


def clear_scene():
    """Remove all objects, meshes, materials from the scene."""
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in bpy.data.meshes:
        bpy.data.meshes.remove(block)
    for block in bpy.data.materials:
        bpy.data.materials.remove(block)


def process_tile(stl_name, tile_type):
    """Import STL, separate by loose parts, color per component, export GLB."""
    stl_path = os.path.join(ASSETS_DIR, stl_name)
    if not os.path.exists(stl_path):
        print(f"WARNING: {stl_path} not found, skipping")
        return None

    tile_name = os.path.splitext(stl_name)[0]
    glb_path = os.path.join(ASSETS_DIR, tile_name + ".glb")

    print(f"\n{'='*60}")
    print(f"Processing: {stl_name} → {tile_name}.glb")
    print(f"{'='*60}")

    clear_scene()

    # Import STL
    bpy.ops.wm.stl_import(filepath=stl_path)
    obj = bpy.context.selected_objects[0]
    obj.name = tile_name

    total_verts = len(obj.data.vertices)
    total_faces = len(obj.data.polygons)
    print(f"  Total vertices: {total_verts}, faces: {total_faces}")

    # Make sure this is the active object
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)

    # Try to separate by loose parts
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.separate(type='LOOSE')
    bpy.ops.object.mode_set(mode='OBJECT')

    # Gather all parts
    parts = list(bpy.context.selected_objects)
    num_parts = len(parts)
    print(f"  Loose parts: {num_parts}")

    used_fallback = False

    if num_parts <= 1:
        # Single connected mesh — use step-function fallback with doc palette colors
        print(f"  → Single connected mesh, using step-function fallback")
        used_fallback = True
        obj = parts[0] if parts else bpy.context.selected_objects[0]
        ground_color = get_part_color(tile_type, 0)
        feature_color = get_part_color(tile_type, 1)
        paint_object_step(obj, ground_color, feature_color, threshold_pct=0.15)
    else:
        # Multiple loose parts — classify each
        part_infos = []
        for p in parts:
            info = get_part_info(p)
            info["obj"] = p
            part_infos.append(info)

        # Sort by vertex count descending; largest = base (index 0)
        part_infos.sort(key=lambda x: x["vert_count"], reverse=True)

        for i, pi in enumerate(part_infos):
            color = get_part_color(tile_type, i)
            role = "BASE" if i == 0 else f"part#{i}"
            print(f"  {role}: verts={pi['vert_count']}, centroid_z={pi['centroid_z']:.2f} → "
                  f"color=({color[0]:.3f},{color[1]:.3f},{color[2]:.3f})")
            paint_object_solid(pi["obj"], color)

    # Create and assign material
    mat = create_vertex_color_material(f"mat_{tile_name}")

    # Select all parts and assign material
    bpy.ops.object.select_all(action='SELECT')
    for obj in bpy.context.selected_objects:
        obj.data.materials.clear()
        obj.data.materials.append(mat)

    # Join all parts back into one
    bpy.context.view_layer.objects.active = bpy.context.selected_objects[0]
    bpy.ops.object.join()

    # Rename joined object
    joined = bpy.context.active_object
    joined.name = tile_name
    joined.data.name = tile_name

    # Export as GLB
    bpy.ops.object.select_all(action="DESELECT")
    joined.select_set(True)
    bpy.context.view_layer.objects.active = joined

    bpy.ops.export_scene.gltf(
        filepath=glb_path,
        export_format='GLB',
        use_selection=True,
        export_vertex_color='MATERIAL',
        export_all_vertex_colors=True,
        export_normals=True,
        export_apply=True,
    )

    print(f"  ✓ Exported: {glb_path}")
    return {"tile": tile_name, "parts": num_parts, "fallback": used_fallback}


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    print(f"\nBlender per-component vertex color pipeline")
    print(f"Assets dir: {ASSETS_DIR}")

    tiles = ["wool", "wood", "wheet", "brick", "ore", "desert", "water", "harbor_water"]
    results = []

    for tile_type in tiles:
        result = process_tile(tile_type + ".stl", tile_type)
        if result:
            results.append(result)

    print(f"\n{'='*60}")
    print("Summary:")
    print(f"{'='*60}")
    for r in results:
        fb = " (FALLBACK: single mesh)" if r["fallback"] else ""
        print(f"  {r['tile']}: {r['parts']} components{fb}")
    print("All tiles processed!")


if __name__ == "__main__":
    main()
