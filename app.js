(function () {
  const MAX_TONS = 10;
  const LINES = ["Rolling", "Bombos"];
  const SHIFTS = ["A", "B", "C"];
  const TODAY = new Date("2026-04-17T12:00:00");
  const HISTORY_DAYS = 61;

  const state = {
    Rolling: { referenceIndex: 0, shift: "A" },
    Bombos: { referenceIndex: 0, shift: "A" }
  };

  const elements = {
    lineBoards: document.getElementById("lineBoards"),
    trendChart: document.getElementById("trendChart"),
    trendNote: document.getElementById("trendNote"),
    installState: document.getElementById("installState")
  };

  const dailyHistory = buildHistory();
  const dayOptions = getDayOptions();

  init();

  function init() {
    renderBoards();
    renderTrendOverview();
    bindEvents();
    registerServiceWorker();
    updateInstallState();
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
      navigator.serviceWorker.register("sw.js").catch(function () {
        elements.installState.textContent = "Modo web";
      });
    }
  }

  function updateInstallState() {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
    elements.installState.textContent = standalone ? "Instalada" : "PWA lista";
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
}());
