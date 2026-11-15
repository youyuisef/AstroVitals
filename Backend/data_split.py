import pandas as pd

# 1. Load data
telemetry_df = pd.read_csv("astronaut_telemetry.csv")
sleep_df = pd.read_csv("astronaut_sleep.csv")

# 2. Convert telemetry timestamp and sleep date to matching date formats
telemetry_df["timestamp"] = pd.to_datetime(telemetry_df["timestamp"])
telemetry_df["date"] = telemetry_df["timestamp"].dt.date
sleep_df["date"] = pd.to_datetime(sleep_df["date"]).dt.date

# 3. Sort chronologically
telemetry_df = telemetry_df.sort_values("timestamp").reset_index(drop=True)

# 4. Merge on both astronaut and date (prevents cross-astronaut mixing)
# (Adjust 'astronaut_id' if your column is named differently)
merged_df = pd.merge(
    telemetry_df, sleep_df, on=["astronaut_id", "date"], how="left"
)

# 5. Forward-fill sleep metrics per astronaut
merged_df = merged_df.groupby("astronaut_id", group_keys=False).ffill()
merged_df = merged_df.bfill()

# 6. Chronological split (70% train, 30% val)
split_idx = int(len(merged_df) * 0.7)
train_df = merged_df.iloc[:split_idx]
val_df = merged_df.iloc[split_idx:]

# 7. Save to disk
train_df.to_csv("train_telemetry_merged.csv", index=False)
val_df.to_csv("val_telemetry_merged.csv", index=False)

print(f"Saved {len(train_df)} rows to train_telemetry_merged.csv")
print(f"Saved {len(val_df)} rows to val_telemetry_merged.csv")