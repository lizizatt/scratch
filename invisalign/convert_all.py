"""Convert Invisalign CTM meshes to OBJ without trimesh."""
import subprocess
import sys
from pathlib import Path

MESH_DIR = Path(__file__).resolve().parent / "meshes"
OUT_DIR = Path(__file__).resolve().parent / "obj"

SNIPPET = """
import openctm
from pathlib import Path

def write_obj(out_path, vertices, faces):
    lines = ['o ' + out_path.stem]
    for row in vertices:
        lines.append('v %s %s %s' % (row[0], row[1], row[2]))
    for a, b, c in faces:
        lines.append('f %d %d %d' % (a + 1, b + 1, c + 1))
    out_path.write_text('\\n'.join(lines) + '\\n', encoding='ascii')

p = Path({path!r})
with p.open('rb') as f:
    data = openctm.load_ctm(f)
vertices = data['vertices']
faces = data['faces']
out = Path({out!r})
out.parent.mkdir(parents=True, exist_ok=True)
write_obj(out, vertices, faces)
print(len(vertices), len(faces))
"""


def convert_one(ctm, out, retries=3):
    code = SNIPPET.format(path=str(ctm), out=str(out))
    last_err = ""
    for _ in range(retries):
        result = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True)
        if result.returncode == 0:
            return result.stdout.strip(), ""
        last_err = result.stderr.strip()
    return "", last_err


def merge_obj_files(obj_dir: Path, merged_path: Path):
    parts = []
    vertex_offset = 0
    for obj in sorted(obj_dir.glob("*.obj")):
        if obj.name == merged_path.name:
            continue
        text = obj.read_text(encoding="ascii").splitlines()
        verts = []
        faces = []
        for line in text:
            if line.startswith("v "):
                verts.append(line)
            elif line.startswith("f "):
                idx = line.split()[1:]
                faces.append(
                    "f "
                    + " ".join(str(int(token.split("/")[0]) + vertex_offset) for token in idx)
                )
        parts.extend(verts)
        parts.extend(faces)
        vertex_offset += len(verts)
    merged_path.write_text("\n".join(parts) + "\n", encoding="ascii")


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    ctm_files = sorted(MESH_DIR.glob("*.ctm"))
    if not ctm_files:
        print(f"No CTM files in {MESH_DIR}", file=sys.stderr)
        return 1

    failed = []
    for ctm in ctm_files:
        safe = ctm.stem.replace(" ", "_")
        out = OUT_DIR / f"{safe}.obj"
        stats, err = convert_one(ctm, out)
        if err:
            failed.append((ctm.name, err))
            print(f"FAILED {ctm.name}: {err}", file=sys.stderr)
        else:
            print(f"Wrote {out.name} ({stats} verts/faces)")

    if failed:
        print(f"\n{len(failed)} files failed.", file=sys.stderr)
        return 1

    merged = OUT_DIR / "full_scan.obj"
    merge_obj_files(OUT_DIR, merged)
    print(f"\nMerged scan: {merged}")
    print(f"Done. {len(ctm_files)} OBJ files in {OUT_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
