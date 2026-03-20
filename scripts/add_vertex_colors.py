"""
add_vertex_colors.py — Blender headless script.

Color strategy: Z-HEIGHT BANDING

The Color-composition.pdf describes FILAMENT CHANGE POINTS during 3D printing.
Ore_-_1, Ore_-_2, etc. are NOT separate files — they are the same mesh printed
in successive color bands from bottom (Z=0) to top (Z=max). Each _-_N color
occupies an equal slice of the tile's Z range.

This script divides each tile's Z range into N equal bands and assigns the
doc's colors as hard cuts, bottom→top, per vertex.

Usage:
    blender --background --python scripts/add_vertex_colors.py
"""

import bpy
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
ASSETS_DIR = os.path.join(PROJECT_DIR, "public", "assets")


def hex_to_linear(h):
    """Convert '#rrggbb' sRGB hex to linear RGB tuple for Blender vertex colors."""
    h = h.lstrip("#")
    r, g, b = int(h[0:2], 16) / 255.0, int(h[2:4], 16) / 255.0, int(h[4:6], 16) / 255.0
    def to_lin(c):
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (to_lin(r), to_lin(g), to_lin(b))


# ─── Exact RGB values pixel-sampled from Color-composition.pdf swatches ───────
#
#  Nr  Name          Hex       Source
#   1  Orange        #FF6600   sampled
#   2  Beige         #D9CF74   sampled
#   3  Brown         #CC6600   sampled
#   4  Red           #C00000   sampled
#   5  Gold          #FFCC00   sampled
#   6  Light green   #66FF33   sampled
#   7  White         #FFFFFF   sampled
#   8  Green         #009900   sampled
#   9  Grey          #BFBFBF   sampled
#  10  Yellow        #FFFF00   sampled
#  11  Blue/green    #00716B   sampled
#  12  Turquoise     #27FFF5   sampled

PALETTE = {
    1:  hex_to_linear("#FF6600"),
    2:  hex_to_linear("#D9CF74"),
    3:  hex_to_linear("#CC6600"),
    4:  hex_to_linear("#C00000"),
    5:  hex_to_linear("#FFCC00"),
    6:  hex_to_linear("#66FF33"),
    7:  hex_to_linear("#FFFFFF"),
    8:  hex_to_linear("#009900"),
    9:  hex_to_linear("#BFBFBF"),
    10: hex_to_linear("#FFFF00"),
    11: hex_to_linear("#00716B"),
    12: hex_to_linear("#27FFF5"),
}

# ─── Per-tile Z-band color sequences (bottom → top = _-_1 → _-_N) ─────────────
#
# From Color-composition.pdf "Landscape ..." sections.
# Each entry is a palette color number, applied to an equal Z slice.
# _-_1 is at the bottom (Z_min), _-_N is at the top (Z_max).

TILE_BANDS = {
    #         _-_1   _-_2   _-_3   _-_4
    "wool":   [6,     3,     8,     7],   # Light green, Brown, Green, White
    "wood":   [6,     8,     2,     3],   # Light green, Green, Beige, Brown
    "wheet":  [5,     10,    4,     8],   # Gold, Yellow, Red, Green
    "brick":  [2,     3,     8,     4],   # Beige, Brown, Green, Red
    "ore":    [2,     9,     3,     8],   # Beige, Grey, Brown, Green
    "desert": [5,     3,     8,     7],   # Gold, Brown, Green, White
    "water":        [11,    12,    7],    # Blue/green, Turquoise, White (3 bands)
    "harbor_water": [11,    12,    7],
}


def paint_z_bands(obj, bands):
    """
    Paint per-vertex colors based on Z-height bands.

    Divides the object's Z range into len(bands) equal slices and assigns
    each vertex the color of whichever band its Z coordinate falls in.
    Colors are written per-loop (face corner) as required by Blender.
    """
    mesh = obj.data
    n = len(bands)

    # Compute Z range across all vertices
    zs = [v.co.z for v in mesh.vertices]
    if not zs:
        return
    z_min, z_max = min(zs), max(zs)
    z_range = z_max - z_min
    if z_range < 1e-6:
        # Flat mesh — use bottom band color
        band_color = PALETTE[bands[0]]
        _paint_solid(mesh, band_color)
        return

    # Per-vertex band index
    vert_band = []
    for v in mesh.vertices:
        t = (v.co.z - z_min) / z_range          # 0.0 at bottom, 1.0 at top
        idx = min(int(t * n), n - 1)             # band 0..n-1
        vert_band.append(idx)

    # Ensure color attribute exists
    attr_name = "Col"
    if attr_name not in mesh.color_attributes:
        mesh.color_attributes.new(name=attr_name, type='BYTE_COLOR', domain='CORNER')
    color_attr = mesh.color_attributes[attr_name]

    # Write color per loop (face corner)
    for poly in mesh.polygons:
        for loop_idx in poly.loop_indices:
            vert_idx = mesh.loops[loop_idx].vertex_index
            band_idx = vert_band[vert_idx]
            c = PALETTE[bands[band_idx]]
            color_attr.data[loop_idx].color = (c[0], c[1], c[2], 1.0)


def _paint_solid(mesh, color):
    """Paint the entire mesh a single solid color."""
    attr_name = "Col"
    if attr_name not in mesh.color_attributes:
        mesh.color_attributes.new(name=attr_name, type='BYTE_COLOR', domain='CORNER')
    color_attr = mesh.color_attributes[attr_name]
    for poly in mesh.polygons:
        for loop_idx in poly.loop_indices:
            color_attr.data[loop_idx].color = (color[0], color[1], color[2], 1.0)


def create_vertex_color_material(name):
    """Material that reads vertex colors → Principled BSDF albedo."""
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    for node in list(nodes):
        nodes.remove(node)

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


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in bpy.data.meshes:
        bpy.data.meshes.remove(block)
    for block in bpy.data.materials:
        bpy.data.materials.remove(block)


def process_tile(tile_type):
    stl_path = os.path.join(ASSETS_DIR, tile_type + ".stl")
    glb_path = os.path.join(ASSETS_DIR, tile_type + ".glb")

    if not os.path.exists(stl_path):
        print(f"  WARNING: {stl_path} not found, skipping")
        return

    print(f"\nProcessing: {tile_type}.stl → {tile_type}.glb")
    clear_scene()

    bpy.ops.wm.stl_import(filepath=stl_path)
    obj = bpy.context.selected_objects[0]
    obj.name = tile_type

    bands = TILE_BANDS[tile_type]
    zs = [v.co.z for v in obj.data.vertices]
    print(f"  Vertices: {len(obj.data.vertices)}  Z range: {min(zs):.2f}..{max(zs):.2f}  Bands: {bands}")

    paint_z_bands(obj, bands)

    mat = create_vertex_color_material(f"mat_{tile_type}")
    obj.data.materials.clear()
    obj.data.materials.append(mat)

    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

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
    print("\nDone.")

main()
