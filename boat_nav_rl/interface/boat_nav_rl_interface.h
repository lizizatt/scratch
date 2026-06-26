/**
 * boat_nav_rl_interface.h
 *
 * Stable C ABI between RL training (Python) and the vehicle control stack.
 * Must match prepare.pack_observation() flat layout (schema v4).
 * Version bumps require BNRL_SCHEMA_VERSION increment and ONNX re-export.
 */
#ifndef BOAT_NAV_RL_INTERFACE_H
#define BOAT_NAV_RL_INTERFACE_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define BNRL_MAX_CONTACTS 8
#define BNRL_SCHEMA_VERSION 4

/** Per-contact: bearing(2) + range(1) + rel_cog(2) + rel_vel_body(2) + radius(1) = 8 */
#define BNRL_CONTACT_OBS_DIM 8

/**
 * Flat obs row-major layout (matches prepare.pack_observation):
 *   own(6) + water_current(3) + contacts(8*8) + mask(8) + goal(3) + has_goal(1) = 85
 *
 * own[0..5]:   heading/pi, speed/V_MAX, yaw_rate/YAW_MAX, pos_x/POS_SCALE, pos_y/POS_SCALE, reserved(0)
 * current[6..8]: speed/CURRENT_MAX, sin(direction), cos(direction)
 * contact i base 9+i*8:
 *   bearing_sin, bearing_cos, range/RANGE_SCALE,
 *   rel_cog_sin, rel_cog_cos (contact COG relative to own bow),
 *   rel_vel_fwd/REL_VEL_SCALE, rel_vel_stbd/REL_VEL_SCALE (body-frame ground rel vel),
 *   radius/RADIUS_SCALE
 * mask[73..80]: 1.0 if contact slot active
 * goal[81..83]: bearing_sin, bearing_cos, range/RANGE_SCALE
 * has_goal[84]: 1.0 if goal fields valid
 */
#define BNRL_OBS_FLAT_LEN (6 + 3 + (BNRL_MAX_CONTACTS * BNRL_CONTACT_OBS_DIM) + BNRL_MAX_CONTACTS + 3 + 1)

#define BNRL_OBS_OWN_DIM 6
#define BNRL_OBS_CURRENT_DIM 3
#define BNRL_OBS_GOAL_DIM 3
#define BNRL_OBS_MASK_OFFSET (BNRL_OBS_OWN_DIM + BNRL_OBS_CURRENT_DIM + BNRL_MAX_CONTACTS * BNRL_CONTACT_OBS_DIM)
#define BNRL_OBS_GOAL_OFFSET (BNRL_OBS_MASK_OFFSET + BNRL_MAX_CONTACTS)
#define BNRL_OBS_HAS_GOAL_OFFSET (BNRL_OBS_GOAL_OFFSET + BNRL_OBS_GOAL_DIM)

/** Set in bnrl_observation_t.has_goal when goal fields are valid. */
#define BNRL_OBS_HAS_GOAL 1u

typedef struct {
    double timestamp_s;
    double heading_rad;       /* true heading, 0 = north, +CW */
    double speed_mps;         /* through-water speed at own ship */
    double yaw_rate_rps;
    double pos_x_m;           /* local frame, origin at episode reset */
    double pos_y_m;
    double reserved_own;      /* flat obs index 5 — always 0.0 in training */
    double current_speed_mps;
    double current_sin;
    double current_cos;
    uint32_t num_contacts;
    uint32_t has_goal;
    double goal_bearing_sin;
    double goal_bearing_cos;
    double goal_range_m;
    struct {
        double bearing_sin;
        double bearing_cos;
        double range_m;
        double rel_cog_sin;
        double rel_cog_cos;
        double rel_vel_fwd_mps;
        double rel_vel_stbd_mps;
        double radius_m;
    } contacts[BNRL_MAX_CONTACTS];
} bnrl_observation_t;

typedef struct {
    double desired_heading_rad;
    double desired_speed_mps;
} bnrl_action_t;

typedef struct {
    double total;
    double rule_applicability;
    double give_way_obligations;
    double stand_on_obligations;
    double cpa_margin;
    double speed_in_separation;
} bnrl_colregs_score_t;

typedef struct bnrl_vessel_state bnrl_vessel_state_t;

bnrl_vessel_state_t* bnrl_create(const char* config_json_path);

void bnrl_destroy(bnrl_vessel_state_t* state);

int bnrl_step(
    bnrl_vessel_state_t* state,
    const bnrl_action_t* action,
    bnrl_observation_t* obs_out,
    int* encounter_closed_out,
    bnrl_colregs_score_t* colregs_out
);

int bnrl_observation_to_flat(
    const bnrl_observation_t* obs,
    float out[BNRL_OBS_FLAT_LEN]
);

int bnrl_action_from_flat(
    bnrl_vessel_state_t* state,
    const float in[2],
    bnrl_action_t* action_out
);

#ifdef __cplusplus
}
#endif

#endif /* BOAT_NAV_RL_INTERFACE_H */
