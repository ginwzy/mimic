#!/usr/bin/env python3
"""Compile CSD4CA CSV streams into an anonymous low-rank interaction model."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator, Sequence

import numpy as np


COMPILER_VERSION = 1
MODEL_SCHEMA = 1
SCREEN_WIDTH = 1080
SCREEN_HEIGHT = 2400
QUANTIZATION = 4096
CHANNELS = (
    "touchX", "touchY", "radiusX", "radiusY", "force",
    "accelerationX", "accelerationY", "accelerationZ",
    "gravityX", "gravityY", "gravityZ",
    "rotationAlpha", "rotationBeta", "rotationGamma",
    "orientationSinAlpha", "orientationCosAlpha", "orientationBeta", "orientationGamma",
)
SCALES = np.asarray((
    1, 1, 0.1, 0.1, 1,
    10, 10, 10,
    10, 10, 10,
    180, 180, 180,
    1, 1, 90, 90,
), dtype=np.float64)
SCENARIOS = {"Normal": "normal", "Walking": "walking", "Stressful": "stressful"}
HANDS = {"l": "left", "r": "right"}
FILES = {
    "touch": "touch_data.csv",
    "acceleration": "acc_data.csv",
    "gyroscope": "gyro_data.csv",
    "magnetometer": "magneto_data.csv",
}


@dataclass(frozen=True)
class SensorGroup:
    swipe_id: int
    scenario: str
    hand: str
    rows: tuple[tuple[float, ...], ...]
    valid: bool


@dataclass(frozen=True)
class SampledGroup:
    scenario: str
    hand: str
    duration: float
    values: np.ndarray | None


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path, help="directory containing the four CSD4CA CSV files")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("src/interaction/csd4ca.model.ts"),
        help="generated TypeScript module",
    )
    parser.add_argument("--frames", type=int, default=16)
    parser.add_argument("--rank", type=int, default=4)
    parser.add_argument("--min-group", type=int, default=20)
    parser.add_argument("--check", action="store_true", help="fail instead of updating a stale output")
    return parser.parse_args()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def grouped_rows(path: Path, value_columns: Sequence[int]) -> Iterator[SensorGroup]:
    with path.open("r", encoding="utf-8", newline="") as source:
        reader = csv.reader(source)
        next(reader)
        swipe_id: int | None = None
        scenario = ""
        hand = ""
        rows: list[tuple[float, ...]] = []
        invalid = False
        for row in reader:
            current_id = int(row[6])
            if swipe_id is not None and current_id != swipe_id:
                yield SensorGroup(swipe_id, scenario, hand, tuple(rows), not invalid)
                rows = []
                invalid = False
            if current_id != swipe_id:
                swipe_id = current_id
                scenario = SCENARIOS.get(row[1], row[1].lower())
                hand = HANDS.get(row[3], row[3].lower())
            try:
                rows.append((float(row[7]), *(float(row[index]) for index in value_columns)))
            except ValueError:
                invalid = True
        if swipe_id is not None:
            yield SensorGroup(swipe_id, scenario, hand, tuple(rows), not invalid)


def noncontiguous_ids(path: Path) -> set[int]:
    seen: set[int] = set()
    repeated: set[int] = set()
    previous: int | None = None
    with path.open("r", encoding="utf-8", newline="") as source:
        reader = csv.reader(source)
        next(reader)
        for row in reader:
            swipe_id = int(row[6])
            if swipe_id != previous:
                if swipe_id in seen:
                    repeated.add(swipe_id)
                seen.add(swipe_id)
                previous = swipe_id
    return repeated


def collapse(rows: Sequence[tuple[float, ...]]) -> np.ndarray:
    output: list[list[float]] = []
    index = 0
    while index < len(rows):
        timestamp = rows[index][0]
        values = np.zeros(len(rows[index]) - 1, dtype=np.float64)
        count = 0
        while index < len(rows) and rows[index][0] == timestamp:
            values += rows[index][1:]
            count += 1
            index += 1
        output.append([timestamp, *(values / count)])
    return np.asarray(output, dtype=np.float64)


def resample(rows: Sequence[tuple[float, ...]], frames: int) -> np.ndarray | None:
    values = collapse(rows)
    if values.shape[0] < 2 or values[-1, 0] <= values[0, 0]:
        return None
    progress = (values[:, 0] - values[0, 0]) / (values[-1, 0] - values[0, 0])
    targets = np.linspace(0, 1, frames)
    return np.column_stack([
        np.interp(targets, progress, values[:, column])
        for column in range(1, values.shape[1])
    ])


def sampled_groups(path: Path, value_columns: Sequence[int], frames: int) -> dict[int, SampledGroup]:
    # A small number of swipe IDs recur in non-adjacent CSV blocks. Defer only
    # those IDs so the common path can be resampled without retaining raw rows.
    repeated = noncontiguous_ids(path)
    deferred: dict[int, SensorGroup] = {}
    output: dict[int, SampledGroup] = {}

    def sample(group: SensorGroup) -> SampledGroup:
        ordered = tuple(sorted(group.rows, key=lambda row: row[0]))
        duration = ordered[-1][0] - ordered[0][0] if len(ordered) >= 2 else 0
        values = resample(ordered, frames) if group.valid else None
        return SampledGroup(group.scenario, group.hand, duration, values)

    for group in grouped_rows(path, value_columns):
        if group.swipe_id not in repeated:
            output[group.swipe_id] = sample(group)
            continue
        previous = deferred.get(group.swipe_id)
        if previous is None:
            deferred[group.swipe_id] = group
            continue
        if previous.scenario != group.scenario or previous.hand != group.hand:
            raise ValueError(f"inconsistent metadata for swipe {group.swipe_id} in {path}")
        deferred[group.swipe_id] = SensorGroup(
            group.swipe_id,
            group.scenario,
            group.hand,
            (*previous.rows, *group.rows),
            previous.valid and group.valid,
        )

    for group in deferred.values():
        output[group.swipe_id] = sample(group)
    return output


def direction(touch: np.ndarray) -> str | None:
    delta_x = (touch[-1, 0] - touch[0, 0]) / (SCREEN_WIDTH - 1)
    delta_y = (touch[-1, 1] - touch[0, 1]) / (SCREEN_HEIGHT - 1)
    if math.hypot(delta_x, delta_y) < 0.08:
        return None
    if abs(delta_x) > abs(delta_y):
        return "right" if delta_x > 0 else "left"
    return "down" if delta_y > 0 else "up"


def orientation(acceleration: np.ndarray, magnetometer: np.ndarray) -> np.ndarray:
    output = np.zeros((acceleration.shape[0], 4), dtype=np.float64)
    for index, (gravity, magnetic) in enumerate(zip(acceleration, magnetometer, strict=True)):
        gx, gy, gz = gravity
        norm = math.sqrt(gx * gx + gy * gy + gz * gz)
        if norm == 0:
            output[index] = (0, 1, 0, 0)
            continue
        gx, gy, gz = gx / norm, gy / norm, gz / norm
        roll = math.atan2(gy, gz)
        pitch = math.atan2(-gx, math.sqrt(gy * gy + gz * gz))
        mx, my, mz = magnetic
        horizontal_x = mx * math.cos(pitch) + mz * math.sin(pitch)
        horizontal_y = (
            mx * math.sin(roll) * math.sin(pitch)
            + my * math.cos(roll)
            - mz * math.sin(roll) * math.cos(pitch)
        )
        alpha = math.atan2(-horizontal_y, horizontal_x)
        output[index] = (math.sin(alpha), math.cos(alpha), math.degrees(pitch), math.degrees(roll))
    return output


def vectorize(
    touch_group: SampledGroup,
    acceleration_group: SampledGroup,
    gyroscope_group: SampledGroup,
    magnetometer_group: SampledGroup,
) -> tuple[tuple[str, str, str], float, np.ndarray] | None:
    if not (touch_group.scenario == acceleration_group.scenario == gyroscope_group.scenario == magnetometer_group.scenario):
        return None
    touch = touch_group.values
    acceleration = acceleration_group.values
    gyroscope = gyroscope_group.values
    magnetometer = magnetometer_group.values
    if touch is None or acceleration is None or gyroscope is None or magnetometer is None:
        return None
    duration = touch_group.duration
    if duration < 40 or duration > 2_000:
        return None
    swipe_direction = direction(touch)
    if swipe_direction != "up":
        return None

    touch_values = np.column_stack((
        touch[:, 0] / (SCREEN_WIDTH - 1),
        touch[:, 1] / (SCREEN_HEIGHT - 1),
        touch[:, 2] / 2 / SCREEN_WIDTH,
        touch[:, 3] / 2 / SCREEN_HEIGHT,
        np.clip(touch[:, 4], 0, 1),
    ))
    gravity = np.median(acceleration, axis=0)
    linear_acceleration = acceleration - gravity
    rotation = np.degrees(gyroscope)
    orientation_values = orientation(acceleration, magnetometer)
    raw = np.column_stack((touch_values, linear_acceleration, acceleration, rotation, orientation_values))
    if raw.shape[1] != len(CHANNELS) or not np.isfinite(raw).all():
        return None
    standardized = (raw / SCALES).reshape(-1)
    key = (touch_group.scenario, touch_group.hand, swipe_direction)
    return key, duration, standardized


def stable_component(component: np.ndarray) -> np.ndarray:
    pivot = int(np.argmax(np.abs(component)))
    return -component if component[pivot] < 0 else component


def quantize(values: np.ndarray) -> list[int]:
    output = np.rint(values * QUANTIZATION).astype(np.int64)
    if np.any(output < -32768) or np.any(output > 32767):
        raise ValueError("model value exceeds int16 quantization range")
    return output.tolist()


def compile_groups(
    samples: dict[tuple[str, str, str], list[np.ndarray]],
    durations: dict[tuple[str, str, str], list[float]],
    rank: int,
    minimum: int,
) -> list[dict[str, object]]:
    output: list[dict[str, object]] = []
    for key in sorted(samples):
        vectors = samples[key]
        if len(vectors) < minimum:
            continue
        matrix = np.stack(vectors)
        mean = np.mean(matrix, axis=0)
        centered = matrix - mean
        covariance = centered.T @ centered / (matrix.shape[0] - 1)
        eigenvalues, eigenvectors = np.linalg.eigh(covariance)
        order = np.argsort(eigenvalues)[::-1]
        components = []
        for component_index in order[:rank]:
            eigenvalue = max(0.0, float(eigenvalues[component_index]))
            components.append({
                "sigma": round(math.sqrt(eigenvalue), 6),
                "basis": quantize(stable_component(eigenvectors[:, component_index])),
            })
        raw_durations = np.asarray(durations[key], dtype=np.float64)
        log_durations = np.log(raw_durations)
        scenario, hand, swipe_direction = key
        output.append({
            "scenario": scenario,
            "hand": hand,
            "direction": swipe_direction,
            "count": len(vectors),
            "duration": [
                round(float(np.mean(log_durations)), 6),
                round(float(np.std(log_durations)), 6),
                round(float(np.min(raw_durations)), 3),
                round(float(np.max(raw_durations)), 3),
            ],
            "mean": quantize(mean),
            "components": components,
        })
    return output


def module_text(model: dict[str, object]) -> str:
    body = json.dumps(model, ensure_ascii=True, indent=2, separators=(",", ": "))
    return (
        "// Generated by scripts/compile-csd4ca.py. Do not edit by hand.\n"
        "// CSD4CA is licensed CC BY 4.0; attribution is recorded in NOTICE.\n"
        "import { INTERACTION_CHANNELS, INTERACTION_SCALES } from './model.js';\n"
        "import type { InteractionModel } from './model.js';\n\n"
        f"const DATA = {body} as const;\n\n"
        "export const CSD4CA_MODEL: InteractionModel = {\n"
        "  ...DATA,\n"
        "  channels: INTERACTION_CHANNELS,\n"
        "  scales: INTERACTION_SCALES,\n"
        "};\n"
    )


def main() -> int:
    options = arguments()
    if options.frames < 3 or options.rank < 1 or options.min_group < 2:
        raise ValueError("frames >= 3, rank >= 1 and min-group >= 2 are required")
    paths = {name: options.input / filename for name, filename in FILES.items()}
    missing = [str(path) for path in paths.values() if not path.is_file()]
    if missing:
        raise FileNotFoundError(f"missing CSD4CA files: {', '.join(missing)}")

    samples: dict[tuple[str, str, str], list[np.ndarray]] = {}
    durations: dict[tuple[str, str, str], list[float]] = {}
    touch_groups = sampled_groups(paths["touch"], (8, 9, 10, 11, 12), options.frames)
    acceleration_groups = sampled_groups(paths["acceleration"], (9, 10, 11), options.frames)
    gyroscope_groups = sampled_groups(paths["gyroscope"], (9, 10, 11), options.frames)
    magnetometer_groups = sampled_groups(paths["magnetometer"], (9, 10, 11), options.frames)
    accepted = 0
    rejected = 0
    for swipe_id in sorted(touch_groups):
        touch = touch_groups[swipe_id]
        acceleration = acceleration_groups.get(swipe_id)
        gyroscope = gyroscope_groups.get(swipe_id)
        magnetometer = magnetometer_groups.get(swipe_id)
        if acceleration is None or gyroscope is None or magnetometer is None:
            rejected += 1
            continue
        sample = vectorize(touch, acceleration, gyroscope, magnetometer)
        if sample is None:
            rejected += 1
            continue
        key, duration, vector = sample
        samples.setdefault(key, []).append(vector)
        durations.setdefault(key, []).append(duration)
        accepted += 1

    groups = compile_groups(samples, durations, options.rank, options.min_group)
    model = {
        "schema": MODEL_SCHEMA,
        "compiler": COMPILER_VERSION,
        "frames": options.frames,
        "stride": len(CHANNELS),
        "quantization": QUANTIZATION,
        "source": {
            "name": "CSD4CA",
            "doi": "10.5281/zenodo.17931118",
            "license": "CC-BY-4.0",
            "device": "Google Pixel 6a",
            "archiveMd5": "0283426398f3d71f185e98d811a60ed3",
            "files": {name: sha256(path) for name, path in sorted(paths.items())},
        },
        "groups": groups,
    }
    text = module_text(model)
    current = options.output.read_text(encoding="utf-8") if options.output.is_file() else None
    if options.check:
        if current != text:
            raise SystemExit("CSD4CA interaction model is stale")
    elif current != text:
        options.output.parent.mkdir(parents=True, exist_ok=True)
        options.output.write_text(text, encoding="utf-8")
    print(json.dumps({
        "accepted": accepted,
        "rejected": rejected,
        "groups": len(groups),
        "bytes": len(text.encode("utf-8")),
        "changed": current != text,
    }, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
