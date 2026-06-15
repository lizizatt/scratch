"""Parse vessel states from sim trace step dicts."""

from __future__ import annotations

from typing import Any, Dict, Optional

import prepare as P


def own_from_step(step: Dict[str, Any]) -> P.VesselState:
    o = step["own"]
    return P.VesselState(
        x_m=float(o["x"]),
        y_m=float(o["y"]),
        heading_rad=float(o["heading"]),
        speed_mps=float(o["speed"]),
        cmd_heading_rad=float(o.get("cmd_heading", o["heading"])),
        cmd_speed_mps=float(o.get("cmd_speed", o["speed"])),
    )


def contact_from_step(step: Dict[str, Any], contact_idx: int) -> Optional[P.ContactState]:
    contacts = step.get("contacts") or []
    if contact_idx >= len(contacts):
        return None
    c = contacts[contact_idx]
    return P.ContactState(
        x_m=float(c["x"]),
        y_m=float(c["y"]),
        cog_rad=float(c["cog"]),
        sog_mps=float(c["sog"]),
        speed_mps=float(c["sog"]),
        radius_m=float(c.get("radius_m", P.OWN_RADIUS_M)),
        vessel_class=str(c.get("vessel_class", P.DEFAULT_VESSEL_CLASS)),
    )


def contact_radius_from_step(step: Dict[str, Any], contact_idx: int) -> float:
    contacts = step.get("contacts") or []
    if contact_idx >= len(contacts):
        return P.OWN_RADIUS_M
    return float(contacts[contact_idx].get("radius_m", P.OWN_RADIUS_M))
