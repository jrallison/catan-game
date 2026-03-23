import bpy, bmesh, os

PARTS_DIR = os.path.expanduser("~/Downloads/catan-parts/harbor_base")
OUT = os.path.expanduser("~/catan-game/public/assets/harbor_base.glb")

# Palette colors (sRGB, same as add_vertex_colors.py)
def hex_to_srgb(h):
    h = h.lstrip("#")
    return int(h[0:2],16)/255, int(h[2:4],16)/255, int(h[4:6],16)/255

COLORS = {
    1: hex_to_srgb("#D9CF74"),  # Beige
    2: hex_to_srgb("#D9CF74"),  # palette 2
    3: hex_to_srgb("#CC6600"),  # Brown
    4: hex_to_srgb("#27FFF5"),  # palette 12 = Turquoise
    7: hex_to_srgb("#FFFFFF"),  # White
}
PART_COLORS = {1: 2, 2: 12, 3: 3, 4: 7}

# Actual palette lookup
PALETTE = {
    2:  hex_to_srgb("#D9CF74"),
    3:  hex_to_srgb("#CC6600"),
    7:  hex_to_srgb("#FFFFFF"),
    12: hex_to_srgb("#27FFF5"),
}

bpy.ops.wm.read_factory_settings(use_empty=True)

objects = []
for i in range(1, 5):
    stl = os.path.join(PARTS_DIR, f"harbor_base_-_{i}.stl")
    bpy.ops.wm.stl_import(filepath=stl)
    obj = bpy.context.selected_objects[0]
    obj.name = f"part_{i}"

    # Paint vertex color
    mesh = obj.data
    if mesh.color_attributes:
        mesh.color_attributes.remove(mesh.color_attributes[0])
    col_attr = mesh.color_attributes.new(name="Col", type="BYTE_COLOR", domain="CORNER")
    r, g, b = PALETTE[PART_COLORS[i]]
    for loop in mesh.loops:
        col_attr.data[loop.index].color = (r, g, b, 1.0)

    # Scale boat parts (3 and 4) from bottom-center using bmesh
    if i in (3, 4):
        bm = bmesh.new()
        bm.from_mesh(mesh)
        xs = [v.co.x for v in bm.verts]
        ys = [v.co.y for v in bm.verts]
        zs = [v.co.z for v in bm.verts]
        cx = (min(xs) + max(xs)) / 2
        cy = min(ys)   # bottom/waterline anchor
        cz = (min(zs) + max(zs)) / 2
        for v in bm.verts:
            v.co.x = cx + (v.co.x - cx) * 0.5
            v.co.y = cy + (v.co.y - cy) * 0.5  # shrinks upward, base stays
            v.co.z = cz + (v.co.z - cz) * 0.5
        bm.to_mesh(mesh)
        bm.free()
        mesh.update()
        print(f"  Part {i} scaled from bottom-center (cy={cy:.2f})")

    objects.append(obj)

# Join all parts
bpy.ops.object.select_all(action='DESELECT')
for o in objects:
    o.select_set(True)
bpy.context.view_layer.objects.active = objects[0]
bpy.ops.object.join()

bpy.ops.export_scene.gltf(
    filepath=OUT, export_format='GLB',
    use_selection=False,
    export_normals=True, export_apply=True,
    export_vertex_color='MATERIAL',
)
print(f"✓ Exported: {OUT}")
