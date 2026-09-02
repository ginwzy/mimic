#!/usr/bin/env python3
"""Compile CSD4CA CSV streams into an anonymous low-rank interaction model."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator, Mapping, Sequence

import numpy as np


COMPILER_VERSION = 2
MODEL_SCHEMA = 2
SCREEN_WIDTH = 1080
SCREEN_HEIGHT = 2400
QUANTIZATION = 4096
SENSOR_TIME_SCALE = 1_000_000
MIN_DURATION_MS = 40
MAX_DURATION_MS = 2_000
MAX_BOUNDARY_OFFSET_MS = 150
MIN_CLOCK_CALIBRATION_SAMPLES = 20
MIN_VARIANCE_RETAINED = 0.95
MIN_CROSS_MODAL_COVARIANCE_RETAINED = 0.92
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
TIMING_CHANNELS = ("touchLogDuration", "sensorStartOffset", "sensorEndOffset")
# A 25 ms unit keeps physical phase variation represented in the retained PCA rank.
TIMING_SCALES = np.asarray((1, 25, 25), dtype=np.float64)
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
    clock_key: tuple[str, str, str]
    scenario: str
    hand: str
    rows: tuple[tuple[float, ...], ...]
    valid: bool


@dataclass(frozen=True)
class SampledGroup:
    clock_key: tuple[str, str, str]
    scenario: str
    hand: str
    start: float
    end: float
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
    parser.add_argument("--rank", type=int, default=16)
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
        clock_key = ("", "", "")
        scenario = ""
        hand = ""
        rows: list[tuple[float, ...]] = []
        invalid = False
        for row in reader:
            current_id = int(row[6])
            if swipe_id is not None and current_id != swipe_id:
                yield SensorGroup(swipe_id, clock_key, scenario, hand, tuple(rows), not invalid)
                rows = []
                invalid = False
            if current_id != swipe_id:
                swipe_id = current_id
                scenario = SCENARIOS.get(row[1], row[1].lower())
                hand = HANDS.get(row[3], row[3].lower())
                clock_key = (row[0], scenario, row[2])
            try:
                rows.append((float(row[7]), *(float(row[index]) for index in value_columns)))
            except ValueError:
                invalid = True
        if swipe_id is not None:
            yield SensorGroup(swipe_id, clock_key, scenario, hand, tuple(rows), not invalid)


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


def resample(
    rows: Sequence[tuple[float, ...]],
    frames: int,
    target_window: tuple[float, float] | None = None,
) -> np.ndarray | None:
    values = collapse(rows)
    if values.shape[0] < 2 or values[-1, 0] <= values[0, 0]:
        return None
    start, end = target_window or (values[0, 0], values[-1, 0])
    if end <= start:
        return None
    targets = np.linspace(start, end, frames)
    return np.column_stack([
        np.interp(targets, values[:, 0], values[:, column])
        for column in range(1, values.shape[1])
    ])


def sampled_groups(
    path: Path,
    value_columns: Sequence[int],
    frames: int,
    target_windows: Mapping[int, tuple[float, float]] | None = None,
) -> dict[int, SampledGroup]:
    # A small number of swipe IDs recur in non-adjacent CSV blocks. Defer only
    # those IDs so the common path can be resampled without retaining raw rows.
    repeated = noncontiguous_ids(path)
    deferred: dict[int, SensorGroup] = {}
    output: dict[int, SampledGroup] = {}

    def sample(group: SensorGroup) -> SampledGroup:
        ordered = tuple(sorted(group.rows, key=lambda row: row[0]))
        start = ordered[0][0] if ordered else 0
        end = ordered[-1][0] if ordered else 0
        target_window = target_windows.get(group.swipe_id) if target_windows is not None else None
        values = resample(ordered, frames, target_window) if group.valid else None
        return SampledGroup(group.clock_key, group.scenario, group.hand, start, end, end - start, values)

    for group in grouped_rows(path, value_columns):
        if group.swipe_id not in repeated:
            output[group.swipe_id] = sample(group)
            continue
        previous = deferred.get(group.swipe_id)
        if previous is None:
            deferred[group.swipe_id] = group
            continue
        if previous.clock_key != group.clock_key or previous.hand != group.hand:
            raise ValueError(f"inconsistent metadata for swipe {group.swipe_id} in {path}")
        deferred[group.swipe_id] = SensorGroup(
            group.swipe_id,
            group.clock_key,
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


def clock_offsets(
    touch_groups: Mapping[int, SampledGroup],
    acceleration_groups: Mapping[int, SampledGroup],
) -> dict[tuple[str, str, str], float]:
    offsets_by_clock: dict[tuple[str, str, str], list[float]] = defaultdict(list)
    offsets_by_session_user: dict[tuple[str, str], list[float]] = defaultdict(list)
    for swipe_id, touch in touch_groups.items():
        acceleration = acceleration_groups.get(swipe_id)
        if (
            acceleration is None
            or touch.values is None
            or acceleration.values is None
            or touch.clock_key != acceleration.clock_key
        ):
            continue
        touch_midpoint = (touch.start + touch.end) / 2
        sensor_midpoint = (acceleration.start + acceleration.end) / 2 / SENSOR_TIME_SCALE
        offset = sensor_midpoint - touch_midpoint
        offsets_by_clock[touch.clock_key].append(offset)
        session, _, user = touch.clock_key
        offsets_by_session_user[(session, user)].append(offset)

    calibrated_offsets: dict[tuple[str, str, str], float] = {}
    for key, values in offsets_by_clock.items():
        session, _, user = key
        calibration_values = (
            values
            if len(values) >= MIN_CLOCK_CALIBRATION_SAMPLES
            else offsets_by_session_user[(session, user)]
        )
        calibrated_offsets[key] = float(np.median(calibration_values))
    return calibrated_offsets


def vectorize(
    touch_group: SampledGroup,
    acceleration_group: SampledGroup,
    gyroscope_group: SampledGroup,
    magnetometer_group: SampledGroup,
    sensor_clock_offset: float,
) -> tuple[tuple[str, str, str], tuple[float, float, float], np.ndarray] | None:
    if not (touch_group.scenario == acceleration_group.scenario == gyroscope_group.scenario == magnetometer_group.scenario):
        return None
    if not (touch_group.clock_key == acceleration_group.clock_key == gyroscope_group.clock_key == magnetometer_group.clock_key):
        return None
    touch = touch_group.values
    acceleration = acceleration_group.values
    gyroscope = gyroscope_group.values
    magnetometer = magnetometer_group.values
    if touch is None or acceleration is None or gyroscope is None or magnetometer is None:
        return None
    touch_duration = touch_group.duration
    sensor_duration = acceleration_group.duration / SENSOR_TIME_SCALE
    sensor_start = acceleration_group.start / SENSOR_TIME_SCALE - sensor_clock_offset
    sensor_start_offset = sensor_start - touch_group.start
    sensor_end_offset = sensor_start_offset + sensor_duration - touch_duration
    if not all(
        MIN_DURATION_MS <= duration <= MAX_DURATION_MS
        for duration in (touch_duration, sensor_duration)
    ):
        return None
    if any(
        abs(offset) > MAX_BOUNDARY_OFFSET_MS
        for offset in (sensor_start_offset, sensor_end_offset)
    ):
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
    timing = (math.log(touch_duration), sensor_start_offset, sensor_end_offset)
    standardized = np.concatenate(((raw / SCALES).reshape(-1), np.asarray(timing) / TIMING_SCALES))
    key = (touch_group.scenario, touch_group.hand, swipe_direction)
    return key, timing, standardized


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
    timings: dict[tuple[str, str, str], list[tuple[float, float, float]]],
    frames: int,
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
        selected = order[:rank]
        components = []
        for component_index in selected:
            eigenvalue = max(0.0, float(eigenvalues[component_index]))
            components.append({
                "sigma": round(math.sqrt(eigenvalue), 6),
                "basis": quantize(stable_component(eigenvectors[:, component_index])),
            })
        frame_values = frames * len(CHANNELS)
        touch_indices = np.asarray([
            *(frame * len(CHANNELS) + channel for frame in range(frames) for channel in range(5)),
            frame_values,
        ])
        sensor_indices = np.asarray([
            *(frame * len(CHANNELS) + channel for frame in range(frames) for channel in range(5, len(CHANNELS))),
            frame_values + 1,
            frame_values + 2,
        ])
        cross_modal_covariance = covariance[np.ix_(touch_indices, sensor_indices)]
        selected_eigenvalues = np.maximum(eigenvalues[selected], 0)
        retained_cross_modal_covariance = (
            eigenvectors[touch_indices][:, selected] * selected_eigenvalues
        ) @ eigenvectors[sensor_indices][:, selected].T
        cross_modal_norm = float(np.linalg.norm(cross_modal_covariance))
        reconstruction_error = float(
            np.linalg.norm(cross_modal_covariance - retained_cross_modal_covariance)
        )
        cross_modal_covariance_retained = 1 - reconstruction_error / cross_modal_norm
        variance_retained = float(np.sum(selected_eigenvalues) / np.sum(np.maximum(eigenvalues, 0)))
        if variance_retained < MIN_VARIANCE_RETAINED:
            raise ValueError(f"{key} retains only {variance_retained:.6f} total variance")
        if cross_modal_covariance_retained < MIN_CROSS_MODAL_COVARIANCE_RETAINED:
            raise ValueError(
                f"{key} retains only {cross_modal_covariance_retained:.6f} cross-modal covariance"
            )
        timing_values = np.asarray(timings[key], dtype=np.float64)
        touch_durations = np.exp(timing_values[:, 0])
        sensor_starts = timing_values[:, 1]
        sensor_ends = timing_values[:, 2]
        scenario, hand, swipe_direction = key
        output.append({
            "scenario": scenario,
            "hand": hand,
            "direction": swipe_direction,
            "count": len(vectors),
            "timingBounds": {
                "touchDuration": [round(float(np.min(touch_durations)), 3), round(float(np.max(touch_durations)), 3)],
                "sensorStartOffset": [round(float(np.min(sensor_starts)), 3), round(float(np.max(sensor_starts)), 3)],
                "sensorEndOffset": [round(float(np.min(sensor_ends)), 3), round(float(np.max(sensor_ends)), 3)],
            },
            "quality": {
                "varianceRetained": round(variance_retained, 6),
                "crossModalCovarianceRetained": round(cross_modal_covariance_retained, 6),
            },
            "mean": quantize(mean),
            "components": components,
        })
    return output


def module_text(model: dict[str, object]) -> str:
    body = json.dumps(model, ensure_ascii=True, indent=2, separators=(",", ": "))
    return (
        "// Generated by scripts/compile-csd4ca.py. Do not edit by hand.\n"
        "// CSD4CA is licensed CC BY 4.0; attribution is recorded in NOTICE.\n"
        "import {\n"
        "  INTERACTION_CHANNELS, INTERACTION_SCALES,\n"
        "  INTERACTION_TIMING_CHANNELS, INTERACTION_TIMING_SCALES,\n"
        "} from './model.js';\n"
        "import type { InteractionModel } from './model.js';\n\n"
        f"const DATA = {body} as const;\n\n"
        "export const CSD4CA_MODEL: InteractionModel = {\n"
        "  ...DATA,\n"
        "  channels: INTERACTION_CHANNELS,\n"
        "  scales: INTERACTION_SCALES,\n"
        "  timingChannels: INTERACTION_TIMING_CHANNELS,\n"
        "  timingScales: INTERACTION_TIMING_SCALES,\n"
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
    timings: dict[tuple[str, str, str], list[tuple[float, float, float]]] = {}
    touch_groups = sampled_groups(paths["touch"], (8, 9, 10, 11, 12), options.frames)
    acceleration_groups = sampled_groups(paths["acceleration"], (9, 10, 11), options.frames)
    sensor_windows = {
        swipe_id: (group.start, group.end)
        for swipe_id, group in acceleration_groups.items()
    }
    gyroscope_groups = sampled_groups(paths["gyroscope"], (9, 10, 11), options.frames, sensor_windows)
    magnetometer_groups = sampled_groups(paths["magnetometer"], (9, 10, 11), options.frames, sensor_windows)
    offsets = clock_offsets(touch_groups, acceleration_groups)
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
        sensor_clock_offset = offsets.get(touch.clock_key)
        if sensor_clock_offset is None:
            rejected += 1
            continue
        sample = vectorize(touch, acceleration, gyroscope, magnetometer, sensor_clock_offset)
        if sample is None:
            rejected += 1
            continue
        key, timing, vector = sample
        samples.setdefault(key, []).append(vector)
        timings.setdefault(key, []).append(timing)
        accepted += 1

    groups = compile_groups(samples, timings, options.frames, options.rank, options.min_group)
    model = {
        "schema": MODEL_SCHEMA,
        "compiler": COMPILER_VERSION,
        "frames": options.frames,
        "stride": len(CHANNELS),
        "quantization": QUANTIZATION,
        "calibration": {
            "sensorTimeScale": SENSOR_TIME_SCALE,
            "clockCalibration": "median-window-midpoint-by-session-scenario-user",
            "minimumDurationMs": MIN_DURATION_MS,
            "maximumDurationMs": MAX_DURATION_MS,
            "maxBoundaryOffsetMs": MAX_BOUNDARY_OFFSET_MS,
        },
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
        "minimumVarianceRetained": min(group["quality"]["varianceRetained"] for group in groups),
        "minimumCrossModalCovarianceRetained": min(
            group["quality"]["crossModalCovarianceRetained"] for group in groups
        ),
    }, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
