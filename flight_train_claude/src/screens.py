import curses
import time
from abc import ABC, abstractmethod

class Screen(ABC):
    def __init__(self, stdscr, state):
        self.stdscr = stdscr
        self.state = state
        self.height, self.width = stdscr.getmaxyx()
        
    def safe_addstr(self, y, x, text, attrs=0):
        try:
            if 0 <= y < self.height and 0 <= x < self.width:
                # Truncate text if it would go beyond screen width
                max_len = self.width - x
                if len(text) > max_len:
                    text = text[:max_len]
                self.stdscr.addstr(y, x, text, attrs)
        except curses.error:
            pass
            
    @abstractmethod
    def render(self):
        pass
        
    @abstractmethod
    def handle_input(self, key):
        pass

class SplashScreen(Screen):
    def render(self):
        self.stdscr.clear()
        
        # Draw title
        title = "IFR Flight Trainer"
        self.safe_addstr(2, (self.width - len(title)) // 2, title, curses.A_BOLD)
        
        # Draw instructions
        instructions = [
            "Controls:",
            "W/S - Pitch down/up",
            "A/D - Roll left/right",
            "Q/E - Yaw left/right",
            "↑/↓ - Throttle up/down",
            "T + Control - Set trim",
            "R - Reset trim",
            "ESC - Quit",
            "",
            "Press SPACE to start",
            "Press H for high scores"
        ]
        
        for i, line in enumerate(instructions):
            self.safe_addstr(5 + i, (self.width - len(line)) // 2, line)
            
        self.stdscr.refresh()
        
    def handle_input(self, key):
        if key == ord(' '):
            return 'game'
        elif key in (ord('h'), ord('H')):
            self._show_high_scores()
        return None
        
    def _show_high_scores(self):
        self.stdscr.clear()
        self.safe_addstr(2, (self.width - 11) // 2, "High Scores", curses.A_BOLD)
        
        if not self.state.high_scores:
            self.safe_addstr(5, (self.width - 15) // 2, "No scores yet!")
        else:
            for i, score in enumerate(self.state.high_scores):
                score_text = f"{i+1}. Score: {score['score']} Time: {int(score['flight_time'])}s"
                self.safe_addstr(5 + i, (self.width - len(score_text)) // 2, score_text)
                
        self.safe_addstr(16, (self.width - 20) // 2, "Press any key to return")
        self.stdscr.refresh()
        self.stdscr.getch()

class GameScreen(Screen):
    def __init__(self, stdscr, state, aircraft):
        super().__init__(stdscr, state)
        self.aircraft = aircraft
        self.last_update = time.time()
        self.trim_mode = False
        
    def render(self):
        current_time = time.time()
        dt = current_time - self.last_update
        self.last_update = current_time
        
        # Update physics
        self.aircraft.update(dt, self.state.weather_intensity)
        self.state.update(dt)
        
        # Clear screen
        self.stdscr.clear()
        
        # Get instrument readings
        readings = self.aircraft.get_instrument_readings()
        
        # Draw instrument panel
        self._draw_attitude_indicator(readings, 2, 2)
        self._draw_altimeter(readings, 2, 40)
        self._draw_airspeed(readings, 2, 60)
        self._draw_heading(readings, 12, 40)
        self._draw_vsi(readings, 12, 60)
        
        # Draw status
        status = f"Flight Time: {int(self.state.flight_time)}s  Score: {self.state.score}"
        self.safe_addstr(self.height - 2, 2, status)
        
        # Draw weather status
        weather = f"Weather: {'█' * int(self.state.weather_intensity * 10)}"
        self.safe_addstr(self.height - 2, self.width - len(weather) - 2, weather)
        
        # Draw control positions with visual indicators
        self._draw_control_status(self.height - 4)
        
        # Draw trim mode indicator if active
        if self.trim_mode:
            self.safe_addstr(self.height - 5, 2, "TRIM MODE", curses.A_BOLD | curses.color_pair(3))
        
        self.stdscr.refresh()
        
    def _draw_control_status(self, y):
        """Draw control position indicators"""
        def draw_bar(value):
            # Create a 21-character bar (-10 to +10)
            bar = list("          |          ")
            pos = int(value * 10) + 10
            pos = max(0, min(20, pos))
            bar[pos] = '█'
            return ''.join(bar)
            
        # Draw elevator
        self.safe_addstr(y, 2, "Elevator: ")
        self.safe_addstr(y, 11, draw_bar(self.aircraft.elevator))
        self.safe_addstr(y, 32, f"({self.aircraft.elevator:+.2f})")
        
        # Draw aileron
        self.safe_addstr(y + 1, 2, "Aileron:  ")
        self.safe_addstr(y + 1, 11, draw_bar(self.aircraft.aileron))
        self.safe_addstr(y + 1, 32, f"({self.aircraft.aileron:+.2f})")
        
        # Draw rudder
        self.safe_addstr(y + 2, 2, "Rudder:   ")
        self.safe_addstr(y + 2, 11, draw_bar(self.aircraft.rudder))
        self.safe_addstr(y + 2, 32, f"({self.aircraft.rudder:+.2f})")
        
        # Draw throttle as percentage
        throttle_text = f"Throttle: {self.aircraft.throttle * 100:3.0f}%"
        self.safe_addstr(y + 3, 2, throttle_text)
        
    def handle_input(self, key):
        if key == 27:  # ESC
            self.state.save_high_scores()
            return 'splash'
            
        # Toggle trim mode
        if key in (ord('t'), ord('T')):
            self.trim_mode = True
            return None
            
        # Reset trim
        if key in (ord('r'), ord('R')):
            for control in ['elevator', 'aileron', 'rudder']:
                self.aircraft.set_trim(control, 0)
            return None
            
        # Handle control inputs
        control_map = {
            ord('w'): ('elevator', 1),    # Reversed to match real aircraft (pull back = up)
            ord('s'): ('elevator', -1),
            ord('a'): ('aileron', -1),
            ord('d'): ('aileron', 1),
            ord('q'): ('rudder', -1),
            ord('e'): ('rudder', 1),
            curses.KEY_UP: ('throttle', 1),
            curses.KEY_DOWN: ('throttle', -1)
        }
        
        if key in control_map:
            control, value = control_map[key]
            if self.trim_mode and control != 'throttle':
                # Set trim
                current_trim = self.aircraft.trim[control]
                self.aircraft.set_trim(control, current_trim + value * 0.1)
                self.trim_mode = False  # Exit trim mode after setting
            else:
                # Normal control input
                self.aircraft.apply_control_input(control, value)
            
        return None
        
    def _draw_attitude_indicator(self, readings, y, x):
        pitch = readings['pitch']
        roll = readings['roll']
        
        # Draw artificial horizon
        horizon_line = "═" * 20
        self.safe_addstr(y, x, "Attitude", curses.A_BOLD)
        center_y = y + 5
        
        # Simplified attitude display
        pitch_offset = int(pitch / 5)
        self.safe_addstr(center_y + pitch_offset, x, horizon_line)
        
        # Roll indicator
        roll_char = "v" if abs(roll) < 10 else ("←" if roll < 0 else "→")
        self.safe_addstr(y + 1, x + 10, roll_char)
        
    def _draw_altimeter(self, readings, y, x):
        alt = int(readings['altitude'])
        self.safe_addstr(y, x, "Altitude", curses.A_BOLD)
        self.safe_addstr(y + 1, x, f"{alt:5d} ft")
        
    def _draw_airspeed(self, readings, y, x):
        speed = int(readings['airspeed'] * 1.944)  # m/s to knots
        self.safe_addstr(y, x, "Airspeed", curses.A_BOLD)
        self.safe_addstr(y + 1, x, f"{speed:3d} kts")
        
    def _draw_heading(self, readings, y, x):
        hdg = int(readings['heading'])
        self.safe_addstr(y, x, "Heading", curses.A_BOLD)
        self.safe_addstr(y + 1, x, f"{hdg:03d}°")
        
    def _draw_vsi(self, readings, y, x):
        vsi = int(readings['vertical_speed'] * 196.85)  # m/s to ft/min
        self.safe_addstr(y, x, "VSI", curses.A_BOLD)
        self.safe_addstr(y + 1, x, f"{vsi:+4d} fpm") 