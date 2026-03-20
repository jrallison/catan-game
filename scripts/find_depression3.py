#!/usr/bin/env python3
"""Deep-dive into depression geometry. Look at actual vertex positions at Z≈2.4."""

import struct, os, math
from collections import defaultdict

def read_stl(path):
    with open(path, 'rb') as f:
        f.read(80)
        n = struct.unpack('<I', f.read(4))[0]
        triangles = []
        for _ in range(n):
            normal = struct.unpack('<fff', f.read(12))
            verts = [struct.unpack('<fff', f.read(12)) for _ in range(3)]
            f.read(2)
            triangles.append((normal, verts))
    return triangles

asset_dir = os.path.join(os.path.dirname(__file__), '..', 'public', 'assets')

# For each tile, find ALL distinct flat surfaces at specific Z heights
for tile_name in ['desert.stl', 'brick.stl', 'wheet.stl']:
    path = os.path.join(asset_dir, tile_name)
    triangles = read_stl(path)
    
    all_xs = []
    all_ys = []
    all_zs = []
    for _, verts in triangles:
        for v in verts:
            all_xs.append(v[0])
            all_ys.append(v[1])
            all_zs.append(v[2])
    
    tile_cx = (min(all_xs) + max(all_xs)) / 2
    tile_cy = (min(all_ys) + max(all_ys)) / 2
    
    print(f"\n{'='*60}")
    print(f"{tile_name}")
    print(f"Bounds: X=[{min(all_xs):.1f}, {max(all_xs):.1f}], Y=[{min(all_ys):.1f}, {max(all_ys):.1f}], Z=[{min(all_zs):.3f}, {max(all_zs):.3f}]")
    print(f"Center: ({tile_cx:.1f}, {tile_cy:.1f})")
    
    # For each upward-facing triangle, record its Z height and position
    # Group into very tight Z bins (0.01 tolerance)
    upward_tris = []
    for normal, verts in triangles:
        if normal[2] > 0.99:  # strictly upward facing
            avg_z = sum(v[2] for v in verts) / 3
            avg_x = sum(v[0] for v in verts) / 3
            avg_y = sum(v[1] for v in verts) / 3
            upward_tris.append((avg_z, avg_x, avg_y, verts))
    
    # Group by Z with tight tolerance
    upward_tris.sort(key=lambda t: t[0])
    
    z_groups = []
    current = [upward_tris[0]]
    for t in upward_tris[1:]:
        if t[0] - current[-1][0] < 0.05:
            current.append(t)
        else:
            z_groups.append(current)
            current = [t]
    z_groups.append(current)
    
    print(f"\nZ-groups of strictly upward-facing (nz>0.99) triangles:")
    for group in z_groups:
        if len(group) < 5:
            continue
        avg_z = sum(t[0] for t in group) / len(group)
        xs = [t[1] for t in group]
        ys = [t[2] for t in group]
        cx = sum(xs) / len(xs)
        cy = sum(ys) / len(ys)
        x_span = max(xs) - min(xs)
        y_span = max(ys) - min(ys)
        
        # Is this compact or spread across the whole tile?
        max_horiz = max(max(all_xs) - min(all_xs), max(all_ys) - min(all_ys))
        is_compact = max(x_span, y_span) < max_horiz * 0.5
        
        # For compact regions, compute radius
        if is_compact:
            dists = [math.sqrt((t[1]-cx)**2 + (t[2]-cy)**2) for t in group]
            avg_r = sum(dists) / len(dists)
            marker = " ★ COMPACT"
        else:
            avg_r = 0
            marker = ""
        
        offset_from_center = math.sqrt((cx-tile_cx)**2 + (cy-tile_cy)**2)
        
        print(f"  Z≈{avg_z:.3f}: {len(group):4d} tris, "
              f"centroid=({cx:.1f}, {cy:.1f}), "
              f"span=({x_span:.1f}, {y_span:.1f}), "
              f"off_center={offset_from_center:.1f}"
              f"{f', avg_r={avg_r:.1f}' if avg_r else ''}"
              f"{marker}")
        
        # Print actual vertex positions for small compact groups
        if is_compact and len(group) <= 60:
            # Get unique vertices
            unique_verts = set()
            for _, _, _, verts in group:
                for v in verts:
                    unique_verts.add((round(v[0], 2), round(v[1], 2), round(v[2], 2)))
            print(f"    Unique vertices: {len(unique_verts)}")
            # Print a few
            sorted_verts = sorted(unique_verts)
            for v in sorted_verts[:5]:
                print(f"      ({v[0]:.2f}, {v[1]:.2f}, {v[2]:.2f})")
            if len(sorted_verts) > 5:
                print(f"      ... and {len(sorted_verts)-5} more")
