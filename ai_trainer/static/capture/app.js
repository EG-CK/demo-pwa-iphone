(function () {
  const state = {
    stream: null,
    imageData: ""
  };

  const elements = {
    cameraVideo: document.getElementById("cameraVideo"),
    previewCanvas: document.getElementById("previewCanvas"),
    captureStatus: document.getElementById("captureStatus"),
    startCameraButton: document.getElementById("startCameraButton"),
    takePhotoButton: document.getElementById("takePhotoButton"),
    retakeButton: document.getElementById("retakeButton"),
    saveOkButton: document.getElementById("saveOkButton"),
    saveKoButton: document.getElementById("saveKoButton")
  };

  init();

  function init() {
    bindEvents();
    updateControls();
  }

  function bindEvents() {
    elements.startCameraButton.addEventListener("click", startCamera);
    elements.takePhotoButton.addEventListener("click", takePhoto);
    elements.retakeButton.addEventListener("click", retakePhoto);
    elements.saveOkButton.addEventListener("click", function () {
      uploadImage("ok");
    });
    elements.saveKoButton.addEventListener("click", function () {
      uploadImage("ko");
    });
  }

  function updateControls() {
    const hasStream = Boolean(state.stream);
    const hasImage = Boolean(state.imageData);
    elements.takePhotoButton.disabled = !hasStream;
    elements.retakeButton.disabled = !hasImage;
    elements.saveOkButton.disabled = !hasImage;
    elements.saveKoButton.disabled = !hasImage;
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
      state.imageData = "";
      elements.previewCanvas.hidden = true;
      elements.cameraVideo.hidden = false;
      elements.captureStatus.textContent = "Camara lista. Captura una foto cuando quieras.";
      updateControls();
    } catch (error) {
      elements.captureStatus.textContent = "No se pudo abrir la camara.";
    }
  }

  function takePhoto() {
    if (!state.stream) {
      return;
    }

    const width = elements.cameraVideo.videoWidth || 1280;
    const height = elements.cameraVideo.videoHeight || 720;
    elements.previewCanvas.width = width;
    elements.previewCanvas.height = height;
    const context = elements.previewCanvas.getContext("2d");
    context.drawImage(elements.cameraVideo, 0, 0, width, height);
    state.imageData = elements.previewCanvas.toDataURL("image/jpeg", 0.92);
    elements.cameraVideo.hidden = true;
    elements.previewCanvas.hidden = false;
    elements.captureStatus.textContent = "Foto capturada. Guardala como OK o KO.";
    updateControls();
  }

  function retakePhoto() {
    state.imageData = "";
    elements.previewCanvas.hidden = true;
    elements.cameraVideo.hidden = false;
    elements.captureStatus.textContent = "Camara lista. Captura una foto cuando quieras.";
    updateControls();
  }

  async function uploadImage(label) {
    if (!state.imageData) {
      return;
    }

    disableSaveButtons(true);
    elements.captureStatus.textContent = "Subiendo imagen...";

    try {
      const response = await fetch("/api/upload-image", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          label: label,
          image_data: state.imageData,
          source: "mobile-capture"
        })
      });
      const payload = await response.json();

      if (!payload.ok) {
        throw new Error(payload.message || "No se pudo guardar la imagen.");
      }

      elements.captureStatus.textContent = "Imagen guardada correctamente como " + label.toUpperCase() + ".";
      retakePhoto();
    } catch (error) {
      elements.captureStatus.textContent = error.message || "No se pudo guardar la imagen.";
    } finally {
      disableSaveButtons(false);
      updateControls();
    }
  }

  function disableSaveButtons(disabled) {
    elements.saveOkButton.disabled = disabled;
    elements.saveKoButton.disabled = disabled;
  }

  function stopStream() {
    if (state.stream) {
      state.stream.getTracks().forEach(function (track) {
        track.stop();
      });
      state.stream = null;
    }
  }
}());
