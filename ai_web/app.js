(function () {
  var STORAGE_KEY = "hand-ai-js-dataset-v1";
  var MODEL_KEY = "indexeddb://hand-ai-js-model";
  var IMAGE_SIZE = 96;

  var state = {
    stream: null,
    imageData: "",
    predictStream: null,
    predictImageData: "",
    samples: [],
    model: null,
    training: false,
    predicting: false
  };

  var elements = {
    cameraVideo: document.getElementById("cameraVideo"),
    snapshotCanvas: document.getElementById("snapshotCanvas"),
    captureStatus: document.getElementById("captureStatus"),
    modelState: document.getElementById("modelState"),
    totalCount: document.getElementById("totalCount"),
    okCount: document.getElementById("okCount"),
    koCount: document.getElementById("koCount"),
    epochsInput: document.getElementById("epochsInput"),
    batchInput: document.getElementById("batchInput"),
    trainStatus: document.getElementById("trainStatus"),
    predictStatus: document.getElementById("predictStatus"),
    predictVideo: document.getElementById("predictVideo"),
    predictCanvas: document.getElementById("predictCanvas"),
    predictLabel: document.getElementById("predictLabel"),
    predictConfidence: document.getElementById("predictConfidence"),
    startCameraButton: document.getElementById("startCameraButton"),
    takePhotoButton: document.getElementById("takePhotoButton"),
    retakeButton: document.getElementById("retakeButton"),
    saveOkButton: document.getElementById("saveOkButton"),
    saveKoButton: document.getElementById("saveKoButton"),
    trainButton: document.getElementById("trainButton"),
    deleteDataButton: document.getElementById("deleteDataButton"),
    deleteModelButton: document.getElementById("deleteModelButton"),
    startPredictCameraButton: document.getElementById("startPredictCameraButton"),
    takePredictPhotoButton: document.getElementById("takePredictPhotoButton"),
    retakePredictPhotoButton: document.getElementById("retakePredictPhotoButton"),
    predictButton: document.getElementById("predictButton")
  };

  init();

  async function init() {
    bindEvents();
    loadSamples();
    renderCounts();
    updateButtons();
    await loadModel();
    window.addEventListener("beforeunload", stopStream);
  }

  function bindEvents() {
    elements.startCameraButton.addEventListener("click", startCamera);
    elements.takePhotoButton.addEventListener("click", takePhoto);
    elements.retakeButton.addEventListener("click", retakePhoto);
    elements.saveOkButton.addEventListener("click", function () { saveSample("ok"); });
    elements.saveKoButton.addEventListener("click", function () { saveSample("ko"); });
    elements.trainButton.addEventListener("click", trainModel);
    elements.startPredictCameraButton.addEventListener("click", startPredictCamera);
    elements.takePredictPhotoButton.addEventListener("click", takePredictPhoto);
    elements.retakePredictPhotoButton.addEventListener("click", retakePredictPhoto);
    elements.predictButton.addEventListener("click", predictSnapshot);
    elements.deleteDataButton.addEventListener("click", clearDataset);
    elements.deleteModelButton.addEventListener("click", clearModel);
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

  async function startCamera() {
    try {
      stopStream();
      state.stream = await requestCameraStream();
      prepareVideoElement(elements.cameraVideo);
      elements.cameraVideo.srcObject = state.stream;
      await elements.cameraVideo.play();
      elements.snapshotCanvas.hidden = true;
      elements.cameraVideo.hidden = false;
      state.imageData = "";
      elements.captureStatus.textContent = "Camara lista. Captura una foto de la mano.";
      updateButtons();
    } catch (error) {
      elements.captureStatus.textContent = cameraErrorMessage(error);
      updateButtons();
    }
  }

  function takePhoto() {
    if (!state.stream) {
      return;
    }

    var width = elements.cameraVideo.videoWidth || 1280;
    var height = elements.cameraVideo.videoHeight || 720;
    elements.snapshotCanvas.width = width;
    elements.snapshotCanvas.height = height;
    var context = elements.snapshotCanvas.getContext("2d");
    context.drawImage(elements.cameraVideo, 0, 0, width, height);
    state.imageData = resizeDataUrl(elements.snapshotCanvas);

    var preview = new Image();
    preview.onload = function () {
      elements.snapshotCanvas.width = preview.width;
      elements.snapshotCanvas.height = preview.height;
      var previewContext = elements.snapshotCanvas.getContext("2d");
      previewContext.drawImage(preview, 0, 0);
    };
    preview.src = state.imageData;

    elements.cameraVideo.hidden = true;
    elements.snapshotCanvas.hidden = false;
    elements.captureStatus.textContent = "Foto capturada. Guardala como OK o KO.";
    updateButtons();
  }

  function retakePhoto() {
    state.imageData = "";
    elements.snapshotCanvas.hidden = true;
    elements.cameraVideo.hidden = false;
    elements.captureStatus.textContent = "Camara lista. Captura una foto de la mano.";
    updateButtons();
  }

  function saveSample(label) {
    if (!state.imageData) {
      return;
    }

    state.samples.unshift({
      id: String(Date.now()) + "-" + Math.random().toString(16).slice(2),
      label: label,
      imageData: state.imageData,
      createdAt: new Date().toISOString()
    });
    state.samples = state.samples.slice(0, 600);
    persistSamples();
    renderCounts();
    elements.captureStatus.textContent = "Muestra guardada como " + label.toUpperCase() + ".";
    retakePhoto();
  }

  async function startPredictCamera() {
    try {
      stopStream();
      state.predictStream = await requestCameraStream();
      prepareVideoElement(elements.predictVideo);
      elements.predictVideo.srcObject = state.predictStream;
      await elements.predictVideo.play();
      elements.predictCanvas.hidden = true;
      elements.predictVideo.hidden = false;
      state.predictImageData = "";
      elements.predictStatus.textContent = "Camara lista. Captura una foto para predecir.";
      updateButtons();
    } catch (error) {
      elements.predictStatus.textContent = cameraErrorMessage(error);
      updateButtons();
    }
  }

  function takePredictPhoto() {
    if (!state.predictStream) {
      return;
    }

    var width = elements.predictVideo.videoWidth || 1280;
    var height = elements.predictVideo.videoHeight || 720;
    elements.predictCanvas.width = width;
    elements.predictCanvas.height = height;
    var context = elements.predictCanvas.getContext("2d");
    context.drawImage(elements.predictVideo, 0, 0, width, height);
    state.predictImageData = resizeDataUrl(elements.predictCanvas);

    var preview = new Image();
    preview.onload = function () {
      elements.predictCanvas.width = preview.width;
      elements.predictCanvas.height = preview.height;
      var previewContext = elements.predictCanvas.getContext("2d");
      previewContext.drawImage(preview, 0, 0);
    };
    preview.src = state.predictImageData;

    elements.predictVideo.hidden = true;
    elements.predictCanvas.hidden = false;
    elements.predictStatus.textContent = state.model
      ? "Foto capturada. Pulsa Predecir OK/KO."
      : "Foto capturada. Puedes pulsar Predecir OK/KO cuando tengas un modelo entrenado.";
    updateButtons();
  }

  function retakePredictPhoto() {
    state.predictImageData = "";
    elements.predictCanvas.hidden = true;
    elements.predictVideo.hidden = !state.predictStream;
    elements.predictStatus.textContent = state.predictStream
      ? "Camara lista. Captura una foto para predecir."
      : "Inicia la camara para tomar una foto y predecir.";
    updateButtons();
  }

  function renderCounts() {
    var counts = getSampleCounts();
    var ok = counts.ok;
    var ko = counts.ko;
    elements.totalCount.textContent = String(state.samples.length);
    elements.okCount.textContent = String(ok);
    elements.koCount.textContent = String(ko);
  }

  async function trainModel() {
    if (!window.tf) {
      elements.trainStatus.textContent = "No se pudo cargar TensorFlow. Abre la app con internet y actualiza.";
      return false;
    }

    var okSamples = state.samples.filter(function (item) { return item.label === "ok"; });
    var koSamples = state.samples.filter(function (item) { return item.label === "ko"; });
    if (okSamples.length < 5 || koSamples.length < 5) {
      elements.trainStatus.textContent = "Necesitas al menos 5 muestras OK y 5 muestras KO.";
      return false;
    }

    var epochs = Math.max(1, Math.min(40, Number(elements.epochsInput.value) || 8));
    var batchSize = Math.max(2, Math.min(32, Number(elements.batchInput.value) || 8));

    state.training = true;
    updateButtons();
    elements.trainStatus.textContent = "Preparando dataset...";

    var xs = null;
    var ys = null;

    try {
      var tensors = await samplesToTensors(state.samples);
      xs = tensors.xs;
      ys = tensors.ys;

      state.model = buildModel();
      state.model.compile({
        optimizer: tf.train.adam(0.001),
        loss: "binaryCrossentropy",
        metrics: ["accuracy"]
      });

      elements.modelState.textContent = "Entrenando...";
      await state.model.fit(xs, ys, {
        epochs: epochs,
        batchSize: Math.min(batchSize, state.samples.length),
        validationSplit: 0.2,
        shuffle: true,
        callbacks: {
          onEpochEnd: function (epoch, logs) {
            var trainAcc = logs.acc || logs.accuracy || 0;
            var valAcc = logs.val_acc || logs.val_accuracy || 0;
            elements.trainStatus.textContent = "Epoca " + (epoch + 1) + "/" + epochs + " | acc " + Math.round(trainAcc * 100) + "% | val " + Math.round(valAcc * 100) + "%";
          }
        }
      });

      await state.model.save(MODEL_KEY);
      elements.modelState.textContent = "Modelo entrenado";
      elements.trainStatus.textContent = "Entrenamiento completado y modelo guardado en el navegador.";
      return true;
    } catch (error) {
      elements.trainStatus.textContent = "No se pudo entrenar: " + (error && error.message ? error.message : "error desconocido");
      return false;
    } finally {
      if (xs) {
        xs.dispose();
      }
      if (ys) {
        ys.dispose();
      }
      state.training = false;
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
    } catch (error) {
      elements.modelState.textContent = "Modelo sin cargar";
    }
    updateButtons();
  }

  async function predictSnapshot() {
    if (!state.predictImageData) {
      elements.predictStatus.textContent = "Captura una foto antes de predecir.";
      return;
    }

    if (!window.tf) {
      elements.predictStatus.textContent = "No se pudo cargar TensorFlow. Abre la app con internet y actualiza.";
      return;
    }

    state.predicting = true;
    elements.predictLabel.textContent = "-";
    elements.predictConfidence.textContent = "-";
    elements.predictStatus.textContent = "Preparando prediccion...";
    updateButtons();

    try {
      if (!state.model) {
        var counts = getSampleCounts();
        if (counts.ok < 5 || counts.ko < 5) {
          elements.predictStatus.textContent = "Primero guarda minimo 5 fotos OK y 5 fotos KO, y entrena el modelo.";
          return;
        }

        elements.predictStatus.textContent = "Modelo no entrenado. Entrenando automaticamente...";
        var trained = await trainModel();
        if (!trained || !state.model) {
          elements.predictStatus.textContent = "No se pudo preparar el modelo para predecir.";
          return;
        }
      }

      await runPrediction(state.predictImageData);
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
    if (!window.tf) {
      state.model = null;
      elements.modelState.textContent = "Modelo sin cargar";
      elements.predictStatus.textContent = "Modelo eliminado de la pantalla.";
      updateButtons();
      return;
    }

    try {
      await tf.io.removeModel(MODEL_KEY);
    } catch (error) {
      // no-op
    }
    if (state.model) {
      state.model.dispose();
    }
    state.model = null;
    elements.modelState.textContent = "Modelo sin cargar";
    elements.predictStatus.textContent = "Modelo eliminado del navegador.";
    updateButtons();
  }

  function clearDataset() {
    state.samples = [];
    persistSamples();
    renderCounts();
    elements.trainStatus.textContent = "Dataset borrado.";
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
    var context = target.getContext("2d");
    context.drawImage(sourceCanvas, 0, 0, IMAGE_SIZE, IMAGE_SIZE);
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

      return navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false
      });
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
    stopPredictStream();
  }

  function stopPredictStream() {
    if (state.predictStream) {
      state.predictStream.getTracks().forEach(function (track) { track.stop(); });
      state.predictStream = null;
    }
  }

  function updateButtons() {
    var hasImage = Boolean(state.imageData);
    var hasPredictImage = Boolean(state.predictImageData);
    var hasModel = Boolean(state.model);
    var hasStream = Boolean(state.stream);
    var hasPredictStream = Boolean(state.predictStream);

    elements.takePhotoButton.disabled = !hasStream || state.training || state.predicting;
    elements.retakeButton.disabled = !hasImage || state.training || state.predicting;
    elements.saveOkButton.disabled = !hasImage || state.training || state.predicting;
    elements.saveKoButton.disabled = !hasImage || state.training || state.predicting;
    elements.trainButton.disabled = state.training || state.predicting;
    elements.takePredictPhotoButton.disabled = !hasPredictStream || state.training || state.predicting;
    elements.retakePredictPhotoButton.disabled = !hasPredictImage || state.training || state.predicting;
    elements.predictButton.disabled = !hasPredictImage || state.training || state.predicting;
    elements.deleteModelButton.disabled = state.training || state.predicting;
    elements.deleteDataButton.disabled = state.training || state.predicting;
    elements.startCameraButton.disabled = state.training || state.predicting;
    elements.startPredictCameraButton.disabled = state.training || state.predicting;
  }
}());
