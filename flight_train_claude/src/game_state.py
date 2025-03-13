import yaml
import os
from pathlib import Path

class GameState:
    def __init__(self):
        self.score = 0
        self.flight_time = 0
        self.weather_intensity = 0
        self.high_scores = self.load_high_scores()
        
    def load_high_scores(self):
        scores_file = Path("data/high_scores.yml")
        if not scores_file.exists():
            return []
            
        with open(scores_file, 'r') as f:
            try:
                scores = yaml.safe_load(f)
                return sorted(scores, key=lambda x: x['score'], reverse=True)[:10]
            except:
                return []
                
    def save_high_scores(self):
        os.makedirs("data", exist_ok=True)
        scores_file = Path("data/high_scores.yml")
        
        current_scores = self.load_high_scores()
        current_scores.append({
            'score': self.score,
            'flight_time': self.flight_time,
            'weather': self.weather_intensity
        })
        
        # Sort and keep top 10
        current_scores = sorted(current_scores, key=lambda x: x['score'], reverse=True)[:10]
        
        with open(scores_file, 'w') as f:
            yaml.dump(current_scores, f)
            
    def reset(self):
        self.score = 0
        self.flight_time = 0
        self.weather_intensity = 0
        
    def update(self, dt):
        self.flight_time += dt
        self.weather_intensity = min(1.0, self.flight_time / 300)  # Max intensity after 5 minutes
        self.score = int(self.flight_time * (1 + self.weather_intensity)) 