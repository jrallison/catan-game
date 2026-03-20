# COORDINATE_CONVENTIONS.md — Catan 3D Game

**Cross-project conventions** (Blender pipeline, material standard, color pipeline, asset inspection, standing rules) live in Fairway's shared reference:
`~/.openclaw/agents/fairway/workspace/references/3D_GAME_CONVENTIONS.md`

This file contains **Catan-specific** values only.

---

## Coordinate System

- **Engine:** Babylon.js — **Y-up**, left-handed
- **Units:** 1 world unit ≈ (no physical equivalent — board scale only)
- **Board plane:** X-Z horizontal, Y = height
- **Origin:** Center of the hex board

## Camera (default)

```typescript
ArcRotateCamera: alpha=0, beta=0.3, radius=25, target=origin
```

- `alpha=0` → camera sits on the **+X axis**, looking toward origin
- `beta=0.3` → slightly off top-down (~17° from vertical)
- **Screen right** = world **-Z**
- **Screen up** ≈ world **-X** (approximately, at beta=0.3)

This orientation affects texture UV mapping on horizontal discs — see Token section below.

## Blender → GLTF → Babylon Pipeline

**Critical:** Blender exports GLTF with `Blender_Y → GLTF_-Z` axis mapping. This negates Z on all geometry.

**Fix applied in `tileRenderer.ts` for every GLB load:**
1. Negate Z positions: `positions[i+2] = -positions[i+2]`
2. Negate Z normals: `normals[i+2] = -normals[i+2]`
3. Swap winding order: swap `indices[i+1]` ↔ `indices[i+2]` per triangle
4. Recompute normals via `VertexData.ComputeNormals()`
5. Negate all recomputed normals — the Z-negation + winding swap produces inward-facing normals from `ComputeNormals`; negation restores correct outward-facing normals for proper lighting
6. `mat.backFaceCulling = false` — required; our Z-negation pipeline leaves screen-space winding inverted, so `true` would GPU-cull visible surfaces

**Do NOT apply this fix in Blender — it lives in the loader.**

## Hex Tile Orientation

- **Land tiles** (ore, wheat, brick, wood, wool, desert): **flat-top** hexagons as exported
- **Water/harbor tiles**: also **flat-top** as exported from current STL files
- No runtime Y rotation is applied to any tile — orientation is canonical in the GLB

If new STL source files produce pointy-top water tiles, fix it in `add_vertex_colors.py` via `TILE_ROTATION_DEG`, not in `tileRenderer.ts`.

## Asset Conventions

**Before writing any mesh loading code for a new asset:**
1. Run a diagnostic: dump node tree, mesh names, vertex counts, connected components
2. Document the structure before writing a single line of loader code

**Template diagnostic (Blender headless):**
```python
import bpy
bpy.ops.wm.stl_import(filepath="path/to/file.stl")
obj = bpy.context.selected_objects[0]
print(f"Vertices: {len(obj.data.vertices)}, Faces: {len(obj.data.polygons)}")
# bbox
xs = [v.co.x for v in obj.data.vertices]
print(f"X: [{min(xs):.2f}, {max(xs):.2f}]")
```

## Color Pipeline

```
Designer hex (#FF6600)
  → hex_to_srgb() — raw sRGB float (0-1), NO gamma conversion
  → BYTE_COLOR attribute (Blender stores sRGB, handles conversion on export)
  → GLTF vertex colors (linear float, Blender converts on export)
  → Babylon StandardMaterial useVertexColors
  → Screen (gamma-corrected by engine)
```

**Do NOT use `hex_to_linear()` with `BYTE_COLOR`** — BYTE_COLOR is already sRGB, double-converting makes colors dark.

**Palette source:** `Color-composition.pdf` by Dakanzla — exact RGB values pixel-sampled from swatches, stored in `scripts/add_vertex_colors.py`.

## Material Standard (Tiles)

Tiles use **`StandardMaterial`** — NOT PBRMaterial.

```typescript
mat.diffuseColor  = Color3.White()          // vertex colors drive diffuse
mat.emissiveColor = new Color3(0.35, 0.35, 0.35)  // floor lift — prevents dark crush
mat.specularColor = Color3.Black()          // no specular highlights
mat.disableLighting = false                 // lighting ON for 3D depth
mat.backFaceCulling = true                  // correct outward normals produced by Z-negation + winding swap + ComputeNormals pipeline. Do NOT set to false; it causes back faces to receive incorrect lighting.
```

**Why not PBR:** PBR energy conservation darkens stylized colors by design. This is a board game, not a photorealistic scene.

**Why emissive 0.35:** Prevents shadowed faces from going too dark while keeping lighting variation visible (tree depth, rock detail, etc.). Tune this constant if overall brightness is wrong — do not change the material type.

**PBR is opt-in only** — requires explicit PM sign-off.

## Number Token Texture Orientation

Token face disc (`CreateDisc`) uses `rotation.x = -Math.PI/2` to lay flat (normal = +Y).

After this rotation:
- Texture U = world X
- Texture V = world +Z

From camera at `alpha=0, beta=0.3`:
- World +Z appears as screen **right**
- Text drawn normally in canvas reads **sideways**

Fix: `ctx.rotate(TOKEN_CANVAS_ROTATION)` = `-Math.PI/2` before drawing text.

**Constant:** `TOKEN_CANVAS_ROTATION = -Math.PI / 2` in `src/numberToken.ts`

**If camera default alpha changes significantly, recalibrate this value.**

---

*Created: 2026-03-20. Update this file whenever a coordinate, material, or pipeline convention changes.*
