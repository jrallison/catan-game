#!/usr/bin/env python3
"""Extract exact depression center from all land tile STLs."""

import struct, os, math

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

for tile_name in ['desert.stl', 'wheet.stl', 'wood.stl', 'brick.stl', 'ore.stl', 'wool.stl']:
    path = os.path.join(asset_dir, tile_name)
    triangles = read_stl(path)
    
    # Get tile bounds
    all_xs, all_ys, all_zs = [], [], []
    for _, verts in triangles:
        for v in verts:
            all_xs.append(v[0]); all_ys.append(v[1]); all_zs.append(v[2])
    
    tile_cx = (min(all_xs) + max(all_xs)) / 2
    tile_cy = (min(all_ys) + max(all_ys)) / 2
    max_horiz = max(max(all_xs) - min(all_xs), max(all_ys) - min(all_ys))
    scale = 4.2 / max_horiz
    
    # Find vertices at Z≈2.4 (tolerance 0.3) from upward-facing triangles
    depression_verts = set()
    for normal, verts in triangles:
        if normal[2] < 0.95:
            continue
        for v in verts:
            if 2.0 < v[2] < 2.7:
                depression_verts.add((round(v[0], 2), round(v[1], 2), round(v[2], 2)))
    
    if not depression_verts:
        # Desert might have it at a slightly different Z
        # Try broader range
        for normal, verts in triangles:
            if normal[2] < 0.95:
                continue
            for v in verts:
                if 2.0 < v[2] < 3.0:
                    depression_verts.add((round(v[0], 2), round(v[1], 2), round(v[2], 2)))
    
    if depression_verts:
        # Check if there's a distinct cluster of verts at a specific Z
        # that form a circle (not the broad terrain)
        z_vals = sorted(set(v[2] for v in depression_verts))
        
        # Group verts by Z
        for z in z_vals:
            z_verts = [(v[0], v[1]) for v in depression_verts if v[2] == z]
            if len(z_verts) < 10:
                continue
            cx = sum(v[0] for v in z_verts) / len(z_verts)
            cy = sum(v[1] for v in z_verts) / len(z_verts)
            x_span = max(v[0] for v in z_verts) - min(v[0] for v in z_verts)
            y_span = max(v[1] for v in z_verts) / 1 - min(v[1] for v in z_verts)
            
            # Skip terrain-spanning groups
            if x_span > 40 or y_span > 40:
                continue
            
            dists = [math.sqrt((v[0]-cx)**2 + (v[1]-cy)**2) for v in z_verts]
            max_r = max(dists)
            avg_r = sum(dists) / len(dists)
            
            # Compute offset from tile center
            offset_raw_x = cx - tile_cx
            offset_raw_y = cy - tile_cy
            
            # World coords (after Babylon Z→Y swap):
            # STL X → Babylon X, STL Y → Babylon Z, STL Z → Babylon Y
            world_off_x = offset_raw_x * scale
            world_off_z = offset_raw_y * scale
            world_y = z * scale  # depression surface height
            world_radius = max_r * scale
            
            print(f"{tile_name}: Z={z:.2f}, {len(z_verts)} verts")
            print(f"  Raw centroid: ({cx:.2f}, {cy:.2f})")
            print(f"  Raw offset from tile center: ({offset_raw_x:.2f}, {offset_raw_y:.2f})")
            print(f"  Max radius (raw): {max_r:.2f}")
            print(f"  ALL verts (sorted by angle):")
            
            # Sort by angle from centroid
            sorted_v = sorted(z_verts, key=lambda v: math.atan2(v[1]-cy, v[0]-cx))
            for v in sorted_v:
                d = math.sqrt((v[0]-cx)**2 + (v[1]-cy)**2)
                print(f"    ({v[0]:8.2f}, {v[1]:8.2f})  r={d:.2f}")
            
            print(f"  World offset (x, y, z): ({world_off_x:.4f}, {world_y:.4f}, {world_off_z:.4f})")
            print(f"  World radius: {world_radius:.4f}")
            print()
