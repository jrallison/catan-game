"""
add_vertex_colors.py — Blender headless script.

Imports each tile STL, paints vertex colors based on normalized Z-height,
creates a vertex-color material, and exports as GLB.

Usage:
    blender --background --python scripts/add_vertex_colors.py
"""

import bpy
import bmesh
import os
import sys

# ─── Configuration ────────────────────────────────────────────────────────────

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
ASSETS_DIR = os.path.join(PROJECT_DIR, "public", "assets")


def hex_to_rgb(h):
    """Convert '#rrggbb' to (r, g, b) in 0..1 range (linear)."""
    h = h.lstrip("#")
    r, g, b = int(h[0:2], 16) / 255.0, int(h[2:4], 16) / 255.0, int(h[4:6], 16) / 255.0
    # Convert sRGB to linear for Blender's internal color space
    def srgb_to_linear(c):
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b))


# Color stops: list of (t_threshold, rgb) tuples, sorted by t ascending.
# Interpolation is linear between stops.
TILE_COLORS = {
    "wood": [
        (0.0, hex_to_rgb("#4a8c2a")),   # Ground: kelly green
        (0.5, hex_to_rgb("#2d5a1a")),   # Trees: dark forest green
        (1.0, hex_to_rgb("#3d7a22")),   # Tree tops: slightly lighter
    ],
    "wheet": [
        (0.0, hex_to_rgb("#c8a832")),   # Ground: sandy gold
        (0.5, hex_to_rgb("#e8c84a")),   # Wheat stalks: golden yellow
        (1.0, hex_to_rgb("#f0d870")),   # Tips: light butter yellow
    ],
    "brick": [
        (0.0, hex_to_rgb("#c4a26b")),   # Ground: sandy tan
        (0.5, hex_to_rgb("#a0432a")),   # Clay: terra cotta
        (1.0, hex_to_rgb("#8b3020")),   # Peaks: brick red
    ],
    "ore": [
        (0.0, hex_to_rgb("#3a3a3a")),   # Base: dark charcoal
        (0.5, hex_to_rgb("#6b7c8c")),   # Slopes: medium slate grey
        (1.0, hex_to_rgb("#dde8ee")),   # Snow caps: near-white
    ],
    "wool": [
        (0.0, hex_to_rgb("#7ecf3f")),   # Ground: bright lime-green
        (0.6, hex_to_rgb("#7ecf3f")),   # Ground continues
        (1.0, hex_to_rgb("#f0f0f0")),   # Sheep bodies: white
    ],
    "desert": [
        (0.0, hex_to_rgb("#c09a50")),   # Base: darker sandy tan
        (1.0, hex_to_rgb("#d4b86a")),   # Features: lighter sandy tan
    ],
    "water": [
        (0.0, hex_to_rgb("#1a5fa8")),   # Base: deep cobalt
        (1.0, hex_to_rgb("#2ab8d4")),   # Waves: cyan/turquoise
    ],
    "harbor_water": [
        (0.0, hex_to_rgb("#1a5fa8")),   # Base: deep cobalt
        (1.0, hex_to_rgb("#2ab8d4")),   # Waves: cyan/turquoise
    ],
}


def lerp_color(stops, t):
    """Interpolate between color stops at parameter t in [0, 1]."""
    t = max(0.0, min(1.0, t))
    # Find the two surrounding stops
    for i in range(len(stops) - 1):
        t0, c0 = stops[i]
        t1, c1 = stops[i + 1]
        if t <= t1:
            if t1 == t0:
                return c0
            f = (t - t0) / (t1 - t0)
            return (
                c0[0] + (c1[0] - c0[0]) * f,
                c0[1] + (c1[1] - c0[1]) * f,
                c0[2] + (c1[2] - c0[2]) * f,
            )
    return stops[-1][1]


def clear_scene():
    """Remove all objects, meshes, materials from the scene."""
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    # Clean up orphan data
    for block in bpy.data.meshes:
        bpy.data.meshes.remove(block)
    for block in bpy.data.materials:
        bpy.data.materials.remove(block)


def process_tile(stl_name, color_stops):
    """Import STL, add vertex colors, create material, export GLB."""
    stl_path = os.path.join(ASSETS_DIR, stl_name)
    if not os.path.exists(stl_path):
        print(f"WARNING: {stl_path} not found, skipping")
        return

    tile_name = os.path.splitext(stl_name)[0]
    glb_path = os.path.join(ASSETS_DIR, tile_name + ".glb")

    print(f"\n{'='*60}")
    print(f"Processing: {stl_name} → {tile_name}.glb")
    print(f"{'='*60}")

    # Clear scene
    clear_scene()

    # Import STL
    bpy.ops.wm.stl_import(filepath=stl_path)
    obj = bpy.context.selected_objects[0]
    obj.name = tile_name
    mesh = obj.data
    mesh.name = tile_name

    print(f"  Vertices: {len(mesh.vertices)}, Faces: {len(mesh.polygons)}")

    # Compute Z bounds from mesh vertices
    z_coords = [v.co.z for v in mesh.vertices]
    z_min = min(z_coords)
    z_max = max(z_coords)
    z_range = z_max - z_min
    if z_range < 1e-6:
        z_range = 1.0  # avoid division by zero for flat meshes

    print(f"  Z range: {z_min:.4f} → {z_max:.4f} (range: {z_range:.4f})")

    # Add vertex color attribute
    # Blender 4.x+ uses color attributes instead of legacy vertex_colors
    if not mesh.color_attributes:
        mesh.color_attributes.new(name="Col", type='BYTE_COLOR', domain='CORNER')

    color_attr = mesh.color_attributes["Col"]

    # Assign colors per face-corner (loop)
    # Each polygon loop corner gets the color of its vertex based on Z height
    for poly in mesh.polygons:
        for loop_idx in poly.loop_indices:
            vert_idx = mesh.loops[loop_idx].vertex_index
            z = mesh.vertices[vert_idx].co.z
            t = (z - z_min) / z_range
            r, g, b = lerp_color(color_stops, t)
            color_attr.data[loop_idx].color = (r, g, b, 1.0)

    # Create material that uses vertex colors
    mat = bpy.data.materials.new(name=f"mat_{tile_name}")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links

    # Clear default nodes
    for node in nodes:
        nodes.remove(node)

    # Create nodes: Color Attribute → Principled BSDF → Material Output
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

    # Assign material to object
    obj.data.materials.clear()
    obj.data.materials.append(mat)

    # Select only this object for export
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

    # Export as GLB
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


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    print(f"\nBlender vertex color pipeline")
    print(f"Assets dir: {ASSETS_DIR}")

    for stl_name, color_stops in TILE_COLORS.items():
        process_tile(stl_name + ".stl", color_stops)

    print(f"\n{'='*60}")
    print("All tiles processed!")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
