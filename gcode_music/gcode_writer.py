"""
Part 6: Emit GCODE with updated F (feedrate) values.

Input: original commands, segments, and per-segment new feedrates (only for
segments that were optimized; others keep current feedrate).
Output: new .gcode file with only F values changed.
"""

import math
from decimal import Decimal
from numbers import Real
from typing import Dict, List

from gcode_source import parse_source_line
from motion_timeline import classify_command


def _replace_f_in_line(line: str, new_f: float) -> str:
    """Replace just the F number, or insert a word without altering other bytes."""
    _validate_feedrate(new_f)
    source = parse_source_line(line.encode('utf-8', 'surrogateescape'), 1).source
    if source.problems or source.numbered_or_checksummed:
        raise ValueError('Cannot edit malformed, numbered, or checksummed source')
    value = _decimal(new_f)
    for token in source.tokens[1:]:
        if token.letter == 'F':
            return line[:token.value_start] + value + line[token.end:]
    offset = source.insertion_offset
    return line[:offset] + ' F' + value + ' ' * (offset < len(line) and line[offset] == '(') + line[offset:]


def _decimal(value: float) -> str:
    # GCODE has no exponent notation. Do not round a small positive F to zero.
    text = format(Decimal(str(value)), 'f')
    if '.' not in text:
        return text + '.00'
    return text + '0' * max(0, 2 - len(text.split('.')[1]))


def _validate_feedrate(value):
    if isinstance(value, bool) or not isinstance(value, Real) or not math.isfinite(value) or value <= 0:
        raise ValueError('F must be a finite positive number in mm/min')


def write_gcode(
    commands: List,
    segments: List,
    segment_index_to_new_f: Dict[int, float],
    path_out: str,
) -> None:
    """Lossless no-op; source-preserving segment F edits (values in mm/min).

    Units initially default to mm, as in the legacy adapter; G20/G21 update
    subsequent words. An F-only/modal restoration is inserted only when needed,
    including before E-only moves. Source with any unsupported operation is
    rejected for edits (but always round-trips without edits). No safety or
    stock machine-limit validation is implied.

    Entirely manual lists use raw_line when supplied, otherwise lexical fields;
    each manual record gets a newline. Mixed manual/parsed lists are rejected.
    Segments must refer to these exact command objects, not copies. All request
    and source validation finishes before opening the destination.
    """
    for index, value in segment_index_to_new_f.items():
        if type(index) is not int or not 0 <= index < len(segments):
            raise ValueError('Invalid segment edit index')
        _validate_feedrate(value)

    parsed = [cmd.source is not None for cmd in commands]
    if any(parsed) and not all(parsed):
        raise ValueError('Mixed manual and parsed command lists are unsupported')
    records = []
    for cmd in commands:
        if cmd.source is not None:
            raw = cmd.source.raw_bytes
        else:
            text = cmd.raw_line or (cmd.command + ''.join(' ' + k + _decimal(v) for k, v in cmd.parameter_values().items()))
            if '\n' in text.rstrip('\r\n') or '\r' in text.rstrip('\r\n'):
                raise ValueError('Manual raw_line must contain one physical line')
            raw = (text.rstrip('\r\n') + '\n').encode('utf-8', 'surrogateescape')
        records.append(raw)

    if segment_index_to_new_f:
        identities = {id(cmd) for cmd in commands}
        if len(identities) != len(commands):
            raise ValueError('Duplicate command objects')
        targets, seen = {}, set()
        for index, segment in enumerate(segments):
            if index in segment_index_to_new_f and not segment.commands:
                raise ValueError('Cannot edit an empty segment')
            for cmd in segment.commands:
                if id(cmd) not in identities or id(cmd) in seen:
                    raise ValueError('Segments contain foreign or overlapping command references')
                seen.add(id(cmd))
                if index in segment_index_to_new_f:
                    if cmd.command not in ('G0', 'G1'):
                        raise ValueError('Only linear movement commands can receive F edits')
                    targets[id(cmd)] = segment_index_to_new_f[index]

        original_f = output_f = None
        unit_factor = 1.0
        for index, (cmd, raw) in enumerate(zip(commands, records)):
            lexical = parse_source_line(raw, cmd.line_num)
            if lexical.command != cmd.command or lexical.parameter_values() != cmd.parameter_values():
                raise ValueError('Interpreted fields differ from source; use explicit segment edits')
            status, _, reason = classify_command(lexical)
            if status == 'unsupported':
                raise ValueError(f'Cannot safely edit line {cmd.line_num}: {reason}')
            if cmd.command in ('G20', 'G21'):
                unit_factor = 25.4 if cmd.command == 'G20' else 1.0
            if cmd.command not in ('G0', 'G1'):
                continue
            if lexical.f is not None:
                original_f = output_f = lexical.f * unit_factor
                _validate_feedrate(original_f)
            desired = targets.get(id(cmd), original_f)
            if desired != output_f:
                if desired is None:
                    raise ValueError('Cannot restore unresolved original modal F')
                word_f = desired / unit_factor
                _validate_feedrate(word_f)
                records[index] = _replace_f_in_line(lexical.source.text, word_f).encode('utf-8', 'surrogateescape')
                output_f = desired

    content = b''.join(records)
    with open(path_out, 'wb') as output:
        output.write(content)
