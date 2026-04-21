(function () {
  var STORAGE_KEY = "hand-ai-js-dataset-v1";
  var MODEL_KEY = "indexeddb://hand-ai-js-model";
  var IMAGE_SIZE = 96;

  var state = {
    stream: null,
    imageData: "",
    samples: [],
    model: null,
    training: false
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
    predictButton: document.getElementById("predictButton"),
    predictImageInput: document.getElementById("predictImageInput"),
    predictFileButton: document.getElementById("predictFileButton")
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
    elements.predictButton.addEventListener("click", predictSnapshot);
    elements.predictFileButton.addEventListener("click", predictFromFile);
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
      state.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false
      });
      elements.cameraVideo.srcObject = state.stream;
      await elements.cameraVideo.play();
      elements.snapshotCanvas.hidden = true;
      elements.cameraVideo.hidden = false;
      state.imageData = "";
      elements.captureStatus.textContent = "Camara lista. Captura una foto de la mano.";
      updateButtons();
    } catch (error) {
      elements.captureStatus.textContent = "No se pudo abrir la camara.";
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

  function renderCounts() {
    var ok = state.samples.filter(function (item) { return item.label === "ok"; }).length;
    var ko = state.samples.filter(function (item) { return item.label === "ko"; }).length;
    elements.totalCount.textContent = String(state.samples.length);
    elements.okCount.textContent = String(ok);
    elements.koCount.textContent = String(ko);
  }

  async function trainModel() {
    var okSamples = state.samples.filter(function (item) { return item.label === "ok"; });
    var koSamples = state.samples.filter(function (item) { return item.label === "ko"; });
    if (okSamples.length < 5 || koSamples.length < 5) {
      elements.trainStatus.textContent = "Necesitas al menos 5 muestras OK y 5 muestras KO.";
      return;
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
    } catch (error) {
      elements.trainStatus.textContent = "No se pudo entrenar: " + (error && error.message ? error.message : "error desconocido");
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
    try {
      state.model = await tf.loadLayersModel(MODEL_KEY);
      elements.modelState.textContent = "Modelo cargado";
    } catch (error) {
      elements.modelState.textContent = "Modelo sin cargar";
    }
    updateButtons();
  }

  async function predictSnapshot() {
    if (!state.model) {
      elements.predictStatus.textContent = "Entrena o carga un modelo antes de predecir.";
      return;
    }
    if (!state.imageData) {
      elements.predictStatus.textContent = "Captura una foto antes de predecir.";
      return;
    }

    try {
      await runPrediction(state.imageData);
    } catch (error) {
      elements.predictStatus.textContent = "No se pudo predecir la foto.";
    }
  }

  async function predictFromFile() {
    if (!state.model) {
      elements.predictStatus.textContent = "Entrena o carga un modelo antes de predecir.";
      return;
    }

    var file = elements.predictImageInput.files && elements.predictImageInput.files[0];
    if (!file) {
      elements.predictStatus.textContent = "Selecciona una imagen primero.";
      return;
    }

    try {
      var dataUrl = await fileToDataUrl(file);
      await runPrediction(dataUrl);
      elements.predictImageInput.value = "";
    } catch (error) {
      elements.predictStatus.textContent = "No se pudo predecir la imagen seleccionada.";
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

  function fileToDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(String(reader.result || ""));
      };
      reader.onerror = function () {
        reject(new Error("No se pudo leer el archivo."));
      };
      reader.readAsDataURL(file);
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

  function stopStream() {
    if (state.stream) {
      state.stream.getTracks().forEach(function (track) { track.stop(); });
      state.stream = null;
    }
  }

  function updateButtons() {
    var hasImage = Boolean(state.imageData);
    var hasModel = Boolean(state.model);
    var hasStream = Boolean(state.stream);

    elements.takePhotoButton.disabled = !hasStream || state.training;
    elements.retakeButton.disabled = !hasImage || state.training;
    elements.saveOkButton.disabled = !hasImage || state.training;
    elements.saveKoButton.disabled = !hasImage || state.training;
    elements.trainButton.disabled = state.training;
    elements.predictButton.disabled = !hasModel || !hasImage || state.training;
    elements.predictFileButton.disabled = !hasModel || state.training;
    elements.deleteModelButton.disabled = state.training;
    elements.deleteDataButton.disabled = state.training;
    elements.startCameraButton.disabled = state.training;
  }
}());
