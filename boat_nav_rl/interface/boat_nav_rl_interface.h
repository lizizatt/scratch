/**
 * boat_nav_rl_interface.h
 *
 * Stable C ABI between RL training (Python) and the vehicle control stack.
 * Version bumps require SCHEMA_VERSION increment and re-export of ONNX normalization.
 */
#ifndef BOAT_NAV_RL_INTERFACE_H
#define BOAT_NAV_RL_INTERFACE_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define BNRL_MAX_CONTACTS 8
#define BNRL_SCHEMA_VERSION 2

/** Per-contact flat fields: bearing(2) + range(1) + cog(2) + sog(1) + speed(1) = 7 */
#define BNRL_CONTACT_OBS_DIM 7

/** Flat obs: own(6) + wind(3) + contacts(7*8) + mask(8) + goal(3) + has_goal(1) = 77 */
#define BNRL_OBS_FLAT_LEN (6 + 3 + (BNRL_MAX_CONTACTS * BNRL_CONTACT_OBS_DIM) + BNRL_MAX_CONTACTS + 3 + 1)

/** Set in bnrl_observation_t.has_goal when goal_bearing / goal_speed are valid. */
#define BNRL_OBS_HAS_GOAL 1u

typedef struct {
    double timestamp_s;
    double heading_rad;       /* true heading, 0 = north, +CW (document in stack) */
    double speed_mps;         /* SOG or through-water — stack defines which */
    double yaw_rate_rps;
    double pos_x_m;           /* local frame, origin at own ship at reset */
    double pos_y_m;
    double aws_mps;           /* apparent wind speed */
    double awa_sin;           /* sin(apparent wind angle rel. bow) */
    double awa_cos;           /* cos(apparent wind angle rel. bow) */
    uint32_t num_contacts;    /* active entries in contacts[]; remainder padded */
    uint32_t has_goal;        /* BNRL_OBS_HAS_GOAL if goal fields valid */
    double goal_bearing_sin;  /* bearing to waypoint in own-ship frame */
    double goal_bearing_cos;
    double goal_speed_mps;
    struct {
        double bearing_sin;   /* true bearing to contact from own ship */
        double bearing_cos;
        double range_m;
        double cog_sin;       /* contact course over ground */
        double cog_cos;
        double sog_mps;       /* contact speed over ground */
        double speed_mps;     /* contact speed through water */
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
 * Applies normalization using parameters stored in state (from training sidecar).
 * mask[i] = 1.0 if contact i active, else 0.0.
 */
int bnrl_observation_to_flat(
    const bnrl_observation_t* obs,
    float out[BNRL_OBS_FLAT_LEN]
);

/**
 * Denormalize policy outputs into action struct.
 * in[0] = desired_heading, in[1] = desired_speed (network output space).
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
