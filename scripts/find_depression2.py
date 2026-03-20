#!/usr/bin/env python3
"""Precisely locate the number token depression in each land tile STL."""

import struct, sys, os, math

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

def find_depression(path):
    """Find the flat circular depression in a tile STL.
    
    Strategy: Look for upward-facing triangles at Z≈2.4 that form a ~28-unit diameter circle.
    This feature is consistent across all land tile types.
    """
    name = os.path.basename(path)
    triangles = read_stl(path)
    
    # Collect all vertices for bounds
    all_xs = []
    all_ys = []
    for _, verts in triangles:
        for v in verts:
            all_xs.append(v[0])
            all_ys.append(v[1])
    
    tile_cx = (min(all_xs) + max(all_xs)) / 2
    tile_cy = (min(all_ys) + max(all_ys)) / 2
    max_horiz = max(max(all_xs) - min(all_xs), max(all_ys) - min(all_ys))
    scale = 4.2 / max_horiz
    
    # Collect upward-facing flat triangles with Z between 1.5 and 4.0
    # (depression is at Z≈2.4, below terrain surface at Z≈3-6)
    depression_verts = set()
    depression_tris = []
    
    for normal, verts in triangles:
        nz = normal[2]
        if nz < 0.95:  # must be strongly upward-facing
            continue
        avg_z = sum(v[2] for v in verts) / 3
        if avg_z < 1.5 or avg_z > 4.0:
            continue
        
        # Check if this triangle's vertices form a compact region
        # (not part of the broad terrain surface)
        depression_tris.append((avg_z, verts))
        for v in verts:
            depression_verts.add((round(v[0], 3), round(v[1], 3), round(v[2], 3)))
    
    # The depression vertices should cluster at a specific (x,y) with Z≈2.4
    # while the terrain vertices span the whole tile
    # Filter: find vertices where Z is distinctly below the majority
    
    # Get Z distribution of these flat vertices
    z_vals = [v[2] for v in depression_verts]
    z_vals.sort()
    
    # Find the depression Z: it's the lowest cluster of flat upward-facing triangles
    # above the base (base is at Z=0)
    # Use a gap-finding approach
    z_clusters = []
    current_cluster = [z_vals[0]]
    for z in z_vals[1:]:
        if z - current_cluster[-1] < 0.5:
            current_cluster.append(z)
        else:
            z_clusters.append(current_cluster)
            current_cluster = [z]
    z_clusters.append(current_cluster)
    
    # The depression cluster should be the one with the lowest average Z
    # that has a reasonable number of vertices
    print(f"\n{name}:")
    print(f"  Z clusters of flat upward-facing triangles (Z 1.5-4.0):")
    for i, cluster in enumerate(z_clusters):
        avg = sum(cluster) / len(cluster)
        print(f"    Cluster {i}: Z_avg={avg:.3f}, count={len(cluster)}, range={min(cluster):.3f}-{max(cluster):.3f}")
    
    # Now let's try a different approach: look specifically for the ~28-unit circle
    # Find all upward-facing triangles, group by Z, find the one forming a compact circle
    
    # Approach: for Z values between 1.0 and 3.5, collect vertices and check if they
    # form a compact circular region vs spanning the whole tile
    
    best_circle = None
    
    for z_target in [x * 0.1 for x in range(15, 35)]:
        z_tol = 0.2
        verts_in_range = []
        for normal, verts in triangles:
            if normal[2] < 0.95:
                continue
            for v in verts:
                if abs(v[2] - z_target) < z_tol:
                    verts_in_range.append(v)
        
        if len(verts_in_range) < 20:
            continue
        
        # Compute centroid
        cx = sum(v[0] for v in verts_in_range) / len(verts_in_range)
        cy = sum(v[1] for v in verts_in_range) / len(verts_in_range)
        
        # Compute span
        x_span = max(v[0] for v in verts_in_range) - min(v[0] for v in verts_in_range)
        y_span = max(v[1] for v in verts_in_range) - min(v[1] for v in verts_in_range)
        
        # Depression is ~28 units across. Check if span is in that ballpark
        # and if it's circular (similar x and y span)
        avg_span = (x_span + y_span) / 2
        if avg_span < 20 or avg_span > 35:
            continue
        circularity = min(x_span, y_span) / max(x_span, y_span)
        if circularity < 0.8:
            continue
        
        # Check if vertices are actually circular (not just rectangular bounds)
        # Compute average distance from centroid
        dists = [math.sqrt((v[0]-cx)**2 + (v[1]-cy)**2) for v in verts_in_range]
        avg_dist = sum(dists) / len(dists)
        max_dist = max(dists)
        
        # For a circular region, max_dist should be close to the radius
        # and avg_dist should be about 2/3 of max_dist
        if max_dist > 20:  # too big, probably includes terrain
            continue
        
        score = circularity * len(verts_in_range) / (max_dist - avg_dist + 1)
        
        if best_circle is None or score > best_circle['score']:
            best_circle = {
                'z': z_target,
                'cx': cx, 'cy': cy,
                'x_span': x_span, 'y_span': y_span,
                'avg_dist': avg_dist, 'max_dist': max_dist,
                'count': len(verts_in_range),
                'circularity': circularity,
                'score': score,
            }
    
    if best_circle:
        c = best_circle
        # Convert to world coords (after Babylon Z→Y swap and centering)
        # In Babylon: STL X → world X, STL Y → world Z, STL Z → world Y
        # After centering: offset from tile center
        world_offset_x = (c['cx'] - tile_cx) * scale
        world_offset_z = (c['cy'] - tile_cy) * scale  
        world_offset_y = c['z'] * scale  # depression height (Y in world)
        
        depression_radius_world = c['max_dist'] * scale
        
        print(f"  DEPRESSION FOUND:")
        print(f"    Raw STL centroid: ({c['cx']:.2f}, {c['cy']:.2f}, Z={c['z']:.2f})")
        print(f"    Span: ({c['x_span']:.2f}, {c['y_span']:.2f}), circularity={c['circularity']:.3f}")
        print(f"    Radius (raw): avg={c['avg_dist']:.2f}, max={c['max_dist']:.2f}")
        print(f"    Vertex count: {c['count']}")
        print(f"    Tile center (raw): ({tile_cx:.2f}, {tile_cy:.2f})")
        print(f"    Offset from tile center (raw): ({c['cx']-tile_cx:.2f}, {c['cy']-tile_cy:.2f})")
        print(f"    Scale factor: {scale:.6f}")
        print(f"    World offset (x, y, z): ({world_offset_x:.4f}, {world_offset_y:.4f}, {world_offset_z:.4f})")
        print(f"    Depression radius (world): {depression_radius_world:.4f}")
        
        return {
            'raw_cx': c['cx'], 'raw_cy': c['cy'], 'raw_z': c['z'],
            'raw_radius': c['max_dist'],
            'world_offset_x': world_offset_x,
            'world_offset_y': world_offset_y, 
            'world_offset_z': world_offset_z,
            'world_radius': depression_radius_world,
            'tile_cx': tile_cx, 'tile_cy': tile_cy,
            'scale': scale,
        }
    else:
        print(f"  NO DEPRESSION FOUND!")
        return None

# Analyze all land tiles
asset_dir = os.path.join(os.path.dirname(__file__), '..', 'public', 'assets')
tiles = ['desert.stl', 'wheet.stl', 'wood.stl', 'brick.stl', 'ore.stl', 'wool.stl']

results = {}
for tile_name in tiles:
    path = os.path.join(asset_dir, tile_name)
    if os.path.exists(path):
        results[tile_name] = find_depression(path)

# Check consistency
print("\n" + "="*60)
print("CONSISTENCY CHECK")
print("="*60)
if all(r is not None for r in results.values()):
    offsets_x = [r['world_offset_x'] for r in results.values()]
    offsets_z = [r['world_offset_z'] for r in results.values()]
    offsets_y = [r['world_offset_y'] for r in results.values()]
    radii = [r['world_radius'] for r in results.values()]
    
    raw_offsets = [(r['raw_cx'] - r['tile_cx'], r['raw_cy'] - r['tile_cy']) for r in results.values()]
    
    print(f"\nRaw offsets from tile center (X, Y):")
    for name, r in results.items():
        print(f"  {name}: ({r['raw_cx']-r['tile_cx']:.2f}, {r['raw_cy']-r['tile_cy']:.2f})")
    
    print(f"\nWorld offsets (X, Y, Z):")
    for name, r in results.items():
        print(f"  {name}: ({r['world_offset_x']:.4f}, {r['world_offset_y']:.4f}, {r['world_offset_z']:.4f})")
    
    print(f"\nWorld radii:")
    for name, r in results.items():
        print(f"  {name}: {r['world_radius']:.4f}")
    
    print(f"\nAverages:")
    print(f"  offset_x: {sum(offsets_x)/len(offsets_x):.4f}")
    print(f"  offset_y: {sum(offsets_y)/len(offsets_y):.4f}")
    print(f"  offset_z: {sum(offsets_z)/len(offsets_z):.4f}")
    print(f"  radius: {sum(radii)/len(radii):.4f}")
