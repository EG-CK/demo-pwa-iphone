(function () {
  const STATUS_POLL_INTERVAL_MS = 10000;

  const elements = {
    totalImages: document.getElementById("totalImages"),
    okCount: document.getElementById("okCount"),
    koCount: document.getElementById("koCount"),
    trainingState: document.getElementById("trainingState"),
    trainingMessage: document.getElementById("trainingMessage"),
    metricsBody: document.getElementById("metricsBody"),
    recordsBody: document.getElementById("recordsBody"),
    refreshButton: document.getElementById("refreshButton"),
    startTrainingButton: document.getElementById("startTrainingButton"),
    epochsInput: document.getElementById("epochsInput"),
    batchSizeInput: document.getElementById("batchSizeInput"),
    learningRateInput: document.getElementById("learningRateInput"),
    predictImageInput: document.getElementById("predictImageInput"),
    predictButton: document.getElementById("predictButton"),
    predictMessage: document.getElementById("predictMessage"),
    predictLabel: document.getElementById("predictLabel"),
    predictConfidence: document.getElementById("predictConfidence"),
    predictModel: document.getElementById("predictModel"),
    trafficCard: document.getElementById("trafficCard"),
    trafficLight: document.getElementById("trafficLight"),
    trafficTitle: document.getElementById("trafficTitle"),
    trafficText: document.getElementById("trafficText"),
    trafficHelpCard: document.getElementById("trafficHelpCard")
  };

  init();

  function init() {
    elements.refreshButton.addEventListener("click", fetchStatus);
    elements.startTrainingButton.addEventListener("click", startTraining);
    elements.predictButton.addEventListener("click", predictImage);
    fetchStatus();
    window.setInterval(fetchStatus, STATUS_POLL_INTERVAL_MS);
  }

  async function fetchStatus() {
    try {
      const response = await fetch("/api/status", { cache: "no-store" });
      const payload = await response.json();
      renderStatus(payload);
    } catch (error) {
      elements.trainingMessage.textContent = "No se pudo leer el estado del servidor.";
    }
  }

  function renderStatus(payload) {
    elements.totalImages.textContent = payload.total_images;
    elements.okCount.textContent = payload.dataset_counts.ok;
    elements.koCount.textContent = payload.dataset_counts.ko;
    elements.trainingState.textContent = payload.training.status;
    elements.trainingMessage.textContent = payload.training.message;
    elements.predictButton.disabled = !payload.model_available;
    if (!payload.model_available) {
      elements.predictMessage.textContent = "Todavia no hay modelo. Entrena primero para poder predecir.";
    }
    renderTrafficLight(payload.app_contact);
    renderMetrics(payload.training.metrics);
    renderRecords(payload.recent_records);
  }

  function renderTrafficLight(appContact) {
    const connected = Boolean(appContact && appContact.is_connected);
    const lastContactAt = appContact && appContact.last_contact_at ? appContact.last_contact_at : "";
    const source = appContact && appContact.last_source ? appContact.last_source : "sin fuente";
    const seconds = appContact && typeof appContact.seconds_since_last_contact === "number"
      ? appContact.seconds_since_last_contact
      : null;

    elements.trafficLight.classList.toggle("traffic-light--on", connected);
    elements.trafficLight.classList.toggle("traffic-light--off", !connected);
    elements.trafficHelpCard.hidden = connected;

    if (connected) {
      elements.trafficTitle.textContent = "En contacto con la APP";
      elements.trafficText.textContent = "Ultimo heartbeat: " + formatDate(lastContactAt) + " | Fuente: " + source + ".";
      return;
    }

    elements.trafficTitle.textContent = "Sin contacto con la APP";
    if (seconds === null) {
      elements.trafficText.textContent = "Aun no se ha recibido ningun heartbeat desde la APP movil.";
      return;
    }

    elements.trafficText.textContent = "Ultimo contacto hace " + seconds + " s. Revisa los pasos de conexion.";
  }

  function renderMetrics(metrics) {
    if (!metrics.length) {
      elements.metricsBody.innerHTML = '<tr class="is-muted"><td colspan="5">Todavia no hay metricas.</td></tr>';
      return;
    }

    elements.metricsBody.innerHTML = metrics.map(function (metric) {
      return [
        "<tr>",
        "<td>", metric.epoch, "</td>",
        "<td>", metric.train_loss, "</td>",
        "<td>", percentage(metric.train_accuracy), "</td>",
        "<td>", metric.val_loss, "</td>",
        "<td>", percentage(metric.val_accuracy), "</td>",
        "</tr>"
      ].join("");
    }).join("");
  }

  function renderRecords(records) {
    if (!records.length) {
      elements.recordsBody.innerHTML = '<tr class="is-muted"><td colspan="3">Todavia no hay imagenes registradas.</td></tr>';
      return;
    }

    elements.recordsBody.innerHTML = records.map(function (record) {
      return [
        "<tr>",
        "<td>", formatDate(record.created_at), "</td>",
        "<td>", record.label.toUpperCase(), "</td>",
        "<td>", record.filename, "</td>",
        "</tr>"
      ].join("");
    }).join("");
  }

  async function startTraining() {
    const payload = {
      epochs: Number(elements.epochsInput.value),
      batch_size: Number(elements.batchSizeInput.value),
      learning_rate: Number(elements.learningRateInput.value)
    };

    elements.startTrainingButton.disabled = true;

    try {
      const response = await fetch("/api/train", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      elements.trainingMessage.textContent = result.message;
      fetchStatus();
    } catch (error) {
      elements.trainingMessage.textContent = "No se pudo lanzar el entrenamiento.";
    } finally {
      window.setTimeout(function () {
        elements.startTrainingButton.disabled = false;
      }, 1200);
    }
  }

  async function predictImage() {
    const file = elements.predictImageInput.files && elements.predictImageInput.files[0];
    if (!file) {
      elements.predictMessage.textContent = "Selecciona una imagen antes de predecir.";
      return;
    }

    elements.predictButton.disabled = true;
    elements.predictMessage.textContent = "Analizando imagen...";

    try {
      const imageData = await fileToDataUrl(file);
      const response = await fetch("/api/predict-image", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          image_data: imageData
        })
      });
      const result = await response.json();
      if (!result.ok) {
        throw new Error(result.message || "No se pudo predecir la imagen.");
      }

      elements.predictLabel.textContent = result.prediction.label.toUpperCase();
      elements.predictConfidence.textContent = percentage(result.prediction.confidence);
      elements.predictModel.textContent = result.prediction.model_path.split("/").pop();
      elements.predictMessage.textContent = "Prediccion completada correctamente.";
    } catch (error) {
      elements.predictMessage.textContent = error.message || "No se pudo predecir la imagen.";
    } finally {
      elements.predictButton.disabled = false;
    }
  }

  function fileToDataUrl(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () {
        resolve(String(reader.result || ""));
      };
      reader.onerror = function () {
        reject(new Error("No se pudo leer la imagen seleccionada."));
      };
      reader.readAsDataURL(file);
    });
  }

  function percentage(value) {
    return Math.round(value * 100) + "%";
  }

  function formatDate(value) {
    if (!value) {
      return "-";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "-";
    }
    return date.toLocaleString("es-ES");
  }
}());
