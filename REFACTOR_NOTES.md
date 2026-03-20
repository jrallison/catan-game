# Tile Renderer Refactor Notes

## STL Loader Gotchas (Babylon.js)

These were discovered through debugging and are now documented in `src/tileRenderer.ts`:

1. **Non-updatable geometry.** The Babylon.js STL loader creates vertex buffers that are non-updatable. `updateVerticesData()` silently fails — no error thrown, no data changed. The workaround is to read raw vertex data, transform it in JS, then apply to a new mesh via `VertexData.applyToMesh(mesh, true)`.

2. **Automatic Z-up → Y-up conversion.** The STL format uses Z-up; Babylon uses Y-up. The loader handles this conversion automatically. After import, X/Z are horizontal and Y is vertical. No manual rotation needed for land tiles.

3. **Pointy-top vs flat-top hex orientation.** Water and harbor STL files are modeled as pointy-top hexagons. The board layout expects flat-top. A 30° Y rotation must be baked into vertex data for water/harbor tiles.

4. **Off-center geometry.** Some STLs (wood.stl, water.stl) are not centered at origin. Centering must be computed from actual vertex bounds — never assumed.

## Why VertexData Baking?

The "bake all transforms into vertex data" approach is the correct solution because:

- STL loader meshes have **non-updatable buffers** (gotcha #1)
- We need to apply rotation, scale, and centering *before* placement
- Baking into vertex data means each clone starts with clean identity transforms
- Position is the only thing that varies per instance, making placement trivial

The alternative (setting `mesh.rotation`, `mesh.scaling`, `mesh.position` at runtime) doesn't work reliably because the STL geometry offsets and orientations would compound with scene transforms.

## Code Structure

```
tileRenderer.ts
├── Constants          — tile diameter, rotation angles, colors, STL map, material params
├── Utility            — hexColorToColor3, isWaterType
├── Geometry Pipeline  — load STL → find geometry → rotate → bounds → scale/center → bake
├── Material Pipeline  — PBR material creation and caching
├── Placement          — clone template → position on board
└── Public API         — renderTiles()
```

## Future Extension Points

### Per-instance Y rotation (visual variety)
Add `instance.rotation.y = someAngle` in `placeTileInstance()` after cloning. The baked geometry is orientation-neutral within its tile type, so any Y spin is purely cosmetic. The function signature is already set up for this — just add a rotation parameter or random angle.

### New tile types
Add entries to `TILE_COLORS`, `TILE_STL_MAP`, and optionally `TILE_Y_ROTATION`. The pipeline handles everything else automatically.

### Per-type scale overrides
Add a `Partial<Record<TileType, number>>` scale map (like `TILE_Y_ROTATION`), and use it in `loadTemplateMesh` to override `TARGET_TILE_DIAMETER`.

### Texture support
Replace `hexColorToColor3` usage in `getOrCreateMaterial` with texture loading. The material cache already supports per-type materials.
