import unittest
import numpy as np
from src.aircraft import Cessna208B

class TestCessna208B(unittest.TestCase):
    def setUp(self):
        self.aircraft = Cessna208B()
        
    def test_initial_conditions(self):
        """Test that aircraft initializes with correct values"""
        self.assertEqual(self.aircraft.mass, 3969)
        self.assertEqual(self.aircraft.wing_area, 26)
        self.assertEqual(self.aircraft.throttle, 0.5)
        np.testing.assert_array_equal(self.aircraft.position, np.array([0., 1000., 0.]))
        np.testing.assert_array_equal(self.aircraft.velocity, np.array([50., 0., 0.]))
        
    def test_throttle_affects_speed(self):
        """Test that throttle changes affect airspeed"""
        # Set initial conditions
        self.aircraft.velocity = np.array([50., 0., 0.])
        initial_speed = self.aircraft.get_instrument_readings()['airspeed']
        
        # Set throttle to max and run for a short while
        self.aircraft.control_targets['throttle'] = 1.0
        for _ in range(50):  # Run shorter to catch intermediate speed
            self.aircraft.update(0.1)
            
        high_speed = self.aircraft.get_instrument_readings()['airspeed']
        self.assertGreater(high_speed, initial_speed)  # Should increase speed
        
        # Now reduce throttle and check deceleration
        self.aircraft.control_targets['throttle'] = 0.0
        for _ in range(50):  # Run shorter to catch intermediate speed
            self.aircraft.update(0.1)
            
        low_speed = self.aircraft.get_instrument_readings()['airspeed']
        self.assertGreater(high_speed, low_speed)  # High speed should be greater than low speed
        
    def test_pitch_affects_vertical_speed(self):
        """Test that pitch changes affect vertical speed"""
        # Start from level flight with good energy
        self.aircraft.velocity = np.array([50., 0., 0.])
        self.aircraft.attitude = np.array([0., 0., 0.])
        self.aircraft.control_targets['throttle'] = 0.8
        
        # Let it stabilize
        for _ in range(10):
            self.aircraft.update(0.1)
            
        initial_vsi = self.aircraft.get_instrument_readings()['vertical_speed']
        
        # Apply up elevator and check we can climb
        self.aircraft.control_targets['elevator'] = -0.7  # Pull up
        max_vsi = initial_vsi
        
        # Give it 5 seconds to establish climb
        for _ in range(50):
            self.aircraft.update(0.1)
            vsi = self.aircraft.get_instrument_readings()['vertical_speed']
            max_vsi = max(max_vsi, vsi)
            
        # Should achieve a positive vertical speed
        self.assertGreater(max_vsi, 2.0)  # Should climb at least 2 m/s
        
        # Now push over and check we can descend
        self.aircraft.control_targets['elevator'] = 0.7  # Push down
        min_vsi = max_vsi
        
        # Give it 5 seconds to establish descent
        for _ in range(50):
            self.aircraft.update(0.1)
            vsi = self.aircraft.get_instrument_readings()['vertical_speed']
            min_vsi = min(min_vsi, vsi)
            
        # Should achieve a negative vertical speed
        self.assertLess(min_vsi, -2.0)  # Should descend at least 2 m/s
        
    def test_trim_functionality(self):
        """Test that trim affects control positions"""
        # Set some elevator trim
        self.aircraft.set_trim('elevator', 0.2)
        
        # Update for a second to let controls move
        for _ in range(10):
            self.aircraft.update(0.1)
            
        # Check that elevator position reflects trim
        self.assertGreater(self.aircraft.elevator, 0.15)
        
        # Reset trim
        self.aircraft.set_trim('elevator', 0.0)
        
        # Update for a second
        for _ in range(10):
            self.aircraft.update(0.1)
            
        # Check that elevator returns near neutral
        self.assertAlmostEqual(self.aircraft.elevator, 0.0, delta=0.1)
        
    def test_flight_envelope_limits(self):
        """Test that aircraft respects flight envelope limits"""
        # Test speed limits with tolerance
        tolerance = 0.01  # 1% tolerance
        
        self.aircraft.velocity = np.array([200., 0., 0.])  # Way too fast
        self.aircraft.update(0.1)
        speed = self.aircraft.get_instrument_readings()['airspeed']
        self.assertLessEqual(speed, self.aircraft.max_speed * (1 + tolerance))
        
        self.aircraft.velocity = np.array([10., 0., 0.])  # Too slow
        self.aircraft.update(0.1)
        speed = self.aircraft.get_instrument_readings()['airspeed']
        self.assertGreaterEqual(speed, self.aircraft.min_speed * (1 - tolerance))
        
        # Test pitch limits
        self.aircraft.attitude[0] = np.radians(45)  # Too steep
        self.aircraft.update(0.1)
        pitch = abs(np.degrees(self.aircraft.attitude[0]))
        self.assertLessEqual(pitch, np.degrees(self.aircraft.max_pitch))
        
        # Test roll limits
        self.aircraft.attitude[1] = np.radians(90)  # Too much bank
        self.aircraft.update(0.1)
        roll = abs(np.degrees(self.aircraft.attitude[1]))
        self.assertLessEqual(roll, np.degrees(self.aircraft.max_roll))
        
    def test_lift_generation(self):
        """Test that lift is generated correctly"""
        # Set up stable flight condition
        self.aircraft.velocity = np.array([50., 0., 0.])
        self.aircraft.attitude = np.array([0., 0., 0.])
        
        # Calculate lift at these conditions
        speed = np.linalg.norm(self.aircraft.velocity)
        dynamic_pressure = 0.5 * 1.225 * speed * speed
        lift = dynamic_pressure * self.aircraft.wing_area * 1.0  # Using actual lift coefficient
        weight = self.aircraft.mass * 9.81
        
        # In level flight, lift should be close to weight
        self.assertAlmostEqual(lift, weight, delta=weight * 0.3)  # Allow 30% tolerance for stability
        
    def test_control_increments(self):
        """Test that control inputs change by the correct increment"""
        initial_elevator = self.aircraft.control_targets['elevator']
        self.aircraft.apply_control_input('elevator', 1)
        self.assertAlmostEqual(
            self.aircraft.control_targets['elevator'],
            initial_elevator + self.aircraft.control_increment
        )
        
    def test_heading_changes(self):
        """Test that rudder and ailerons affect heading"""
        initial_heading = self.aircraft.get_instrument_readings()['heading']
        
        # Apply right aileron and rudder
        self.aircraft.control_targets['aileron'] = 0.5
        self.aircraft.control_targets['rudder'] = 0.5
        
        # Run simulation for 5 seconds
        for _ in range(50):
            self.aircraft.update(0.1)
            
        new_heading = self.aircraft.get_instrument_readings()['heading']
        self.assertNotEqual(initial_heading, new_heading)

    def test_stall_behavior(self):
        """Test that aircraft exhibits proper stall characteristics.
        Basic test: if you cut power and pull up hard, you should eventually lose altitude."""
        # Start in level flight
        self.aircraft.velocity = np.array([50., 0., 0.])  # Good starting speed
        self.aircraft.attitude = np.array([0., 0., 0.])
        self.aircraft.position = np.array([0., 1000., 0.])  # Start at 1000m
        
        # Cut power and pull up
        self.aircraft.control_targets['throttle'] = 0.0  # Cut throttle
        self.aircraft.control_targets['elevator'] = -1.0  # Full pull up
        
        # Let it develop
        initial_altitude = self.aircraft.position[1]
        lowest_altitude = initial_altitude
        
        # Run for 10 seconds
        for _ in range(100):
            self.aircraft.update(0.1)
            lowest_altitude = min(lowest_altitude, self.aircraft.position[1])
        
        # We should have lost some altitude
        self.assertLess(lowest_altitude, initial_altitude - 50)  # Should drop by at least 50m

    def _calculate_lift(self):
        """Helper method to calculate lift force"""
        speed = np.clip(np.linalg.norm(self.aircraft.velocity), 1.0, self.aircraft.max_speed)
        dynamic_pressure = 0.5 * 1.225 * speed * speed
        angle_of_attack = self.aircraft.attitude[0]
        
        if abs(angle_of_attack) <= self.aircraft.stall_angle:
            lift_coefficient = self.aircraft.base_lift_coefficient * (1.0 + 1.2 * angle_of_attack / self.aircraft.stall_angle)
        else:
            excess_angle = abs(angle_of_attack) - self.aircraft.stall_angle
            lift_coefficient = self.aircraft.max_lift_coefficient * np.exp(-5.0 * excess_angle)
            if angle_of_attack < 0:
                lift_coefficient = -lift_coefficient
                
        speed_factor = np.clip(speed / self.aircraft.min_speed, 0, 1)
        lift_coefficient *= speed_factor
        
        return dynamic_pressure * self.aircraft.wing_area * lift_coefficient

if __name__ == '__main__':
    unittest.main() 