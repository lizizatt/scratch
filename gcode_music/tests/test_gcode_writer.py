"""Part 6: GCODE writer tests."""
import sys
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from gcode_analyzer import GCodeParser, MovementAnalyzer
from gcode_writer import write_gcode
from models import TimingParams


def _get_commands_and_segments(gcode_path):
    parser = GCodeParser()
    parser.parse_file(str(gcode_path))
    analyzer = MovementAnalyzer(parser.commands)
    timing = TimingParams(default_acceleration=10000.0, time_scale=1.0)
    segments = analyzer.segment_movements(timing)
    return parser.commands, segments


def test_roundtrip_one_f_changed(tmp_path):
    """Parse GCODE, change one segment's F, write, parse again; only that F changed."""
    gcode_path = ROOT / "data" / "ground_truth" / "calibration.gcode"
    if not gcode_path.exists():
        gcode_path = ROOT / "data" / "Bench.gcode"
    if not gcode_path.exists():
        return
    commands, segments = _get_commands_and_segments(gcode_path)
    if len(segments) < 2:
        return
    original_feedrates = [s.feedrate for s in segments]
    new_f = 999.0
    segment_index_to_new_f = {1: new_f}
    out_path = tmp_path / "out.gcode"
    write_gcode(commands, segments, segment_index_to_new_f, str(out_path))
    cmd2, seg2 = _get_commands_and_segments(out_path)
    for i, seg in enumerate(seg2):
        if i == 1:
            assert abs(seg.feedrate - new_f) < 0.01
        else:
            assert abs(seg.feedrate - original_feedrates[i]) < 0.01


def test_replace_f_in_line():
    """Helper replaces or adds F in a line."""
    from gcode_writer import _replace_f_in_line
    assert "F300.00" in _replace_f_in_line("G1 X50 Y50 Z10 F300", 300)
    assert "F999.00" in _replace_f_in_line("G1 X50 Y50 Z10 F300", 999)
    assert "F100.00" in _replace_f_in_line("G1 X50 Y50 Z10", 100)


def test_noop_preserves_every_source_byte(tmp_path):
    original = b'; metadata \xff\r\n\r\n T1 ; tool\nM970.3 Q1\rG1X.5 F600 (F99) ; tail'
    source = tmp_path / 'source.gcode'
    source.write_bytes(original)
    commands = GCodeParser().parse_file(str(source))
    output = tmp_path / 'output.gcode'
    write_gcode(commands, [], {}, str(output))
    assert output.read_bytes() == original
    assert [c.command for c in commands if c.command] == ['T1', 'M970.3', 'G1']
    assert commands[-1].x == .5
    assert commands[-1].f == 600


def test_feedrate_edit_preserves_bytes_and_restores_before_extrusion(tmp_path):
    original = b'G21\r\nG90\r\nM83\r\nG1X10F600 (F42) ; keep\r\n; middle\r\nG1E1\r\nG1X20 F1200\n'
    source = tmp_path / 'source.gcode'
    source.write_bytes(original)
    commands, segments = _get_commands_and_segments(source)
    output = tmp_path / 'output.gcode'
    write_gcode(commands, segments, {0: 900}, str(output))
    expected = original.replace(b'F600 (', b'F900.00 (').replace(b'G1E1\r', b'G1E1 F600.00\r')
    assert output.read_bytes() == expected
    from motion_timeline import build_timeline, ExecutionContext
    before = build_timeline(commands, context=ExecutionContext.known_origin())
    after = build_timeline(GCodeParser().parse_file(str(output)), context=ExecutionContext.known_origin())
    moves_before = [e for e in before.events if e.velocity_mm_s is not None]
    moves_after = [e for e in after.events if e.velocity_mm_s is not None]
    assert [e.velocity_mm_s for e in moves_after] == [15, 10, 20]
    assert [(e.delta_xyz_mm, e.delta_e_mm) for e in moves_after] == [(e.delta_xyz_mm, e.delta_e_mm) for e in moves_before]


@pytest.mark.parametrize('edits', [{-1: 100}, {1: 100}, {0: 0}, {0: -1}, {0: float('nan')}, {0: float('inf')}, {True: 100}, {0.0: 100}])
def test_invalid_edits_do_not_touch_destination(tmp_path, edits):
    source = tmp_path / 'source.gcode'
    source.write_text('G1 X10 F600\n')
    commands, segments = _get_commands_and_segments(source)
    output = tmp_path / 'output.gcode'
    output.write_bytes(b'keep existing destination')
    with pytest.raises(ValueError):
        write_gcode(commands, segments, edits, str(output))
    assert output.read_bytes() == b'keep existing destination'


def test_edit_in_inches_converts_and_restores_modal_mm_per_min(tmp_path):
    source = tmp_path / 'source.gcode'
    source.write_bytes(b'G20\r\nG91\r\nG1 X1 F60\r\nG21\r\nG1 Y25.4\r\n')
    commands, segments = _get_commands_and_segments(source)
    output = tmp_path / 'out.gcode'
    write_gcode(commands, segments, {0: 762}, str(output))
    assert output.read_bytes() == b'G20\r\nG91\r\nG1 X1 F30.00\r\nG21\r\nG1 Y25.4 F1524.00\r\n'
    _, edited = _get_commands_and_segments(output)
    assert [segment.feedrate for segment in edited] == [762, 1524]


@pytest.mark.parametrize('text', ['N1 G1 X1 F600*42\n', 'G1 X1 F600\nT1\n',
                                 'G1 X1 F600\nM970.3 Q1\n', 'G1 X1 F600 Q1\n'])
def test_edit_rejects_numbered_or_unknown_sources_but_noop_preserves(tmp_path, text):
    from gcode_analyzer import MovementSegment

    source = tmp_path / 'source.gcode'
    source.write_text(text)
    commands = GCodeParser().parse_file(str(source))
    segments = [MovementSegment(0, 1, 1, 600, (1, 0, 0), [commands[0]])]
    output = tmp_path / 'out.gcode'
    write_gcode(commands, segments, {}, str(output))
    assert output.read_bytes() == source.read_bytes()
    with pytest.raises(ValueError):
        write_gcode(commands, segments, {0: 900}, str(output))
    assert output.read_bytes() == source.read_bytes()


def test_manual_command_list_fallback_and_foreign_segment_rejection(tmp_path):
    from gcode_analyzer import GCodeCommand, MovementSegment

    commands = [GCodeCommand(1, 'G1', x=10, f=600), GCodeCommand(2, 'G1', y=10)]
    segments = MovementAnalyzer(commands).segment_movements()
    output = tmp_path / 'out.gcode'
    write_gcode(commands, segments, {}, str(output))
    assert output.read_text() == 'G1 X10.00 F600.00\nG1 Y10.00\n'
    write_gcode(commands, segments, {0: 900}, str(output))
    assert output.read_text() == 'G1 X10.00 F900.00\nG1 Y10.00 F600.00\n'
    foreign = MovementSegment(0, 1, 10, 600, (1, 0, 0), [GCodeCommand(1, 'G1', x=10, f=600)])
    previous = output.read_bytes()
    with pytest.raises(ValueError, match='foreign'):
        write_gcode(commands, [foreign], {0: 900}, str(output))
    assert output.read_bytes() == previous


def test_multiple_selected_moves_do_not_leak_or_reformat_unedited_words(tmp_path):
    source = tmp_path / 'source.gcode'
    original = b'G1 F+600.000\nG1X10 ; F4\nG1X20\nG1Y10\nG1 Z1 F1200 ; tail\n'
    source.write_bytes(original)
    commands, segments = _get_commands_and_segments(source)
    output = tmp_path / 'out.gcode'
    write_gcode(commands, segments, {0: 300}, str(output))
    assert output.read_bytes() == b'G1 F+600.000\nG1X10  F300.00; F4\nG1X20\nG1Y10 F600.00\nG1 Z1 F1200 ; tail\n'
    write_gcode(commands, segments, {0: 600}, str(output))
    assert output.read_bytes() == original


@pytest.mark.parametrize('line', [b'(note) G1 X10\r\n', b'(note) G1 (middle) X10\r\n'])
def test_feedrate_insertion_after_leading_comment_keeps_opcode_first(tmp_path, line):
    source = tmp_path / 'source.gcode'
    source.write_bytes(b'G1 F600\r\n' + line + b'G1 Y10\r\n')
    commands, segments = _get_commands_and_segments(source)
    output = tmp_path / 'out.gcode'

    write_gcode(commands, segments, {0: 900}, str(output))

    edited, changed_segments = _get_commands_and_segments(output)
    assert [c.command for c in edited] == ['G1', 'G1', 'G1']
    assert [s.feedrate for s in changed_segments] == [900, 600]
    assert [s.distance for s in changed_segments] == [10, 10]
    assert b'(note)' in output.read_bytes()
    if b'(middle)' in line:
        assert b'(middle)' in output.read_bytes()
