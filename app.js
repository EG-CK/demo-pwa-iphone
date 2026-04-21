(function () {
  const APP_VERSION = "v1.9.1 | 21/04/2026";
  const BUILD_TOKEN = "20260421-v1.9.1";
  const QR_CAPTURE_WINDOW_MS = 5000;
  const QR_CAPTURE_RETRY_MS = 180;
  const MAX_TONS = 10;
  const LINES = ["Rolling", "Bombos"];
  const SHIFTS = ["A", "B", "C"];
  const TODAY = new Date("2026-04-17T12:00:00");
  const HISTORY_DAYS = 61;
  const QR_DB_NAME = "pulse-oee-qr-db";
  const QR_STORE_NAME = "qrRecords";
  const QR_MAX_RECORDS = 30;

  const state = {
    currentView: "home",
    Rolling: { referenceIndex: 0, shift: "A" },
    Bombos: { referenceIndex: 0, shift: "A" },
    qr: {
      records: [],
      db: null,
      cameraActive: false,
      capturing: false,
      stream: null,
      captureSessionId: 0,
      lastValue: "",
      lastSavedAt: 0
    },
    ai: {
      pollTimer: null
    }
  };

  const elements = {
    lineBoards: document.getElementById("lineBoards"),
    trendChart: document.getElementById("trendChart"),
    trendNote: document.getElementById("trendNote"),
    homeView: document.getElementById("homeView"),
    oeeView: document.getElementById("oeeView"),
    qrView: document.getElementById("qrView"),
    aiView: document.getElementById("aiView"),
    openOeeView: document.getElementById("openOeeView"),
    openQrView: document.getElementById("openQrView"),
    openAiView: document.getElementById("openAiView"),
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
    qrImageInput: document.getElementById("qrImageInput"),
    aiBaseUrl: document.getElementById("aiBaseUrl"),
    openAiCapture: document.getElementById("openAiCapture"),
    openAiConsole: document.getElementById("openAiConsole"),
    checkAiHealth: document.getElementById("checkAiHealth"),
    aiStatus: document.getElementById("aiStatus"),
    aiConnectionBadge: document.getElementById("aiConnectionBadge"),
    aiConnectionDetail: document.getElementById("aiConnectionDetail"),
    aiStartCommand: document.getElementById("aiStartCommand"),
    copyAiStartCommand: document.getElementById("copyAiStartCommand"),
    aiDatasetTotal: document.getElementById("aiDatasetTotal"),
    aiDatasetOk: document.getElementById("aiDatasetOk"),
    aiDatasetKo: document.getElementById("aiDatasetKo")
  };

  const dailyHistory = buildHistory();
  const dayOptions = getDayOptions();

  init();

  async function init() {
    renderAppVersion();
    renderBoards();
    renderTrendOverview();
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

  function buildHistory() {
    const history = [];
    for (let index = HISTORY_DAYS - 1; index >= 0; index -= 1) {
      const date = new Date(TODAY);
      date.setDate(TODAY.getDate() - index);

      const lineValues = {};
      LINES.forEach(function (lineName, lineIndex) {
        const shifts = {};
        let totalTons = 0;
        let totalStops = 0;

        SHIFTS.forEach(function (shiftName, shiftIndex) {
          const tons = computeTons(date, lineIndex, shiftIndex);
          const oee = Math.round((tons / MAX_TONS) * 100);
          const stops = Math.max(0, Math.round((100 - oee) * 1.35 + shiftIndex * 5 + lineIndex * 4));

          shifts[shiftName] = {
            tons: round(tons, 1),
            oee: clamp(oee, 0, 100),
            stops
          };
          totalTons += tons;
          totalStops += stops;
        });

        lineValues[lineName] = {
          shifts,
          day: {
            tons: round(totalTons, 1),
            oee: clamp(Math.round((totalTons / (MAX_TONS * SHIFTS.length)) * 100), 0, 100),
            stops: totalStops
          }
        };
      });

      history.push({
        key: formatDateKey(date),
        date,
        lines: lineValues
      });
    }

    return history;
  }

  function computeTons(date, lineIndex, shiftIndex) {
    const daySeed = Math.floor((date.getTime() / 86400000) % 97);
    const base = 5.9 + (2.0 * Math.sin((daySeed + lineIndex * 5) / 4.8));
    const seasonal = 1.5 * Math.cos((daySeed + shiftIndex * 4) / 6.1);
    const lineBias = [0.9, -0.2][lineIndex];
    const shiftBias = [0.55, 0.1, -0.65][shiftIndex];
    return clamp(base + seasonal + lineBias + shiftBias, 0, MAX_TONS);
  }

  function getDayOptions() {
    return dailyHistory.slice().reverse().map(function (entry) {
      return {
        key: entry.key,
        label: formatLongDate(entry.date)
      };
    });
  }

  function bindEvents() {
    elements.refreshAppButton.addEventListener("click", function () {
      refreshApplication();
    });

    elements.openOeeView.addEventListener("click", function () {
      openView("oee");
    });

    elements.openQrView.addEventListener("click", function () {
      openView("qr");
    });

    elements.openAiView.addEventListener("click", function () {
      openView("ai");
    });

    elements.viewButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        openView(button.dataset.openView);
      });
    });

    elements.lineBoards.addEventListener("change", function (event) {
      const line = event.target.dataset.line;
      const control = event.target.dataset.control;
      if (!line || !control) {
        return;
      }

      if (control === "date") {
        state[line].referenceIndex = Number(event.target.value);
      }

      if (control === "shift") {
        state[line].shift = event.target.value;
      }

      renderBoards();
      renderTrendOverview();
    });

    elements.startScanButton.addEventListener("click", function () {
      startCamera();
    });

    elements.captureQrButton.addEventListener("click", function () {
      captureQr();
    });

    elements.stopScanButton.addEventListener("click", function () {
      stopCamera("Camara detenida.");
    });

    elements.qrImageInput.addEventListener("change", function (event) {
      handleQrImage(event.target.files && event.target.files[0]);
      event.target.value = "";
    });

    elements.openAiCapture.addEventListener("click", function () {
      openAiPath("/capture");
    });

    elements.openAiConsole.addEventListener("click", function () {
      openAiPath("/console");
    });

    elements.copyAiStartCommand.addEventListener("click", function () {
      copyAiStartCommand();
    });

    elements.checkAiHealth.addEventListener("click", function () {
      checkAiHealth(true);
    });
  }

  function openView(viewName) {
    if (state.currentView === "qr" && viewName !== "qr") {
      stopCamera();
    }

    if (state.currentView === "ai" && viewName !== "ai") {
      stopAiMonitoring();
    }

    state.currentView = viewName;
    updateView();

    if (viewName === "ai") {
      startAiMonitoring();
    }
  }

  function updateView() {
    elements.homeView.hidden = state.currentView !== "home";
    elements.oeeView.hidden = state.currentView !== "oee";
    elements.qrView.hidden = state.currentView !== "qr";
    elements.aiView.hidden = state.currentView !== "ai";
  }

  function normalizeAiBaseUrl() {
    var raw = String(elements.aiBaseUrl.value || "").trim();
    if (!raw) {
      raw = "http://127.0.0.1:8765";
      elements.aiBaseUrl.value = raw;
    }
    return raw.replace(/\/+$/, "");
  }

  function openAiPath(path) {
    var baseUrl = normalizeAiBaseUrl();
    var url = baseUrl + path;
    window.open(url, "_blank", "noopener");
  }

  async function checkAiHealth(manual) {
    await refreshAiConnection(Boolean(manual));
  }

  function startAiMonitoring() {
    stopAiMonitoring();
    refreshAiConnection(false);
    state.ai.pollTimer = window.setInterval(function () {
      refreshAiConnection(false);
    }, 3500);
  }

  function stopAiMonitoring() {
    if (state.ai.pollTimer) {
      window.clearInterval(state.ai.pollTimer);
      state.ai.pollTimer = null;
    }
  }

  async function refreshAiConnection(manual) {
    var baseUrl = normalizeAiBaseUrl();
    if (manual) {
      elements.checkAiHealth.disabled = true;
      elements.aiStatus.textContent = "Comprobando...";
    }

    try {
      var healthResponse = await fetch(baseUrl + "/api/health", { cache: "no-store" });
      if (!healthResponse.ok) {
        throw new Error("Servidor no disponible");
      }
      var statusResponse = await fetch(baseUrl + "/api/status", { cache: "no-store" });
      if (!statusResponse.ok) {
        throw new Error("No se pudo leer el estado del servidor.");
      }
      var statusPayload = await statusResponse.json();
      setAiConnected(statusPayload);
    } catch (error) {
      setAiDisconnected();
    } finally {
      if (manual) {
        elements.checkAiHealth.disabled = false;
      }
    }
  }

  async function copyAiStartCommand() {
    var command = String(elements.aiStartCommand.value || "").trim();
    if (!command) {
      return;
    }

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(command);
        elements.aiStatus.textContent = "Comando copiado. Pegalo en PowerShell para arrancar el server.";
      } else {
        throw new Error("Clipboard API no disponible");
      }
    } catch (error) {
      elements.aiStartCommand.removeAttribute("readonly");
      elements.aiStartCommand.focus();
      elements.aiStartCommand.select();
      elements.aiStatus.textContent = "No se pudo copiar automaticamente. Selecciona y copia el comando manualmente.";
    } finally {
      elements.aiStartCommand.setAttribute("readonly", "readonly");
    }
  }

  function setAiConnected(payload) {
    var counts = payload.dataset_counts || { ok: "-", ko: "-" };
    elements.aiStatus.textContent = "Servidor activo y enlazado";
    elements.aiConnectionBadge.textContent = "Conectado";
    elements.aiConnectionBadge.classList.remove("ai-health__badge--off");
    elements.aiConnectionBadge.classList.add("ai-health__badge--on");
    elements.aiConnectionDetail.textContent = "La app recibe estado del backend correctamente.";
    elements.openAiCapture.disabled = false;
    elements.openAiConsole.disabled = false;
    elements.aiDatasetTotal.textContent = String(payload.total_images);
    elements.aiDatasetOk.textContent = String(counts.ok);
    elements.aiDatasetKo.textContent = String(counts.ko);
  }

  function setAiDisconnected() {
    elements.aiStatus.textContent = "Sin conexion";
    elements.aiConnectionBadge.textContent = "Desconectado";
    elements.aiConnectionBadge.classList.remove("ai-health__badge--on");
    elements.aiConnectionBadge.classList.add("ai-health__badge--off");
    elements.aiConnectionDetail.textContent = "Ejecuta el comando de arranque y vuelve a comprobar.";
    elements.openAiCapture.disabled = true;
    elements.openAiConsole.disabled = true;
    elements.aiDatasetTotal.textContent = "-";
    elements.aiDatasetOk.textContent = "-";
    elements.aiDatasetKo.textContent = "-";
  }

  function renderBoards() {
    elements.lineBoards.innerHTML = LINES.map(function (line) {
      const selection = state[line];
      const snapshot = getSnapshot(line, selection.referenceIndex, selection.shift);
      const dayDetail = getDayBreakdown(line, selection.referenceIndex);

      return [
        '<section class="panel line-board">',
        '<div class="line-board__head">',
        '<div>',
        '<p class="section-label">Linea</p>',
        '<h2>', line, '</h2>',
        '<p class="mini-note">Cambia fecha y turno directamente en esta tabla</p>',
        '</div>',
        '<div class="line-board__score">', snapshot.oee, '% OEE</div>',
        '</div>',
        '<div class="field-grid line-board__filters">',
        '<div class="field-group">',
        '<label for="date-', line, '">Fecha</label>',
        '<select id="date-', line, '" data-line="', line, '" data-control="date">',
        dayOptions.map(function (option, index) {
          return '<option value="' + index + '"' + (selection.referenceIndex === index ? ' selected' : '') + '>' + option.label + '</option>';
        }).join(""),
        '</select>',
        '</div>',
        '<div class="field-group">',
        '<label for="shift-', line, '">Turno</label>',
        '<select id="shift-', line, '" data-line="', line, '" data-control="shift">',
        SHIFTS.map(function (shift) {
          return '<option value="' + shift + '"' + (selection.shift === shift ? ' selected' : '') + '>Turno ' + shift + '</option>';
        }).join(""),
        '</select>',
        '</div>',
        '</div>',
        '<div class="kpi-grid">',
        renderKpi("OEE", snapshot.oee + "%", snapshot.oee >= 85 ? "Sobre objetivo" : "Objetivo 85%"),
        renderKpi("Produccion", formatTons(snapshot.tons), "Max. 10 T por turno"),
        renderKpi("Paradas", snapshot.stops + " min", "No planificadas"),
        '</div>',
        '<div class="table-card">',
        '<table class="data-table">',
        '<thead><tr><th>Vista</th><th>OEE</th><th>Toneladas</th><th>Paradas</th></tr></thead>',
        '<tbody>',
        renderRow("Turno " + selection.shift, snapshot),
        renderRow("Total dia", dayDetail.day, "is-muted"),
        renderRow("Mejor turno", dayDetail.best, "is-good"),
        renderRow("Peor turno", dayDetail.worst, "is-bad"),
        '</tbody>',
        '</table>',
        '</div>',
        '</section>'
      ].join("");
    }).join("");
  }

  function renderTrendOverview() {
    const rollingSeries = getTrendSeries("Rolling");
    const bombosSeries = getTrendSeries("Bombos");
    const latestRolling = rollingSeries[rollingSeries.length - 1];
    const latestBombos = bombosSeries[bombosSeries.length - 1];
    const series = LINES.map(function (line) {
      const current = line === "Rolling" ? latestRolling : latestBombos;
      return {
        label: line,
        value: current.oee,
        tons: current.tons
      };
    });

    elements.trendNote.textContent = "Ultimo dia disponible";
    elements.trendChart.innerHTML = series.map(function (item) {
      const height = Math.max(18, Math.round((item.value / 100) * 150));
      return [
        '<div class="chart__bar" title="', item.label, ": ", item.value, "% | ", formatTons(item.tons), '">',
        '<div class="chart__track"><div class="chart__fill" style="height:', height, 'px"></div></div>',
        '<div class="chart__label chart__label--strong">', item.label, '</div>',
        '<div class="chart__label">', item.value, '%</div>',
        '</div>'
      ].join("");
    }).join("");
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
      state.qr.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" }
        },
        audio: false
      });
      elements.qrVideo.srcObject = state.qr.stream;
      await elements.qrVideo.play();
      updateQrStatus("Camara iniciada. Apunta al QR correcto y pulsa 'Capturar QR'.");
      updateScannerVisualState();
      updateScannerControls();
    } catch (error) {
      state.qr.cameraActive = false;
      state.qr.capturing = false;
      updateQrStatus("No se pudo abrir la camara. Revisa permisos del navegador.");
      stopCamera();
    }
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

    const record = {
      value,
      createdAt: now
    };

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
        const result = request.result.slice().sort(function (a, b) {
          return b.createdAt - a.createdAt;
        });
        resolve(result);
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

  function getSnapshot(line, referenceIndex, shift) {
    const selected = dayOptions[referenceIndex] || dayOptions[0];
    const entry = dailyHistory.find(function (item) {
      return item.key === selected.key;
    });
    const value = entry.lines[line].shifts[shift];
    return {
      label: selected.label,
      tons: value.tons,
      oee: value.oee,
      stops: value.stops
    };
  }

  function getDayBreakdown(line, referenceIndex) {
    const selected = dayOptions[referenceIndex] || dayOptions[0];
    const entry = dailyHistory.find(function (item) {
      return item.key === selected.key;
    });
    const shifts = SHIFTS.map(function (shift) {
      return {
        label: "Turno " + shift,
        tons: entry.lines[line].shifts[shift].tons,
        oee: entry.lines[line].shifts[shift].oee,
        stops: entry.lines[line].shifts[shift].stops
      };
    });
    const ordered = shifts.slice().sort(function (a, b) {
      return b.oee - a.oee;
    });

    return {
      day: {
        label: selected.label,
        tons: entry.lines[line].day.tons,
        oee: entry.lines[line].day.oee,
        stops: entry.lines[line].day.stops
      },
      best: ordered[0],
      worst: ordered[ordered.length - 1]
    };
  }

  function getTrendSeries(line) {
    return dailyHistory.slice(-14).map(function (entry) {
      return {
        label: pad(entry.date.getDate()),
        tons: entry.lines[line].day.tons,
        oee: entry.lines[line].day.oee
      };
    });
  }

  function renderKpi(label, value, hint) {
    return [
      '<article class="kpi-card">',
      '<p class="kpi-card__label">', label, '</p>',
      '<p class="kpi-card__value">', value, '</p>',
      '<p class="kpi-card__hint">', hint, '</p>',
      '</article>'
    ].join("");
  }

  function renderRow(label, metric, className) {
    return [
      '<tr class="', className || '', '">',
      '<td>', label, '</td>',
      '<td>', metric.oee, '%</td>',
      '<td>', formatTons(metric.tons), '</td>',
      '<td>', metric.stops, ' min</td>',
      '</tr>'
    ].join("");
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

  function formatLongDate(date) {
    const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
    return pad(date.getDate()) + " " + months[date.getMonth()] + " " + date.getFullYear();
  }

  function formatDateKey(date) {
    return [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join("-");
  }

  function formatTons(value) {
    return round(value, 1).toFixed(1) + " T";
  }

  function round(value, precision) {
    const factor = Math.pow(10, precision);
    return Math.round(value * factor) / factor;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
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
