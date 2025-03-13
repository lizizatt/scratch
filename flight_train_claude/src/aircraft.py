import numpy as np

class Cessna208B:
    def __init__(self):
        # Aircraft characteristics (Cessna 208B Caravan)
        self.mass = 3969  # kg
        self.wing_area = 26  # m²
        self.max_power = 675 * 745.7  # Convert HP to Watts
        
        # Aerodynamic parameters
        self.base_lift_coefficient = 0.8  # Base lift coefficient
        self.stall_angle = np.radians(15)  # Angle where stall begins
        self.max_lift_coefficient = 1.2  # Peak lift coefficient at stall angle
        self.min_lift_coefficient = -0.5  # Negative lift coefficient
        
        # Flight envelope limits
        self.max_speed = 85  # m/s (~165 knots)
        self.min_speed = 30   # m/s (~58 knots)
        self.max_altitude = 7620  # m (25,000 ft)
        self.max_pitch = np.radians(30)
        self.max_roll = np.radians(60)
        
        # Control parameters
        self.control_rate = 0.8  # How fast controls move
        self.return_rate = 0.3   # How fast controls return to neutral
        self.control_increment = 0.15  # How much each button press changes the target
        self.control_targets = {
            'elevator': 0.0,
            'aileron': 0.0,
            'rudder': 0.0,
            'throttle': 0.5
        }
        
        # State variables
        self.position = np.array([0., 1000., 0.])  # x, y (altitude), z
        self.velocity = np.array([50., 0., 0.])  # m/s, initial cruise speed
        self.acceleration = np.array([0., 0., 0.])  # m/s²
        self.attitude = np.array([0., 0., 0.])  # pitch, roll, yaw (radians)
        self.angular_velocity = np.array([0., 0., 0.])  # rad/s
        
        # Control inputs (normalized -1 to 1)
        self.throttle = 0.5  # Initial cruise power
        self.elevator = 0.0
        self.aileron = 0.0
        self.rudder = 0.0
        
        # Control trim positions
        self.trim = {
            'elevator': 0.0,
            'aileron': 0.0,
            'rudder': 0.0
        }
        
    def _calculate_lift(self):
        """Calculate current lift force"""
        speed = np.clip(np.linalg.norm(self.velocity), 1.0, self.max_speed)
        dynamic_pressure = 0.5 * 1.225 * speed * speed
        
        # Calculate angle of attack (simplified - assuming pitch angle approximates AoA)
        angle_of_attack = self.attitude[0]
        
        # Calculate lift coefficient based on angle of attack
        if abs(angle_of_attack) <= self.stall_angle:
            # Linear region before stall
            lift_coefficient = self.base_lift_coefficient * (1.0 + 2.0 * angle_of_attack / self.stall_angle)  # Less lift before stall
        else:
            # Stall region - lift drops off extremely sharply
            excess_angle = abs(angle_of_attack) - self.stall_angle
            lift_coefficient = self.max_lift_coefficient * np.exp(-4.0 * excess_angle)  # Even sharper dropoff
            if angle_of_attack < 0:
                lift_coefficient = -lift_coefficient
                
        # Apply speed effects on lift coefficient
        speed_factor = np.clip(speed / self.min_speed, 0, 1)
        lift_coefficient *= speed_factor
        
        return dynamic_pressure * self.wing_area * lift_coefficient

    def update(self, dt, weather_intensity=0.0):
        """Update aircraft state for one time step."""
        # Limit dt to prevent numerical instability
        dt = min(dt, 0.1)
        
        # Update control positions
        self._update_controls(dt)
        
        # Get current state
        speed = np.clip(np.linalg.norm(self.velocity), 1.0, self.max_speed)
        pitch = self.attitude[0]
        
        # Calculate aerodynamic forces
        lift = self._calculate_lift()
        drag = 0.5 * 1.225 * speed * speed * self.wing_area * (0.02 + 0.03 * abs(self.elevator) + 0.01 * self.throttle)
        
        # More responsive thrust model
        base_thrust = self.max_power * self.throttle
        speed_factor = 1.0 - (speed / self.max_speed) ** 2  # Quadratic thrust reduction
        thrust = base_thrust * speed_factor
        
        # Calculate target vertical speed based on pitch and power
        pitch_deg = np.degrees(pitch)
        nominal_thrust = self.max_power * 0.5 * (1.0 - (speed / self.max_speed) ** 2)
        excess_thrust = max(0, thrust - nominal_thrust) / self.mass
        power_factor = excess_thrust * 2.0
        
        # Calculate target vertical speed with smoother transitions
        if abs(pitch_deg) <= 15:  # Normal flight
            target_vsi = speed * np.sin(pitch) * 2.0 + power_factor
        else:  # Beyond critical angle
            excess_angle = abs(pitch_deg) - 15
            reduction = np.exp(-0.8 * excess_angle)  # Even faster reduction
            target_vsi = (speed * np.sin(pitch) + power_factor) * reduction - excess_angle * 0.8  # More downward tendency
            
        # Smooth transition to target VSI with faster rate
        current_vsi = self.velocity[1]
        vsi_rate = 8.0  # Even faster VSI response
        if target_vsi > current_vsi:
            vertical_speed = min(target_vsi, current_vsi + vsi_rate * dt)
        else:
            vertical_speed = max(target_vsi, current_vsi - vsi_rate * dt)
            
        # Add weather effects
        if weather_intensity > 0:
            max_turbulence = 5.0 * weather_intensity
            turbulence = np.random.normal(0, max_turbulence)
            vertical_speed += turbulence
            
        # Calculate acceleration from thrust and drag
        accel = (thrust - drag) / self.mass
        
        # Update forward speed based on acceleration
        forward_speed = speed + accel * dt
        forward_speed = np.clip(forward_speed, self.min_speed, self.max_speed)
        
        # Update velocity components maintaining energy relationship
        horizontal_speed = np.sqrt(max(0, forward_speed * forward_speed - vertical_speed * vertical_speed))
        self.velocity = np.array([
            horizontal_speed * np.cos(self.attitude[2]),  # X
            vertical_speed,                               # Y
            horizontal_speed * np.sin(self.attitude[2])   # Z
        ])
        
        # Update position
        self.position += self.velocity * dt
        self.position[1] = np.clip(self.position[1], 0, self.max_altitude)
        
        # Calculate moments with smoother transitions
        control_effectiveness = 8.0
        target_pitch_rate = -self.elevator * control_effectiveness
        current_pitch_rate = self.angular_velocity[0]
        
        # Smooth pitch rate changes with faster response
        if target_pitch_rate > current_pitch_rate:
            pitch_rate = min(target_pitch_rate, current_pitch_rate + 6.0 * dt)
        else:
            pitch_rate = max(target_pitch_rate, current_pitch_rate - 6.0 * dt)
            
        angular_accel = np.array([
            (pitch_rate - current_pitch_rate) / dt,  # Pitch
            self.aileron * control_effectiveness,    # Roll
            self.rudder * control_effectiveness      # Yaw
        ])
        
        # Add stall effects
        if abs(pitch) > self.stall_angle:
            # Strong nose-down moment in stall
            stall_moment = -60.0 * (abs(pitch) - self.stall_angle)  # Even stronger nose-down
            angular_accel[0] += stall_moment
            
            # Reduced control effectiveness in stall
            angular_accel *= 0.005  # Almost no control in stall
            
            # Add roll instability in stall
            if abs(self.attitude[1]) > 0.1:
                angular_accel[1] += np.sign(self.attitude[1]) * 20.0  # Even more roll instability
                
        # Scale control effectiveness with airspeed
        speed_factor = np.clip(speed / self.min_speed, 0, 1)
        angular_accel *= speed_factor
        
        # Update angular velocity with damping
        damping = 0.9
        self.angular_velocity = (self.angular_velocity + angular_accel * dt) * damping
        self.angular_velocity = np.clip(self.angular_velocity, -1.5, 1.5)
        
        # Update attitude
        new_attitude = self.attitude + self.angular_velocity * dt
        new_attitude[0] = np.clip(new_attitude[0], -self.max_pitch, self.max_pitch)
        new_attitude[1] = np.clip(new_attitude[1], -self.max_roll, self.max_roll)
        new_attitude[2] = np.mod(new_attitude[2], 2 * np.pi)
        
        self.attitude = new_attitude
        
    def _update_controls(self, dt):
        """Update control surface positions based on targets"""
        # Update each control surface
        for control in ['elevator', 'aileron', 'rudder']:
            current = getattr(self, control)
            target = self.control_targets[control] + self.trim[control]
            
            # Move toward target
            if current < target:
                new_value = min(target, current + self.control_rate * dt)
            else:
                new_value = max(target, current - self.control_rate * dt)
                    
            setattr(self, control, new_value)
        
        # Update throttle (smoother changes)
        current = self.throttle
        target = self.control_targets['throttle']
        if current < target:
            self.throttle = min(target, current + 0.5 * dt)
        else:
            self.throttle = max(target, current - 0.5 * dt)
        
    def get_instrument_readings(self):
        """Get the current instrument readings."""
        speed = np.linalg.norm(self.velocity)
        return {
            'airspeed': speed,
            'altitude': self.position[1],
            'heading': np.degrees(self.attitude[2]) % 360,
            'pitch': np.degrees(self.attitude[0]),
            'roll': np.degrees(self.attitude[1]),
            'vertical_speed': self.velocity[1],  # Positive is up
            'throttle': self.throttle,
            'elevator': self.elevator,
            'aileron': self.aileron,
            'rudder': self.rudder
        }
        
    def apply_control_input(self, control, value):
        """Set control target positions"""
        if control == 'throttle':
            # Throttle is cumulative
            self.control_targets['throttle'] = np.clip(self.control_targets['throttle'] + value * 0.1, 0, 1)
        else:
            # Other controls are now incremental too
            current = self.control_targets[control]
            new_value = current + value * self.control_increment
            self.control_targets[control] = np.clip(new_value, -1, 1)
            
    def set_trim(self, control, value):
        """Set trim for a control surface"""
        if control in self.trim:
            self.trim[control] = np.clip(value, -1, 1) 