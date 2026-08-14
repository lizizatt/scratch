import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from ns_millennium.ledger import (
    _target_subject_sha256,
    _validate_gauntlet_certification,
    _validate_gauntlet_chain,
    _validate_gauntlet_manifest,
    validate_ledger,
)


def claim(
    claim_id: str,
    *,
    status: str = "conjectured",
    depends_on: list[str] | None = None,
) -> dict[str, object]:
    item: dict[str, object] = {
        "id": claim_id,
        "kind": "lemma",
        "statement": f"Statement for {claim_id}",
        "status": status,
        "depends_on": depends_on or [],
        "evidence": [],
        "falsification_attempts": [],
    }
    if status in {"established", "proved"}:
        item["evidence"] = ["docs/proofs/example.md"]
    if status == "proved":
        item["proof_artifact"] = "docs/proofs/example.md"
        item["falsification_attempts"] = ["Checked the endpoint case."]
    if status == "refuted":
        item["evidence"] = ["proofs/counterexample.md"]
        item["counterexample_artifact"] = "proofs/counterexample.md"
        item["falsification_attempts"] = ["Constructed a counterexample."]
    return item


class ValidateLedgerTests(unittest.TestCase):
    def test_accepts_settled_acyclic_dependency_graph(self) -> None:
        data = {
            "schema_version": 1,
            "targets": ["candidate"],
            "claims": [
                claim("known", status="established"),
                claim("candidate", status="proved", depends_on=["known"]),
            ],
        }

        self.assertEqual(validate_ledger(data, structural_only=True), [])

    def test_rejects_proof_without_falsification_attempt(self) -> None:
        candidate = claim("candidate", status="proved")
        candidate["falsification_attempts"] = []

        errors = validate_ledger(
            {"schema_version": 1, "targets": ["candidate"], "claims": [candidate]}
        )

        self.assertIn("candidate is proved but has no falsification attempt", errors)

    def test_rejects_proof_without_proof_artifact(self) -> None:
        candidate = claim("candidate", status="proved")
        del candidate["proof_artifact"]

        errors = validate_ledger(
            {"schema_version": 1, "targets": ["candidate"], "claims": [candidate]}
        )

        self.assertIn("candidate is proved but has no proof artifact", errors)

    def test_rejects_proof_depending_on_conjecture(self) -> None:
        data = {
            "schema_version": 1,
            "targets": ["candidate"],
            "claims": [
                claim("missing-lemma"),
                claim("candidate", status="proved", depends_on=["missing-lemma"]),
            ],
        }

        errors = validate_ledger(data)

        self.assertIn(
            "candidate is proved but depends on unsettled claim: missing-lemma", errors
        )

    def test_rejects_established_claim_hiding_blocked_dependency(self) -> None:
        data = {
            "schema_version": 1,
            "targets": ["candidate"],
            "claims": [
                claim("blocked", status="blocked"),
                claim("imported", status="established", depends_on=["blocked"]),
                claim("candidate", status="proved", depends_on=["imported"]),
            ],
        }

        errors = validate_ledger(data)

        self.assertIn(
            "imported is established but depends on unsettled claim: blocked", errors
        )

    def test_rejects_dependency_cycle(self) -> None:
        data = {
            "schema_version": 1,
            "claims": [
                claim("a", depends_on=["b"]),
                claim("b", depends_on=["a"]),
            ],
        }

        errors = validate_ledger(data)

        self.assertIn("dependency cycle: a -> b -> a", errors)

    def test_rejects_missing_evidence_path_and_anchor(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "docs" / "proofs").mkdir(parents=True)
            (root / "docs" / "proofs" / "example.md").write_text(
                "# Existing proof\n", encoding="utf-8"
            )
            candidate = claim("candidate", status="proved")
            candidate["evidence"] = ["proofs/missing.md"]
            candidate["proof_artifact"] = (
                "docs/proofs/example.md#missing-anchor"
            )

            errors = validate_ledger(
                {
                    "schema_version": 1,
                    "targets": ["candidate"],
                    "claims": [candidate],
                },
                root=root,
            )

        self.assertIn(
            "candidate.evidence does not exist: proofs/missing.md", errors
        )
        self.assertIn(
            "candidate.proof_artifact anchor does not exist: "
            "docs/proofs/example.md#missing-anchor",
            errors,
        )

    def test_rejects_proof_artifact_path_traversal(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "docs" / "proofs").mkdir(parents=True)
            (root / "docs" / "research").mkdir()
            (root / "docs" / "research" / "report.md").write_text(
                "# Claimed proof\n", encoding="utf-8"
            )
            candidate = claim("candidate", status="proved")
            candidate["evidence"] = ["docs/research/report.md#claimed-proof"]
            candidate["proof_artifact"] = (
                "docs/proofs/../research/report.md#claimed-proof"
            )

            errors = validate_ledger(
                {"schema_version": 1, "claims": [candidate]}, root=root
            )

        self.assertIn(
            "candidate.proof_artifact must resolve under docs/proofs/", errors
        )

    def test_rejects_computational_dependency_without_analytic_bridge(self) -> None:
        computation = claim("computed", status="proved")
        computation["kind"] = "computation"
        candidate = claim(
            "candidate", status="proved", depends_on=["computed"]
        )

        errors = validate_ledger(
            {"schema_version": 1, "claims": [computation, candidate]}
        )

        self.assertIn(
            "candidate depends on computation but has no analytic bridge map", errors
        )

    def test_rejects_refuted_computational_claim_without_bridge(self) -> None:
        computation = claim("computed", status="proved")
        computation["kind"] = "computation"
        candidate = claim(
            "candidate", status="refuted", depends_on=["computed"]
        )

        errors = validate_ledger(
            {"schema_version": 1, "claims": [computation, candidate]},
            structural_only=True,
        )

        self.assertIn(
            "candidate depends on computation but has no analytic bridge map", errors
        )

    def test_rejects_wrong_clay_contract(self) -> None:
        target = claim("CLAY-A", status="blocked")
        target["clay_alternative"] = "A"
        target["target_contract"] = {"quantifier": "small_data_only"}

        errors = validate_ledger(
            {"schema_version": 1, "targets": ["CLAY-A"], "claims": [target]}
        )

        self.assertIn(
            "CLAY-A.target_contract does not match Clay alternative A", errors
        )

    def test_rejects_clay_id_alternative_mismatch(self) -> None:
        target = claim("CLAY-B", status="blocked")
        target["clay_alternative"] = "A"
        target["target_contract"] = {
            "quantifier": "for_every_admissible_datum",
            "domain": "R3",
            "force": "zero",
            "datum": "smooth_divergence_free_rapidly_decreasing",
            "conclusion": "global_smooth_velocity_pressure_uniform_kinetic_energy",
        }

        errors = validate_ledger(
            {"schema_version": 1, "targets": ["CLAY-B"], "claims": [target]}
        )

        self.assertIn(
            "CLAY-B.clay_alternative must match its canonical claim id", errors
        )

    def test_rejects_settled_clay_target_without_certification(self) -> None:
        target = claim("CLAY-A", status="proved")
        target["clay_alternative"] = "A"
        target["target_contract"] = {
            "quantifier": "for_every_admissible_datum",
            "domain": "R3",
            "force": "zero",
            "datum": "smooth_divergence_free_rapidly_decreasing",
            "conclusion": "global_smooth_velocity_pressure_uniform_kinetic_energy",
        }

        errors = validate_ledger(
            {"schema_version": 1, "targets": ["CLAY-A"], "claims": [target]}
        )

        self.assertIn("resolved target CLAY-A has no certification", errors)

    def test_rejects_refuted_clay_target_without_certification(self) -> None:
        target = claim("CLAY-A", status="refuted")
        target["clay_alternative"] = "A"
        target["target_contract"] = {
            "quantifier": "for_every_admissible_datum",
            "domain": "R3",
            "force": "zero",
            "datum": "smooth_divergence_free_rapidly_decreasing",
            "conclusion": "global_smooth_velocity_pressure_uniform_kinetic_energy",
        }

        errors = validate_ledger(
            {"schema_version": 1, "targets": ["CLAY-A"], "claims": [target]}
        )

        self.assertIn("resolved target CLAY-A has no certification", errors)

    def test_rejects_undeclared_clay_target(self) -> None:
        target = claim("CLAY-A", status="blocked")
        target["clay_alternative"] = "A"
        target["target_contract"] = {
            "quantifier": "for_every_admissible_datum",
            "domain": "R3",
            "force": "zero",
            "datum": "smooth_divergence_free_rapidly_decreasing",
            "conclusion": "global_smooth_velocity_pressure_uniform_kinetic_energy",
        }

        errors = validate_ledger(
            {"schema_version": 1, "targets": [], "claims": [target]}
        )

        self.assertIn("Clay claim must be declared as a target: CLAY-A", errors)

    def test_rejects_nonconverged_gauntlet_certification(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "docs" / "proofs").mkdir(parents=True)
            (root / "reviews").mkdir()
            (root / "docs" / "proofs" / "example.md").write_text(
                "# Proof\n", encoding="utf-8"
            )
            target = claim("CLAY-A", status="proved")
            target["clay_alternative"] = "A"
            target["target_contract"] = {
                "quantifier": "for_every_admissible_datum",
                "domain": "R3",
                "force": "zero",
                "datum": "smooth_divergence_free_rapidly_decreasing",
                "conclusion": "global_smooth_velocity_pressure_uniform_kinetic_energy",
            }
            target["certification"] = {
                "gauntlet_reviews": ["reviews/round.json"],
                "external_reviews": [
                    "reviews/external-1.json",
                    "reviews/external-2.json",
                ],
            }
            for name in ("round", "external-1", "external-2"):
                (root / "reviews" / f"{name}.json").write_text(
                    json.dumps(
                        {
                            "schema_version": 1,
                            "target_claim_id": "CLAY-A",
                            "subject_sha256": "wrong",
                            "converged": False,
                            "result": "valid_findings_repaired",
                            "unresolved_valid_findings": [],
                            "reviewers": [],
                            "verdict": "rejected",
                            "reviewer": {
                                "name": "Reviewer",
                                "affiliation": "Institution",
                                "qualification": "PDE expert",
                            },
                        }
                    ),
                    encoding="utf-8",
                )

            errors = validate_ledger(
                {
                    "schema_version": 1,
                    "targets": ["CLAY-A"],
                    "claims": [target],
                },
                root=root,
            )

        self.assertIn(
            "CLAY-A.certification.gauntlet_reviews is not converged", errors
        )

    def test_rejects_actionable_finding_in_converged_review(self) -> None:
        review = {
            "schema_version": 1,
            "target_claim_id": "CLAY-A",
            "subject_sha256": "hash",
            "converged": True,
            "result": "converged_no_verified_findings",
            "unresolved_valid_findings": [],
            "findings": [
                {
                    "id": "finding",
                    "disposition": "valid",
                    "repair": "claimed repair",
                }
            ],
            "reviewers": [],
        }

        errors = _validate_gauntlet_certification(
            review, "CLAY-A", "hash", "review"
        )

        self.assertIn("review has verified actionable findings", errors)

    def test_rejects_malformed_root_and_unhashable_kind(self) -> None:
        self.assertEqual(validate_ledger([]), ["ledger root must be an object"])
        malformed = claim("candidate")
        malformed["kind"] = []
        malformed["status"] = []

        errors = validate_ledger({"schema_version": 1, "claims": [malformed]})

        self.assertTrue(any(error.startswith("candidate.kind must be") for error in errors))
        self.assertTrue(
            any(error.startswith("candidate.status must be") for error in errors)
        )

    def test_rootless_full_validation_is_explicitly_incomplete(self) -> None:
        errors = validate_ledger(
            {"schema_version": 1, "claims": [claim("candidate", status="proved")]}
        )

        self.assertIn(
            "repository root is required for full validation; "
            "pass structural_only=True explicitly",
            errors,
        )

    def test_rejects_unhashable_clay_alternative(self) -> None:
        target = claim("CLAY-A", status="blocked")
        target["clay_alternative"] = []

        errors = validate_ledger(
            {"schema_version": 1, "targets": ["CLAY-A"], "claims": [target]}
        )

        self.assertIn("CLAY-A.clay_alternative must be one of A, B, C, D", errors)

    def test_rejects_documented_claim_missing_from_ledger(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "docs").mkdir()
            (root / "docs" / "report.md").write_text(
                "| ID | Status |\n|---|---|\n| PR-999 | `blocked` |\n",
                encoding="utf-8",
            )

            errors = validate_ledger(
                {"schema_version": 1, "claims": []}, root=root
            )

        self.assertIn("documented claim missing from ledger: PR-999", errors)

    def test_rejects_generic_documented_claim_missing_from_ledger(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "docs").mkdir()
            (root / "docs" / "report.md").write_text(
                "**Claim BREAKTHROUGH-001 (`proved`).** A result.\n",
                encoding="utf-8",
            )

            errors = validate_ledger(
                {"schema_version": 1, "claims": []}, root=root
            )

        self.assertIn(
            "documented claim missing from ledger: BREAKTHROUGH-001", errors
        )

    def test_rejects_documented_status_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "docs").mkdir()
            (root / "docs" / "report.md").write_text(
                "| ID | Status |\n|---|---|\n| PR-999 | `proved` |\n",
                encoding="utf-8",
            )
            tracked = claim("PR-999", status="blocked")

            errors = validate_ledger(
                {"schema_version": 1, "claims": [tracked]}, root=root
            )

        self.assertIn(
            "documented status mismatch for PR-999: documents=['proved'], "
            "ledger=blocked",
            errors,
        )

    def test_rejects_ambiguous_documented_statuses(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "docs").mkdir()
            (root / "docs" / "report.md").write_text(
                "| ID | Status | Other |\n"
                "|---|---|---|\n"
                "| PR-999 | **proved** | `blocked` |\n",
                encoding="utf-8",
            )
            tracked = claim("PR-999", status="blocked")

            errors = validate_ledger(
                {"schema_version": 1, "claims": [tracked]}, root=root
            )

        self.assertTrue(
            any(error.startswith("documented claim row has 2 statuses") for error in errors)
        )

    def test_deep_acyclic_dependency_chain_does_not_recurse(self) -> None:
        claims = [claim("node-0000")]
        for index in range(1, 1100):
            claims.append(
                claim(
                    f"node-{index:04d}",
                    depends_on=[f"node-{index - 1:04d}"],
                )
            )

        errors = validate_ledger(
            {"schema_version": 1, "claims": claims}, structural_only=True
        )

        self.assertEqual(errors, [])

    def test_target_hash_changes_when_proof_bytes_change(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            proof = root / "docs" / "proofs" / "proof.md"
            proof.parent.mkdir(parents=True)
            proof.write_text("first proof", encoding="utf-8")
            target = claim("CLAY-A", status="blocked")
            target["evidence"] = ["docs/proofs/proof.md"]
            claims = {"CLAY-A": target}

            first = _target_subject_sha256("CLAY-A", claims, root=root)
            proof.write_text("changed proof", encoding="utf-8")
            second = _target_subject_sha256("CLAY-A", claims, root=root)

        self.assertNotEqual(first, second)

    def test_rejects_round_filename_id_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "artifacts" / "gauntlet" / "round-004.json"
            path.parent.mkdir(parents=True)
            path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "round_id": "round-001",
                        "target_claim_id": "CLAY-A",
                        "date": "2026-08-13",
                        "reviewers": [],
                        "findings": [],
                        "validation": [],
                        "converged": True,
                    }
                ),
                encoding="utf-8",
            )

            errors = _validate_gauntlet_chain(
                "artifacts/gauntlet/round-004.json",
                root,
                "review",
                "CLAY-A",
            )

        self.assertIn(
            "review filename does not match round_id: "
            "artifacts/gauntlet/round-004.json",
            errors,
        )

    def test_target_specific_head_can_extend_program_history(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            gauntlet = root / "artifacts" / "gauntlet"
            gauntlet.mkdir(parents=True)
            first = gauntlet / "round-001.json"
            first.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "round_id": "round-001",
                        "date": "2026-08-13",
                        "target": "whole program",
                        "reviewers": [],
                        "findings": [],
                        "validation": [],
                        "unresolved_valid_findings": [],
                        "result": "valid_findings_repaired",
                        "converged": False,
                    }
                ),
                encoding="utf-8",
            )
            first_hash = __import__("hashlib").sha256(first.read_bytes()).hexdigest()
            second = gauntlet / "round-002.json"
            second.write_text(
                json.dumps(
                    {
                        "schema_version": 2,
                        "round_id": "round-002",
                        "date": "2026-08-13",
                        "target": "CLAY-A proof",
                        "target_claim_id": "CLAY-A",
                        "subject_sha256": "subject",
                        "previous_round": "artifacts/gauntlet/round-001.json",
                        "previous_round_sha256": first_hash,
                        "reviewers": [],
                        "findings": [],
                        "validation": [],
                        "unresolved_valid_findings": [],
                        "result": "converged_no_findings",
                        "converged": True,
                    }
                ),
                encoding="utf-8",
            )

            errors = _validate_gauntlet_chain(
                "artifacts/gauntlet/round-002.json",
                root,
                "review",
                "CLAY-A",
            )

        self.assertFalse(
            any("does not review target" in error for error in errors), errors
        )

    def test_manifest_rejects_contradictory_convergence(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            gauntlet = root / "artifacts" / "gauntlet"
            gauntlet.mkdir(parents=True)
            round_path = gauntlet / "round-001.json"
            round_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "round_id": "round-001",
                        "date": "2026-08-13",
                        "target": "whole program",
                        "reviewers": [],
                        "findings": [
                            {
                                "id": "finding",
                                "fingerprint": "finding",
                                "disposition": "valid",
                            }
                        ],
                        "validation": [],
                        "unresolved_valid_findings": [],
                        "result": "converged_no_findings",
                        "converged": True,
                    }
                ),
                encoding="utf-8",
            )
            digest = __import__("hashlib").sha256(round_path.read_bytes()).hexdigest()
            (gauntlet / "manifest.json").write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "head": "artifacts/gauntlet/round-001.json",
                        "rounds": [
                            {
                                "path": "artifacts/gauntlet/round-001.json",
                                "sha256": digest,
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )

            errors = _validate_gauntlet_manifest(root)

        self.assertIn(
            "gauntlet round artifacts/gauntlet/round-001.json has an "
            "actionable converged finding",
            errors,
        )

    def test_manifest_rejects_snapshot_escape_and_stale_hash(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            gauntlet = root / "artifacts" / "gauntlet"
            gauntlet.mkdir(parents=True)
            claims = root / "artifacts" / "claims.json"
            claims.write_text('{"schema_version": 1, "claims": []}', encoding="utf-8")
            round_path = gauntlet / "round-001.json"
            round_path.write_text(
                json.dumps(
                    {
                        "schema_version": 2,
                        "round_id": "round-001",
                        "date": "2026-08-13",
                        "target": "whole program",
                        "subject_sha256": "subject",
                        "claims_snapshot": (
                            "artifacts/gauntlet/snapshots/../../claims.json"
                        ),
                        "claims_snapshot_sha256": "stale",
                        "post_repair_claims_sha256": "stale",
                        "reviewers": [],
                        "findings": [],
                        "validation": [],
                        "unresolved_valid_findings": [],
                        "result": "valid_findings_repaired",
                        "converged": False,
                    }
                ),
                encoding="utf-8",
            )
            digest = __import__("hashlib").sha256(round_path.read_bytes()).hexdigest()
            (gauntlet / "manifest.json").write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "head": "artifacts/gauntlet/round-001.json",
                        "rounds": [
                            {
                                "path": "artifacts/gauntlet/round-001.json",
                                "sha256": digest,
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )

            errors = _validate_gauntlet_manifest(root)

        self.assertIn(
            "gauntlet round artifacts/gauntlet/round-001.json claims snapshot "
            "escapes snapshot root",
            errors,
        )
        self.assertIn("gauntlet manifest head does not match current claims", errors)

    def test_manifest_rejects_schema_one_after_round_four(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            gauntlet = root / "artifacts" / "gauntlet"
            gauntlet.mkdir(parents=True)
            entries = []
            previous_path = None
            previous_hash = None
            for index in range(1, 6):
                reference = f"artifacts/gauntlet/round-{index:03d}.json"
                record = {
                    "schema_version": 1,
                    "round_id": f"round-{index:03d}",
                    "date": "2026-08-13",
                    "target": "whole program",
                    "reviewers": [],
                    "findings": [],
                    "validation": [],
                    "unresolved_valid_findings": [],
                    "result": "valid_findings_repaired",
                    "converged": False,
                }
                if previous_path is not None:
                    record["previous_round"] = previous_path
                    record["previous_round_sha256"] = previous_hash
                path = root / reference
                path.write_text(json.dumps(record), encoding="utf-8")
                digest = __import__("hashlib").sha256(path.read_bytes()).hexdigest()
                entries.append({"path": reference, "sha256": digest})
                previous_path = reference
                previous_hash = digest
            (gauntlet / "manifest.json").write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "head": previous_path,
                        "rounds": entries,
                    }
                ),
                encoding="utf-8",
            )

            errors = _validate_gauntlet_manifest(root)

        self.assertIn(
            "gauntlet round artifacts/gauntlet/round-005.json must use "
            "schema_version 2",
            errors,
        )

    def test_cli_reports_malformed_json(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            ledger = Path(directory) / "claims.json"
            ledger.write_text("{", encoding="utf-8")

            result = subprocess.run(
                [sys.executable, "-m", "ns_millennium.ledger", str(ledger)],
                capture_output=True,
                check=False,
                text=True,
            )

        self.assertEqual(result.returncode, 1)
        self.assertIn("unable to read ledger:", result.stdout)

    def test_cli_rejects_duplicate_json_members(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            ledger = Path(directory) / "claims.json"
            ledger.write_text(
                '{"schema_version": 999, "schema_version": 1, "claims": []}',
                encoding="utf-8",
            )

            result = subprocess.run(
                [sys.executable, "-m", "ns_millennium.ledger", str(ledger)],
                capture_output=True,
                check=False,
                text=True,
            )

        self.assertEqual(result.returncode, 1)
        self.assertIn("duplicate JSON member: schema_version", result.stdout)

    def test_cli_discovers_root_for_nonstandard_ledger_path(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "pyproject.toml").write_text("[project]\n", encoding="utf-8")
            (root / "ns_millennium").mkdir()
            ledger = root / "research" / "nested" / "claims.json"
            ledger.parent.mkdir(parents=True)
            ledger.write_text(
                json.dumps({"schema_version": 1, "claims": []}),
                encoding="utf-8",
            )

            result = subprocess.run(
                [sys.executable, "-m", "ns_millennium.ledger", str(ledger)],
                capture_output=True,
                check=False,
                text=True,
            )

        self.assertEqual(result.returncode, 0)
        self.assertIn("valid ledger:", result.stdout)


if __name__ == "__main__":
    unittest.main()
