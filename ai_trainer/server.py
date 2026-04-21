from __future__ import annotations

import base64
import io
import json
import random
import threading
import time
import uuid
from dataclasses import dataclass
from datetime import datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

import numpy as np
import torch
from PIL import Image, ImageOps
from torch import nn
from torch.utils.data import DataLoader, Dataset, random_split


ROOT_DIR = Path(__file__).resolve().parent
STATIC_DIR = ROOT_DIR / "static"
DATA_DIR = ROOT_DIR / "data"
DATASET_DIR = DATA_DIR / "dataset"
MODELS_DIR = DATA_DIR / "models"
RECORDS_PATH = DATA_DIR / "records.json"

HOST = "0.0.0.0"
PORT = 8765
IMAGE_SIZE = 128
SUPPORTED_LABELS = ("ok", "ko")


def ensure_storage() -> None:
    for label in SUPPORTED_LABELS:
      (DATASET_DIR / label).mkdir(parents=True, exist_ok=True)
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    if not RECORDS_PATH.exists():
        RECORDS_PATH.write_text("[]", encoding="utf-8")


def load_records() -> list[dict[str, Any]]:
    try:
        return json.loads(RECORDS_PATH.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def save_records(records: list[dict[str, Any]]) -> None:
    RECORDS_PATH.write_text(json.dumps(records, ensure_ascii=True, indent=2), encoding="utf-8")


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


class BinaryImageDataset(Dataset):
    def __init__(self, root_dir: Path) -> None:
        self.items: list[tuple[Path, int]] = []
        for label_index, label_name in enumerate(SUPPORTED_LABELS):
            label_dir = root_dir / label_name
            for image_path in sorted(label_dir.glob("*")):
                if image_path.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}:
                    self.items.append((image_path, label_index))

    def __len__(self) -> int:
        return len(self.items)

    def __getitem__(self, index: int) -> tuple[torch.Tensor, torch.Tensor]:
        image_path, label_index = self.items[index]
        image = Image.open(image_path).convert("RGB")
        image = ImageOps.fit(image, (IMAGE_SIZE, IMAGE_SIZE), method=Image.Resampling.BILINEAR)
        image_array = np.asarray(image, dtype=np.float32) / 255.0
        tensor = torch.from_numpy(image_array).permute(2, 0, 1)
        label_tensor = torch.tensor(label_index, dtype=torch.float32)
        return tensor, label_tensor


class TinyClassifier(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.features = nn.Sequential(
            nn.Conv2d(3, 16, kernel_size=3, padding=1),
            nn.ReLU(),
            nn.MaxPool2d(2),
            nn.Conv2d(16, 32, kernel_size=3, padding=1),
            nn.ReLU(),
            nn.MaxPool2d(2),
            nn.Conv2d(32, 64, kernel_size=3, padding=1),
            nn.ReLU(),
            nn.MaxPool2d(2),
        )
        self.classifier = nn.Sequential(
            nn.Flatten(),
            nn.Linear(64 * 16 * 16, 128),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(128, 1),
        )

    def forward(self, inputs: torch.Tensor) -> torch.Tensor:
        features = self.features(inputs)
        logits = self.classifier(features)
        return logits.squeeze(1)


@dataclass
class TrainingConfig:
    epochs: int = 6
    batch_size: int = 8
    learning_rate: float = 0.001


class TrainerState:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.thread: threading.Thread | None = None
        self.status = "idle"
        self.message = "Listo para entrenar."
        self.started_at: str | None = None
        self.finished_at: str | None = None
        self.current_epoch = 0
        self.total_epochs = 0
        self.metrics: list[dict[str, Any]] = []
        self.last_model_path: str | None = None
        self.last_error: str | None = None

    def snapshot(self) -> dict[str, Any]:
        with self.lock:
            return {
                "status": self.status,
                "message": self.message,
                "started_at": self.started_at,
                "finished_at": self.finished_at,
                "current_epoch": self.current_epoch,
                "total_epochs": self.total_epochs,
                "metrics": list(self.metrics),
                "last_model_path": self.last_model_path,
                "last_error": self.last_error,
            }

    def set_running(self, config: TrainingConfig) -> None:
        with self.lock:
            self.status = "running"
            self.message = "Entrenamiento en curso."
            self.started_at = now_iso()
            self.finished_at = None
            self.current_epoch = 0
            self.total_epochs = config.epochs
            self.metrics = []
            self.last_error = None

    def append_metric(self, metric: dict[str, Any]) -> None:
        with self.lock:
            self.metrics.append(metric)
            self.current_epoch = metric["epoch"]
            self.message = f"Epoca {metric['epoch']} de {self.total_epochs} completada."

    def set_done(self, model_path: Path) -> None:
        with self.lock:
            self.status = "done"
            self.message = "Entrenamiento completado."
            self.finished_at = now_iso()
            self.last_model_path = str(model_path)

    def set_error(self, message: str) -> None:
        with self.lock:
            self.status = "error"
            self.message = message
            self.finished_at = now_iso()
            self.last_error = message


trainer_state = TrainerState()


def collect_counts() -> dict[str, int]:
    counts = {}
    for label in SUPPORTED_LABELS:
        counts[label] = sum(1 for path in (DATASET_DIR / label).glob("*") if path.is_file())
    return counts


def run_training(config: TrainingConfig) -> None:
    try:
        trainer_state.set_running(config)
        dataset = BinaryImageDataset(DATASET_DIR)
        label_counts = collect_counts()

        if len(dataset) < 8:
            raise RuntimeError("Se necesitan al menos 8 imagenes en total para entrenar.")
        if min(label_counts.values()) < 2:
            raise RuntimeError("Debe haber al menos 2 imagenes en OK y 2 en KO.")

        validation_size = max(2, int(len(dataset) * 0.2))
        training_size = len(dataset) - validation_size
        train_dataset, val_dataset = random_split(
            dataset,
            [training_size, validation_size],
            generator=torch.Generator().manual_seed(42),
        )

        train_loader = DataLoader(train_dataset, batch_size=config.batch_size, shuffle=True)
        val_loader = DataLoader(val_dataset, batch_size=config.batch_size)

        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        model = TinyClassifier().to(device)
        optimizer = torch.optim.Adam(model.parameters(), lr=config.learning_rate)
        criterion = nn.BCEWithLogitsLoss()

        for epoch in range(1, config.epochs + 1):
            model.train()
            train_loss = 0.0
            train_correct = 0
            train_total = 0

            for images, labels in train_loader:
                images = images.to(device)
                labels = labels.to(device)

                optimizer.zero_grad()
                logits = model(images)
                loss = criterion(logits, labels)
                loss.backward()
                optimizer.step()

                train_loss += loss.item() * images.size(0)
                predictions = (torch.sigmoid(logits) >= 0.5).float()
                train_correct += (predictions == labels).sum().item()
                train_total += images.size(0)

            model.eval()
            val_loss = 0.0
            val_correct = 0
            val_total = 0

            with torch.no_grad():
                for images, labels in val_loader:
                    images = images.to(device)
                    labels = labels.to(device)
                    logits = model(images)
                    loss = criterion(logits, labels)
                    val_loss += loss.item() * images.size(0)
                    predictions = (torch.sigmoid(logits) >= 0.5).float()
                    val_correct += (predictions == labels).sum().item()
                    val_total += images.size(0)

            metric = {
                "epoch": epoch,
                "train_loss": round(train_loss / max(train_total, 1), 4),
                "train_accuracy": round(train_correct / max(train_total, 1), 4),
                "val_loss": round(val_loss / max(val_total, 1), 4),
                "val_accuracy": round(val_correct / max(val_total, 1), 4),
            }
            trainer_state.append_metric(metric)

        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        model_path = MODELS_DIR / f"model-{timestamp}.pt"
        latest_path = MODELS_DIR / "model-latest.pt"
        payload = {
            "created_at": now_iso(),
            "image_size": IMAGE_SIZE,
            "labels": list(SUPPORTED_LABELS),
            "metrics": trainer_state.snapshot()["metrics"],
            "state_dict": model.state_dict(),
        }
        torch.save(payload, model_path)
        torch.save(payload, latest_path)
        trainer_state.set_done(model_path)
    except Exception as error:  # pragma: no cover - surfaced to UI
        trainer_state.set_error(str(error))
    finally:
        with trainer_state.lock:
            trainer_state.thread = None


def start_training(config_data: dict[str, Any]) -> dict[str, Any]:
    with trainer_state.lock:
        if trainer_state.thread and trainer_state.thread.is_alive():
            return {"ok": False, "message": "Ya hay un entrenamiento en curso."}

    config = TrainingConfig(
        epochs=max(1, min(int(config_data.get("epochs", 6)), 50)),
        batch_size=max(2, min(int(config_data.get("batch_size", 8)), 64)),
        learning_rate=float(config_data.get("learning_rate", 0.001)),
    )

    thread = threading.Thread(target=run_training, args=(config,), daemon=True)
    with trainer_state.lock:
        trainer_state.thread = thread
    thread.start()
    return {"ok": True, "message": "Entrenamiento lanzado.", "config": config.__dict__}


def decode_image(data_url: str) -> Image.Image:
    if "," not in data_url:
        raise ValueError("Formato de imagen no valido.")

    _, encoded = data_url.split(",", 1)
    raw_bytes = base64.b64decode(encoded)
    image = Image.open(io.BytesIO(raw_bytes)).convert("RGB")
    return image


def save_uploaded_image(payload: dict[str, Any]) -> dict[str, Any]:
    label = str(payload.get("label", "")).lower().strip()
    image_data = str(payload.get("image_data", ""))

    if label not in SUPPORTED_LABELS:
        raise ValueError("La etiqueta debe ser 'ok' o 'ko'.")
    if not image_data:
        raise ValueError("No se ha recibido ninguna imagen.")

    image = decode_image(image_data)
    filename = f"{datetime.now().strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:8]}.jpg"
    destination = DATASET_DIR / label / filename
    image.save(destination, format="JPEG", quality=92)

    record = {
        "id": uuid.uuid4().hex,
        "label": label,
        "filename": filename,
        "created_at": now_iso(),
        "path": str(destination.relative_to(ROOT_DIR)),
        "source": payload.get("source", "capture"),
    }
    records = load_records()
    records.insert(0, record)
    save_records(records[:500])
    return record


def build_status_payload() -> dict[str, Any]:
    records = load_records()
    counts = collect_counts()
    latest_model_path = MODELS_DIR / "model-latest.pt"
    return {
        "dataset_counts": counts,
        "total_images": sum(counts.values()),
        "recent_records": records[:12],
        "model_available": latest_model_path.exists(),
        "training": trainer_state.snapshot(),
    }


def predict_image(payload: dict[str, Any]) -> dict[str, Any]:
    image_data = str(payload.get("image_data", ""))
    if not image_data:
        raise ValueError("No se ha recibido ninguna imagen para predecir.")

    latest_model_path = MODELS_DIR / "model-latest.pt"
    if not latest_model_path.exists():
        raise RuntimeError("Todavia no hay un modelo entrenado. Lanza el entrenamiento primero.")

    image = decode_image(image_data)
    image = ImageOps.fit(image, (IMAGE_SIZE, IMAGE_SIZE), method=Image.Resampling.BILINEAR)
    image_array = np.asarray(image, dtype=np.float32) / 255.0
    image_tensor = torch.from_numpy(image_array).permute(2, 0, 1).unsqueeze(0)

    checkpoint = torch.load(latest_model_path, map_location=torch.device("cpu"))
    model = TinyClassifier()
    model.load_state_dict(checkpoint["state_dict"])
    model.eval()

    with torch.no_grad():
        logits = model(image_tensor)
        ko_probability = torch.sigmoid(logits).item()

    label = "ko" if ko_probability >= 0.5 else "ok"
    confidence = ko_probability if label == "ko" else (1.0 - ko_probability)

    return {
        "label": label,
        "confidence": round(confidence, 4),
        "probabilities": {
            "ok": round(1.0 - ko_probability, 4),
            "ko": round(ko_probability, 4),
        },
        "model_path": str(latest_model_path.relative_to(ROOT_DIR)),
        "predicted_at": now_iso(),
    }


def json_response(handler: BaseHTTPRequestHandler, payload: dict[str, Any], status: int = 200) -> None:
    body = json.dumps(payload, ensure_ascii=True).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(body)


def html_response(handler: BaseHTTPRequestHandler, file_path: Path) -> None:
    if not file_path.exists():
        handler.send_error(HTTPStatus.NOT_FOUND)
        return

    body = file_path.read_bytes()
    content_type = "text/html; charset=utf-8"
    if file_path.suffix == ".js":
        content_type = "application/javascript; charset=utf-8"
    elif file_path.suffix == ".css":
        content_type = "text/css; charset=utf-8"

    handler.send_response(HTTPStatus.OK)
    handler.send_header("Content-Type", content_type)
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(body)


class AppHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        route = parsed.path

        if route in {"/", ""}:
            self.send_response(HTTPStatus.FOUND)
            self.send_header("Location", "/console")
            self.end_headers()
            return

        if route == "/console":
            return html_response(self, STATIC_DIR / "console" / "index.html")
        if route == "/console/app.js":
            return html_response(self, STATIC_DIR / "console" / "app.js")
        if route == "/console/styles.css":
            return html_response(self, STATIC_DIR / "console" / "styles.css")
        if route == "/capture":
            return html_response(self, STATIC_DIR / "capture" / "index.html")
        if route == "/capture/app.js":
            return html_response(self, STATIC_DIR / "capture" / "app.js")
        if route == "/capture/styles.css":
            return html_response(self, STATIC_DIR / "capture" / "styles.css")
        if route == "/api/status":
            return json_response(self, build_status_payload())
        if route == "/api/health":
            return json_response(self, {"ok": True, "message": "Servidor activo."})

        self.send_error(HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        route = parsed.path

        content_length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(content_length) if content_length else b"{}"

        try:
            payload = json.loads(raw_body.decode("utf-8"))
        except json.JSONDecodeError:
            return json_response(self, {"ok": False, "message": "JSON no valido."}, status=400)

        if route == "/api/upload-image":
            try:
                record = save_uploaded_image(payload)
                return json_response(self, {"ok": True, "record": record})
            except Exception as error:
                return json_response(self, {"ok": False, "message": str(error)}, status=400)

        if route == "/api/train":
            result = start_training(payload)
            return json_response(self, result, status=200 if result["ok"] else 409)

        if route == "/api/predict-image":
            try:
                prediction = predict_image(payload)
                return json_response(self, {"ok": True, "prediction": prediction})
            except Exception as error:
                return json_response(self, {"ok": False, "message": str(error)}, status=400)

        self.send_error(HTTPStatus.NOT_FOUND)

    def log_message(self, format_string: str, *args: Any) -> None:
        timestamp = datetime.now().strftime("%H:%M:%S")
        print(f"[{timestamp}] {self.address_string()} - {format_string % args}")


def main() -> None:
    ensure_storage()
    server = ThreadingHTTPServer((HOST, PORT), AppHandler)
    print(f"Servidor listo en http://127.0.0.1:{PORT}/console")
    print(f"Capturador movil en http://127.0.0.1:{PORT}/capture")
    server.serve_forever()


if __name__ == "__main__":
    main()
