"""
add_vertex_colors.py — Blender headless script.

Color strategy: SEPARATE PART FILES (correct approach)

Each piece has separate _-_N.stl files from Thingiverse, designed for Prusa MMU
multi-material printing. Each file is one color. We import each part, paint it
solid with its exact color, join all parts, and export as a single GLB.

Color source: Color-composition.pdf by Dakanzla (pixel-sampled swatch values).

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

# ─── Player colors (4 players) ────────────────────────────────────────────────
PLAYER_COLORS = {
    "p1": hex_to_linear("#FF6600"),  # Orange (palette 1)
    "p2": hex_to_linear("#27FFF5"),  # Turquoise (palette 12)
    "p3": hex_to_linear("#66FF33"),  # Light green (palette 6)
    "p4": hex_to_linear("#C00000"),  # Red (palette 4)
}

# ─── Part color assignments (from Color-composition.pdf) ──────────────────────
# Format: tile_type -> {filename_stem: palette_color_number}
# For player pieces (settlements, cities, roads, crossings): default to player 1 (orange)
# The file stem is matched case-insensitively.

TILE_PART_COLORS = {
    # Landscapes
    "ore":          {"ore_-_1": 2,  "ore_-_2": 9,  "ore_-_3": 3,  "ore_-_4": 8},
    "wheet":        {"wheet_-_1": 5,  "wheet_-_2": 10, "wheet_-_3": 4,  "wheet_-_4": 8},
    "brick":        {"brick_-_1": 2,  "brick_-_2": 3,  "brick_-_3": 8,  "brick_-_4": 4},
    "wood":         {"wood_-_1": 6,  "wood_-_2": 8,  "wood_-_3": 2,  "wood_-_4": 3},
    "wool":         {"wool_-_1": 6,  "wool_-_2": 3,  "wool_-_3": 8,  "wool_-_4": 7},
    "desert":       {"desert_-_1": 5,  "desert_-_2": 3,  "desert_-_3": 8,  "desert_-_4": 7},
    "water":        {"water_-_1": 11, "water_-_2": 12, "water_-_3": 7},
    "harbor_water": {"harbor_water_-_1": 11, "harbor_water_-_2": 12, "harbor_water_-_3": 7},

    # Number tokens
    "number_tokens": {
        "number_tokens_-_1": 9,
        "number_tokens_-_2": 1,
        "number_tokens_-_3": 7,
        "number_tokens_-_4": 4,
    },

    # Player pieces — use player 1 (orange) by default for rendering
    "settlements": {
        "settlement_1": 1,  # player color
        "settlement_2": 9,  # grey base
        "settlement_3": 8,  # green roof
    },
    "cities": {
        "city_-_1": 1,  # player color
        "city_-_2": 9,  # grey base
        "city_-_3": 8,  # green detail
    },
    "roads": {
        "road_-_1": 1,  # player color
        "road_-_2": 9,  # grey
    },
    "crossings": {
        "crossing_-_1": 1,  # player color
        "crossing_-_2": 9,  # grey
    },

    # Harbor pieces
    "harbor_resources": {
        "harbor_3_for_1": 5,   # gold
        "harbor_brick":   1,   # orange
        "harbor_wool":    7,   # white
        "harbor_wood":    3,   # brown
        "harbor_ore":     9,   # grey
        "harbor_wheet":   10,  # yellow
    },
    "harbor_base": {
        "harbor_base_-_1": 2,
        "harbor_base_-_2": 12,
        "harbor_base_-_3": 3,
        "harbor_base_-_4": 7,
    },
    "harbor_top": {
        "harbor_top_-_1": 9,
        "harbor_top_-_2": 3,
        "harbor_top_-_3": 2,
        "harbor_top_-_4": 4,
    },

    # Robber
    "sandstorm": {
        "sandstorm_-_1": 5,
        "sandstorm_-_2": 2,
        "sandstorm_-_3": 8,
        "sandstorm_-_4": 7,
    },

    # Landscape bases (single file, color by tile type — we export one per type)
    # These are handled separately below.
}

# Landscape base colors: one base.stl per tile type, different colors
LANDSCAPE_BASE_COLORS = {
    "base_brick":   1,   # orange
    "base_wool":    7,   # white
    "base_wood":    3,   # brown
    "base_ore":     9,   # grey
    "base_wheet":   10,  # yellow
    "base_desert":  5,   # gold
    "base_water":   11,  # blue/green
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


def import_stl_and_paint(stl_path, color):
    """Import an STL file and paint it solid color. Returns the imported object(s)."""
    if not os.path.exists(stl_path):
        print(f"  WARNING: {stl_path} not found, skipping")
        return []
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.wm.stl_import(filepath=stl_path)
    new_objs = list(bpy.context.selected_objects)
    if not new_objs:
        print(f"  WARNING: No objects imported from {stl_path}")
        return []
    for obj in new_objs:
        paint_solid(obj, color)
    return new_objs


def export_glb(obj, glb_path):
    """Export a single joined object as GLB."""
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    os.makedirs(os.path.dirname(glb_path), exist_ok=True)
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


def process_tile(tile_type):
    """Process a tile type that has _-_N.stl part files."""
    part_colors = TILE_PART_COLORS[tile_type]
    parts_subdir = os.path.join(PARTS_DIR, tile_type)
    glb_path = os.path.join(ASSETS_DIR, tile_type + ".glb")

    print(f"\nProcessing: {tile_type} → {tile_type}.glb")
    clear_scene()

    imported_objects = []

    for file_stem, palette_num in sorted(part_colors.items()):
        stl_path = os.path.join(parts_subdir, file_stem + ".stl")
        # Try case-insensitive match
        if not os.path.exists(stl_path):
            # Check directory for case-insensitive match
            if os.path.isdir(parts_subdir):
                for f in os.listdir(parts_subdir):
                    if f.lower() == (file_stem + ".stl").lower():
                        stl_path = os.path.join(parts_subdir, f)
                        break

        color = PALETTE[palette_num]
        print(f"  {file_stem} → palette color {palette_num}")
        objs = import_stl_and_paint(stl_path, color)
        imported_objects.extend(objs)

    if not imported_objects:
        print(f"  ERROR: No parts imported for {tile_type}")
        return

    # Join all parts
    bpy.ops.object.select_all(action="DESELECT")
    for obj in imported_objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = imported_objects[0]
    bpy.ops.object.join()

    joined = bpy.context.active_object
    joined.name = tile_type
    mat = create_vertex_color_material(f"mat_{tile_type}")
    joined.data.materials.clear()
    joined.data.materials.append(mat)

    export_glb(joined, glb_path)


def process_harbor_resources():
    """Each harbor resource is a SINGLE .stl with a solid color — export individually."""
    print("\nProcessing: harbor_resources (individual files)")
    part_colors = TILE_PART_COLORS["harbor_resources"]
    parts_subdir = os.path.join(PARTS_DIR, "harbor_resources")

    for file_stem, palette_num in sorted(part_colors.items()):
        stl_path = os.path.join(parts_subdir, file_stem + ".stl")
        glb_path = os.path.join(ASSETS_DIR, "harbor_resources", file_stem + ".glb")
        print(f"\n  {file_stem} → palette color {palette_num}")
        clear_scene()
        color = PALETTE[palette_num]
        objs = import_stl_and_paint(stl_path, color)
        if not objs:
            continue
        bpy.ops.object.select_all(action="DESELECT")
        for obj in objs:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        if len(objs) > 1:
            bpy.ops.object.join()
        joined = bpy.context.active_object
        joined.name = file_stem
        mat = create_vertex_color_material(f"mat_{file_stem}")
        joined.data.materials.clear()
        joined.data.materials.append(mat)
        export_glb(joined, glb_path)


def process_landscape_bases():
    """base.stl is a single file exported in 7 color variants."""
    print("\nProcessing: landscape_bases (color variants)")
    base_stl = os.path.join(PARTS_DIR, "landscape_bases", "base.stl")
    if not os.path.exists(base_stl):
        print(f"  ERROR: {base_stl} not found")
        return

    for name, palette_num in LANDSCAPE_BASE_COLORS.items():
        glb_path = os.path.join(ASSETS_DIR, "landscape_bases", name + ".glb")
        print(f"\n  {name} → palette color {palette_num}")
        clear_scene()
        color = PALETTE[palette_num]
        objs = import_stl_and_paint(base_stl, color)
        if not objs:
            continue
        bpy.ops.object.select_all(action="DESELECT")
        for obj in objs:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        if len(objs) > 1:
            bpy.ops.object.join()
        joined = bpy.context.active_object
        joined.name = name
        mat = create_vertex_color_material(f"mat_{name}")
        joined.data.materials.clear()
        joined.data.materials.append(mat)
        export_glb(joined, glb_path)


def main():
    # Landscape tiles
    for tile_type in ["wool", "wood", "wheet", "brick", "ore", "desert", "water", "harbor_water"]:
        process_tile(tile_type)

    # Game pieces
    for piece_type in ["number_tokens", "settlements", "cities", "roads", "crossings",
                       "harbor_base", "harbor_top", "sandstorm"]:
        process_tile(piece_type)

    # Special cases
    process_harbor_resources()
    process_landscape_bases()

    print("\n\nAll done.")


main()
