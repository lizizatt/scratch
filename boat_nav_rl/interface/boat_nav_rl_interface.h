/**
 * boat_nav_rl_interface.h
 *
 * Stable C ABI between RL training (Python) and the vehicle control stack.
 * Must match prepare.pack_observation() flat layout (schema v3).
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
#define BNRL_SCHEMA_VERSION 3

/** Per-contact flat fields: bearing(2) + range(1) + cog(2) + sog(1) + radius(1) = 7 */
#define BNRL_CONTACT_OBS_DIM 7

/**
 * Flat obs row-major layout (matches prepare.pack_observation):
 *   own(6) + water_current(3) + contacts(7*8) + mask(8) + goal(3) + has_goal(1) = 77
 *
 * own[0..5]:   heading/pi, speed/V_MAX, yaw_rate/YAW_MAX, pos_x/POS_SCALE, pos_y/POS_SCALE, reserved(0)
 * current[6..8]: speed/CURRENT_MAX, sin(direction), cos(direction)  [wind slots repurposed]
 * contact i base 9+i*7: bearing_sin, bearing_cos, range/RANGE_SCALE, cog_sin, cog_cos, sog/V_MAX, radius/RADIUS_SCALE
 * mask[65..72]: 1.0 if contact slot active
 * goal[73..75]: bearing_sin, bearing_cos, range/RANGE_SCALE
 * has_goal[76]: 1.0 if goal fields valid
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
    double heading_rad;       /* true heading, 0 = north, +CW (document in stack) */
    double speed_mps;         /* through-water speed at own ship */
    double yaw_rate_rps;
    double pos_x_m;           /* local frame, origin at own ship at episode reset */
    double pos_y_m;
    double reserved_own;      /* flat obs index 5 — always 0.0 in training */
    double current_speed_mps; /* water current speed (flat obs 6) */
    double current_sin;       /* sin(current direction), flat obs 7 */
    double current_cos;       /* cos(current direction), flat obs 8 */
    uint32_t num_contacts;    /* active entries in contacts[]; remainder padded */
    uint32_t has_goal;        /* BNRL_OBS_HAS_GOAL if goal fields valid */
    double goal_bearing_sin;
    double goal_bearing_cos;
    double goal_range_m;      /* slant range to waypoint (flat obs 75 uses range/RANGE_SCALE) */
    struct {
        double bearing_sin;
        double bearing_cos;
        double range_m;
        double cog_sin;
        double cog_cos;
        double sog_mps;
        double radius_m;      /* contact vessel radius (flat obs uses radius/RADIUS_SCALE) */
    } contacts[BNRL_MAX_CONTACTS];
} bnrl_observation_t;

typedef struct {
    double desired_heading_rad; /* absolute setpoint */
    double desired_speed_mps;
} bnrl_action_t;

/**
 * COLREGs compliance breakdown from the vehicle stack.
 * All fields use the same scale; document whether [0,1] or [-1,1] in stack README.
 */
typedef struct {
    double total;
    double rule_applicability;
    double give_way_obligations;
    double stand_on_obligations;
    double cpa_margin;
    double speed_in_separation;
} bnrl_colregs_score_t;

typedef struct bnrl_vessel_state bnrl_vessel_state_t;

/** Create sim or live adapter from JSON config path. Returns NULL on failure. */
bnrl_vessel_state_t* bnrl_create(const char* config_json_path);

void bnrl_destroy(bnrl_vessel_state_t* state);

/**
 * Apply setpoints to transfer-function plant (sim) or live stack (deploy),
 * advance one planner tick (dt in config), fill observation.
 *
 * colregs_out is written only when *encounter_closed_out is non-zero
 * (evaluator runs after encounter closes, not every tick).
 * Returns 0 on success, non-zero on error.
 */
int bnrl_step(
    bnrl_vessel_state_t* state,
    const bnrl_action_t* action,
    bnrl_observation_t* obs_out,
    int* encounter_closed_out,
    bnrl_colregs_score_t* colregs_out
);

/**
 * Pack observation into row-major float vector for ONNX / PyTorch.
 * Layout must match prepare.pack_observation() in Python training (schema v3).
 * mask[i] = 1.0 if contact i active, else 0.0.
 */
int bnrl_observation_to_flat(
    const bnrl_observation_t* obs,
    float out[BNRL_OBS_FLAT_LEN]
);

/**
 * Denormalize policy outputs into action struct.
 * in[0], in[1] are normalized actions in [-1, 1] (SB3 Box space).
 */
int bnrl_action_from_flat(
    bnrl_vessel_state_t* state,
    const float in[2],
    bnrl_action_t* action_out
);

#ifdef __cplusplus
}
#endif

#endif /* BOAT_NAV_RL_INTERFACE_H */
