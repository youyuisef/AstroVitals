import joblib
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler

# Load your data
df = pd.read_csv('train_telemetry_merged.csv')
numeric_cols = df.select_dtypes(include="number").columns

# Split into train and test sets FIRST (to prevent data leakage)
train_df, test_df = train_test_split(df, test_size=0.2, random_state=42)

# Initialize and fit the scaler ONLY on training data
scaler = StandardScaler()
train_df[numeric_cols] = scaler.fit_transform(train_df[numeric_cols])

# Transform the test set using the train-fitted scaler
test_df[numeric_cols] = scaler.transform(test_df[numeric_cols])

# Save the fitted scaler object to disk
joblib.dump(scaler, 'scaler.pkl')