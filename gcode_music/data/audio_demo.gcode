; offline audition only; not reviewed for printer execution
; SIMULATION-ONLY authored snippet, not a hardware demo or executable print job.
; Explicit simulator context: --assume-origin = XYZ=(0,0,0), E=0, mm,
; absolute XYZ/E, zero offsets; all illustrative fans initially off.
; No homing, thermal readiness, extrusion readiness, or collision clearance is
; established or inferred. Do not send this snippet to a printer.
; Target: theoretical P1S planner limits, UNCALIBRATED audio, not stock music.
; A/B assumed acoustic_cycles_per_mm=8 (not measured steps/mm).
G21
G90
M82
M204 S1000
G4 S0.5
G1 Z1 F300
G1 X40 Y40 F2400
G4 S0.35
; Ascending C4 major scale through C5 on pure X, alternating direction.
; F = assumed note_hz * 60 / 8. Acceleration adds pitch bends.
; C4 261.6256, D4 293.6648, E4 329.6276, F4 349.2282 Hz.
G1 X80 F1962.192
G4 S0.15
G1 X40 F2202.486
G4 S0.15
G1 X80 F2472.207
G4 S0.15
G1 X40 F2619.2115
G4 S0.15
; G4 391.9954, A4 440, B4 493.8833, C5 523.2511 Hz.
G1 X80 F2939.9655
G4 S0.15
G1 X40 F3300
G4 S0.15
G1 X80 F3704.12475
G4 S0.15
G1 X40 F3924.38325
G4 S0.3
; Illustrative default/P1 alias plus P2/P3, unknown physical sound mapping.
M106 S100
M106 P2 S160
M106 P3 S190
; Pure Y at two speeds, then A-only and B-only diagonal belt travel.
G1 Y100 F1800
G1 Y40 F3600
G4 S0.3
G1 X100 Y100 F3600
G1 X40 Y160 F3600
G4 S0.3
; Short collinear segments keep phase/lookahead continuity; corner and reversal.
G1 X41 F3000
G1 X42
G1 X43
G1 X44
G1 X45
G1 X46
G1 X47
G1 X48
G1 X49
G1 X50
G1 Y180 F2400
G1 Y160 F2400
; E-only then coordinated E: audible model voices, no thermal readiness assumed.
G1 E8 F600
G1 X90 E10 F2400
G4 S1.25
M107
M107 P2
M107 P3
G4 S1.5
