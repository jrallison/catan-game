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


# ─── Per-tile color classification ───────────────────────────────────────────

def classify_wool(part_info, is_base):
    """Pasture tile: green base, white sheep, grey buildings, green bushes."""
    if is_base:
        return hex_to_linear("#7ecf3f")
    z_span = part_info["z_span"]
    centroid_z = part_info["centroid_z"]
    vert_count = part_info["vert_count"]
    # Sheep: low flat shapes
    if z_span < 5:
        return hex_to_linear("#f0f0f0")
    # Buildings: moderate vertex count, moderate height
    if vert_count > 100 and centroid_z > 3:
        return hex_to_linear("#8a8a8a")
    # Bushes / vegetation
    return hex_to_linear("#5aaa28")


def classify_wood(part_info, is_base):
    """Forest tile: green base, brown trunks, dark green canopy."""
    if is_base:
        return hex_to_linear("#4a8c2a")
    centroid_z = part_info["centroid_z"]
    z_span = part_info["z_span"]
    xy_span = part_info["xy_span"]
    # Tree trunks: tall and thin (z_span >> xy_span)
    if z_span > 2 and xy_span < z_span * 0.6:
        return hex_to_linear("#5c3a1e")
    # Tree canopy: high centroid, bulbous
    if centroid_z > 5:
        return hex_to_linear("#2d5a1a")
    # Default: darker green
    return hex_to_linear("#2d5a1a")


def classify_wheet(part_info, is_base):
    """Wheat tile: golden base, golden stalks, light yellow tips."""
    if is_base:
        return hex_to_linear("#c8a832")
    centroid_z = part_info["centroid_z"]
    if centroid_z > 8:
        return hex_to_linear("#f0d870")
    return hex_to_linear("#e8c84a")


def classify_brick(part_info, is_base):
    """Hills tile: tan base, terra cotta formations, brick red details."""
    if is_base:
        return hex_to_linear("#c4a26b")
    vert_count = part_info["vert_count"]
    if vert_count < 50:
        return hex_to_linear("#8b3020")
    return hex_to_linear("#a0432a")


def classify_ore(part_info, is_base):
    """Mountains tile: charcoal base, grey slopes, white peaks."""
    if is_base:
        return hex_to_linear("#3a3a3a")
    centroid_z = part_info["centroid_z"]
    if centroid_z > 10:
        return hex_to_linear("#dde8ee")
    return hex_to_linear("#6b7c8c")


def classify_desert(part_info, is_base):
    """Desert: uniform sandy tan with slight height variation."""
    centroid_z = part_info["centroid_z"]
    # Slight variation: darker at base, lighter up top
    t = min(1.0, centroid_z / 15.0) if centroid_z > 0 else 0.0
    base = hex_to_linear("#c09a50")
    top = hex_to_linear("#d4b86a")
    return (
        base[0] + (top[0] - base[0]) * t,
        base[1] + (top[1] - base[1]) * t,
        base[2] + (top[2] - base[2]) * t,
    )


def classify_water(part_info, is_base):
    """Water: deep cobalt base, cyan wave crests."""
    if is_base:
        return hex_to_linear("#1a5fa8")
    centroid_z = part_info["centroid_z"]
    if centroid_z > 2:
        return hex_to_linear("#2ab8d4")
    return hex_to_linear("#1a5fa8")


TILE_CLASSIFIERS = {
    "wool": classify_wool,
    "wood": classify_wood,
    "wheet": classify_wheet,
    "brick": classify_brick,
    "ore": classify_ore,
    "desert": classify_desert,
    "water": classify_water,
    "harbor_water": classify_water,
}

# Fallback ground/feature colors for step-function (single connected mesh)
TILE_FALLBACK_COLORS = {
    "wool": (hex_to_linear("#7ecf3f"), hex_to_linear("#5aaa28")),
    "wood": (hex_to_linear("#4a8c2a"), hex_to_linear("#2d5a1a")),
    "wheet": (hex_to_linear("#c8a832"), hex_to_linear("#e8c84a")),
    "brick": (hex_to_linear("#c4a26b"), hex_to_linear("#a0432a")),
    "ore": (hex_to_linear("#3a3a3a"), hex_to_linear("#6b7c8c")),
    "desert": (hex_to_linear("#c09a50"), hex_to_linear("#d4b86a")),
    "water": (hex_to_linear("#1a5fa8"), hex_to_linear("#2ab8d4")),
    "harbor_water": (hex_to_linear("#1a5fa8"), hex_to_linear("#2ab8d4")),
}


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

    classifier = TILE_CLASSIFIERS[tile_type]
    used_fallback = False

    if num_parts <= 1:
        # Single connected mesh — use step-function fallback
        print(f"  → Single connected mesh, using step-function fallback")
        used_fallback = True
        obj = parts[0] if parts else bpy.context.selected_objects[0]
        ground_color, feature_color = TILE_FALLBACK_COLORS[tile_type]
        paint_object_step(obj, ground_color, feature_color, threshold_pct=0.15)
    else:
        # Multiple loose parts — classify each
        part_infos = []
        for p in parts:
            info = get_part_info(p)
            info["obj"] = p
            part_infos.append(info)

        # Sort by vertex count descending; largest = base
        part_infos.sort(key=lambda x: x["vert_count"], reverse=True)

        for i, pi in enumerate(part_infos):
            is_base = (i == 0)
            color = classifier(pi, is_base)
            role = "BASE" if is_base else f"part#{i}"
            print(f"  {role}: verts={pi['vert_count']}, centroid_z={pi['centroid_z']:.2f}, "
                  f"z_span={pi['z_span']:.2f}, xy_span={pi['xy_span']:.2f} → "
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
