#!/usr/bin/env python3
import curses
import time
import os
import sys
import subprocess
import traceback
import logging
from game_state import GameState
from screens import SplashScreen, GameScreen
from aircraft import Cessna208B

# Set up logging
logging.basicConfig(
    filename='flight_trainer.log',
    level=logging.DEBUG,
    format='%(asctime)s - %(levelname)s - %(message)s'
)

class IFRTrainer:
    MIN_HEIGHT = 24
    MIN_WIDTH = 80
    
    def __init__(self):
        self.state = GameState()
        self.aircraft = Cessna208B()
        self.current_screen = None
        self.screens = {}
        
    @staticmethod
    def try_resize_terminal():
        """Try to resize the current terminal or spawn a new one if needed."""
        try:
            # Try using stty to get and set terminal size
            current_size = subprocess.check_output(['stty', 'size']).decode().split()
            current_height = int(current_size[0])
            current_width = int(current_size[1])
            
            if current_height < IFRTrainer.MIN_HEIGHT or current_width < IFRTrainer.MIN_WIDTH:
                # Try to resize current terminal
                if sys.stdout.isatty():
                    try:
                        subprocess.run(['resize', '-s', str(IFRTrainer.MIN_HEIGHT), str(IFRTrainer.MIN_WIDTH)])
                        return True
                    except:
                        pass
                
                # If resize fails or not possible, try to spawn a new terminal
                terminal_cmds = [
                    ['gnome-terminal', '--', 'python3', sys.argv[0]],
                    ['xterm', '-geometry', f'{IFRTrainer.MIN_WIDTH}x{IFRTrainer.MIN_HEIGHT}', '-e', 'python3', sys.argv[0]],
                    ['konsole', '--geometry', f'{IFRTrainer.MIN_WIDTH}x{IFRTrainer.MIN_HEIGHT}', '-e', 'python3', sys.argv[0]]
                ]
                
                for cmd in terminal_cmds:
                    try:
                        subprocess.Popen(cmd)
                        print(f"Launched game in new terminal window")
                        return False
                    except FileNotFoundError:
                        continue
                
                print("Could not launch a new terminal. Please manually resize your terminal to at least "
                      f"{IFRTrainer.MIN_WIDTH}x{IFRTrainer.MIN_HEIGHT}")
                return False
        except Exception as e:
            logging.error(f"Error in try_resize_terminal: {str(e)}")
            logging.error(traceback.format_exc())
        return True
        
    def init_curses(self):
        try:
            self.stdscr = curses.initscr()
            
            # Check terminal size
            height, width = self.stdscr.getmaxyx()
            if height < self.MIN_HEIGHT or width < self.MIN_WIDTH:
                curses.endwin()
                print(f"Terminal too small. Minimum size: {self.MIN_WIDTH}x{self.MIN_HEIGHT}")
                print(f"Current size: {width}x{height}")
                if not self.try_resize_terminal():
                    exit(1)
                # Reinitialize curses after resize
                self.stdscr = curses.initscr()
                
            curses.start_color()
            curses.noecho()
            curses.cbreak()
            curses.curs_set(0)
            self.stdscr.keypad(True)
            
            # Set up non-blocking input
            self.stdscr.nodelay(1)
            
            # Initialize color pairs
            curses.init_pair(1, curses.COLOR_GREEN, curses.COLOR_BLACK)
            curses.init_pair(2, curses.COLOR_RED, curses.COLOR_BLACK)
            curses.init_pair(3, curses.COLOR_YELLOW, curses.COLOR_BLACK)
            
        except Exception as e:
            logging.error(f"Error in init_curses: {str(e)}")
            logging.error(traceback.format_exc())
            raise
        
    def cleanup_curses(self):
        try:
            curses.nocbreak()
            self.stdscr.keypad(False)
            curses.echo()
            curses.endwin()
        except Exception as e:
            logging.error(f"Error in cleanup_curses: {str(e)}")
            logging.error(traceback.format_exc())
        
    def setup_screens(self):
        try:
            self.screens = {
                'splash': SplashScreen(self.stdscr, self.state),
                'game': GameScreen(self.stdscr, self.state, self.aircraft)
            }
            self.current_screen = self.screens['splash']
        except Exception as e:
            logging.error(f"Error in setup_screens: {str(e)}")
            logging.error(traceback.format_exc())
            raise
        
    def run(self):
        try:
            logging.info("Starting game")
            self.init_curses()
            self.setup_screens()
            
            target_frame_time = 1.0 / 60  # Target 60 FPS
            last_frame_time = time.time()
            
            while True:
                try:
                    current_time = time.time()
                    frame_time = current_time - last_frame_time
                    
                    # Ensure we don't update too quickly
                    if frame_time < target_frame_time:
                        time.sleep(target_frame_time - frame_time)
                        current_time = time.time()
                        frame_time = current_time - last_frame_time
                    
                    last_frame_time = current_time
                    
                    # Handle input (non-blocking)
                    while True:
                        key = self.stdscr.getch()
                        if key == -1:  # No more input
                            break
                        if key == 27:  # ESC
                            return
                            
                        next_screen = self.current_screen.handle_input(key)
                        if next_screen and next_screen in self.screens:
                            logging.info(f"Switching to screen: {next_screen}")
                            self.current_screen = self.screens[next_screen]
                    
                    # Update and render (always happens)
                    self.current_screen.render()
                    
                except curses.error as e:
                    # Handle terminal resize
                    logging.warning(f"Curses error (possibly resize): {str(e)}")
                    self.stdscr.clear()
                    self.stdscr.refresh()
                    height, width = self.stdscr.getmaxyx()
                    if height < self.MIN_HEIGHT or width < self.MIN_WIDTH:
                        raise ValueError("Terminal too small")
                    
                    # Update screen dimensions
                    for screen in self.screens.values():
                        screen.height, screen.width = height, width
                
                except Exception as e:
                    logging.error(f"Error in game loop: {str(e)}")
                    logging.error(traceback.format_exc())
                    raise
                
        except ValueError as e:
            self.cleanup_curses()
            print(str(e))
            if "Terminal too small" in str(e):
                if not self.try_resize_terminal():
                    exit(1)
                self.run()
        except Exception as e:
            self.cleanup_curses()
            logging.error(f"Fatal error: {str(e)}")
            logging.error(traceback.format_exc())
            print("\nGame crashed! Check flight_trainer.log for details.")
            print(f"Error: {str(e)}")
            input("Press Enter to exit...")
        finally:
            self.cleanup_curses()

if __name__ == "__main__":
    try:
        game = IFRTrainer()
        game.run()
    except Exception as e:
        print("\nGame crashed during startup!")
        print(f"Error: {str(e)}")
        print("Check flight_trainer.log for details.")
        logging.error(f"Startup error: {str(e)}")
        logging.error(traceback.format_exc())
        input("Press Enter to exit...") 