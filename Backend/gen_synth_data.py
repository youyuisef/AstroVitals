#AI generated telemetry script for synthetic data

import numpy as np
import pandas as pd

from datetime import datetime, timedelta

# ============================================================
# CONFIGURATION
# ============================================================

NUM_ASTRONAUTS = 6
DAYS = 14
INTERVAL_MINUTES = 1

START_TIME = datetime(2026, 1, 1)

TELEMETRY_FILE = "astronaut_telemetry.csv"
SLEEP_FILE = "astronaut_sleep.csv"

rng = np.random.default_rng(42)

MINUTES_PER_DAY = 1440
TOTAL_MINUTES = DAYS * MINUTES_PER_DAY


# ============================================================
# HELPER FUNCTIONS
# ============================================================

def clamp(value, low, high):
    return float(np.clip(value, low, high))


def ar_noise(previous, scale=1.0, persistence=0.96):
    """Temporally correlated noise."""
    return persistence * previous + rng.normal(0, scale)


# ============================================================
# SHARED SPACECRAFT ENVIRONMENT
# ============================================================

def generate_environment():

    environment = []

    noise = {
        "co2": 0.0,
        "oxygen": 0.0,
        "pressure": 0.0,
        "temperature": 0.0,
        "humidity": 0.0,
        "radiation": 0.0
    }

    cumulative_radiation = 0.0

    for minute in range(TOTAL_MINUTES):

        hour = (minute % MINUTES_PER_DAY) / 60

        # Cabin CO2
        noise["co2"] = ar_noise(
            noise["co2"], 5, 0.96
        )

        co2 = clamp(
            900
            + 35 * np.sin(2 * np.pi * hour / 24)
            + noise["co2"],
            650, 1400
        )

        # Cabin oxygen concentration
        noise["oxygen"] = ar_noise(
            noise["oxygen"], 0.003, 0.97
        )

        oxygen = clamp(
            20.9 + noise["oxygen"],
            20.7, 21.1
        )

        # Cabin pressure
        noise["pressure"] = ar_noise(
            noise["pressure"], 0.003, 0.97
        )

        pressure = clamp(
            101.3 + noise["pressure"],
            100.8, 101.8
        )

        # Oxygen partial pressure, derived from
        # oxygen fraction and total cabin pressure.
        oxygen_partial_pressure = (
            pressure * oxygen / 100
        )

        # Cabin temperature
        noise["temperature"] = ar_noise(
            noise["temperature"], 0.025, 0.96
        )

        temperature = clamp(
            23 + 0.3 * np.sin(
                2 * np.pi * hour / 24
            ) + noise["temperature"],
            22, 24
        )

        # Relative humidity
        noise["humidity"] = ar_noise(
            noise["humidity"], 0.12, 0.97
        )

        humidity = clamp(
            45 + noise["humidity"],
            40, 50
        )

        # Radiation dose rate
        noise["radiation"] = ar_noise(
            noise["radiation"], 0.5, 0.98
        )

        radiation = clamp(
            15 + noise["radiation"],
            8, 23
        )

        # Convert uSv/hour into mSv for one minute.
        cumulative_radiation += (
            radiation / 60 / 1000
        )

        environment.append({
            "cabin_co2_ppm": round(co2, 3),
            "cabin_oxygen_percent": round(oxygen, 4),
            "cabin_oxygen_partial_pressure_kpa": round(
                oxygen_partial_pressure, 4
            ),
            "cabin_pressure_kpa": round(pressure, 4),
            "cabin_temperature_c": round(temperature, 3),
            "cabin_humidity_percent": round(humidity, 3),
            "radiation_dose_rate_usv_h": round(
                radiation, 3
            ),
            "cumulative_radiation_msv": round(
                cumulative_radiation, 6
            )
        })

    return environment


# ============================================================
# ASTRONAUT DAILY SCHEDULE
# ============================================================

def get_activity(hour, exercise_start):

    # Sleep
    if hour >= 23 or hour < 7:
        return 1.0, 0

    # Morning routine
    if 7 <= hour < 9:
        return 1.8, 0

    # Work
    if 9 <= hour < 12:
        return 1.5, 0

    # Lunch and rest
    if 12 <= hour < 13:
        return 1.2, 0

    # Afternoon work
    if 13 <= hour < 17:
        return 1.6, 0

    # Scheduled exercise
    if exercise_start <= hour < exercise_start + 0.75:
        return 4.5, 1

    # Relaxation
    return 1.3, 0


# ============================================================
# GENERATE ONE ASTRONAUT
# ============================================================

def generate_astronaut(astronaut_id, environment):

    records = []
    sleep_records = []

    # Individual healthy physiological baselines
    baseline_hr = rng.uniform(58, 76)
    baseline_hrv = rng.uniform(45, 75)

    baseline_systolic = rng.uniform(108, 122)
    baseline_diastolic = rng.uniform(68, 80)

    # Individual variation
    hr_noise = 0.0
    hrv_noise = 0.0

    previous_bp = None

    # Individual radiation exposure factor
    shielding_factor = rng.uniform(0.97, 1.03)

    cumulative_dose = 0.0

    # Exercise time differs between astronauts and days.
    exercise_schedule = [
        rng.uniform(16.5, 18.0)
        for _ in range(DAYS)
    ]

    for minute in range(TOTAL_MINUTES):

        timestamp = START_TIME + timedelta(
            minutes=minute
        )

        hour = timestamp.hour + timestamp.minute / 60

        day_index = minute // MINUTES_PER_DAY

        exercise_start = exercise_schedule[day_index]

        activity_met, exercise_status = get_activity(
            hour, exercise_start
        )

        sleep_state = int(
            hour >= 23 or hour < 7
        )

        # ================================================
        # HEART RATE
        # ================================================

        hr_noise = ar_noise(
            hr_noise, 0.7, 0.94
        )

        circadian = 3 * np.sin(
            2 * np.pi * (hour - 15) / 24
        )

        heart_rate = (
            baseline_hr
            + (activity_met - 1) * 12
            + circadian
            + hr_noise
        )

        heart_rate = clamp(
            heart_rate, 50, 165
        )

        # ================================================
        # HEART RATE VARIABILITY
        # ================================================

        hrv_noise = ar_noise(
            hrv_noise, 1.0, 0.94
        )

        hrv = (
            baseline_hrv
            - (activity_met - 1) * 6
            + hrv_noise
        )

        hrv = clamp(hrv, 25, 100)

        # ================================================
        # BLOOD PRESSURE
        # Simulated cuff measurement every 30 minutes.
        # Previous reading is retained between measurements.
        # ================================================

        if minute % 30 == 0 or previous_bp is None:

            systolic = (
                baseline_systolic
                + (activity_met - 1) * 1.5
                + rng.normal(0, 2)
            )

            diastolic = (
                baseline_diastolic
                + (activity_met - 1) * 0.4
                + rng.normal(0, 1.5)
            )

            previous_bp = (
                clamp(systolic, 100, 130),
                clamp(diastolic, 60, 85)
            )

        systolic_bp, diastolic_bp = previous_bp

        # ================================================
        # ENVIRONMENT
        # ================================================

        env = environment[minute]

        radiation = (
            env["radiation_dose_rate_usv_h"]
            * shielding_factor
        )

        cumulative_dose += radiation / 60 / 1000

        # ================================================
        # RECORD
        # ================================================

        records.append({
            "timestamp": timestamp.isoformat(),
            "astronaut_id": astronaut_id,

            "heart_rate_bpm": round(heart_rate, 3),

            "systolic_bp_mmhg": round(
                systolic_bp, 2
            ),

            "diastolic_bp_mmhg": round(
                diastolic_bp, 2
            ),

            "hrv_rmssd_ms": round(hrv, 3),

            "activity_level_met": round(
                activity_met, 2
            ),

            "exercise_status": exercise_status,

            "sleep_state": sleep_state,

            "cabin_co2_ppm": env["cabin_co2_ppm"],

            "cabin_oxygen_percent": env[
                "cabin_oxygen_percent"
            ],

            "cabin_oxygen_partial_pressure_kpa": env[
                "cabin_oxygen_partial_pressure_kpa"
            ],

            "cabin_pressure_kpa": env[
                "cabin_pressure_kpa"
            ],

            "cabin_temperature_c": env[
                "cabin_temperature_c"
            ],

            "cabin_humidity_percent": env[
                "cabin_humidity_percent"
            ],

            "radiation_dose_rate_usv_h": round(
                radiation, 3
            ),

            "cumulative_radiation_msv": round(
                cumulative_dose, 6
            ),

            "data_origin": "SYNTHETIC_HEALTHY"
        })

    # ================================================
    # DAILY SLEEP RECORDS
    # ================================================

    for day in range(DAYS):

        # A healthy sleep duration with normal variation
        duration = rng.uniform(7.2, 8.8)

        # Sleep quality correlates with sleep duration.
        quality = (
            85
            + (duration - 8) * 5
            + rng.normal(0, 3)
        )

        quality = clamp(quality, 75, 98)

        sleep_records.append({
            "date": (
                START_TIME + timedelta(days=day)
            ).date().isoformat(),

            "astronaut_id": astronaut_id,

            "sleep_duration_hours": round(
                duration, 2
            ),

            "sleep_quality_score": round(
                quality, 2
            ),

            "data_origin": "SYNTHETIC_HEALTHY"
        })

    return records, sleep_records


# ============================================================
# MAIN GENERATOR
# ============================================================

def main():

    print("Generating spacecraft environment...")

    environment = generate_environment()

    telemetry = []
    sleep_data = []

    for i in range(NUM_ASTRONAUTS):

        astronaut_id = f"AST-{i + 1:03}"

        print(f"Generating {astronaut_id}...")

        records, sleep_records = generate_astronaut(
            astronaut_id,
            environment
        )

        telemetry.extend(records)
        sleep_data.extend(sleep_records)

    # Convert to DataFrames
    telemetry_df = pd.DataFrame(telemetry)
    sleep_df = pd.DataFrame(sleep_data)

    # Save datasets
    telemetry_df.to_csv(
        TELEMETRY_FILE, index=False
    )

    sleep_df.to_csv(
        SLEEP_FILE, index=False
    )

    # ================================================
    # VALIDATION
    # ================================================

    feature_columns = [
        col for col in telemetry_df.columns
        if col not in [
            "timestamp",
            "astronaut_id",
            "data_origin"
        ]
    ]

    assert telemetry_df[feature_columns].notna().all().all()
    assert sleep_df[
        ["sleep_duration_hours", "sleep_quality_score"]
    ].notna().all().all()

    assert telemetry_df["heart_rate_bpm"].between(
        50, 165
    ).all()

    assert telemetry_df["cabin_co2_ppm"].between(
        650, 1400
    ).all()

    assert telemetry_df["cabin_pressure_kpa"].between(
        100.8, 101.8
    ).all()

    assert telemetry_df["sleep_state"].isin(
        [0, 1]
    ).all()

    assert telemetry_df["exercise_status"].isin(
        [0, 1]
    ).all()

    assert sleep_df["sleep_duration_hours"].between(
        7.2, 8.8
    ).all()

    assert sleep_df["sleep_quality_score"].between(
        75, 98
    ).all()

    print("\n================================")
    print("GENERATION COMPLETE")
    print("================================")

    print(f"Astronauts: {NUM_ASTRONAUTS}")
    print(f"Days: {DAYS}")
    print(f"Telemetry rows: {len(telemetry_df):,}")
    print(f"Sleep rows: {len(sleep_df):,}")

    print("\nTelemetry preview:")
    print(telemetry_df.head())

    print("\nFeature statistics:")
    print(telemetry_df[feature_columns].describe())

    print("\nFiles saved:")
    print(TELEMETRY_FILE)
    print(SLEEP_FILE)


if __name__ == "__main__":
    main()
