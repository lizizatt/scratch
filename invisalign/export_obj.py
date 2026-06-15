"""Convert downloaded Invisalign CTM meshes to OBJ files."""
import argparse
import json
import os
from pathlib import Path

import openctm
import trimesh


def ctm_to_mesh(path: Path) -> trimesh.Trimesh:
    with path.open("rb") as f:
        data = openctm.load_ctm(f)
    return trimesh.Trimesh(**data)


def quat_to_matrix(q):
    x, y, z, w = q
    return trimesh.transformations.quaternion_matrix([w, x, y, z])


def apply_transform(mesh: trimesh.Trimesh, position, rotation, basis=None):
    t = trimesh.transformations.translation_matrix(position)
    r = quat_to_matrix(rotation)
    m = trimesh.transformations.concatenate_matrices(t, r)
    if basis is not None:
        b = trimesh.transformations.translation_matrix(basis)
        m = trimesh.transformations.concatenate_matrices(m, b)
    return mesh.copy().apply_transform(m)


def export_meshes(mesh_dir: Path, out_dir: Path, apply_scene_transforms: bool):
    out_dir.mkdir(parents=True, exist_ok=True)
    scene_path = mesh_dir / "scene.json"
    scene = json.loads(scene_path.read_text(encoding="utf-8")) if scene_path.exists() else None

    jaw_pair = None
    jaws = {}
    teeth = {}
    if scene:
        for obj in scene.get("sceneObjects", []):
            name = obj.get("name")
            if name == "JawPair":
                jaw_pair = obj
            elif name in ("Lower Jaw", "Upper Jaw"):
                jaws[name] = obj
            elif name and name.startswith("Tooth_"):
                teeth[name] = obj

    combined = []
    for ctm_path in sorted(mesh_dir.glob("*.ctm")):
        mesh = ctm_to_mesh(ctm_path)
        stem = ctm_path.stem

        if apply_scene_transforms and scene:
            tooth_name = stem.replace(" ", "_")
            if tooth_name in teeth:
                tooth = teeth[tooth_name]
                jaw_name = tooth.get("parent")
                jaw = jaws.get(jaw_name, {})
                jaw_rot = jaw.get("rotation", [0, 0, 0, 1])
                jaw_pos = jaw.get("position", [0, 0, 0])
                pair_rot = jaw_pair.get("rotation", [0, 0, 0, 1]) if jaw_pair else [0, 0, 0, 1]
                pair_pos = jaw_pair.get("position", [0, 0, 0]) if jaw_pair else [0, 0, 0]

                mesh = apply_transform(mesh, tooth.get("position", [0, 0, 0]), tooth.get("rotation", [0, 0, 0, 1]), tooth.get("basis"))
                mesh = apply_transform(mesh, jaw_pos, jaw_rot)
                mesh = apply_transform(mesh, pair_pos, pair_rot)
            elif stem.startswith("Gingiva"):
                jaw_name = "Lower Jaw" if "Lower" in stem else "Upper Jaw"
                jaw = jaws.get(jaw_name, {})
                mesh = apply_transform(mesh, jaw.get("position", [0, 0, 0]), jaw.get("rotation", [0, 0, 0, 1]))
                if jaw_pair:
                    mesh = apply_transform(mesh, jaw_pair.get("position", [0, 0, 0]), jaw_pair.get("rotation", [0, 0, 0, 1]))

        obj_path = out_dir / f"{stem}.obj"
        mesh.export(obj_path)
        combined.append(mesh)
        print(f"Wrote {obj_path.name} ({len(mesh.vertices)} verts)")

    if combined:
        merged = trimesh.util.concatenate(combined)
        merged_path = out_dir / "full_scan.obj"
        merged.export(merged_path)
        stl_path = out_dir / "full_scan.stl"
        merged.export(stl_path)
        print(f"Wrote combined {merged_path.name} and {stl_path.name}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--mesh-dir",
        default=str(Path(__file__).resolve().parent / "meshes"),
        help="Directory containing extracted CTM files",
    )
    parser.add_argument(
        "--out-dir",
        default=str(Path(__file__).resolve().parent / "obj"),
        help="Output directory for OBJ/STL files",
    )
    parser.add_argument(
        "--transform",
        action="store_true",
        help="Apply scene.json transforms (approximate viewer pose)",
    )
    args = parser.parse_args()
    export_meshes(Path(args.mesh_dir), Path(args.out_dir), args.transform)


if __name__ == "__main__":
    main()
