(function () {
  const APP_VERSION = "v1.16.0 | 21/04/2026";
  const BUILD_TOKEN = "20260421-v1.16.0";
  const QR_CAPTURE_WINDOW_MS = 5000;
  const QR_CAPTURE_RETRY_MS = 180;
  const QR_DB_NAME = "qr-records-db";
  const QR_STORE_NAME = "qrRecords";
  const QR_MAX_RECORDS = 30;

  const state = {
    currentView: "home",
    qr: {
      records: [],
      db: null,
      cameraActive: false,
      capturing: false,
      stream: null,
      captureSessionId: 0,
      lastValue: "",
      lastSavedAt: 0
    }
  };

  const elements = {
    homeView: document.getElementById("homeView"),
    qrView: document.getElementById("qrView"),
    openQrView: document.getElementById("openQrView"),
    openAiJsApp: document.getElementById("openAiJsApp"),
    viewButtons: document.querySelectorAll("[data-open-view]"),
    installState: document.getElementById("installState"),
    appVersion: document.getElementById("appVersion"),
    refreshAppButton: document.getElementById("refreshAppButton"),
    scannerCard: document.querySelector(".scanner-card"),
    qrVideo: document.getElementById("qrVideo"),
    qrStatus: document.getElementById("qrStatus"),
    qrSignal: document.getElementById("qrSignal"),
    qrCount: document.getElementById("qrCount"),
    qrRecordsBody: document.getElementById("qrRecordsBody"),
    startScanButton: document.getElementById("startScanButton"),
    captureQrButton: document.getElementById("captureQrButton"),
    stopScanButton: document.getElementById("stopScanButton"),
    qrImageInput: document.getElementById("qrImageInput")
  };

  init();

  async function init() {
    renderAppVersion();
    bindEvents();
    registerServiceWorker();
    updateInstallState();
    updateView();
    updateQrStatus("Inicializando base de datos local...");
    updateScannerVisualState();
    updateScannerControls();

    try {
      state.qr.db = await openQrDb();
      state.qr.records = await loadQrRecords(state.qr.db);
      renderQrRecords();
      updateQrStatus(window.QrScanner ? "Listo para iniciar la camara." : "No se pudo cargar el lector QR. Recarga la app con internet e intentalo de nuevo.");
    } catch (error) {
      updateQrStatus("No se pudo abrir la base de datos local.");
      renderQrRecords();
    } finally {
      updateScannerControls();
    }
  }

  function bindEvents() {
    elements.refreshAppButton.addEventListener("click", refreshApplication);
    elements.openQrView.addEventListener("click", function () {
      openView("qr");
    });
    elements.openAiJsApp.addEventListener("click", function () {
      window.location.href = "ai_web/index.html?v=" + BUILD_TOKEN;
    });

    elements.viewButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        openView(button.dataset.openView);
      });
    });

    elements.startScanButton.addEventListener("click", startCamera);
    elements.captureQrButton.addEventListener("click", captureQr);
    elements.stopScanButton.addEventListener("click", function () {
      stopCamera("Camara detenida.");
    });
    elements.qrImageInput.addEventListener("change", function (event) {
      handleQrImage(event.target.files && event.target.files[0]);
      event.target.value = "";
    });
  }

  function openView(viewName) {
    if (state.currentView === "qr" && viewName !== "qr") {
      stopCamera();
    }

    state.currentView = viewName;
    updateView();
  }

  function updateView() {
    elements.homeView.hidden = state.currentView !== "home";
    elements.qrView.hidden = state.currentView !== "qr";
  }

  function renderQrRecords() {
    const records = state.qr.records.slice(0, QR_MAX_RECORDS);
    elements.qrCount.textContent = records.length + " lecturas";

    if (!records.length) {
      elements.qrRecordsBody.innerHTML = '<tr class="is-muted"><td colspan="2">Todavia no hay lecturas guardadas.</td></tr>';
      return;
    }

    elements.qrRecordsBody.innerHTML = records.map(function (record) {
      return [
        "<tr>",
        "<td>", formatQrTimestamp(record.createdAt), "</td>",
        "<td>", escapeHtml(record.value), "</td>",
        "</tr>"
      ].join("");
    }).join("");
  }

  function updateScannerControls() {
    const disabled = !state.qr.db;
    elements.startScanButton.disabled = disabled || state.qr.cameraActive;
    elements.captureQrButton.disabled = disabled || !state.qr.cameraActive || state.qr.capturing;
    elements.stopScanButton.disabled = !state.qr.cameraActive;
  }

  function updateScannerVisualState() {
    const signalText = elements.qrSignal.querySelector(".scanner-signal__text");
    elements.scannerCard.classList.toggle("is-live", state.qr.cameraActive);
    elements.qrVideo.classList.toggle("is-visible", state.qr.cameraActive);
    elements.qrVideo.classList.toggle("is-scanning", state.qr.capturing);
    elements.qrSignal.classList.toggle("is-scanning", state.qr.capturing);
    signalText.textContent = state.qr.capturing ? "Capturando QR..." : state.qr.cameraActive ? "Camara lista para capturar" : "Listo para leer";
  }

  async function startCamera() {
    if (!state.qr.db) {
      updateQrStatus("La base de datos local todavia no esta disponible.");
      return;
    }

    if (!window.QrScanner) {
      updateQrStatus("No se pudo cargar el lector QR. Abre la app con conexion e intentalo otra vez.");
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      updateQrStatus("La camara no esta disponible en este dispositivo.");
      return;
    }

    stopCamera();
    state.qr.cameraActive = true;
    state.qr.capturing = false;
    updateScannerVisualState();
    updateScannerControls();

    try {
      elements.qrVideo.setAttribute("autoplay", "");
      elements.qrVideo.setAttribute("muted", "");
      elements.qrVideo.setAttribute("playsinline", "");
      elements.qrVideo.setAttribute("webkit-playsinline", "true");
      state.qr.stream = await requestCameraStream();
      elements.qrVideo.srcObject = state.qr.stream;
      await elements.qrVideo.play();
      updateQrStatus("Camara iniciada. Apunta al QR correcto y pulsa 'Capturar QR'.");
      updateScannerVisualState();
      updateScannerControls();
    } catch (error) {
      state.qr.cameraActive = false;
      state.qr.capturing = false;
      updateQrStatus(cameraErrorMessage(error));
      stopCamera();
    }
  }

  async function requestCameraStream() {
    try {
      return await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false
      });
    } catch (error) {
      if (error && (error.name === "NotAllowedError" || error.name === "SecurityError")) {
        throw error;
      }
      return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }
  }

  function cameraErrorMessage(error) {
    if (!window.isSecureContext) {
      return "La camara solo funciona en HTTPS. Abre la app desde GitHub Pages o como PWA instalada.";
    }
    const name = error && error.name ? error.name : "";
    if (name === "NotAllowedError" || name === "SecurityError") {
      return "Permiso de camara denegado. Activalo en el navegador y vuelve a intentar.";
    }
    if (name === "NotReadableError" || name === "TrackStartError") {
      return "La camara esta ocupada por otra app. Cierrala y vuelve a intentar.";
    }
    return "No se pudo abrir la camara. Revisa permisos del navegador.";
  }

  async function captureQr() {
    if (!state.qr.cameraActive) {
      updateQrStatus("Primero inicia la camara.");
      return;
    }

    if (!window.QrScanner) {
      updateQrStatus("No se pudo cargar el lector QR. Abre la app con conexion e intentalo otra vez.");
      return;
    }

    state.qr.capturing = true;
    state.qr.captureSessionId += 1;
    const sessionId = state.qr.captureSessionId;
    const startedAt = Date.now();
    updateQrStatus("Buscando QR... manten el codigo dentro del marco.");
    updateScannerVisualState();
    updateScannerControls();

    try {
      while (state.qr.cameraActive && state.qr.captureSessionId === sessionId && Date.now() - startedAt < QR_CAPTURE_WINDOW_MS) {
        try {
          const result = await window.QrScanner.scanImage(elements.qrVideo, {
            returnDetailedScanResult: true
          });
          const value = result && result.data ? result.data : result;
          await persistQrValue(value);
          updateQrStatus("QR guardado correctamente.");
          return;
        } catch (error) {
          await wait(QR_CAPTURE_RETRY_MS);
        }
      }

      if (state.qr.captureSessionId === sessionId && state.qr.cameraActive) {
        updateQrStatus("No se detecto un QR valido. Ajusta el encuadre y vuelve a capturar.");
      }
    } catch (error) {
      updateQrStatus("No se pudo completar la captura. Intentalo de nuevo.");
    } finally {
      if (state.qr.captureSessionId === sessionId) {
        state.qr.capturing = false;
        updateScannerVisualState();
        updateScannerControls();
      }
    }
  }

  async function handleQrImage(file) {
    if (!file) {
      return;
    }

    if (!state.qr.db) {
      updateQrStatus("La base de datos local no esta disponible.");
      return;
    }

    if (!window.QrScanner) {
      updateQrStatus("No se pudo cargar el lector QR. Abre la app con conexion e intentalo otra vez.");
      return;
    }

    try {
      updateQrStatus("Analizando imagen...");
      const result = await window.QrScanner.scanImage(file, { returnDetailedScanResult: true });
      const value = result && result.data ? result.data : result;
      await persistQrValue(value);
      updateQrStatus("QR guardado correctamente desde imagen.");
    } catch (error) {
      updateQrStatus("No se detecto ningun QR en la imagen seleccionada.");
    }
  }

  async function persistQrValue(rawValue) {
    const value = String(rawValue || "").trim();
    if (!value) {
      updateQrStatus("El QR detectado no contiene texto utilizable.");
      return;
    }

    const now = Date.now();
    if (value === state.qr.lastValue && now - state.qr.lastSavedAt < 3000) {
      updateQrStatus("Ese QR ya se acaba de registrar.");
      return;
    }

    const record = { value, createdAt: now };
    const saved = await saveQrRecord(state.qr.db, record);
    state.qr.records.unshift(saved);
    state.qr.records = state.qr.records.slice(0, QR_MAX_RECORDS);
    state.qr.lastValue = value;
    state.qr.lastSavedAt = now;
    renderQrRecords();
  }

  function stopCamera(message) {
    state.qr.cameraActive = false;
    state.qr.capturing = false;
    state.qr.captureSessionId += 1;

    if (state.qr.stream) {
      state.qr.stream.getTracks().forEach(function (track) {
        track.stop();
      });
      state.qr.stream = null;
    }

    elements.qrVideo.pause();
    elements.qrVideo.srcObject = null;
    updateScannerVisualState();
    updateScannerControls();

    if (message) {
      updateQrStatus(message);
    }
  }

  function updateQrStatus(message) {
    elements.qrStatus.textContent = message;
  }

  function openQrDb() {
    return new Promise(function (resolve, reject) {
      if (!("indexedDB" in window)) {
        reject(new Error("IndexedDB no disponible"));
        return;
      }

      const request = window.indexedDB.open(QR_DB_NAME, 1);
      request.onupgradeneeded = function () {
        const db = request.result;
        const store = db.createObjectStore(QR_STORE_NAME, { keyPath: "id", autoIncrement: true });
        store.createIndex("createdAt", "createdAt");
      };
      request.onsuccess = function () {
        resolve(request.result);
      };
      request.onerror = function () {
        reject(request.error || new Error("No se pudo abrir la base de datos"));
      };
    });
  }

  function loadQrRecords(db) {
    return new Promise(function (resolve, reject) {
      const transaction = db.transaction(QR_STORE_NAME, "readonly");
      const store = transaction.objectStore(QR_STORE_NAME);
      const request = store.getAll();
      request.onsuccess = function () {
        resolve(request.result.slice().sort(function (a, b) {
          return b.createdAt - a.createdAt;
        }));
      };
      request.onerror = function () {
        reject(request.error || new Error("No se pudieron leer los registros"));
      };
    });
  }

  function saveQrRecord(db, record) {
    return new Promise(function (resolve, reject) {
      const transaction = db.transaction(QR_STORE_NAME, "readwrite");
      const store = transaction.objectStore(QR_STORE_NAME);
      const request = store.add(record);
      request.onsuccess = function () {
        resolve(Object.assign({ id: request.result }, record));
      };
      request.onerror = function () {
        reject(request.error || new Error("No se pudo guardar el registro"));
      };
    });
  }

  function registerServiceWorker() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").then(function (registration) {
        registration.addEventListener("updatefound", function () {
          const worker = registration.installing;
          if (!worker) {
            return;
          }
          worker.addEventListener("statechange", function () {
            if (worker.state === "installed" && navigator.serviceWorker.controller) {
              updateQrStatus("Nueva version descargada. Pulsa 'Actualizar app' para activarla.");
            }
          });
        });
      }).catch(function () {
        elements.installState.textContent = "Modo web";
      });
    }
  }

  function updateInstallState() {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
    elements.installState.textContent = standalone ? "Instalada" : "PWA lista";
  }

  function renderAppVersion() {
    elements.appVersion.textContent = APP_VERSION;
  }

  async function refreshApplication() {
    elements.refreshAppButton.disabled = true;
    elements.refreshAppButton.textContent = "Actualizando...";

    try {
      updateQrStatus("Forzando descarga de la ultima version...");

      if ("caches" in window) {
        const cacheKeys = await window.caches.keys();
        await Promise.all(cacheKeys.map(function (cacheKey) {
          return window.caches.delete(cacheKey);
        }));
      }

      if ("serviceWorker" in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map(function (registration) {
          if (registration.waiting) {
            registration.waiting.postMessage({ type: "SKIP_WAITING" });
          }
          return registration.unregister();
        }));
      }

      window.setTimeout(function () {
        const refreshUrl = new URL(window.location.href);
        refreshUrl.searchParams.set("update", BUILD_TOKEN + "-" + Date.now());
        window.location.replace(refreshUrl.toString());
      }, 400);
    } catch (error) {
      updateQrStatus("No se pudo forzar la actualizacion. Prueba de nuevo con conexion.");
      elements.refreshAppButton.disabled = false;
      elements.refreshAppButton.textContent = "Actualizar app";
    }
  }

  function formatQrTimestamp(timestamp) {
    const date = new Date(timestamp);
    return [
      pad(date.getDate()) + "/" + pad(date.getMonth() + 1),
      pad(date.getHours()) + ":" + pad(date.getMinutes())
    ].join(" ");
  }

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function wait(milliseconds) {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, milliseconds);
    });
  }
}());
