"""Lossless source records; lexical numbers are not modal machine state.

Spans index decoded text (UTF-8 with surrogateescape), not byte offsets.
Every physical line, including comments and blanks, has a command record.
"""

import re
from dataclasses import dataclass, field
from typing import Optional


NUMBER = r'[+-]?(?:\d+(?:\.\d*)?|\.\d+)'
WORD = re.compile(r'([A-Za-z])\s*(' + NUMBER + r')')


@dataclass(frozen=True)
class SourceToken:
    letter: str
    value: float
    start: int
    end: int
    value_start: int


@dataclass(frozen=True)
class SourceLine:
    raw_bytes: bytes
    text: str
    tokens: tuple[SourceToken, ...]
    insertion_offset: int
    numbered_or_checksummed: bool = False
    problems: tuple[str, ...] = ()


@dataclass
class GCodeCommand:
    """Lexical XYZ/E/F values in source units; no inherited values are filled in.

    The first eight arguments preserve the legacy constructor. Manually made
    records may omit source; use parameters for non-XYZEF words.
    """

    line_num: int
    command: str
    x: Optional[float] = None
    y: Optional[float] = None
    z: Optional[float] = None
    e: Optional[float] = None
    f: Optional[float] = None
    raw_line: str = ''
    source: Optional[SourceLine] = None
    parameters: dict[str, float] = field(default_factory=dict)

    def parameter_values(self) -> dict[str, float]:
        values = dict(self.parameters)
        for axis in 'xyzef':
            value = getattr(self, axis)
            if value is not None:
                values[axis.upper()] = value
        return values


def parse_source_line(raw: bytes, line_num: int) -> GCodeCommand:
    text = raw.decode('utf-8', errors='surrogateescape')
    masked = list(text)
    depth = 0
    insertion = len(text.rstrip('\r\n'))
    problems = []
    for i, char in enumerate(text):
        if char == ';' and depth == 0:
            insertion = min(insertion, i)
            masked[i:] = ' ' * (len(text) - i)
            break
        if char == '(':
            insertion = min(insertion, i)
            depth += 1
        if depth:
            masked[i] = ' '
        if char == ')':
            if not depth:
                problems.append('unmatched closing comment')
            depth = max(0, depth - 1)
    if depth:
        problems.append('unclosed comment')
    code = ''.join(masked)
    matches = list(WORD.finditer(code))
    tokens = tuple(SourceToken(m[1].upper(), float(m[2]), m.start(), m.end(), m.start(2))
                   for m in matches)
    remaining = list(code)
    for token in tokens:
        remaining[token.start:token.end] = ' ' * (token.end - token.start)
    if ''.join(remaining).strip():
        problems.append('unrecognized source syntax')
    numbered = bool(tokens and tokens[0].letter == 'N') or '*' in code
    executable = list(zip(tokens, matches))
    if executable and executable[0][0].letter == 'N':
        executable.pop(0)
    command = ''
    parameters = {}
    if executable:
        opcode, match = executable.pop(0)
        # Decimal suffixes are deliberately retained, never truncated to G/M integers.
        command = opcode.letter + match[2]
        for token, _ in executable:
            if token.letter in parameters:
                problems.append('duplicate parameter ' + token.letter)
            parameters[token.letter] = token.value
    elif code.strip():
        command = code.strip()
    if tokens:
        # A leading comment must never put an inserted parameter before the opcode.
        insertion = max(insertion, tokens[0].end)
    source = SourceLine(raw, text, tokens, insertion, numbered, tuple(problems))
    return GCodeCommand(line_num, command, **{k.lower(): v for k, v in parameters.items()
                                            if k in 'XYZEF'},
                        raw_line=text.rstrip('\r\n'), source=source, parameters=parameters)


def parse_source(data: bytes) -> list[GCodeCommand]:
    # Unlike bytes.splitlines(), only CR/LF delimit physical GCODE lines.
    lines = re.findall(rb'[^\r\n]*(?:\r\n|\r|\n|$)', data)
    return [parse_source_line(raw, i) for i, raw in enumerate(lines, 1) if raw]
