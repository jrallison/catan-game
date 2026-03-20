"""
add_vertex_colors.py — Blender headless script.

Color strategy: SEPARATE PART FILES (correct approach)

Each tile type has separate _-_1.stl, _-_2.stl, etc. files from Thingiverse,
designed for Prusa MMU multi-material printing. Each file is one color.
We import each part, paint it solid with its exact color, join all parts,
and export as a single GLB with vertex colors.

Color numbers map exactly to the palette in Color-composition.pdf (pixel-sampled).

Usage:
    blender --background --python scripts/add_vertex_colors.py
"""

import bpy
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
ASSETS_DIR = os.path.join(PROJECT_DIR, "public", "assets")
PARTS_DIR = os.path.expanduser("~/Downloads/catan-parts")


def hex_to_linear(h):
    """Convert '#rrggbb' sRGB hex to linear RGB for Blender vertex colors."""
    h = h.lstrip("#")
    r, g, b = int(h[0:2], 16) / 255.0, int(h[2:4], 16) / 255.0, int(h[4:6], 16) / 255.0
    def to_lin(c):
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (to_lin(r), to_lin(g), to_lin(b))


# ─── Exact RGB values pixel-sampled from Color-composition.pdf swatches ───────
PALETTE = {
    1:  hex_to_linear("#FF6600"),  # Orange
    2:  hex_to_linear("#D9CF74"),  # Beige
    3:  hex_to_linear("#CC6600"),  # Brown
    4:  hex_to_linear("#C00000"),  # Red
    5:  hex_to_linear("#FFCC00"),  # Gold
    6:  hex_to_linear("#66FF33"),  # Light green
    7:  hex_to_linear("#FFFFFF"),  # White
    8:  hex_to_linear("#009900"),  # Green
    9:  hex_to_linear("#BFBFBF"),  # Grey
    10: hex_to_linear("#FFFF00"),  # Yellow
    11: hex_to_linear("#00716B"),  # Blue/green
    12: hex_to_linear("#27FFF5"),  # Turquoise
}

# ─── Part color assignments from Color-composition.pdf ────────────────────────
# Format: tile_type -> {part_number: palette_color_number}
# Part numbers match the _-_N suffix in the STL filenames.

TILE_PART_COLORS = {
    "ore":          {1: 2,  2: 9,  3: 3,  4: 8},
    "wheet":        {1: 5,  2: 10, 3: 4,  4: 8},
    "brick":        {1: 2,  2: 3,  3: 8,  4: 4},
    "wood":         {1: 6,  2: 8,  3: 2,  4: 3},
    "wool":         {1: 6,  2: 3,  3: 8,  4: 7},
    "desert":       {1: 5,  2: 3,  3: 8,  4: 7},
    "water":        {1: 11, 2: 12, 3: 7},
    "harbor_water": {1: 11, 2: 12, 3: 7},
}


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in list(bpy.data.meshes):
        bpy.data.meshes.remove(block)
    for block in list(bpy.data.materials):
        bpy.data.materials.remove(block)


def paint_solid(obj, color):
    """Paint every face of obj a single solid color using a vertex color attribute."""
    mesh = obj.data
    attr_name = "Col"
    if attr_name not in mesh.color_attributes:
        mesh.color_attributes.new(name=attr_name, type='BYTE_COLOR', domain='CORNER')
    ca = mesh.color_attributes[attr_name]
    for poly in mesh.polygons:
        for loop_idx in poly.loop_indices:
            ca.data[loop_idx].color = (color[0], color[1], color[2], 1.0)


def create_vertex_color_material(name):
    """Material: Vertex Color → Principled BSDF."""
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    for n in list(nodes):
        nodes.remove(n)
    output = nodes.new("ShaderNodeOutputMaterial")
    output.location = (400, 0)
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (0, 0)
    bsdf.inputs["Metallic"].default_value = 0.1
    bsdf.inputs["Roughness"].default_value = 0.8
    vcol = nodes.new("ShaderNodeVertexColor")
    vcol.location = (-300, 0)
    vcol.layer_name = "Col"
    links.new(vcol.outputs["Color"], bsdf.inputs["Base Color"])
    links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])
    return mat


def process_tile(tile_type):
    part_colors = TILE_PART_COLORS[tile_type]
    parts_subdir = os.path.join(PARTS_DIR, tile_type)
    glb_path = os.path.join(ASSETS_DIR, tile_type + ".glb")

    print(f"\nProcessing: {tile_type} → {tile_type}.glb")
    clear_scene()

    imported_objects = []

    for part_num, palette_num in sorted(part_colors.items()):
        stl_path = os.path.join(parts_subdir, f"{tile_type}_-_{part_num}.stl")
        if not os.path.exists(stl_path):
            print(f"  WARNING: {stl_path} not found, skipping")
            continue

        bpy.ops.object.select_all(action="DESELECT")
        bpy.ops.wm.stl_import(filepath=stl_path)

        # Find newly imported objects
        new_objs = [o for o in bpy.context.selected_objects]
        if not new_objs:
            print(f"  WARNING: No objects imported from {stl_path}")
            continue

        color = PALETTE[palette_num]
        print(f"  Part {part_num} → palette color {palette_num} ({stl_path.split('/')[-1]})")

        for obj in new_objs:
            obj.name = f"{tile_type}_part{part_num}"
            paint_solid(obj, color)
            imported_objects.append(obj)

    if not imported_objects:
        print(f"  ERROR: No parts imported for {tile_type}")
        return

    # Select all imported objects and join into one mesh
    bpy.ops.object.select_all(action="DESELECT")
    for obj in imported_objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = imported_objects[0]
    bpy.ops.object.join()

    joined = bpy.context.active_object
    joined.name = tile_type

    # Assign single material that uses vertex colors
    mat = create_vertex_color_material(f"mat_{tile_type}")
    joined.data.materials.clear()
    joined.data.materials.append(mat)

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


def main():
    tiles = ["wool", "wood", "wheet", "brick", "ore", "desert", "water", "harbor_water"]
    for tile_type in tiles:
        process_tile(tile_type)
    print("\nAll done.")

main()
