"""Address (California) -> STL from USGS 3DEP lidar (public AWS EPT).

pip install requests numpy scipy "laspy[lazrs]" pyproj shapely
python address_to_stl.py "Oakland City Hall, Oakland CA" -r 200 -o city_hall.stl
"""
import argparse
import io
import re
import struct
from concurrent.futures import ThreadPoolExecutor

import laspy
import numpy as np
import requests
from pyproj import CRS, Transformer
from scipy import ndimage
from shapely.geometry import Point, shape

UA = {"User-Agent": "address-to-stl/2.0"}
BOUNDARIES = "https://usgs.entwine.io/boundaries/resources.geojson"
VEG = {3, 4, 5}
NOISE = {7, 18}


def get(url, **kw):
    r = requests.get(url, headers=UA, timeout=60, **kw)
    r.raise_for_status()
    return r


def geocode(address):
    r = get("https://nominatim.openstreetmap.org/search",
            params={"q": address, "format": "json", "limit": 1}).json()
    if not r:
        raise SystemExit(f"Address not found: {address}")
    return float(r[0]["lat"]), float(r[0]["lon"])


def pick_project(lat, lon):
    pt = Point(lon, lat)
    hits = []
    for f in get(BOUNDARIES).json()["features"]:
        name = f["properties"]["name"]
        if shape(f["geometry"]).contains(pt):
            m = re.search(r"(20\d\d|19\d\d)$", name)
            hits.append((int(m.group(1)) if m else 0, f["properties"]["count"], name, f["properties"]["url"]))
    if not hits:
        raise SystemExit("No USGS 3DEP lidar coverage at this location")
    hits = [h for h in hits if h[1] > 1_000_000] or hits  # skip sparse legacy sets
    hits.sort(reverse=True)
    print("Using lidar project:", hits[0][2])
    return hits[0][3].rsplit("/", 1)[0]


class Ept:
    def __init__(self, base):
        self.base = base
        self.info = get(f"{base}/ept.json").json()
        self.span = self.info["span"]
        self.bounds = self.info["bounds"]
        srs = self.info["srs"]
        self.crs = CRS.from_wkt(srs["wkt"]) if srs.get("wkt") else CRS.from_epsg(int(srs["horizontal"]))
        self.unit = self.crs.axis_info[0].unit_conversion_factor  # native unit -> meters
        self.hier = {}

    def load_hier(self, key):
        self.hier.update(get(f"{self.base}/ept-hierarchy/{key}.json").json())

    def nodes(self, bbox, spacing_target):
        """Octree keys intersecting bbox (native units), descending to the needed density."""
        b = self.bounds
        width = b[3] - b[0]
        self.load_hier("0-0-0-0")
        out, stack = [], [(0, 0, 0, 0)]
        while stack:
            d, x, y, z = stack.pop()
            key = f"{d}-{x}-{y}-{z}"
            n = self.hier.get(key)
            if n is None:
                continue
            size = width / 2 ** d
            nx0, ny0 = b[0] + x * size, b[1] + y * size
            if nx0 > bbox[2] or nx0 + size < bbox[0] or ny0 > bbox[3] or ny0 + size < bbox[1]:
                continue
            if n == -1:
                self.load_hier(key)
                n = self.hier.get(key, 0)
            if n > 0:
                out.append(key)
            if size / self.span * self.unit > spacing_target:
                for dx in (0, 1):
                    for dy in (0, 1):
                        for dz in (0, 1):
                            stack.append((d + 1, 2 * x + dx, 2 * y + dy, 2 * z + dz))
        return out

    def points(self, key, bbox, keep_veg):
        raw = get(f"{self.base}/ept-data/{key}.laz").content
        las = laspy.read(io.BytesIO(raw))
        x, y, z = np.asarray(las.x), np.asarray(las.y), np.asarray(las.z)
        cls = np.asarray(las.classification)
        m = (x >= bbox[0]) & (x <= bbox[2]) & (y >= bbox[1]) & (y <= bbox[3])
        m &= ~np.isin(cls, list(NOISE | (set() if keep_veg else VEG)))
        return x[m], y[m], z[m]


def build_dsm(x, y, z, x0, y0, nx, ny, res):
    ix = np.clip(((x - x0) / res).astype(int), 0, nx - 1)
    iy = np.clip(((y - y0) / res).astype(int), 0, ny - 1)
    grid = np.full((ny, nx), -np.inf)
    np.maximum.at(grid, (iy, ix), z)
    empty = ~np.isfinite(grid)
    if empty.all():
        raise SystemExit("No lidar points in area")
    if empty.any():  # fill holes (water, shadows, removed trees) from nearest cell
        idx = ndimage.distance_transform_edt(empty, return_distances=False, return_indices=True)
        grid = grid[tuple(idx)]
    return grid


def write_stl(path, tris):
    normals = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0])
    normals /= np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-12)
    rec = np.zeros(len(tris), dtype=[("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")])
    rec["n"], rec["v"] = normals, tris
    with open(path, "wb") as f:
        f.write(b"address_to_stl".ljust(80, b"\0"))
        f.write(struct.pack("<I", len(tris)))
        f.write(rec.tobytes())


def heightfield_solid(h, cell, base):
    """Watertight solid: top surface from heights h (ny, nx), side walls, flat bottom at z=0."""
    ny, nx = h.shape
    X, Y = np.meshgrid(np.arange(nx) * cell, np.arange(ny) * cell)
    V = np.stack([X, Y, h + base], -1)
    a, b, c, d = V[:-1, :-1], V[:-1, 1:], V[1:, 1:], V[1:, :-1]
    tris = [np.stack([a, b, c], 2).reshape(-1, 3, 3), np.stack([a, c, d], 2).reshape(-1, 3, 3)]
    ctr = np.array([(nx - 1) * cell / 2, (ny - 1) * cell / 2, 0.0])

    def wall(edge):  # edge ordered counter-clockwise seen from above
        lo = edge.copy()
        lo[:, 2] = 0
        t1 = np.stack([edge[:-1], lo[:-1], lo[1:]], 1)
        t2 = np.stack([edge[:-1], lo[1:], edge[1:]], 1)
        fan = np.stack([np.broadcast_to(ctr, lo[:-1].shape), lo[1:], lo[:-1]], 1)
        return [t1, t2, fan]

    for edge in (V[0, :], V[:, -1], V[-1, ::-1], V[::-1, 0]):
        tris += wall(edge)
    return np.concatenate(tris)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("address")
    ap.add_argument("-r", "--radius", type=float, default=200, help="half-width in meters")
    ap.add_argument("-o", "--output", default="model.stl")
    ap.add_argument("--res", type=float, default=1.0, help="grid cell size in meters")
    ap.add_argument("--size", type=float, default=120, help="printed width in mm")
    ap.add_argument("--vscale", type=float, default=1.5, help="height exaggeration")
    ap.add_argument("--veg", action="store_true", help="keep trees/vegetation")
    a = ap.parse_args()

    lat, lon = geocode(a.address)
    print(f"Geocoded: {lat:.6f}, {lon:.6f}")
    ept = Ept(pick_project(lat, lon))
    cx, cy = Transformer.from_crs(4326, ept.crs, always_xy=True).transform(lon, lat)
    r = a.radius / ept.unit
    bbox = (cx - r, cy - r, cx + r, cy + r)

    keys = ept.nodes(bbox, a.res * 0.5)
    print(f"Downloading {len(keys)} lidar nodes...")
    with ThreadPoolExecutor(8) as ex:
        parts = list(ex.map(lambda k: ept.points(k, bbox, a.veg), keys))
    x = np.concatenate([p[0] for p in parts])
    y = np.concatenate([p[1] for p in parts])
    z = np.concatenate([p[2] for p in parts])
    print(f"{len(x):,} points")

    n = int(2 * a.radius / a.res)
    h = build_dsm(x, y, z, bbox[0], bbox[1], n, n, a.res / ept.unit)
    h = (h - h.min()) * ept.unit  # meters above lowest point
    s = a.size / (2 * a.radius)   # mm per meter
    tris = heightfield_solid(h * a.vscale * s, a.res * s, 2.0)
    write_stl(a.output, tris)
    print(f"Wrote {a.output}: {len(tris):,} triangles, {a.size:.0f} mm wide, "
          f"{h.max() * a.vscale * s + 2:.1f} mm tall")


if __name__ == "__main__":
    main()
