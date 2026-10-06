"""
Invisible Queue AI — Outpatient Queue Dataset Generator
Generates realistic outpatient hospital queue consultation records for waiting-time prediction.

Features generated strictly reflect queue state at arrival/prediction time:
- No future consultation durations or future timestamps are leaked.
- Consultation durations follow empirical log-normal hospital distributions.
- Department-specific clinical workflows and doctor-specific pacing are modeled.
"""

import os
import numpy as np
import pandas as pd
from datetime import datetime, timedelta

def generate_outpatient_dataset(num_records=5000, random_seed=42):
    np.random.seed(random_seed)

    # Department profiles: {id: (name, base_duration_mean, base_duration_sd)}
    # Log-normal consultation distribution parameters
    dept_profiles = {
        1: {"name": "General Medicine", "mean_dur": 11.5, "sd_dur": 3.8},
        2: {"name": "Cardiology",       "mean_dur": 17.5, "sd_dur": 5.2},
        3: {"name": "Pediatrics",       "mean_dur": 13.0, "sd_dur": 4.1},
        4: {"name": "Orthopedics",      "mean_dur": 14.5, "sd_dur": 4.5},
        5: {"name": "Dermatology",      "mean_dur": 10.0, "sd_dur": 3.2},
    }

    # Doctor profiles: (doctor_id, dept_id, doctor_efficiency_factor)
    doctor_profiles = [
        {"doctor_id": 1, "dept_id": 1, "efficiency": 1.00},  # Dr. Ravi Kumar (GM)
        {"doctor_id": 2, "dept_id": 1, "efficiency": 0.92},  # Faster GM doctor
        {"doctor_id": 3, "dept_id": 2, "efficiency": 1.10},  # Cardiology thorough
        {"doctor_id": 4, "dept_id": 2, "efficiency": 0.95},  # Cardiology senior
        {"doctor_id": 5, "dept_id": 3, "efficiency": 1.05},  # Pediatrics specialist
        {"doctor_id": 6, "dept_id": 4, "efficiency": 1.00},  # Ortho specialist
        {"doctor_id": 7, "dept_id": 5, "efficiency": 0.90},  # Derm specialist
    ]

    records = []
    start_date = datetime(2026, 7, 1)

    for i in range(num_records):
        # Progressively advance dates to allow realistic chronological train-test splits
        day_offset = int((i / num_records) * 60)
        curr_date = start_date + timedelta(days=day_offset)
        day_of_week = curr_date.weekday() # 0 = Monday, 6 = Sunday

        # Hospital outpatient clinic hours: 8:00 AM to 5:00 PM (8 to 17)
        # Probability distribution over outpatient hours (peak around 9-11 AM, 2-4 PM)
        hour_weights = [
            0.04, # 8 AM
            0.18, # 9 AM (peak)
            0.20, # 10 AM (peak)
            0.16, # 11 AM (peak)
            0.08, # 12 PM (lunch transition)
            0.04, # 1 PM
            0.12, # 2 PM (afternoon peak)
            0.10, # 3 PM
            0.06, # 4 PM
            0.02  # 5 PM
        ]
        hour_of_day = int(np.random.choice(range(8, 18), p=hour_weights))
        is_peak_hour = 1 if (hour_of_day in [9, 10, 11, 14, 15]) else 0

        # Pick doctor
        doc = np.random.choice(doctor_profiles)
        doc_id = doc["doctor_id"]
        dept_id = doc["dept_id"]
        dept_info = dept_profiles[dept_id]

        # Historical average consultation duration for this doctor
        doc_avg_dur = round(dept_info["mean_dur"] * doc["efficiency"], 2)

        # Queue dynamics at patient arrival time
        # Higher queue lengths during peak hours and on Mondays/Saturdays
        day_load_multiplier = 1.25 if day_of_week in [0, 5] else (0.75 if day_of_week == 6 else 1.0)
        peak_multiplier = 1.4 if is_peak_hour else 0.85

        mean_ahead = 4.5 * day_load_multiplier * peak_multiplier
        patients_ahead = int(np.clip(np.random.poisson(lam=mean_ahead), 0, 16))
        token_position = patients_ahead + 1
        queue_length = patients_ahead + int(np.random.poisson(lam=2.5))

        # Completed consultations today so far
        completed_today = int(np.clip(np.random.poisson(lam=max(0.5, (hour_of_day - 8) * 3.2)), 0, 35))

        # Realistic wait time physics calculation
        # Each patient ahead takes an actual consultation duration drawn from log-normal distribution
        mu = np.log((doc_avg_dur ** 2) / np.sqrt(dept_info["sd_dur"] ** 2 + doc_avg_dur ** 2))
        sigma = np.sqrt(np.log(1 + (dept_info["sd_dur"] ** 2 / doc_avg_dur ** 2)))

        if patients_ahead == 0:
            # If 0 patients ahead, doctor is either finishing with previous patient or ready
            if np.random.rand() > 0.4:
                # Finishing up current consultation (random fraction remaining: 1 to 6 minutes)
                actual_wait = float(np.random.uniform(1.0, min(6.0, doc_avg_dur * 0.5)))
            else:
                actual_wait = float(np.random.uniform(0.5, 2.0)) # Practically ready
        else:
            # Patients ahead sum + small turnover buffer (e.g. 0.5 - 1.5 min per patient for sanitization/entry)
            simulated_consults = np.random.lognormal(mean=mu, sigma=sigma, size=patients_ahead)
            turnaround_delays = np.random.uniform(0.5, 1.5, size=patients_ahead)
            
            # Additional small clinic fatigue / emergency triage delay factor
            fatigue_delay = (completed_today * 0.08) if completed_today > 15 else 0.0
            peak_congestion_noise = np.random.normal(0.0, 1.2) if is_peak_hour else np.random.normal(0.0, 0.7)

            raw_wait = np.sum(simulated_consults) + np.sum(turnaround_delays) + fatigue_delay + peak_congestion_noise
            actual_wait = float(np.clip(raw_wait, 1.0, 180.0))

        actual_wait = round(actual_wait, 1)

        records.append({
            "record_id": i + 1,
            "record_date": curr_date.strftime("%Y-%m-%d"),
            "hour_of_day": hour_of_day,
            "day_of_week": day_of_week,
            "is_peak_hour": is_peak_hour,
            "department_id": dept_id,
            "department_name": dept_info["name"],
            "doctor_id": doc_id,
            "doctor_avg_duration": doc_avg_dur,
            "patients_ahead": patients_ahead,
            "queue_length": queue_length,
            "token_position": token_position,
            "completed_today": completed_today,
            "waiting_time_minutes": actual_wait,
            "dataset_type": "SYNTHETIC_DEVELOPMENT"
        })

    df = pd.DataFrame(records)
    return df

if __name__ == "__main__":
    out_dir = os.path.dirname(os.path.abspath(__file__))
    os.makedirs(out_dir, exist_ok=True)
    csv_path = os.path.join(out_dir, "synthetic_training_data.csv")

    df = generate_outpatient_dataset(num_records=5000)
    df.to_csv(csv_path, index=False)
    print(f"Generated {len(df)} synthetic outpatient queue training records at: {csv_path}")
    print("Sample records:")
    print(df.head(3)[["record_date", "hour_of_day", "department_name", "doctor_id", "patients_ahead", "waiting_time_minutes"]])
