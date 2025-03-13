# IFR Flight Trainer

A command-line based IFR flight training game that simulates flying a Cessna 208b Caravan under instrument conditions.

## Controls
- W/S: Pitch control (forward/back)
- A/D: Roll control (left/right)
- Q/E: Yaw control (rudder)
- Up/Down arrows: Throttle control
- ESC: Quit game

## Installation
```bash
pip install -r requirements.txt
python src/main.py
```

## Gameplay
Try to maintain controlled flight under increasingly challenging weather conditions. The game features:
- Realistic Cessna 208b flight model
- ASCII instrument panel display
- Progressive weather deterioration
- High score tracking
- Instrument-only navigation challenges

## Requirements
- Python 3.8+
- Curses (built into Unix/Linux, windows-curses on Windows) 