import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import DataLoader, Dataset
import lightning as pl
import pandas as pd
import joblib
from sklearn.preprocessing import StandardScaler

torch.set_float32_matmul_precision("high")

class TrainCSVLoader(Dataset):
    def __init__(self, path="train_telemetry_merged.csv", scaler_path="scaler.pkl"):
        df = pd.read_csv(path)
        numeric_cols = df.select_dtypes("number").columns

        scaler = joblib.load(scaler_path)
        scaled_values = scaler.transform(df[numeric_cols])

        # Move the ENTIRE dataset to CUDA once
        self.data = torch.tensor(
            scaled_values, dtype=torch.float32, device="cuda"
        )

    def __len__(self):
        return len(self.data)

    def __getitem__(self, index):
        # Just indexing a GPU tensor—zero CPU-GPU transfer overhead during training
        return self.data[index]
    
class ValCSVLoader(Dataset):
    def __init__(self, path="val_telemetry_merged.csv", scaler_path="scaler.pkl"):
        df = pd.read_csv(path)
        numeric_cols = df.select_dtypes("number").columns

        scaler = joblib.load(scaler_path)
        scaled_values = scaler.transform(df[numeric_cols])

        # Move the ENTIRE dataset to CUDA once
        self.data = torch.tensor(
            scaled_values, dtype=torch.float32, device="cuda"
        )

    def __len__(self):
        return len(self.data)

    def __getitem__(self, index):
        # Just indexing a GPU tensor—zero CPU-GPU transfer overhead during training
        return self.data[index]
    
class Encoder(nn.Module):
    def __init__(self, input_dim):
        super().__init__()

        self.net = nn.Sequential(
            nn.Linear(input_dim, 16),
            nn.ReLU(),
            nn.Linear(16, 32),
            nn.ReLU(),
            nn.Linear(32, 32)
        )

    def forward(self, x):
        return self.net(x)

class Decoder(nn.Module):
    def __init__(self, output_dim):
        super().__init__()

        self.net = nn.Sequential(
            nn.Linear(32, 16),
            nn.ReLU(),
            nn.Linear(16, output_dim)
        )

    def forward(self, x):
        return self.net(x)

class AutoEncoder(pl.LightningModule):
    def __init__(self, num_cols):
        super().__init__()

        self.encoder = Encoder(input_dim=num_cols)
        self.decoder = Decoder(output_dim=num_cols)

    def forward(self, x):
        encoder_out = self.encoder(x)
        decoded = self.decoder(encoder_out)

        return decoded

    def training_step(self, batch, batch_idx):
        target = batch

        model_out = self(target)

        loss = F.l1_loss(model_out, target)

        self.log("train_loss", loss, prog_bar=True)

        return loss

    def validation_step(self, batch, batch_idx):
        target = batch
        
        model_out = self(target)
        
        loss = F.l1_loss(model_out, target)
        
        self.log("val_loss", loss, prog_bar=True)
        
        return loss

    def configure_optimizers(self):
        return torch.optim.AdamW(self.parameters(), lr=1e-3, weight_decay=0.01)

if __name__ == "__main__":
    model = AutoEncoder(num_cols=17)

    train_set = TrainCSVLoader()
    train_data = DataLoader(dataset=train_set, batch_size=1024, shuffle=True)

    val_set = ValCSVLoader()
    val_data = DataLoader(dataset=val_set, batch_size=512, shuffle=False)

    trainer = pl.Trainer(max_epochs=100, accelerator="gpu", precision="bf16-mixed", check_val_every_n_epoch=1)
    trainer.fit(model, train_dataloaders=train_data, val_dataloaders=val_data)

    torch.save(model.state_dict(), "model.pt")