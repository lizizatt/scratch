"""
Part 6: Emit GCODE with updated F (feedrate) values.

Input: original commands, segments, and per-segment new feedrates (only for
segments that were optimized; others keep current feedrate).
Output: new .gcode file with only F values changed.
"""

import re
from typing import Dict, List


def _replace_f_in_line(line: str, new_f: float) -> str:
    """Replace or append F parameter in a GCODE line."""
    # Replace existing F value
    if re.search(r"\bF[+\d.]+\b", line):
        return re.sub(r"\bF[+\d.]+\b", "F{:.2f}".format(new_f), line, count=1)
    # No F: append before comment or at end
    comment = ""
    if ";" in line:
        idx = line.index(";")
        comment = " " + line[idx:]
        line = line[:idx].rstrip()
    return line.rstrip() + " F{:.2f}".format(new_f) + comment


def write_gcode(
    commands: List,
    segments: List,
    segment_index_to_new_f: Dict[int, float],
    path_out: str,
) -> None:
    """
    Write GCODE to path_out with feedrates updated per segment.

    Args:
        commands: All GCodeCommand in file order (from parser.commands).
        segments: MovementSegment list (from MovementAnalyzer.segment_movements).
        segment_index_to_new_f: Map segment index -> new feedrate (only for optimized segments).
        path_out: Output file path.
    """
    cmd_to_seg: Dict[int, int] = {}
    for seg_i, seg in enumerate(segments):
        for cmd in seg.commands:
            cmd_to_seg[id(cmd)] = seg_i

    lines = []
    for cmd in commands:
        seg_i = cmd_to_seg.get(id(cmd))
        if seg_i is not None:
            f = segment_index_to_new_f.get(seg_i, segments[seg_i].feedrate)
            lines.append(_replace_f_in_line(cmd.raw_line, f))
        else:
            lines.append(cmd.raw_line)

    with open(path_out, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines))
        if lines:
            f.write("\n")
