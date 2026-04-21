(function () {
  var STORAGE_KEY = "hand-ai-js-dataset-v1";
  var MODEL_KEY = "indexeddb://hand-ai-js-model";
  var IMAGE_SIZE = 96;
  var MIN_SAMPLES_PER_CLASS = 5;

  var state = {
    activeScreen: "training",
    stream: null,
    trainingImageData: "",
    evaluationImageData: "",
    samples: [],
    model: null,
    training: false,
    predicting: false
  };

  var elements = {
    tabButtons: document.querySelectorAll("[data-screen]"),
    trainingScreen: document.getElementById("trainingScreen"),
    evaluationScreen: document.getElementById("evaluationScreen"),
    trainingVideo: document.getElementById("trainingVideo"),
    trainingCanvas: document.getElementById("trainingCanvas"),
    evaluationVideo: document.getElementById("evaluationVideo"),
    evaluationCanvas: document.getElementById("evaluationCanvas"),
    captureStatus: document.getElementById("captureStatus"),
    predictStatus: document.getElementById("predictStatus"),
    modelState: document.getElementById("modelState"),
    totalCount: document.getElementById("totalCount"),
    okCount: document.getElementById("okCount"),
    koCount: document.getElementById("koCount"),
    trainingReadiness: document.getElementById("trainingReadiness"),
    epochsInput: document.getElementById("epochsInput"),
    batchInput: document.getElementById("batchInput"),
    trainStatus: document.getElementById("trainStatus"),
    trainingProgress: document.getElementById("trainingProgress"),
    trainingDetail: document.getElementById("trainingDetail"),
    predictLabel: document.getElementById("predictLabel"),
    predictConfidence: document.getElementById("predictConfidence"),
    takeTrainingPhotoButton: document.getElementById("takeTrainingPhotoButton"),
    retakeTrainingButton: document.getElementById("retakeTrainingButton"),
    saveOkButton: document.getElementById("saveOkButton"),
    saveKoButton: document.getElementById("saveKoButton"),
    trainButton: document.getElementById("trainButton"),
    deleteDataButton: document.getElementById("deleteDataButton"),
    deleteModelButton: document.getElementById("deleteModelButton"),
    takeEvaluationPhotoButton: document.getElementById("takeEvaluationPhotoButton"),
    retakeEvaluationButton: document.getElementById("retakeEvaluationButton"),
    predictButton: document.getElementById("predictButton")
  };

  init();

  async function init() {
    bindEvents();
    loadSamples();
    renderCounts();
    renderTrainingReadiness();
    updateButtons();
    await loadModel();
    await openCameraForActiveScreen();
    window.addEventListener("beforeunload", stopStream);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden && !state.stream) {
        openCameraForActiveScreen();
      }
    });
  }

  function bindEvents() {
    elements.tabButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        switchScreen(button.dataset.screen);
      });
    });
    elements.takeTrainingPhotoButton.addEventListener("click", takeTrainingPhoto);
    elements.retakeTrainingButton.addEventListener("click", retakeTrainingPhoto);
    elements.saveOkButton.addEventListener("click", function () { saveSample("ok"); });
    elements.saveKoButton.addEventListener("click", function () { saveSample("ko"); });
    elements.trainButton.addEventListener("click", trainModel);
    elements.deleteDataButton.addEventListener("click", clearDataset);
    elements.deleteModelButton.addEventListener("click", clearModel);
    elements.takeEvaluationPhotoButton.addEventListener("click", takeEvaluationPhoto);
    elements.retakeEvaluationButton.addEventListener("click", retakeEvaluationPhoto);
    elements.predictButton.addEventListener("click", predictSnapshot);
  }

  async function switchScreen(screenName) {
    if (state.activeScreen === screenName) {
      return;
    }

    stopStream();
    state.activeScreen = screenName;
    elements.trainingScreen.hidden = screenName !== "training";
    elements.evaluationScreen.hidden = screenName !== "evaluation";
    elements.tabButtons.forEach(function (button) {
      button.classList.toggle("is-active", button.dataset.screen === screenName);
    });
    updateButtons();
    await openCameraForActiveScreen();
  }

  async function openCameraForActiveScreen() {
    var videoElement = state.activeScreen === "training" ? elements.trainingVideo : elements.evaluationVideo;
    var canvasElement = state.activeScreen === "training" ? elements.trainingCanvas : elements.evaluationCanvas;
    var statusElement = state.activeScreen === "training" ? elements.captureStatus : elements.predictStatus;

    try {
      stopStream();
      statusElement.textContent = "Abriendo camara...";
      state.stream = await requestCameraStream();
      prepareVideoElement(videoElement);
      videoElement.srcObject = state.stream;
      await videoElement.play();
      canvasElement.hidden = true;
      videoElement.hidden = false;
      if (state.activeScreen === "training") {
        state.trainingImageData = "";
        statusElement.textContent = "Camara lista. Captura una muestra OK o KO.";
      } else {
        state.evaluationImageData = "";
        statusElement.textContent = "Camara lista. Captura una foto para evaluar.";
      }
      updateButtons();
    } catch (error) {
      statusElement.textContent = cameraErrorMessage(error);
      updateButtons();
    }
  }

  function loadSamples() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      state.samples = raw ? JSON.parse(raw) : [];
    } catch (error) {
      state.samples = [];
    }
  }

  function persistSamples() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.samples));
  }

  function takeTrainingPhoto() {
    if (!state.stream || state.activeScreen !== "training") {
      return;
    }

    state.trainingImageData = captureFrame(elements.trainingVideo, elements.trainingCanvas);
    elements.trainingVideo.hidden = true;
    elements.trainingCanvas.hidden = false;
    elements.captureStatus.textContent = "Foto capturada. Guardala como muestra OK o KO.";
    updateButtons();
  }

  function retakeTrainingPhoto() {
    state.trainingImageData = "";
    elements.trainingCanvas.hidden = true;
    elements.trainingVideo.hidden = false;
    elements.captureStatus.textContent = "Camara lista. Captura una muestra OK o KO.";
    updateButtons();
  }

  function saveSample(label) {
    if (!state.trainingImageData) {
      return;
    }

    state.samples.unshift({
      id: String(Date.now()) + "-" + Math.random().toString(16).slice(2),
      label: label,
      imageData: state.trainingImageData,
      createdAt: new Date().toISOString()
    });
    state.samples = state.samples.slice(0, 600);
    persistSamples();
    renderCounts();
    renderTrainingReadiness();
    elements.captureStatus.textContent = "Muestra guardada como " + label.toUpperCase() + ".";
    retakeTrainingPhoto();
  }

  function takeEvaluationPhoto() {
    if (!state.stream || state.activeScreen !== "evaluation") {
      return;
    }

    state.evaluationImageData = captureFrame(elements.evaluationVideo, elements.evaluationCanvas);
    elements.evaluationVideo.hidden = true;
    elements.evaluationCanvas.hidden = false;
    elements.predictLabel.textContent = "-";
    elements.predictConfidence.textContent = "-";
    elements.predictStatus.textContent = state.model
      ? "Foto capturada. Pulsa Predecir OK/KO."
      : "Foto capturada. Entrena un modelo antes de predecir.";
    updateButtons();
  }

  function retakeEvaluationPhoto() {
    state.evaluationImageData = "";
    elements.evaluationCanvas.hidden = true;
    elements.evaluationVideo.hidden = false;
    elements.predictLabel.textContent = "-";
    elements.predictConfidence.textContent = "-";
    elements.predictStatus.textContent = "Camara lista. Captura una foto para evaluar.";
    updateButtons();
  }

  function captureFrame(videoElement, canvasElement) {
    var width = videoElement.videoWidth || 1280;
    var height = videoElement.videoHeight || 720;
    canvasElement.width = width;
    canvasElement.height = height;
    var context = canvasElement.getContext("2d");
    context.drawImage(videoElement, 0, 0, width, height);
    var imageData = resizeDataUrl(canvasElement);

    var preview = new Image();
    preview.onload = function () {
      canvasElement.width = preview.width;
      canvasElement.height = preview.height;
      canvasElement.getContext("2d").drawImage(preview, 0, 0);
    };
    preview.src = imageData;
    return imageData;
  }

  function renderCounts() {
    var counts = getSampleCounts();
    elements.totalCount.textContent = String(state.samples.length);
    elements.okCount.textContent = String(counts.ok);
    elements.koCount.textContent = String(counts.ko);
  }

  function renderTrainingReadiness() {
    var counts = getSampleCounts();
    var missingOk = Math.max(0, MIN_SAMPLES_PER_CLASS - counts.ok);
    var missingKo = Math.max(0, MIN_SAMPLES_PER_CLASS - counts.ko);

    if (missingOk === 0 && missingKo === 0) {
      elements.trainingReadiness.textContent = "Listo para entrenar. Ya tienes suficientes muestras OK y KO.";
      elements.trainStatus.textContent = state.model ? "Modelo entrenado y guardado en este navegador." : "Puedes entrenar el modelo cuando quieras.";
      return;
    }

    var parts = [];
    if (missingOk > 0) {
      parts.push(missingOk + " OK");
    }
    if (missingKo > 0) {
      parts.push(missingKo + " KO");
    }
    elements.trainingReadiness.textContent = "Faltan " + parts.join(" y ") + " para poder entrenar.";
    elements.trainStatus.textContent = "Necesitas minimo " + MIN_SAMPLES_PER_CLASS + " OK y " + MIN_SAMPLES_PER_CLASS + " KO.";
  }

  async function trainModel() {
    if (!window.tf) {
      elements.trainStatus.textContent = "No se pudo cargar TensorFlow. Abre la app con internet y actualiza.";
      return false;
    }

    var counts = getSampleCounts();
    if (counts.ok < MIN_SAMPLES_PER_CLASS || counts.ko < MIN_SAMPLES_PER_CLASS) {
      renderTrainingReadiness();
      return false;
    }

    var epochs = Math.max(1, Math.min(40, Number(elements.epochsInput.value) || 8));
    var batchSize = Math.max(2, Math.min(32, Number(elements.batchInput.value) || 8));

    state.training = true;
    elements.trainingProgress.style.width = "0%";
    elements.modelState.textContent = "Entrenando...";
    elements.trainStatus.textContent = "Preparando dataset...";
    elements.trainingDetail.textContent = "Inicio de entrenamiento.";
    updateButtons();

    var xs = null;
    var ys = null;

    try {
      var tensors = await samplesToTensors(state.samples);
      xs = tensors.xs;
      ys = tensors.ys;

      if (state.model) {
        state.model.dispose();
      }
      state.model = buildModel();
      state.model.compile({
        optimizer: tf.train.adam(0.001),
        loss: "binaryCrossentropy",
        metrics: ["accuracy"]
      });

      await state.model.fit(xs, ys, {
        epochs: epochs,
        batchSize: Math.min(batchSize, state.samples.length),
        validationSplit: 0.2,
        shuffle: true,
        callbacks: {
          onEpochEnd: function (epoch, logs) {
            var trainAcc = logs.acc || logs.accuracy || 0;
            var valAcc = logs.val_acc || logs.val_accuracy || 0;
            var progress = Math.round(((epoch + 1) / epochs) * 100);
            elements.trainingProgress.style.width = progress + "%";
            elements.trainStatus.textContent = "Entrenando: epoca " + (epoch + 1) + " de " + epochs + ".";
            elements.trainingDetail.textContent = "Precision " + Math.round(trainAcc * 100) + "% | Validacion " + Math.round(valAcc * 100) + "%";
          }
        }
      });

      await state.model.save(MODEL_KEY);
      elements.modelState.textContent = "Modelo entrenado";
      elements.trainStatus.textContent = "Modelo entrenado y guardado en este movil.";
      elements.trainingDetail.textContent = "Listo para ir a Evaluacion.";
      elements.trainingProgress.style.width = "100%";
      return true;
    } catch (error) {
      elements.modelState.textContent = "Error al entrenar";
      elements.trainStatus.textContent = "No se pudo entrenar: " + (error && error.message ? error.message : "error desconocido");
      elements.trainingDetail.textContent = "Revisa muestras e intenta de nuevo.";
      return false;
    } finally {
      if (xs) {
        xs.dispose();
      }
      if (ys) {
        ys.dispose();
      }
      state.training = false;
      renderTrainingReadiness();
      updateButtons();
    }
  }

  async function loadModel() {
    if (!window.tf) {
      elements.modelState.textContent = "TensorFlow sin cargar";
      updateButtons();
      return;
    }

    try {
      state.model = await tf.loadLayersModel(MODEL_KEY);
      elements.modelState.textContent = "Modelo cargado";
      elements.trainStatus.textContent = "Modelo cargado desde este navegador.";
      elements.trainingDetail.textContent = "Listo para evaluar nuevas fotos.";
    } catch (error) {
      elements.modelState.textContent = "Modelo sin cargar";
    }
    renderTrainingReadiness();
    updateButtons();
  }

  async function predictSnapshot() {
    if (!state.evaluationImageData) {
      elements.predictStatus.textContent = "Captura una foto antes de predecir.";
      return;
    }
    if (!window.tf) {
      elements.predictStatus.textContent = "No se pudo cargar TensorFlow. Abre la app con internet y actualiza.";
      return;
    }
    if (!state.model) {
      elements.predictStatus.textContent = "No hay modelo entrenado. Ve a Entrenamiento y pulsa Entrenar modelo.";
      return;
    }

    state.predicting = true;
    elements.predictLabel.textContent = "-";
    elements.predictConfidence.textContent = "-";
    elements.predictStatus.textContent = "Analizando foto...";
    updateButtons();

    try {
      await runPrediction(state.evaluationImageData);
    } catch (error) {
      elements.predictStatus.textContent = "No se pudo predecir: " + (error && error.message ? error.message : "error desconocido");
    } finally {
      state.predicting = false;
      updateButtons();
    }
  }

  async function runPrediction(imageData) {
    var input = null;
    var prediction = null;
    try {
      input = await dataUrlToTensor(imageData);
      prediction = state.model.predict(input);
      var score = prediction.dataSync()[0];
      var label = score >= 0.5 ? "KO" : "OK";
      var confidence = score >= 0.5 ? score : (1 - score);
      elements.predictLabel.textContent = label;
      elements.predictConfidence.textContent = Math.round(confidence * 100) + "%";
      elements.predictStatus.textContent = "Prediccion completada.";
    } finally {
      if (input) {
        input.dispose();
      }
      if (prediction) {
        prediction.dispose();
      }
    }
  }

  async function clearModel() {
    if (window.tf) {
      try {
        await tf.io.removeModel(MODEL_KEY);
      } catch (error) {
        // Sin modelo previo, no hay nada que borrar.
      }
    }
    if (state.model) {
      state.model.dispose();
    }
    state.model = null;
    elements.modelState.textContent = "Modelo sin cargar";
    elements.trainStatus.textContent = "Modelo eliminado del navegador.";
    elements.trainingDetail.textContent = "Entrena de nuevo para evaluar.";
    elements.trainingProgress.style.width = "0%";
    updateButtons();
  }

  function clearDataset() {
    state.samples = [];
    persistSamples();
    renderCounts();
    renderTrainingReadiness();
    elements.trainingProgress.style.width = "0%";
    elements.trainingDetail.textContent = "Muestras borradas.";
    updateButtons();
  }

  function buildModel() {
    var model = tf.sequential();
    model.add(tf.layers.conv2d({ inputShape: [IMAGE_SIZE, IMAGE_SIZE, 3], filters: 12, kernelSize: 3, activation: "relu" }));
    model.add(tf.layers.maxPooling2d({ poolSize: 2 }));
    model.add(tf.layers.conv2d({ filters: 24, kernelSize: 3, activation: "relu" }));
    model.add(tf.layers.maxPooling2d({ poolSize: 2 }));
    model.add(tf.layers.flatten());
    model.add(tf.layers.dense({ units: 32, activation: "relu" }));
    model.add(tf.layers.dropout({ rate: 0.2 }));
    model.add(tf.layers.dense({ units: 1, activation: "sigmoid" }));
    return model;
  }

  function getSampleCounts() {
    return state.samples.reduce(function (counts, item) {
      if (item.label === "ok") {
        counts.ok += 1;
      }
      if (item.label === "ko") {
        counts.ko += 1;
      }
      return counts;
    }, { ok: 0, ko: 0 });
  }

  async function samplesToTensors(samples) {
    var imageTensors = [];
    var labels = [];

    for (var i = 0; i < samples.length; i += 1) {
      var sample = samples[i];
      var tensor = await dataUrlToTensor(sample.imageData);
      imageTensors.push(tensor.squeeze());
      labels.push(sample.label === "ko" ? 1 : 0);
    }

    var xs = tf.stack(imageTensors);
    imageTensors.forEach(function (tensor) { tensor.dispose(); });
    var ys = tf.tensor2d(labels, [labels.length, 1], "float32");
    return { xs: xs, ys: ys };
  }

  function dataUrlToTensor(dataUrl) {
    return new Promise(function (resolve, reject) {
      var image = new Image();
      image.onload = function () {
        var canvas = document.createElement("canvas");
        canvas.width = IMAGE_SIZE;
        canvas.height = IMAGE_SIZE;
        var context = canvas.getContext("2d");
        context.drawImage(image, 0, 0, IMAGE_SIZE, IMAGE_SIZE);
        var tensor = tf.tidy(function () {
          return tf.browser.fromPixels(canvas).toFloat().div(255).expandDims(0);
        });
        resolve(tensor);
      };
      image.onerror = function () {
        reject(new Error("No se pudo procesar la imagen."));
      };
      image.src = dataUrl;
    });
  }

  function resizeDataUrl(sourceCanvas) {
    var target = document.createElement("canvas");
    target.width = IMAGE_SIZE;
    target.height = IMAGE_SIZE;
    target.getContext("2d").drawImage(sourceCanvas, 0, 0, IMAGE_SIZE, IMAGE_SIZE);
    return target.toDataURL("image/jpeg", 0.86);
  }

  async function requestCameraStream() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("camera-api-unavailable");
    }

    try {
      return await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });
    } catch (error) {
      if (error && (error.name === "NotAllowedError" || error.name === "SecurityError")) {
        throw error;
      }
      return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }
  }

  function prepareVideoElement(videoElement) {
    videoElement.setAttribute("autoplay", "");
    videoElement.setAttribute("muted", "");
    videoElement.setAttribute("playsinline", "");
    videoElement.setAttribute("webkit-playsinline", "true");
  }

  function cameraErrorMessage(error) {
    if (!window.isSecureContext) {
      return "La camara solo funciona en HTTPS. Abre la app desde GitHub Pages o como PWA instalada.";
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return "Este navegador no permite abrir la camara desde esta pagina.";
    }
    var name = error && error.name ? error.name : "";
    if (name === "NotAllowedError" || name === "SecurityError") {
      return "Permiso de camara denegado. Activalo en los permisos del navegador y vuelve a intentar.";
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      return "No se encontro ninguna camara disponible en este dispositivo.";
    }
    if (name === "NotReadableError" || name === "TrackStartError") {
      return "La camara esta ocupada por otra app. Cierrala y vuelve a intentar.";
    }
    return "No se pudo abrir la camara. Revisa permisos del navegador.";
  }

  function stopStream() {
    if (state.stream) {
      state.stream.getTracks().forEach(function (track) { track.stop(); });
      state.stream = null;
    }
  }

  function updateButtons() {
    var hasTrainingImage = Boolean(state.trainingImageData);
    var hasEvaluationImage = Boolean(state.evaluationImageData);
    var hasStream = Boolean(state.stream);
    var busy = state.training || state.predicting;
    var counts = getSampleCounts();
    var canTrain = counts.ok >= MIN_SAMPLES_PER_CLASS && counts.ko >= MIN_SAMPLES_PER_CLASS;

    elements.takeTrainingPhotoButton.disabled = state.activeScreen !== "training" || !hasStream || busy;
    elements.retakeTrainingButton.disabled = !hasTrainingImage || busy;
    elements.saveOkButton.disabled = !hasTrainingImage || busy;
    elements.saveKoButton.disabled = !hasTrainingImage || busy;
    elements.trainButton.disabled = !canTrain || busy;
    elements.deleteModelButton.disabled = busy;
    elements.deleteDataButton.disabled = busy;
    elements.takeEvaluationPhotoButton.disabled = state.activeScreen !== "evaluation" || !hasStream || busy;
    elements.retakeEvaluationButton.disabled = !hasEvaluationImage || busy;
    elements.predictButton.disabled = !hasEvaluationImage || busy;
  }
}());
