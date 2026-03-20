"""
add_vertex_colors.py — Blender headless script.

Imports each tile STL, separates by loose parts, assigns per-component
vertex colors using geometry-based classification (not vertex-count order),
then rejoins and exports as GLB.

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

PALETTE = {
    1:  "#FF6600",  # Orange
    2:  "#D9CF74",  # Beige
    3:  "#CC6600",  # Brown
    4:  "#C00000",  # Red
    5:  "#FFCC00",  # Gold
    6:  "#66FF33",  # Light green
    7:  "#FFFFFF",  # White
    8:  "#009900",  # Green
    9:  "#BFBFBF",  # Grey
    10: "#FFFF00",  # Yellow
    11: "#00716B",  # Blue/green
    12: "#27FFF5",  # Turquoise
}

def p(n):
    """Return linear RGB tuple for palette color n."""
    return hex_to_linear(PALETTE[n])


# ─── Geometry analysis ────────────────────────────────────────────────────────

def get_part_info(obj):
    """Compute detailed geometry stats for a mesh object."""
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

    spans = sorted([x_span, y_span, z_span])
    equidim_ratio = spans[0] / spans[2] if spans[2] > 1e-6 else 0.0

    return {
        "obj": obj,
        "vert_count": len(verts),
        "centroid_x": centroid_x,
        "centroid_y": centroid_y,
        "centroid_z": centroid_z,
        "x_span": x_span,
        "y_span": y_span,
        "z_span": z_span,
        "xy_footprint": xy_footprint,
        "aspect_ratio": aspect_ratio,
        "equidim_ratio": equidim_ratio,
        "z_min": z_min,
        "z_max": z_max,
    }


def find_base(parts):
    """Return the base part (largest XY footprint, flat)."""
    return max(parts, key=lambda p: p["xy_footprint"])


# ─── Per-tile geometric classifiers ──────────────────────────────────────────
# Each returns a list of (part_info, color, role_name) tuples.

def classify_wheet(parts):
    """
    Wheat tile classification:
    - Base: largest flat hex platform → Yellow (#FFFF00)
    - Wheat stalks: large flat area (huge XY, very low aspect) → Gold (#FFCC00)
    - Barn/house: moderate verts, tallest relative to footprint → Red (#C00000)
    - Trees/bushes: small, roughly spherical → Green (#009900)
    """
    base = find_base(parts)
    rest = [p for p in parts if p is not base]

    result = [(base, p(10), "base")]

    for part in rest:
        # Wheat field: large vertex count + very flat (aspect < 0.15)
        if part["vert_count"] > 500 and part["aspect_ratio"] < 0.15:
            result.append((part, p(5), "wheat_stalks"))
        # Barn: moderate vertices, tall relative to footprint (aspect > 0.75)
        # AND not tiny (> 150 verts to exclude small round trees)
        elif part["vert_count"] > 150 and part["aspect_ratio"] > 0.75:
            result.append((part, p(4), "barn"))
        # Flat part high up (roof): low vert count, centroid_z high, flat
        elif part["centroid_z"] > 8.0 and part["aspect_ratio"] < 0.3:
            result.append((part, p(4), "barn_roof"))
        # Trees/bushes: small parts
        else:
            result.append((part, p(8), "tree"))

    return result


def classify_wool(parts):
    """
    Pasture/wool tile classification:
    - Base: largest → White (#FFFFFF)
    - Sheep: small-medium roughly equidimensional blobs → White (#FFFFFF)
    - Building/house: tallest aspect ratio, largest non-base → Brown (#CC6600)
    - Ground cover: very small + flat → Light green (#66FF33)
    """
    base = find_base(parts)
    rest = [p for p in parts if p is not base]

    result = [(base, p(7), "base")]

    if not rest:
        return result

    # The largest non-base part is likely the building/house
    rest_sorted = sorted(rest, key=lambda x: x["vert_count"], reverse=True)
    building = rest_sorted[0]

    for part in rest:
        if part is building:
            result.append((part, p(3), "building"))
        # Very small + flat = ground cover
        elif part["vert_count"] < 120 and part["aspect_ratio"] < 0.6:
            result.append((part, p(6), "ground_cover"))
        # Everything else = sheep
        else:
            result.append((part, p(7), "sheep"))

    return result


def classify_wood(parts):
    """
    Forest/wood tile classification:
    - Base: largest → Brown (#CC6600)
    - Tree canopy / ground features: smaller parts
      - Larger flat parts → Light green (#66FF33) (ground/undergrowth)
      - Smaller parts → Green (#009900) (tree details)
    """
    base = find_base(parts)
    rest = [p for p in parts if p is not base]

    result = [(base, p(3), "base")]

    for part in rest:
        if part["vert_count"] > 100:
            result.append((part, p(6), "ground"))
        else:
            result.append((part, p(8), "tree_detail"))

    return result


def classify_brick(parts):
    """
    Brick/hills tile classification:
    - Base: largest → Orange (#FF6600)
    - Medium features: clay/ground → Beige (#D9CF74)
    - Smaller features: rock formations → Brown (#CC6600)
    - Tiny features: brick details → Red (#C00000)
    """
    base = find_base(parts)
    rest = [p for p in parts if p is not base]

    result = [(base, p(1), "base")]

    # Sort by vert count to assign by relative size
    rest_sorted = sorted(rest, key=lambda x: x["vert_count"], reverse=True)

    for i, part in enumerate(rest_sorted):
        if part["vert_count"] >= 80:
            # Larger features = clay ground (Beige)
            result.append((part, p(2), "clay_ground"))
        elif part["vert_count"] >= 30:
            # Medium features = rock formations (Brown)
            result.append((part, p(3), "rock"))
        else:
            # Tiny features = brick details (Red)
            result.append((part, p(4), "brick_detail"))

    return result


def classify_desert(parts):
    """
    Desert tile classification:
    - Base: largest → Gold (#FFCC00)
    - Feature: rock/cactus → Brown (#CC6600)
    """
    base = find_base(parts)
    rest = [p for p in parts if p is not base]

    result = [(base, p(5), "base")]
    for part in rest:
        result.append((part, p(3), "rock_feature"))

    return result


TILE_CLASSIFIERS = {
    "wheet": classify_wheet,
    "wool": classify_wool,
    "wood": classify_wood,
    "brick": classify_brick,
    "desert": classify_desert,
}


# ─── Painting functions ──────────────────────────────────────────────────────

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


# Step-function color configs for single-mesh tiles
STEP_CONFIGS = {
    "ore":          (p(9), p(2), 0.15),   # Grey base, Beige peaks
    "water":        (p(11), p(12), 0.50),  # Blue/green base, Turquoise waves
    "harbor_water": (p(11), p(12), 0.50),  # Blue/green base, Turquoise waves
}


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
    parts_objs = list(bpy.context.selected_objects)
    num_parts = len(parts_objs)
    print(f"  Loose parts: {num_parts}")

    used_fallback = False

    if tile_type in STEP_CONFIGS:
        # Single-mesh step-function tiles (ore, water, harbor_water)
        print(f"  → Step-function coloring for {tile_type}")
        used_fallback = True
        ground, feature, threshold = STEP_CONFIGS[tile_type]
        for obj in parts_objs:
            paint_object_step(obj, ground, feature, threshold)

    elif tile_type in TILE_CLASSIFIERS and num_parts > 1:
        # Multi-part tiles with geometry-based classification
        part_infos = []
        for obj in parts_objs:
            info = get_part_info(obj)
            if info:
                part_infos.append(info)

        classifier = TILE_CLASSIFIERS[tile_type]
        assignments = classifier(part_infos)

        for part_info, color, role in assignments:
            print(f"  {role}: verts={part_info['vert_count']}, "
                  f"aspect={part_info['aspect_ratio']:.3f}, "
                  f"centroid_z={part_info['centroid_z']:.2f} → "
                  f"color=({color[0]:.3f},{color[1]:.3f},{color[2]:.3f})")
            paint_object_solid(part_info["obj"], color)

    elif num_parts <= 1:
        # Single connected mesh without step config — use first palette color
        print(f"  → Single connected mesh, using step-function fallback")
        used_fallback = True
        obj = parts_objs[0] if parts_objs else bpy.context.selected_objects[0]
        # Default: use first two colors from old config
        ground_color = p(9)  # Grey
        feature_color = p(2)  # Beige
        paint_object_step(obj, ground_color, feature_color, 0.15)

    else:
        # Multi-part tile without specific classifier — fallback to size-order
        print(f"  → No specific classifier for {tile_type}, using size-order fallback")
        used_fallback = True
        part_infos = []
        for obj in parts_objs:
            info = get_part_info(obj)
            if info:
                part_infos.append(info)
        part_infos.sort(key=lambda x: x["vert_count"], reverse=True)
        # Just paint everything the same base color
        for pi in part_infos:
            paint_object_solid(pi["obj"], p(11))

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
    print(f"\nBlender geometry-based vertex color pipeline")
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
        fb = " (step-function)" if r["fallback"] else " (geometry-classified)"
        print(f"  {r['tile']}: {r['parts']} components{fb}")
    print("All tiles processed!")


if __name__ == "__main__":
    main()
