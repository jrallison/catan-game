"""
fix_harbor_base_boat.py — Blender headless script.

Imports all 4 harbor_base STL parts, scales the boat parts (3 + 4) to 50%,
paints vertex colors (matching add_vertex_colors.py palette), joins, and
exports as harbor_base.glb.

Usage:
    blender --background --python scripts/fix_harbor_base_boat.py
"""

import bpy
import os


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
ASSETS_DIR = os.path.join(PROJECT_DIR, "public", "assets")
PARTS_DIR = os.path.expanduser("~/Downloads/catan-parts/harbor_base")
OUTPUT_PATH = os.path.join(ASSETS_DIR, "harbor_base.glb")

# Parts 3 (brown/hull+masts) and 4 (gray/sails) = boat → scale to 50%
BOAT_PARTS = {"harbor_base_-_3", "harbor_base_-_4"}

# Vertex colors from add_vertex_colors.py palette
def hex_to_srgb(h):
    h = h.lstrip("#")
    return int(h[0:2], 16) / 255.0, int(h[2:4], 16) / 255.0, int(h[4:6], 16) / 255.0

PART_COLORS = {
    "harbor_base_-_1": hex_to_srgb("#D9CF74"),  # palette 2 — beige
    "harbor_base_-_2": hex_to_srgb("#27FFF5"),  # palette 12 — turquoise
    "harbor_base_-_3": hex_to_srgb("#CC6600"),  # palette 3 — brown
    "harbor_base_-_4": hex_to_srgb("#FFFFFF"),  # palette 7 — white
}


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in list(bpy.data.meshes):
        bpy.data.meshes.remove(block)
    for block in list(bpy.data.materials):
        bpy.data.materials.remove(block)


def paint_solid(obj, color):
    mesh = obj.data
    attr_name = "Col"
    if attr_name not in mesh.color_attributes:
        mesh.color_attributes.new(name=attr_name, type='BYTE_COLOR', domain='CORNER')
    ca = mesh.color_attributes[attr_name]
    for poly in mesh.polygons:
        for loop_idx in poly.loop_indices:
            ca.data[loop_idx].color = (color[0], color[1], color[2], 1.0)


def create_vertex_color_material(name):
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


def main():
    clear_scene()
    all_objects = []

    for stem, color in sorted(PART_COLORS.items()):
        stl_path = os.path.join(PARTS_DIR, stem + ".stl")
        if not os.path.exists(stl_path):
            print(f"  WARNING: {stl_path} not found, skipping")
            continue

        print(f"  Importing {stem}")
        bpy.ops.object.select_all(action="DESELECT")
        bpy.ops.wm.stl_import(filepath=stl_path)
        new_objs = list(bpy.context.selected_objects)

        for obj in new_objs:
            paint_solid(obj, color)

            if stem in BOAT_PARTS:
                # Set origin to bounding box center, then scale to 50%
                bpy.ops.object.select_all(action="DESELECT")
                obj.select_set(True)
                bpy.context.view_layer.objects.active = obj
                bpy.ops.object.origin_set(type='ORIGIN_GEOMETRY', center='BOUNDS')
                obj.scale = (0.5, 0.5, 0.5)
                bpy.ops.object.transform_apply(scale=True)
                print(f"    → Scaled {stem} to 50%")

            all_objects.append(obj)

    if not all_objects:
        print("ERROR: No parts imported")
        return

    # Join all parts
    bpy.ops.object.select_all(action="DESELECT")
    for obj in all_objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = all_objects[0]
    bpy.ops.object.join()

    joined = bpy.context.active_object
    joined.name = "harbor_base"

    # Add vertex color material
    mat = create_vertex_color_material("mat_harbor_base")
    joined.data.materials.clear()
    joined.data.materials.append(mat)

    # Export GLB
    bpy.ops.object.select_all(action="DESELECT")
    joined.select_set(True)
    bpy.context.view_layer.objects.active = joined
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=OUTPUT_PATH,
        export_format='GLB',
        use_selection=True,
        export_vertex_color='MATERIAL',
        export_all_vertex_colors=True,
        export_normals=True,
        export_apply=True,
    )
    print(f"\n  ✓ Exported: {OUTPUT_PATH}")


main()
