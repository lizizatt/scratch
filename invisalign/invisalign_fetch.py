"""Download Invisalign share viewer 3D assets.

Usage:
  python invisalign_fetch.py --share-id YOUR_ID --password 'your password'

Or set env vars INVISALIGN_SHARE_ID and INVISALIGN_PASSWORD.
"""
import argparse
import json
import os
import zipfile
import urllib.request

BASE = "https://share.invisalign.com"


def post_json(url, payload):
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))


def get_bytes(url):
    with urllib.request.urlopen(url) as resp:
        return resp.read(), resp.headers.get("Content-Type", "")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--share-id", default=os.environ.get("INVISALIGN_SHARE_ID"))
    parser.add_argument("--password", default=os.environ.get("INVISALIGN_PASSWORD"))
    parser.add_argument(
        "--out-dir",
        default=os.path.dirname(__file__),
    )
    args = parser.parse_args()
    if not args.share_id or not args.password:
        parser.error("Provide --share-id and --password (or env vars)")

    os.makedirs(args.out_dir, exist_ok=True)
    mesh_dir = os.path.join(args.out_dir, "meshes")
    os.makedirs(mesh_dir, exist_ok=True)

    home_url = f"{BASE}/clinical/v1/shared-treatment-plan/{args.share_id}"
    home = json.loads(urllib.request.urlopen(home_url).read().decode("utf-8"))
    access_href = next(a["href"] for a in home["actions"] if a["name"] == "access")
    result = post_json(access_href, {"password": args.password})

    for link in result.get("links", []):
        rel = link["rel"][0] if isinstance(link["rel"], list) else link["rel"]
        body, _ = get_bytes(link["href"])
        if rel == "treatment-plan-file":
            zip_path = os.path.join(args.out_dir, "treatment_plan_file.zip")
            with open(zip_path, "wb") as f:
                f.write(body)
            with zipfile.ZipFile(zip_path) as zf:
                zf.extractall(mesh_dir)
            print(f"Extracted {len(zf.namelist())} files to {mesh_dir}")
        else:
            out_path = os.path.join(args.out_dir, f"{rel.replace('-', '_')}.json")
            with open(out_path, "wb") as f:
                f.write(body)
            print(f"Saved {out_path}")

    print("\nNext: python convert_all.py")


if __name__ == "__main__":
    main()
