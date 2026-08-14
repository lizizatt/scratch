"""Validate machine-readable mathematical claim ledgers."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections.abc import Mapping
from pathlib import Path
from typing import Any

VALID_STATUSES = {"established", "proved", "conjectured", "blocked", "refuted"}
VALID_KINDS = {
    "assumption",
    "computation",
    "computation_bridge",
    "definition",
    "lemma",
    "observation",
    "theorem",
}
SETTLED_STATUSES = {"established", "proved"}
EVIDENCE_STATUSES = {*SETTLED_STATUSES, "refuted"}
RESOLVED_TARGET_STATUSES = {*SETTLED_STATUSES, "refuted"}
CONVERGED_GAUNTLET_RESULTS = {
    "converged_no_findings",
    "converged_no_verified_findings",
}
GAUNTLET_RESULTS = {
    *CONVERGED_GAUNTLET_RESULTS,
    "valid_findings_repaired",
    "stopped_with_blocker",
}
DOCUMENTED_CLAIM_ID = r"[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+"
DOCUMENTED_CLAIM_PATTERN = re.compile(rf"\b{DOCUMENTED_CLAIM_ID}\b")
CLAY_TARGET_CONTRACTS = {
    "A": {
        "quantifier": "for_every_admissible_datum",
        "domain": "R3",
        "force": "zero",
        "datum": "smooth_divergence_free_rapidly_decreasing",
        "conclusion": "global_smooth_velocity_pressure_uniform_kinetic_energy",
    },
    "B": {
        "quantifier": "for_every_admissible_datum",
        "domain": "T3",
        "force": "zero",
        "datum": "smooth_divergence_free_periodic",
        "conclusion": "global_smooth_periodic_velocity_pressure",
    },
    "C": {
        "quantifier": "there_exists_admissible_datum_and_force",
        "domain": "R3",
        "force": "smooth_rapidly_decreasing",
        "datum": "smooth_divergence_free_rapidly_decreasing",
        "conclusion": "no_global_smooth_uniform_energy_solution",
    },
    "D": {
        "quantifier": "there_exists_admissible_datum_and_force",
        "domain": "T3",
        "force": "smooth_periodic_time_decaying",
        "datum": "smooth_divergence_free_periodic",
        "conclusion": "no_global_smooth_periodic_solution",
    },
}


class DuplicateJsonKeyError(ValueError):
    """Raised when a JSON object repeats a member name."""


def _reject_duplicate_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise DuplicateJsonKeyError(f"duplicate JSON member: {key}")
        result[key] = value
    return result


def _load_json(text: str) -> Any:
    return json.loads(text, object_pairs_hook=_reject_duplicate_pairs)


def _nonempty_strings(value: object) -> bool:
    return (
        isinstance(value, list)
        and bool(value)
        and all(isinstance(item, str) and bool(item.strip()) for item in value)
    )


def _markdown_anchors(path: Path) -> set[str]:
    anchors: set[str] = set()
    counts: dict[str, int] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        match = re.match(r"^#{1,6}\s+(.+?)\s*#*\s*$", line)
        if match is None:
            continue
        heading = match.group(1).lower()
        heading = re.sub(r"[^\w\s-]", "", heading)
        base = re.sub(r"[\s-]+", "-", heading).strip("-")
        if not base:
            continue
        count = counts.get(base, 0)
        counts[base] = count + 1
        anchors.add(base if count == 0 else f"{base}-{count}")
    return anchors


def _validate_reference(reference: str, root: Path, owner: str) -> list[str]:
    path_text, separator, anchor = reference.partition("#")
    try:
        reference_path = Path(path_text)
    except (TypeError, ValueError, OSError) as error:
        return [f"{owner} is not a valid path: {reference}: {error}"]
    if not path_text or reference_path.is_absolute():
        return [f"{owner} must be a repository-relative reference: {reference}"]

    root = root.resolve()
    try:
        path = (root / reference_path).resolve()
    except (ValueError, OSError) as error:
        return [f"{owner} is not a valid path: {reference}: {error}"]
    try:
        path.relative_to(root)
    except ValueError:
        return [f"{owner} escapes the repository: {reference}"]
    if not path.is_file():
        return [f"{owner} does not exist: {reference}"]
    if separator:
        if not anchor:
            return [f"{owner} has an empty anchor: {reference}"]
        if path.suffix.lower() != ".md":
            return [f"{owner} anchors require Markdown: {reference}"]
        if anchor not in _markdown_anchors(path):
            return [f"{owner} anchor does not exist: {reference}"]
    return []


def _find_repository_root(ledger: Path, explicit_root: Path | None) -> Path | None:
    if explicit_root is not None:
        return explicit_root.resolve()

    starts = (ledger.resolve().parent, Path.cwd().resolve())
    for start in starts:
        for candidate in (start, *start.parents):
            if (
                (candidate / "pyproject.toml").is_file()
                and (candidate / "ns_millennium").is_dir()
            ):
                return candidate
    return None


def _target_subject_sha256(
    target: str,
    claims: Mapping[str, Mapping[str, Any]],
    root: Path | None = None,
) -> str:
    pending = [target]
    closure: dict[str, Mapping[str, Any]] = {}
    while pending:
        claim_id = pending.pop()
        if claim_id in closure or claim_id not in claims:
            continue
        claim = claims[claim_id]
        normalized = dict(claim)
        normalized.pop("certification", None)
        closure[claim_id] = normalized
        dependencies = claim.get("depends_on")
        if isinstance(dependencies, list):
            pending.extend(
                item for item in dependencies if isinstance(item, str)
            )

    artifact_hashes: dict[str, str] = {}
    if root is not None:
        for claim in closure.values():
            references: list[str] = []
            evidence = claim.get("evidence")
            if isinstance(evidence, list):
                references.extend(item for item in evidence if isinstance(item, str))
            for field in ("proof_artifact", "counterexample_artifact"):
                reference = claim.get(field)
                if isinstance(reference, str):
                    references.append(reference)
            for reference in references:
                path_text = reference.partition("#")[0]
                try:
                    path = (root / path_text).resolve()
                    path.relative_to(root.resolve())
                except (ValueError, OSError):
                    continue
                if path.is_file():
                    artifact_hashes[reference] = _file_sha256(path)

    serialized = json.dumps(
        {"claims": closure, "artifacts": artifact_hashes},
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    )
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def _load_review(
    reference: str, root: Path, owner: str
) -> tuple[Mapping[str, Any] | None, list[str]]:
    errors = _validate_reference(reference, root, owner)
    if errors:
        return None, errors
    if "#" in reference or Path(reference).suffix.lower() != ".json":
        return None, [f"{owner} must reference a JSON file: {reference}"]
    try:
        value = _load_json((root / reference).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, DuplicateJsonKeyError) as error:
        return None, [f"{owner} is not valid JSON: {reference}: {error}"]
    if not isinstance(value, Mapping):
        return None, [f"{owner} JSON root must be an object: {reference}"]
    return value, []


def _file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _documented_claims(
    root: Path,
) -> tuple[set[str], dict[str, set[str]], list[str]]:
    claim_ids: set[str] = set()
    statuses: dict[str, set[str]] = {}
    errors: list[str] = []
    docs = root / "docs"
    if not docs.is_dir():
        return claim_ids, statuses, errors

    inline_pattern = re.compile(
        rf"Claim\s+({DOCUMENTED_CLAIM_ID})\s+\(`?"
        rf"({'|'.join(sorted(VALID_STATUSES))})`?\)"
    )
    for path in docs.rglob("*.md"):
        for line in path.read_text(encoding="utf-8").splitlines():
            for inline_match in inline_pattern.finditer(line):
                claim_id = inline_match.group(1)
                claim_ids.add(claim_id)
                statuses.setdefault(claim_id, set()).add(inline_match.group(2))

            if not line.lstrip().startswith("|"):
                continue
            cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
            declared_ids = set(DOCUMENTED_CLAIM_PATTERN.findall(cells[0]))
            claim_ids.update(declared_ids)
            if not declared_ids:
                continue
            cell_statuses = {
                normalized
                for cell in cells
                if (normalized := re.sub(r"[`*_\s]", "", cell).lower())
                in VALID_STATUSES
            }
            if len(cell_statuses) != 1:
                errors.append(
                    f"documented claim row has {len(cell_statuses)} statuses in "
                    f"{path.relative_to(root)}: {sorted(declared_ids)}"
                )
                continue
            status = next(iter(cell_statuses))
            for claim_id in declared_ids:
                statuses.setdefault(claim_id, set()).add(status)
    return claim_ids, statuses, errors


def _validate_gauntlet_chain(
    reference: str, root: Path, owner: str, target: str
) -> list[str]:
    errors: list[str] = []
    current_reference: str | None = reference
    seen: set[str] = set()
    history: list[tuple[str, Mapping[str, Any]]] = []
    head_round_number: int | None = None
    is_head = True
    while current_reference is not None:
        if current_reference in seen:
            errors.append(f"{owner} gauntlet history contains a cycle")
            break
        seen.add(current_reference)
        if not current_reference.startswith("artifacts/gauntlet/round-"):
            errors.append(
                f"{owner} must reference artifacts/gauntlet/round-NNN.json: "
                f"{current_reference}"
            )
            break
        review, review_errors = _load_review(current_reference, root, owner)
        errors.extend(review_errors)
        if review is None:
            break

        round_id = review.get("round_id")
        match = re.fullmatch(r"round-(\d{3})", round_id if isinstance(round_id, str) else "")
        if match is None:
            errors.append(f"{owner} has invalid round_id: {round_id}")
            break
        round_number = int(match.group(1))
        filename_match = re.fullmatch(
            r"artifacts/gauntlet/round-(\d{3})\.json", current_reference
        )
        filename_number = int(filename_match.group(1)) if filename_match else None
        if filename_number != round_number:
            errors.append(
                f"{owner} filename does not match round_id: {current_reference}"
            )
            break
        if head_round_number is None:
            head_round_number = round_number

        if review.get("schema_version") not in {1, 2}:
            errors.append(f"{owner} history node has unsupported schema_version")
        if is_head:
            if review.get("target_claim_id") != target:
                errors.append(f"{owner} history head does not review target {target}")
            if not isinstance(review.get("subject_sha256"), str) or not review.get(
                "subject_sha256"
            ):
                errors.append(f"{owner} history head has no subject_sha256")
        if not isinstance(review.get("date"), str) or not review.get("date"):
            errors.append(f"{owner} history node has no date")
        if not isinstance(review.get("reviewers"), list):
            errors.append(f"{owner} history node reviewers must be a list")
        if not isinstance(review.get("validation"), list):
            errors.append(f"{owner} history node validation must be a list")
        if not isinstance(review.get("converged"), bool):
            errors.append(f"{owner} history node converged must be boolean")
        if review.get("result") not in GAUNTLET_RESULTS:
            errors.append(f"{owner} history node has invalid result")
        if not isinstance(review.get("unresolved_valid_findings"), list):
            errors.append(
                f"{owner} history node unresolved_valid_findings must be a list"
            )
        history_findings = review.get("findings")
        if not isinstance(history_findings, list):
            errors.append(f"{owner} history node findings must be a list")
        history.append((current_reference, review))
        previous = review.get("previous_round")
        previous_hash = review.get("previous_round_sha256")
        if round_number == 1:
            if previous is not None or previous_hash is not None:
                errors.append(f"{owner} round-001 must not name a previous round")
            break
        expected = f"artifacts/gauntlet/round-{round_number - 1:03d}.json"
        if previous != expected:
            errors.append(
                f"{owner} expected previous_round {expected}, got {previous}"
            )
            break
        previous_path = (root / expected).resolve()
        if not previous_path.is_file():
            errors.append(f"{owner} previous round does not exist: {expected}")
            break
        actual_hash = _file_sha256(previous_path)
        if previous_hash != actual_hash:
            errors.append(f"{owner} previous round hash mismatch: {expected}")
            break
        current_reference = expected
        is_head = False

    known_fingerprints: set[str] = set()
    for _, review in reversed(history):
        history_findings = review.get("findings")
        if not isinstance(history_findings, list):
            continue
        for finding in history_findings:
            if not isinstance(finding, Mapping):
                continue
            fingerprint = finding.get("fingerprint")
            disposition = finding.get("disposition")
            if disposition == "duplicate":
                duplicate_of = finding.get("duplicate_of")
                if (
                    not isinstance(duplicate_of, str)
                    or duplicate_of not in known_fingerprints
                ):
                    errors.append(
                        f"{owner} duplicate finding has no prior fingerprint"
                    )
                elif fingerprint != duplicate_of:
                    errors.append(
                        f"{owner} duplicate finding fingerprint does not match"
                    )
            if isinstance(fingerprint, str) and fingerprint:
                known_fingerprints.add(fingerprint)

    latest_round = 0
    gauntlet_dir = root / "artifacts" / "gauntlet"
    if gauntlet_dir.is_dir():
        for path in gauntlet_dir.glob("round-*.json"):
            try:
                candidate = _load_json(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError, DuplicateJsonKeyError):
                continue
            if not isinstance(candidate, Mapping):
                continue
            if candidate.get("target_claim_id") != target:
                continue
            match = re.fullmatch(r"round-(\d{3})\.json", path.name)
            if match is not None:
                latest_round = max(latest_round, int(match.group(1)))
    if head_round_number is not None and latest_round > head_round_number:
        errors.append(f"{owner} does not reference the latest target review round")
    return errors


def _validate_gauntlet_certification(
    review: Mapping[str, Any], target: str, subject_hash: str, owner: str
) -> list[str]:
    errors: list[str] = []
    if review.get("schema_version") not in {1, 2}:
        errors.append(f"{owner} has unsupported schema_version")
    if review.get("target_claim_id") != target:
        errors.append(f"{owner} does not review target {target}")
    if review.get("subject_sha256") != subject_hash:
        errors.append(f"{owner} does not match the current target closure")
    if review.get("converged") is not True:
        errors.append(f"{owner} is not converged")
    if review.get("result") not in CONVERGED_GAUNTLET_RESULTS:
        errors.append(f"{owner} does not have a converged result")
    if review.get("unresolved_valid_findings") != []:
        errors.append(f"{owner} has unresolved valid findings")

    findings = review.get("findings")
    if not isinstance(findings, list):
        errors.append(f"{owner} findings must be a list")
    else:
        if review.get("result") == "converged_no_findings" and findings:
            errors.append(f"{owner} claims no findings but records findings")
        allowed_dispositions = {"invalid", "hallucinated", "duplicate"}
        for finding in findings:
            if not isinstance(finding, Mapping):
                errors.append(f"{owner} contains a malformed finding")
                continue
            disposition = finding.get("disposition")
            if not isinstance(disposition, str) or disposition not in allowed_dispositions:
                errors.append(f"{owner} has verified actionable findings")
                continue
            if not isinstance(finding.get("reason"), str) or not finding.get(
                "reason"
            ).strip():
                errors.append(
                    f"{owner} {disposition} finding has no rejection reason"
                )
            fingerprint = finding.get("fingerprint")
            if not isinstance(fingerprint, str) or not fingerprint.strip():
                errors.append(f"{owner} finding has no fingerprint")
            if disposition == "duplicate" and (
                not isinstance(finding.get("duplicate_of"), str)
                or not finding.get("duplicate_of").strip()
            ):
                errors.append(f"{owner} duplicate finding has no duplicate_of")

    reviewers = review.get("reviewers")
    completed_roles: set[str] = set()
    if isinstance(reviewers, list):
        for reviewer in reviewers:
            if not isinstance(reviewer, Mapping):
                continue
            if reviewer.get("outcome") != "completed":
                continue
            model = reviewer.get("actual_model")
            if not isinstance(model, str) or not model.strip() or model.startswith(
                "unknown"
            ):
                continue
            role = reviewer.get("role")
            if isinstance(role, str):
                completed_roles.add(role)
    required_roles = {"scaling", "pde", "counterexample", "source", "arbiter"}
    missing_roles = sorted(required_roles - completed_roles)
    if missing_roles:
        errors.append(f"{owner} lacks completed reviewers: {missing_roles}")
    return errors


def _validate_round_convergence(
    review: Mapping[str, Any], owner: str
) -> list[str]:
    errors: list[str] = []
    converged = review.get("converged")
    result = review.get("result")
    unresolved = review.get("unresolved_valid_findings")
    findings = review.get("findings")
    if converged is True:
        if result not in CONVERGED_GAUNTLET_RESULTS:
            errors.append(f"{owner} is converged but has a non-converged result")
        if unresolved != []:
            errors.append(f"{owner} is converged but has unresolved findings")
        if not isinstance(findings, list):
            errors.append(f"{owner} converged findings must be a list")
        else:
            if result == "converged_no_findings" and findings:
                errors.append(f"{owner} claims no findings but records findings")
            for finding in findings:
                if not isinstance(finding, Mapping):
                    errors.append(f"{owner} contains a malformed finding")
                    continue
                disposition = finding.get("disposition")
                if disposition not in {"invalid", "hallucinated", "duplicate"}:
                    errors.append(f"{owner} has an actionable converged finding")
                if not isinstance(finding.get("reason"), str) or not finding.get(
                    "reason"
                ).strip():
                    errors.append(f"{owner} converged finding has no reason")
                if not isinstance(finding.get("fingerprint"), str) or not finding.get(
                    "fingerprint"
                ).strip():
                    errors.append(f"{owner} converged finding has no fingerprint")
                if disposition == "duplicate" and (
                    not isinstance(finding.get("duplicate_of"), str)
                    or not finding.get("duplicate_of").strip()
                ):
                    errors.append(f"{owner} duplicate finding has no duplicate_of")
    elif result in CONVERGED_GAUNTLET_RESULTS:
        errors.append(f"{owner} has a converged result but converged is not true")
    return errors


def _validate_external_certification(
    review: Mapping[str, Any], target: str, subject_hash: str, owner: str
) -> list[str]:
    errors: list[str] = []
    if review.get("schema_version") != 1:
        errors.append(f"{owner} schema_version must be 1")
    if review.get("target_claim_id") != target:
        errors.append(f"{owner} does not review target {target}")
    if review.get("subject_sha256") != subject_hash:
        errors.append(f"{owner} does not match the current target closure")
    if review.get("verdict") != "accepted_complete_proof":
        errors.append(f"{owner} does not accept a complete proof")
    reviewer = review.get("reviewer")
    if not isinstance(reviewer, Mapping) or not all(
        isinstance(reviewer.get(field), str) and reviewer.get(field).strip()
        for field in ("name", "affiliation", "qualification")
    ):
        errors.append(f"{owner} has incomplete external reviewer identity")
    return errors


def _validate_gauntlet_manifest(root: Path) -> list[str]:
    errors: list[str] = []
    directory = root / "artifacts" / "gauntlet"
    round_paths = sorted(directory.glob("round-*.json")) if directory.is_dir() else []
    if not round_paths:
        return errors

    manifest_path = directory / "manifest.json"
    if not manifest_path.is_file():
        return ["gauntlet manifest is missing"]
    try:
        manifest = _load_json(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, DuplicateJsonKeyError) as error:
        return [f"gauntlet manifest is invalid: {error}"]
    if not isinstance(manifest, Mapping):
        return ["gauntlet manifest root must be an object"]
    if manifest.get("schema_version") != 1:
        errors.append("gauntlet manifest schema_version must be 1")

    entries = manifest.get("rounds")
    if not isinstance(entries, list):
        return [*errors, "gauntlet manifest rounds must be a list"]

    manifest_paths: list[str] = []
    records: list[Mapping[str, Any] | None] = []
    hashes: list[str | None] = []
    for index, entry in enumerate(entries):
        owner = f"gauntlet manifest rounds[{index}]"
        if not isinstance(entry, Mapping):
            errors.append(f"{owner} must be an object")
            records.append(None)
            hashes.append(None)
            continue
        reference = entry.get("path")
        expected_hash = entry.get("sha256")
        if not isinstance(reference, str) or not re.fullmatch(
            r"artifacts/gauntlet/round-\d{3}\.json", reference
        ):
            errors.append(f"{owner}.path must name round-NNN.json")
            records.append(None)
            hashes.append(None)
            continue
        manifest_paths.append(reference)
        path = (root / reference).resolve()
        if not path.is_file():
            errors.append(f"{owner} does not exist: {reference}")
            records.append(None)
            hashes.append(None)
            continue
        actual_hash = _file_sha256(path)
        hashes.append(actual_hash)
        if expected_hash != actual_hash:
            errors.append(f"{owner} hash mismatch: {reference}")
        try:
            record = _load_json(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError, DuplicateJsonKeyError) as error:
            errors.append(f"{owner} is invalid JSON: {error}")
            records.append(None)
            continue
        if not isinstance(record, Mapping):
            errors.append(f"{owner} root must be an object")
            records.append(None)
            continue
        records.append(record)

    actual_references = {str(path.relative_to(root)) for path in round_paths}
    if set(manifest_paths) != actual_references or len(manifest_paths) != len(
        actual_references
    ):
        errors.append("gauntlet manifest does not list every round exactly once")
    if manifest.get("head") != (manifest_paths[-1] if manifest_paths else None):
        errors.append("gauntlet manifest head is not the last listed round")

    previous_open: set[str] = set()
    for index, record in enumerate(records):
        if record is None:
            continue
        reference = manifest_paths[index] if index < len(manifest_paths) else "?"
        owner = f"gauntlet round {reference}"
        if record.get("round_id") != f"round-{index + 1:03d}":
            errors.append(f"{owner} round_id does not match manifest order")
        if record.get("schema_version") not in {1, 2}:
            errors.append(f"{owner} has unsupported schema_version")
        for field, expected_type in (
            ("target", str),
            ("reviewers", list),
            ("findings", list),
            ("validation", list),
            ("converged", bool),
        ):
            if not isinstance(record.get(field), expected_type):
                errors.append(f"{owner} has invalid {field}")
        if record.get("result") not in GAUNTLET_RESULTS:
            errors.append(f"{owner} has invalid result")
        errors.extend(_validate_round_convergence(record, owner))

        if index == 0:
            if record.get("previous_round") is not None:
                errors.append(f"{owner} must not name a previous round")
        else:
            expected_previous = manifest_paths[index - 1]
            expected_hash = hashes[index - 1]
            if record.get("previous_round") != expected_previous:
                errors.append(f"{owner} previous_round is not contiguous")
            if record.get("previous_round_sha256") != expected_hash:
                errors.append(f"{owner} previous_round_sha256 mismatch")

        unresolved = record.get(
            "unresolved_valid_findings",
            [] if record.get("schema_version") == 1 else None,
        )
        if not isinstance(unresolved, list) or not all(
            isinstance(item, str) and item for item in unresolved
        ):
            errors.append(f"{owner} unresolved_valid_findings must be strings")
            current_open: set[str] = set()
        else:
            current_open = set(unresolved)
        resolved = record.get("resolved_findings", [])
        if not isinstance(resolved, list) or not all(
            isinstance(item, str) and item for item in resolved
        ):
            errors.append(f"{owner} resolved_findings must be strings")
            resolved_set: set[str] = set()
        else:
            resolved_set = set(resolved)
        disappeared = previous_open - current_open - resolved_set
        if disappeared:
            errors.append(
                f"{owner} drops unresolved findings without repair: "
                f"{sorted(disappeared)}"
            )
        previous_open = current_open

        if index >= 4 and record.get("schema_version") != 2:
            errors.append(f"{owner} must use schema_version 2")
        if record.get("schema_version") == 2:
            snapshot = record.get("claims_snapshot")
            snapshot_hash = record.get("claims_snapshot_sha256")
            if not isinstance(snapshot, str):
                errors.append(f"{owner} has no canonical claims snapshot")
            else:
                try:
                    snapshot_path = (root / snapshot).resolve()
                    snapshots_root = (
                        root / "artifacts" / "gauntlet" / "snapshots"
                    ).resolve()
                    snapshot_path.relative_to(snapshots_root)
                except (ValueError, OSError):
                    errors.append(f"{owner} claims snapshot escapes snapshot root")
                    snapshot_path = None
                if snapshot_path is None:
                    pass
                elif snapshot_path.suffix.lower() != ".json":
                    errors.append(f"{owner} claims snapshot must be JSON")
                elif not snapshot_path.is_file():
                    errors.append(f"{owner} claims snapshot does not exist")
                else:
                    actual_snapshot_hash = _file_sha256(snapshot_path)
                    if snapshot_hash != actual_snapshot_hash:
                        errors.append(f"{owner} claims snapshot hash mismatch")
                    if record.get("post_repair_claims_sha256") != actual_snapshot_hash:
                        errors.append(
                            f"{owner} snapshot does not match post-repair claims hash"
                        )
                    try:
                        snapshot_data = _load_json(
                            snapshot_path.read_text(encoding="utf-8")
                        )
                    except (
                        OSError,
                        json.JSONDecodeError,
                        DuplicateJsonKeyError,
                    ) as error:
                        errors.append(f"{owner} claims snapshot is invalid: {error}")
                    else:
                        if not isinstance(snapshot_data, Mapping) or not isinstance(
                            snapshot_data.get("claims"), list
                        ):
                            errors.append(f"{owner} claims snapshot is not a ledger")

    if records:
        head = records[-1]
        claims_path = root / "artifacts" / "claims.json"
        if head is not None and claims_path.is_file():
            if head.get("post_repair_claims_sha256") != _file_sha256(claims_path):
                errors.append("gauntlet manifest head does not match current claims")
    return errors


def validate_ledger(
    data: object,
    root: Path | None = None,
    *,
    structural_only: bool = False,
) -> list[str]:
    """Return contract violations in a claim ledger."""
    errors: list[str] = []
    if not isinstance(data, Mapping):
        return ["ledger root must be an object"]
    if data.get("schema_version") != 1:
        errors.append("schema_version must be 1")
    if root is None and not structural_only:
        errors.append(
            "repository root is required for full validation; "
            "pass structural_only=True explicitly"
        )

    raw_claims = data.get("claims")
    if not isinstance(raw_claims, list):
        return [*errors, "claims must be a list"]

    claims: dict[str, Mapping[str, Any]] = {}
    for index, raw_claim in enumerate(raw_claims):
        location = f"claims[{index}]"
        if not isinstance(raw_claim, Mapping):
            errors.append(f"{location} must be an object")
            continue

        claim_id = raw_claim.get("id")
        if not isinstance(claim_id, str) or not claim_id.strip():
            errors.append(f"{location}.id must be a nonempty string")
            continue
        if claim_id in claims:
            errors.append(f"duplicate claim id: {claim_id}")
            continue
        claims[claim_id] = raw_claim

        statement = raw_claim.get("statement")
        if not isinstance(statement, str) or not statement.strip():
            errors.append(f"{claim_id}.statement must be a nonempty string")

        kind = raw_claim.get("kind")
        if not isinstance(kind, str) or kind not in VALID_KINDS:
            errors.append(f"{claim_id}.kind must be one of {sorted(VALID_KINDS)}")

        raw_status = raw_claim.get("status")
        status = (
            raw_status
            if isinstance(raw_status, str) and raw_status in VALID_STATUSES
            else None
        )
        if status is None:
            errors.append(
                f"{claim_id}.status must be one of {sorted(VALID_STATUSES)}"
            )

        dependencies = raw_claim.get("depends_on")
        if not isinstance(dependencies, list) or not all(
            isinstance(item, str) and item for item in dependencies
        ):
            errors.append(f"{claim_id}.depends_on must be a list of claim ids")

        if status in EVIDENCE_STATUSES and not _nonempty_strings(
            raw_claim.get("evidence")
        ):
            errors.append(f"{claim_id} is {status} but has no evidence")
        if status in {"proved", "refuted"}:
            if not _nonempty_strings(raw_claim.get("falsification_attempts")):
                errors.append(
                    f"{claim_id} is {status} but has no falsification attempt"
                )
        if status == "proved":
            proof_artifact = raw_claim.get("proof_artifact")
            if not isinstance(proof_artifact, str) or not proof_artifact.strip():
                errors.append(f"{claim_id} is proved but has no proof artifact")
            elif root is not None:
                try:
                    proof_path = (root / proof_artifact.partition("#")[0]).resolve()
                    proofs_root = (root / "docs" / "proofs").resolve()
                    proof_path.relative_to(proofs_root)
                except (ValueError, OSError):
                    errors.append(
                        f"{claim_id}.proof_artifact must resolve under docs/proofs/"
                    )
        if status == "refuted":
            counterexample = raw_claim.get("counterexample_artifact")
            if not isinstance(counterexample, str) or not counterexample.strip():
                errors.append(
                    f"{claim_id} is refuted but has no counterexample artifact"
                )

        if root is not None:
            evidence = raw_claim.get("evidence")
            if isinstance(evidence, list):
                for reference in evidence:
                    if isinstance(reference, str) and reference.strip():
                        errors.extend(
                            _validate_reference(
                                reference, root, f"{claim_id}.evidence"
                            )
                        )
            proof_artifact = raw_claim.get("proof_artifact")
            if isinstance(proof_artifact, str) and proof_artifact.strip():
                errors.extend(
                    _validate_reference(
                        proof_artifact, root, f"{claim_id}.proof_artifact"
                    )
                )
            counterexample = raw_claim.get("counterexample_artifact")
            if isinstance(counterexample, str) and counterexample.strip():
                errors.extend(
                    _validate_reference(
                        counterexample,
                        root,
                        f"{claim_id}.counterexample_artifact",
                    )
                )

    targets = data.get("targets", [])
    if not isinstance(targets, list) or not all(
        isinstance(item, str) and bool(item.strip()) for item in targets
    ):
        errors.append("targets must be a list of claim ids")
        targets = []

    for target in targets:
        if target not in claims:
            errors.append(f"unknown target: {target}")
            continue
        if not target.startswith("CLAY-"):
            continue

        target_claim = claims[target]
        alternative = target_claim.get("clay_alternative")
        expected_contract = (
            CLAY_TARGET_CONTRACTS.get(alternative)
            if isinstance(alternative, str)
            else None
        )
        if expected_contract is None:
            errors.append(f"{target}.clay_alternative must be one of A, B, C, D")
        elif target != f"CLAY-{alternative}":
            errors.append(
                f"{target}.clay_alternative must match its canonical claim id"
            )
        elif target_claim.get("target_contract") != expected_contract:
            errors.append(
                f"{target}.target_contract does not match Clay alternative "
                f"{alternative}"
            )

        target_status = target_claim.get("status")
        if isinstance(target_status, str) and target_status in RESOLVED_TARGET_STATUSES:
            certification = target_claim.get("certification")
            if not isinstance(certification, Mapping):
                errors.append(f"resolved target {target} has no certification")
                continue
            subject_hash = _target_subject_sha256(target, claims, root=root)
            all_references: dict[str, list[str]] = {}
            canonical_references: dict[str, set[Path]] = {}
            external_identities: set[tuple[str, str]] = set()
            for field in ("gauntlet_reviews", "external_reviews"):
                references = certification.get(field)
                if not _nonempty_strings(references):
                    errors.append(
                        f"resolved target {target} certification has no {field}"
                    )
                    continue
                all_references[field] = list(references)
                if len(set(references)) != len(references):
                    errors.append(
                        f"resolved target {target} certification repeats {field}"
                    )
                if root is not None:
                    canonical_references[field] = set()
                    for reference in references:
                        owner = f"{target}.certification.{field}"
                        expected_prefix = (
                            "artifacts/gauntlet/"
                            if field == "gauntlet_reviews"
                            else "artifacts/external_reviews/"
                        )
                        try:
                            resolved_reference = (root / reference).resolve()
                            expected_root = (root / expected_prefix).resolve()
                            resolved_reference.relative_to(expected_root)
                        except (ValueError, OSError):
                            errors.append(
                                f"{owner} must resolve under {expected_prefix}"
                            )
                        else:
                            if resolved_reference in canonical_references[field]:
                                errors.append(
                                    f"resolved target {target} certification "
                                    f"repeats {field}"
                                )
                            canonical_references[field].add(resolved_reference)
                        review, review_errors = _load_review(
                            reference, root, owner
                        )
                        errors.extend(review_errors)
                        if review is None:
                            continue
                        if field == "gauntlet_reviews":
                            errors.extend(
                                _validate_gauntlet_chain(
                                    reference, root, owner, target
                                )
                            )
                            errors.extend(
                                _validate_gauntlet_certification(
                                    review, target, subject_hash, owner
                                )
                            )
                        else:
                            errors.extend(
                                _validate_external_certification(
                                    review, target, subject_hash, owner
                                )
                            )
                            reviewer = review.get("reviewer")
                            if isinstance(reviewer, Mapping):
                                identity = (
                                    str(reviewer.get("name", "")),
                                    str(reviewer.get("affiliation", "")),
                                )
                                if identity in external_identities:
                                    errors.append(
                                        f"resolved target {target} repeats an "
                                        "external reviewer identity"
                                    )
                                external_identities.add(identity)

            gauntlet_refs = canonical_references.get("gauntlet_reviews", set())
            external_refs = canonical_references.get("external_reviews", set())
            if gauntlet_refs & external_refs:
                errors.append(
                    f"resolved target {target} reuses internal and external reviews"
                )

            external_reviews = certification.get("external_reviews")
            if isinstance(external_reviews, list) and len(external_reviews) < 2:
                errors.append(
                    f"resolved target {target} needs at least two external reviews"
                )

    intrinsic_targets = {
        claim_id
        for claim_id, claim in claims.items()
        if claim_id.startswith("CLAY-") or "clay_alternative" in claim
    }
    for target in sorted(intrinsic_targets - set(targets)):
        errors.append(f"Clay claim must be declared as a target: {target}")
    for claim_id, claim in claims.items():
        if "clay_alternative" in claim and not claim_id.startswith("CLAY-"):
            errors.append(
                f"Clay-equivalent claim must use the canonical CLAY-* id: {claim_id}"
            )

    if root is not None:
        errors.extend(_validate_gauntlet_manifest(root))
        documented_ids, documented_statuses, documentation_errors = (
            _documented_claims(root)
        )
        errors.extend(documentation_errors)
        for claim_id in sorted(documented_ids - set(claims)):
            errors.append(f"documented claim missing from ledger: {claim_id}")
        for claim_id, statuses in sorted(documented_statuses.items()):
            claim = claims.get(claim_id)
            if claim is None:
                continue
            canonical = claim.get("status")
            if statuses != {canonical}:
                errors.append(
                    f"documented status mismatch for {claim_id}: "
                    f"documents={sorted(statuses)}, ledger={canonical}"
                )

    graph: dict[str, list[str]] = {}
    for claim_id, claim in claims.items():
        dependencies = claim.get("depends_on")
        graph[claim_id] = (
            dependencies
            if isinstance(dependencies, list)
            and all(isinstance(item, str) and item for item in dependencies)
            else []
        )
        for dependency in graph[claim_id]:
            if dependency not in claims:
                errors.append(f"{claim_id} has unknown dependency: {dependency}")
                continue
            claim_status = claim.get("status")
            dependency_status = claims[dependency].get("status")
            if (
                isinstance(claim_status, str)
                and claim_status in EVIDENCE_STATUSES
                and (
                    not isinstance(dependency_status, str)
                    or dependency_status not in SETTLED_STATUSES
                )
            ):
                errors.append(
                    f"{claim_id} is {claim.get('status')} but depends on "
                    f"unsettled claim: {dependency}"
                )
    for claim_id, claim in claims.items():
        claim_status = claim.get("status")
        if (
            not isinstance(claim_status, str)
            or claim_status not in EVIDENCE_STATUSES
            or claim.get("kind") in {"computation", "computation_bridge"}
        ):
            continue
        closure: set[str] = set()
        pending = list(graph[claim_id])
        while pending:
            dependency = pending.pop()
            if dependency in closure or dependency not in claims:
                continue
            closure.add(dependency)
            pending.extend(graph.get(dependency, []))
        computations = {
            dependency
            for dependency in closure
            if claims[dependency].get("kind") == "computation"
        }
        if not computations:
            continue
        bridges = claim.get("computation_bridges")
        if not isinstance(bridges, Mapping):
            errors.append(
                f"{claim_id} depends on computation but has no analytic bridge map"
            )
            continue
        for computation in sorted(computations):
            bridge = bridges.get(computation)
            if not isinstance(bridge, str) or bridge not in closure:
                errors.append(
                    f"{claim_id} has no dependency bridge for computation: "
                    f"{computation}"
                )
            elif (
                claims[bridge].get("status") != "proved"
                or claims[bridge].get("kind") != "computation_bridge"
                or computation not in graph.get(bridge, [])
            ):
                errors.append(
                    f"{claim_id} has unsettled analytic bridge: {bridge}"
                )

    state: dict[str, int] = {claim_id: 0 for claim_id in claims}
    for start in claims:
        if state[start] != 0:
            continue
        state[start] = 1
        path = [start]
        stack: list[tuple[str, int]] = [(start, 0)]
        while stack:
            claim_id, index = stack[-1]
            dependencies = [
                item for item in graph.get(claim_id, []) if item in claims
            ]
            if index >= len(dependencies):
                state[claim_id] = 2
                stack.pop()
                path.pop()
                continue
            dependency = dependencies[index]
            stack[-1] = (claim_id, index + 1)
            if state[dependency] == 0:
                state[dependency] = 1
                path.append(dependency)
                stack.append((dependency, 0))
            elif state[dependency] == 1:
                cycle_start = path.index(dependency)
                errors.append(
                    "dependency cycle: "
                    + " -> ".join(path[cycle_start:] + [dependency])
                )

    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("ledger", type=Path)
    parser.add_argument(
        "--root",
        type=Path,
        help="repository root for resolving evidence (auto-detected by default)",
    )
    args = parser.parse_args()
    try:
        data = _load_json(args.ledger.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, DuplicateJsonKeyError) as error:
        print(f"unable to read ledger: {error}")
        return 1

    root = _find_repository_root(args.ledger, args.root)
    if root is None:
        print("unable to locate repository root; pass --root")
        return 1
    errors = validate_ledger(data, root=root)
    if errors:
        for error in errors:
            print(error)
        return 1
    print(f"valid ledger: {args.ledger}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
