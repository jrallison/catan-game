#!/usr/bin/env python3
"""Analyze land tile STLs to find the circular depression for number tokens."""

import struct, sys, os
from collections import defaultdict

def read_stl(path):
    with open(path, 'rb') as f:
        f.read(80)  # header
        n = struct.unpack('<I', f.read(4))[0]
        triangles = []
        for _ in range(n):
            normal = struct.unpack('<fff', f.read(12))
            verts = [struct.unpack('<fff', f.read(12)) for _ in range(3)]
            f.read(2)  # attribute
            triangles.append((normal, verts))
    return triangles

def analyze_tile(path):
    name = os.path.basename(path)
    triangles = read_stl(path)
    
    # Collect all vertices
    all_verts = []
    for normal, verts in triangles:
        for v in verts:
            all_verts.append(v)
    
    # In raw STL: X, Y are horizontal, Z is height
    xs = [v[0] for v in all_verts]
    ys = [v[1] for v in all_verts]
    zs = [v[2] for v in all_verts]
    
    print(f"\n{'='*60}")
    print(f"File: {name}")
    print(f"Triangles: {len(triangles)}")
    print(f"X range: {min(xs):.3f} to {max(xs):.3f}")
    print(f"Y range: {min(ys):.3f} to {max(ys):.3f}")
    print(f"Z range: {min(zs):.3f} to {max(zs):.3f}")
    
    z_min = min(zs)
    z_max = max(zs)
    z_range = z_max - z_min
    
    # Strategy: Find flat-normal triangles (normal pointing up, nz ≈ 1)
    # at a Z height between base and terrain max
    # The depression should be a cluster of upward-facing triangles at a specific Z level
    
    # Collect upward-facing triangles (normal Z > 0.9) and their Z heights
    flat_tris = []
    for normal, verts in triangles:
        nz = normal[2]
        if nz > 0.9:  # upward-facing
            avg_z = sum(v[2] for v in verts) / 3
            flat_tris.append((avg_z, verts, normal))
    
    # Histogram of flat triangle Z heights
    z_bucket_size = z_range * 0.005
    z_buckets = defaultdict(list)
    for avg_z, verts, normal in flat_tris:
        bucket = round(avg_z / z_bucket_size) * z_bucket_size
        z_buckets[bucket].append((verts, normal))
    
    print(f"\nFlat (upward-facing) triangles: {len(flat_tris)}")
    print(f"\nZ height histogram of flat triangles (top 15):")
    sorted_buckets = sorted(z_buckets.items(), key=lambda x: -len(x[1]))
    for z_val, tris in sorted_buckets[:15]:
        # Compute XY centroid of this bucket
        all_x = []
        all_y = []
        for verts, _ in tris:
            for v in verts:
                all_x.append(v[0])
                all_y.append(v[1])
        cx = sum(all_x) / len(all_x)
        cy = sum(all_y) / len(all_y)
        x_span = max(all_x) - min(all_x)
        y_span = max(all_y) - min(all_y)
        rel_z = (z_val - z_min) / z_range * 100
        print(f"  Z={z_val:8.3f} ({rel_z:5.1f}%): {len(tris):4d} tris, "
              f"centroid=({cx:.2f}, {cy:.2f}), span=({x_span:.2f}, {y_span:.2f})")
    
    # The depression is likely:
    # - Not at the base (Z ≈ z_min)
    # - Not at the very top
    # - A cluster of moderate count with a small, circular footprint
    # - Located off-center
    
    # Let's look for a flat circular region that's NOT the base
    # Filter: Z > z_min + 10% of range AND Z < z_max - 10% of range
    # Then find a tight cluster
    
    print(f"\n--- Searching for depression ---")
    
    # Try a different approach: look for flat regions at specific Z heights
    # that form a compact circular area
    candidate_buckets = []
    for z_val, tris in sorted_buckets:
        rel_z = (z_val - z_min) / z_range
        # Skip base and very top
        if rel_z < 0.05 or rel_z > 0.95:
            continue
        if len(tris) < 5:  # need enough triangles to form a surface
            continue
        
        all_x = []
        all_y = []
        for verts, _ in tris:
            for v in verts:
                all_x.append(v[0])
                all_y.append(v[1])
        
        cx = sum(all_x) / len(all_x)
        cy = sum(all_y) / len(all_y)
        x_span = max(all_x) - min(all_x)
        y_span = max(all_y) - min(all_y)
        
        # A circular depression should have similar X and Y spans
        # and be relatively compact compared to the full tile
        max_horiz = max(max(xs) - min(xs), max(ys) - min(ys))
        compactness = max(x_span, y_span) / max_horiz
        circularity = min(x_span, y_span) / max(x_span, y_span) if max(x_span, y_span) > 0 else 0
        
        candidate_buckets.append({
            'z': z_val,
            'rel_z': rel_z,
            'count': len(tris),
            'cx': cx,
            'cy': cy,
            'x_span': x_span,
            'y_span': y_span,
            'compactness': compactness,
            'circularity': circularity,
        })
    
    # Sort by circularity and compactness - we want circular, compact regions
    # that are off-center
    tile_cx = (min(xs) + max(xs)) / 2
    tile_cy = (min(ys) + max(ys)) / 2
    
    for c in candidate_buckets:
        offset = ((c['cx'] - tile_cx)**2 + (c['cy'] - tile_cy)**2)**0.5
        c['offset'] = offset
    
    # Score: prefer circular, compact, off-center, moderate triangle count
    for c in candidate_buckets:
        score = c['circularity'] * (1 - c['compactness']) * min(c['count'], 50) / 50
        if c['compactness'] < 0.05 or c['compactness'] > 0.5:
            score *= 0.1  # too small or too large
        c['score'] = score
    
    candidate_buckets.sort(key=lambda x: -x['score'])
    
    print(f"\nTop depression candidates:")
    for c in candidate_buckets[:10]:
        print(f"  Z={c['z']:.3f} ({c['rel_z']*100:.1f}%), {c['count']} tris, "
              f"centroid=({c['cx']:.2f}, {c['cy']:.2f}), "
              f"span=({c['x_span']:.2f}, {c['y_span']:.2f}), "
              f"compact={c['compactness']:.3f}, circ={c['circularity']:.3f}, "
              f"offset={c['offset']:.2f}, score={c['score']:.4f}")
    
    # Also try merging adjacent Z buckets for the depression
    # The depression floor might span 2-3 adjacent buckets
    print(f"\n--- Merged bucket analysis ---")
    # Sort flat_tris by Z
    flat_tris.sort(key=lambda x: x[0])
    
    # Group into Z layers with a tolerance
    tolerance = z_range * 0.01  # 1% of total height
    layers = []
    current_layer = [flat_tris[0]]
    for ft in flat_tris[1:]:
        if abs(ft[0] - current_layer[-1][0]) < tolerance:
            current_layer.append(ft)
        else:
            layers.append(current_layer)
            current_layer = [ft]
    layers.append(current_layer)
    
    print(f"Found {len(layers)} Z-layers")
    for layer in layers:
        if len(layer) < 10:
            continue
        avg_z = sum(ft[0] for ft in layer) / len(layer)
        rel_z = (avg_z - z_min) / z_range
        if rel_z < 0.05 or rel_z > 0.95:
            continue
        
        all_x = []
        all_y = []
        for _, verts, _ in layer:
            for v in verts:
                all_x.append(v[0])
                all_y.append(v[1])
        
        cx = sum(all_x) / len(all_x)
        cy = sum(all_y) / len(all_y)
        x_span = max(all_x) - min(all_x)
        y_span = max(all_y) - min(all_y)
        
        max_horiz = max(max(xs) - min(xs), max(ys) - min(ys))
        compactness = max(x_span, y_span) / max_horiz
        
        # Estimate radius: average distance from centroid
        dists = []
        for _, verts, _ in layer:
            for v in verts:
                d = ((v[0] - cx)**2 + (v[1] - cy)**2)**0.5
                dists.append(d)
        avg_radius = sum(dists) / len(dists)
        max_radius = max(dists)
        
        offset_from_center = ((cx - tile_cx)**2 + (cy - tile_cy)**2)**0.5
        
        print(f"  Layer Z≈{avg_z:.3f} ({rel_z*100:.1f}%): {len(layer)} tris, "
              f"centroid=({cx:.2f}, {cy:.2f}), "
              f"span=({x_span:.2f}, {y_span:.2f}), "
              f"compact={compactness:.3f}, "
              f"avg_r={avg_radius:.2f}, max_r={max_radius:.2f}, "
              f"off_center={offset_from_center:.2f}")
    
    return {
        'x_range': (min(xs), max(xs)),
        'y_range': (min(ys), max(ys)),
        'z_range': (min(zs), max(zs)),
        'tile_cx': tile_cx,
        'tile_cy': tile_cy,
    }

# Analyze multiple tile types
asset_dir = os.path.join(os.path.dirname(__file__), '..', 'public', 'assets')

tiles_to_check = ['desert.stl', 'wheet.stl', 'wood.stl', 'brick.stl', 'ore.stl', 'wool.stl']
results = {}
for tile_name in tiles_to_check:
    path = os.path.join(asset_dir, tile_name)
    if os.path.exists(path):
        results[tile_name] = analyze_tile(path)

# Summary
print("\n" + "="*60)
print("SUMMARY")
print("="*60)
for name, r in results.items():
    max_horiz = max(r['x_range'][1] - r['x_range'][0], r['y_range'][1] - r['y_range'][0])
    scale = 4.2 / max_horiz
    print(f"\n{name}: scale_factor = 4.2 / {max_horiz:.3f} = {scale:.6f}")
    print(f"  Tile center (raw STL): ({r['tile_cx']:.3f}, {r['tile_cy']:.3f})")
