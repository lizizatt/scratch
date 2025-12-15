#              .
#              |
#         .   ]#[   .
#          \_______/
#       .    ]LIZ[    .
#        \___________/
#     .     ]CLAUDE[     .
#      \_______________/
#   .      ]#######[      .
#    \___________________/
# .       ]#########[       .
#  \_____]##.-----.##[_____/
#   |__|__|_|     |_|__|__|
#   |__|__|_|_____|_|__|__|
#   ########/_____\########
#          |_______|
#         /_________\

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Tuple


RGB_PATTERN = re.compile(
    r"^(?P<scene_id>[0-9A-Z]+)_rgb_(?P<timestamp>[0-9\-]+)\.jpg$"
)
DEPTH_PATTERN = re.compile(
    r"^(?P<scene_id>[0-9A-Z]+)_depth_vis_(?P<timestamp>[0-9\-]+)\.png$"
)


@dataclass
class ImagePair:
    scene_id: str
    timestamp: str
    rgb_path: Path
    depth_path: Path


def discover_image_pairs(data_root: Path) -> List[ImagePair]:
    """Discover matching RGB / DEPTH image pairs based on the filename scheme.

    Naming scheme (from the provided dataset):
      - RGB:   <scene_id>_rgb_<timestamp>.jpg
      - DEPTH: <scene_id>_depth_vis_<timestamp>.png

    Example:
      - 14442C10D185D9D600_rgb_2025-09-30-15-51-47.jpg
      - 14442C10D185D9D600_depth_vis_2025-09-30-15-51-47.png
    """
    rgb_dir = data_root / "RGB"
    depth_dir = data_root / "DEPTH"

    rgb_index: Dict[Tuple[str, str], Path] = {}
    for p in rgb_dir.glob("*.jpg"):
        m = RGB_PATTERN.match(p.name)
        if not m:
            continue
        key = (m.group("scene_id"), m.group("timestamp"))
        rgb_index[key] = p

    depth_index: Dict[Tuple[str, str], Path] = {}
    for p in depth_dir.glob("*.png"):
        m = DEPTH_PATTERN.match(p.name)
        if not m:
            continue
        key = (m.group("scene_id"), m.group("timestamp"))
        depth_index[key] = p

    pairs: List[ImagePair] = []
    for key, rgb_path in rgb_index.items():
        if key not in depth_index:
            continue
        scene_id, timestamp = key
        pairs.append(
            ImagePair(
                scene_id=scene_id,
                timestamp=timestamp,
                rgb_path=rgb_path,
                depth_path=depth_index[key],
            )
        )

    return sorted(pairs, key=lambda p: (p.scene_id, p.timestamp))


def load_pair_images(pair: ImagePair) -> Tuple["np.ndarray", "np.ndarray"]:
    """Load RGB and depth images as numpy arrays."""
    import cv2
    import numpy as np

    rgb = cv2.imread(str(pair.rgb_path), cv2.IMREAD_COLOR)
    depth_vis = cv2.imread(str(pair.depth_path), cv2.IMREAD_GRAYSCALE)
    if rgb is None:
        raise RuntimeError(f"Failed to read RGB image: {pair.rgb_path}")
    if depth_vis is None:
        raise RuntimeError(f"Failed to read depth image: {pair.depth_path}")
    return rgb, depth_vis


def detect_cracks(rgb: "np.ndarray", depth_vis: "np.ndarray") -> "np.ndarray":
    """Stub: detect crack pixels.

    This is where you should experiment with:
      - filtering / denoising,
      - edge detection / ridge detection,
      - combining RGB + depth cues,
      - morphological ops to clean up the mask.

    For now, this returns an empty mask with the same height/width.
    """
    import numpy as np

    h, w = depth_vis.shape[:2]
    return np.zeros((h, w), dtype=np.uint8)


def plan_trajectory_from_mask(mask: "np.ndarray") -> List[Tuple[float, float, float]]:
    """Stub: convert a binary crack mask into a 3D XYZ gantry trajectory.

    You might:
      - skeletonize the mask to a 1-pixel-wide curve,
      - extract ordered polylines,
      - convert from pixel coordinates to gantry coordinates using your
        camera / robot assumptions.

    For now, we create a simple dummy trajectory: a straight line across the
    middle of the image at a fixed "height" in this RGBD space. When you
    implement this for real, you should output a sequence of (x, y, z)
    waypoints in gantry space that trace the crack(s) at the appropriate
    application height.
    """
    import numpy as np

    h, w = mask.shape[:2]
    num_points = 50
    xs = np.linspace(0, w - 1, num_points, dtype=float)
    y = float(h // 2)
    z = 128.0  # dummy "height" in depth units
    return [(float(x), y, z) for x in xs]


def rgbd_to_point_cloud(
    rgb: "np.ndarray", depth_vis: "np.ndarray", stride: int = 4
) -> Tuple["np.ndarray", "np.ndarray"]:
    """Convert RGB + 8-bit depth visualization into a simple 3D point cloud.

    We treat:
      - X = image column (u)
      - Y = image row (v)
      - Z = depth_vis intensity (0–255)

    This is not metrically accurate but is sufficient for debugging and
    visualization of fused RGBD structure.
    """
    import numpy as np

    h, w = depth_vis.shape[:2]
    ys, xs = np.mgrid[0:h:stride, 0:w:stride]
    zs = depth_vis[::stride, ::stride].astype(np.float32)

    xs = xs.astype(np.float32).ravel()
    ys = ys.astype(np.float32).ravel()
    zs = zs.ravel()

    points = np.stack([xs, ys, zs], axis=1)

    colors = rgb[::stride, ::stride, :].reshape(-1, 3).astype(np.float32) / 255.0
    return points, colors


def visualize_rgbd_and_trajectory(
    rgb: "np.ndarray",
    depth_vis: "np.ndarray",
    trajectory_xyz: List[Tuple[float, float, float]],
    out_path: Path | None = None,
    show: bool = False,
) -> None:
    """Visualize the fused RGBD point cloud and XYZ trajectory using matplotlib."""
    import matplotlib.pyplot as plt
    from mpl_toolkits.mplot3d import Axes3D  # noqa: F401  (needed for 3D)
    import numpy as np

    points, colors = rgbd_to_point_cloud(rgb, depth_vis, stride=4)

    fig = plt.figure(figsize=(8, 6))
    ax = fig.add_subplot(111, projection="3d")

    ax.scatter(
        points[:, 0],
        points[:, 1],
        points[:, 2],
        c=colors,
        s=1,
        depthshade=False,
    )

    if trajectory_xyz:
        traj = np.array(trajectory_xyz, dtype=float)
        ax.plot(traj[:, 0], traj[:, 1], traj[:, 2], color="red", linewidth=2)

    ax.set_xlabel("X (image column)")
    ax.set_ylabel("Y (image row)")
    ax.set_zlabel("Z (depth intensity)")
    ax.set_title("Fused RGBD point cloud with XYZ trajectory")
    ax.view_init(elev=60, azim=-60)

    if out_path is not None:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        fig.savefig(out_path, dpi=150, bbox_inches="tight")

    if show:
        plt.show()

    plt.close(fig)


def save_trajectory(
    out_dir: Path, pair: ImagePair, trajectory: List[Tuple[float, float, float]]
) -> None:
    """Save a simple JSON representation of the planned XYZ gantry trajectory."""
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{pair.scene_id}_{pair.timestamp}_trajectory.json"
    payload = {
        "scene_id": pair.scene_id,
        "timestamp": pair.timestamp,
        "rgb": str(pair.rgb_path),
        "depth": str(pair.depth_path),
        # XYZ gantry positions in robot gantry frame 
        "trajectory_xyz": trajectory,
    }
    out_path.write_text(json.dumps(payload, indent=2))


def run_pipeline(
    data_root: Path,
    output_dir: Path,
    limit: int | None = None,
    verbose: bool = True,
    do_viz: bool = False,
    viz_dir: Path | None = None,
) -> None:
    pairs = discover_image_pairs(data_root)
    if verbose:
        print(f"Discovered {len(pairs)} RGB/DEPTH pairs under {data_root}")

    if limit is not None:
        pairs = pairs[:limit]

    for i, pair in enumerate(pairs, start=1):
        if verbose:
            print(
                f"[{i}/{len(pairs)}] "
                f"scene_id={pair.scene_id} ts={pair.timestamp} "
                f"rgb={pair.rgb_path.name} depth={pair.depth_path.name}"
            )

        rgb, depth_vis = load_pair_images(pair)

        # TODO: insert your own preprocessing / visualization here.
        mask = detect_cracks(rgb, depth_vis)
        trajectory = plan_trajectory_from_mask(mask)
        save_trajectory(output_dir, pair, trajectory)

        if do_viz:
            viz_dir = viz_dir or (output_dir / "viz")
            viz_path = viz_dir / f"{pair.scene_id}_{pair.timestamp}_viz.png"
            visualize_rgbd_and_trajectory(rgb, depth_vis, trajectory, viz_path, show=False)


def interactive_view_pair(data_root: Path, index: int) -> None:
    """Open an interactive 3D viewer for a single image pair (1-based index)."""
    pairs = discover_image_pairs(data_root)
    if not pairs:
        print(f"No RGB/DEPTH pairs found under {data_root}")
        return

    if index < 1 or index > len(pairs):
        raise IndexError(
            f"interactive index {index} is out of range; "
            f"dataset has {len(pairs)} pairs (valid range: 1..{len(pairs)})"
        )

    pair = pairs[index - 1]
    print(
        f"Interactive view for index {index}/{len(pairs)}: "
        f"scene_id={pair.scene_id} ts={pair.timestamp} "
        f"rgb={pair.rgb_path.name} depth={pair.depth_path.name}"
    )

    rgb, depth_vis = load_pair_images(pair)
    mask = detect_cracks(rgb, depth_vis)
    trajectory = plan_trajectory_from_mask(mask)

    # No file output here; just pop up an interactive viewer.
    visualize_rgbd_and_trajectory(
        rgb, depth_vis, trajectory_xyz=trajectory, out_path=None, show=True
    )


def install_requirements(requirements_path: Path) -> None:
    """Install Python dependencies from a requirements.txt file.

    This uses the current Python interpreter: `python -m pip install -r ...`.
    """
    if not requirements_path.is_file():
        raise FileNotFoundError(f"requirements.txt not found at {requirements_path}")

    print(f"Installing requirements from {requirements_path} ...")
    cmd = [sys.executable, "-m", "pip", "install", "-r", str(requirements_path)]
    try:
        subprocess.check_call(cmd)
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(f"pip install failed with exit code {exc.returncode}") from exc


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Pave Robotics take-home starter script.\n\n"
            "Loads paired RGB / DEPTH images, runs a crack-detection + "
            "trajectory-planning pipeline, and writes per-image trajectories "
            "to disk. Use this as a starting point and fill in the core "
            "perception and planning pieces."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--data-root",
        type=Path,
        default=Path("data"),
        help="Root of the data directory containing RGB/ and DEPTH/ (default: ./data)",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("trajectories"),
        help="Directory to write per-image trajectory JSON files (default: ./trajectories)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Optional maximum number of image pairs to process.",
    )
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Suppress per-image logging.",
    )
    parser.add_argument(
        "--viz",
        action="store_true",
        help="Generate a matplotlib visualization of the RGBD point cloud and XYZ trajectory.",
    )
    parser.add_argument(
        "--viz-dir",
        type=Path,
        default=None,
        help="Directory to write visualization PNGs (default: <output-dir>/viz).",
    )
    parser.add_argument(
        "--interactive-index",
        type=int,
        default=None,
        help=(
            "Open an interactive 3D viewer for the Nth RGB/DEPTH pair (1-based index) "
            "and exit. Does not write any PNGs."
        ),
    )
    parser.add_argument(
        "--install-reqs",
        action="store_true",
        help="Install Python dependencies from requirements.txt and exit.",
    )
    return parser


def main() -> None:
    parser = build_arg_parser()
    args = parser.parse_args()

    if args.install_reqs:
        # Assume requirements.txt lives next to this script
        requirements_path = Path(__file__).with_name("requirements.txt")
        install_requirements(requirements_path)
        return

    if args.interactive_index is not None:
        interactive_view_pair(args.data_root, args.interactive_index)
        return

    run_pipeline(
        data_root=args.data_root,
        output_dir=args.output_dir,
        limit=args.limit,
        verbose=not args.quiet,
        do_viz=args.viz,
        viz_dir=args.viz_dir,
    )


if __name__ == "__main__":
    main()


