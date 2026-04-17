(function () {
  const MAX_TONS = 10;
  const LINES = ["Rolling", "Bombos", "Aduana"];
  const SHIFTS = ["A", "B", "C"];
  const TODAY = new Date("2026-04-17T12:00:00");
  const HISTORY_DAYS = 61;
  const PERIOD_LABELS = {
    shift: "Turno",
    day: "Dia",
    week: "Semana"
  };

  const state = {
    period: "shift",
    line: "Rolling",
    referenceIndex: 0,
    shift: "A"
  };

  const elements = {
    lineSelect: document.getElementById("lineSelect"),
    referenceSelect: document.getElementById("referenceSelect"),
    shiftSelect: document.getElementById("shiftSelect"),
    summaryTitle: document.getElementById("summaryTitle"),
    summaryDate: document.getElementById("summaryDate"),
    oeeValue: document.getElementById("oeeValue"),
    oeeHint: document.getElementById("oeeHint"),
    unitsValue: document.getElementById("unitsValue"),
    unitsHint: document.getElementById("unitsHint"),
    stopsValue: document.getElementById("stopsValue"),
    trendChart: document.getElementById("trendChart"),
    trendNote: document.getElementById("trendNote"),
    comparisonCards: document.getElementById("comparisonCards"),
    insightList: document.getElementById("insightList"),
    installState: document.getElementById("installState"),
    periodButtons: Array.from(document.querySelectorAll("[data-period]"))
  };

  const dailyHistory = buildHistory();

  init();

  function init() {
    populateLineSelect();
    populateReferenceSelect();
    populateShiftSelect();
    bindEvents();
    render();
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
          const stops = Math.max(0, Math.round((100 - oee) * 1.35 + shiftIndex * 4 + lineIndex * 3));

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
        weekKey: getWeekKey(date),
        lines: lineValues
      });
    }

    return history;
  }

  function computeTons(date, lineIndex, shiftIndex) {
    const daySeed = Math.floor((date.getTime() / 86400000) % 97);
    const base = 5.8 + (2.1 * Math.sin((daySeed + lineIndex * 4) / 4.5));
    const seasonal = 1.6 * Math.cos((daySeed + shiftIndex * 5) / 6.2);
    const lineBias = [1.1, -0.4, -1.0][lineIndex];
    const shiftBias = [0.6, 0.15, -0.7][shiftIndex];
    const tons = base + seasonal + lineBias + shiftBias;
    return clamp(tons, 0, MAX_TONS);
  }

  function populateLineSelect() {
    elements.lineSelect.innerHTML = LINES.map(function (line) {
      return '<option value="' + line + '">' + line + "</option>";
    }).join("");
    elements.lineSelect.value = state.line;
  }

  function populateReferenceSelect() {
    const options = getReferenceOptions(state.period);
    elements.referenceSelect.innerHTML = options.map(function (option, index) {
      return '<option value="' + index + '">' + option.label + "</option>";
    }).join("");
    state.referenceIndex = 0;
    elements.referenceSelect.value = "0";
  }

  function populateShiftSelect() {
    elements.shiftSelect.innerHTML = SHIFTS.map(function (shift) {
      return '<option value="' + shift + '">Turno ' + shift + "</option>";
    }).join("");
    elements.shiftSelect.value = state.shift;
    elements.shiftSelect.disabled = state.period !== "shift";
  }

  function bindEvents() {
    elements.periodButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        state.period = button.dataset.period;
        elements.periodButtons.forEach(function (candidate) {
          candidate.classList.toggle("is-active", candidate === button);
        });
        populateReferenceSelect();
        populateShiftSelect();
        render();
      });
    });

    elements.lineSelect.addEventListener("change", function (event) {
      state.line = event.target.value;
      render();
    });

    elements.referenceSelect.addEventListener("change", function (event) {
      state.referenceIndex = Number(event.target.value);
      render();
    });

    elements.shiftSelect.addEventListener("change", function (event) {
      state.shift = event.target.value;
      render();
    });
  }

  function render() {
    const current = getCurrentMetric(state.line, state.period, state.referenceIndex, state.shift);
    const comparison = LINES.map(function (line) {
      return getCurrentMetric(line, state.period, state.referenceIndex, state.shift);
    });
    const trend = getTrendSeries(state.line, state.period, state.shift);

    elements.summaryTitle.textContent = state.line + " · " + buildTitleSuffix();
    elements.summaryDate.textContent = current.label;
    elements.oeeValue.textContent = current.oee + "%";
    elements.oeeHint.textContent = current.oee >= 85 ? "Por encima del objetivo" : "Objetivo 85%";
    elements.unitsValue.textContent = formatTons(current.tons);
    elements.unitsHint.textContent = state.period === "shift" ? "Max. 10 T" : state.period === "day" ? "Max. 30 T" : "Agregado semanal";
    elements.stopsValue.textContent = current.stops + " min";
    elements.trendNote.textContent = PERIOD_LABELS[state.period] + " seleccionado";

    renderTrendChart(trend);
    renderComparison(comparison);
    renderInsights(current, comparison);
  }

  function getReferenceOptions(period) {
    if (period === "week") {
      const seen = new Set();
      const options = [];
      for (let i = dailyHistory.length - 1; i >= 0; i -= 1) {
        const entry = dailyHistory[i];
        if (!seen.has(entry.weekKey)) {
          seen.add(entry.weekKey);
          options.push({
            key: entry.weekKey,
            label: "Semana " + entry.weekKey.split("-W")[1] + " · " + entry.date.getFullYear()
          });
        }
      }
      return options;
    }

    const latest = dailyHistory.slice().reverse();
    return latest.map(function (entry) {
      return {
        key: entry.key,
        label: formatLongDate(entry.date)
      };
    });
  }

  function getCurrentMetric(line, period, referenceIndex, shift) {
    const options = getReferenceOptions(period);
    const selected = options[referenceIndex] || options[0];

    if (period === "shift") {
      const entry = dailyHistory.find(function (item) {
        return item.key === selected.key;
      });
      const value = entry.lines[line].shifts[shift];
      return {
        line,
        tons: value.tons,
        oee: value.oee,
        stops: value.stops,
        label: selected.label
      };
    }

    if (period === "day") {
      const entry = dailyHistory.find(function (item) {
        return item.key === selected.key;
      });
      const value = entry.lines[line].day;
      return {
        line,
        tons: value.tons,
        oee: value.oee,
        stops: value.stops,
        label: selected.label
      };
    }

    const weekEntries = dailyHistory.filter(function (item) {
      return item.weekKey === selected.key;
    });
    const summary = summarizeEntries(weekEntries, line);
    return {
      line,
      tons: summary.tons,
      oee: summary.oee,
      stops: summary.stops,
      label: selected.label
    };
  }

  function summarizeEntries(entries, line) {
    const total = entries.reduce(function (acc, entry) {
      acc.tons += entry.lines[line].day.tons;
      acc.stops += entry.lines[line].day.stops;
      return acc;
    }, { tons: 0, stops: 0 });
    const capacity = Math.max(entries.length * MAX_TONS * SHIFTS.length, 1);
    return {
      tons: round(total.tons, 1),
      oee: clamp(Math.round((total.tons / capacity) * 100), 0, 100),
      stops: total.stops
    };
  }

  function getTrendSeries(line, period, shift) {
    if (period === "week") {
      const grouped = getReferenceOptions("week").map(function (option) {
        const entries = dailyHistory.filter(function (item) {
          return item.weekKey === option.key;
        });
        const summary = summarizeEntries(entries, line);
        return {
          label: option.label.replace("Semana ", "S"),
          value: summary.oee,
          tons: summary.tons
        };
      });
      return grouped.slice(-8);
    }

    const recent = dailyHistory.slice(-14);
    return recent.map(function (entry) {
      const source = period === "shift" ? entry.lines[line].shifts[shift] : entry.lines[line].day;
      return {
        label: pad(entry.date.getDate()),
        value: source.oee,
        tons: source.tons
      };
    });
  }

  function renderTrendChart(series) {
    const max = Math.max.apply(null, series.map(function (item) { return item.value; }).concat([100]));
    elements.trendChart.innerHTML = series.map(function (item) {
      const height = Math.max(8, Math.round((item.value / max) * 150));
      return [
        '<div class="chart__bar" title="',
        item.label,
        ": ",
        item.value,
        "% · ",
        formatTons(item.tons),
        '">',
        '<div class="chart__track"><div class="chart__fill" style="height:',
        height,
        'px"></div></div>',
        '<div class="chart__label">',
        item.label,
        "</div></div>"
      ].join("");
    }).join("");
  }

  function renderComparison(comparison) {
    const leader = comparison.reduce(function (best, current) {
      return current.oee > best.oee ? current : best;
    }, comparison[0]);

    elements.comparisonCards.innerHTML = comparison.map(function (item) {
      return [
        '<article class="line-card">',
        '<div class="line-card__top">',
        "<div>",
        '<p class="line-card__title">',
        item.line || inferLine(item),
        "</p>",
        '<p class="line-card__sub">',
        item.label,
        "</p>",
        "</div>",
        '<p class="line-card__value">',
        item.oee,
        "%</p>",
        "</div>",
        '<div class="line-card__meta">',
        "<span>",
        formatTons(item.tons),
        "</span>",
        "<span>",
        item.stops,
        " min</span>",
        "</div>",
        '<div class="progress"><div class="progress__fill" style="width:',
        item.oee,
        '%"></div></div>',
        leader.oee === item.oee ? '<p class="line-card__sub">Linea lider del periodo</p>' : "",
        "</article>"
      ].join("");
    }).join("");
  }

  function renderInsights(current, comparison) {
    const sorted = comparison.slice().sort(function (a, b) {
      return b.oee - a.oee;
    });
    const leader = sorted[0];
    const lagger = sorted[sorted.length - 1];
    const insights = [
      state.line + " registra " + current.oee + "% OEE y " + formatTons(current.tons) + " en " + current.label + ".",
      "La linea lider es " + inferLine(leader) + " con " + leader.oee + "% OEE.",
      inferLine(lagger) + " necesita recuperar ritmo: se queda en " + lagger.oee + "% OEE y " + lagger.stops + " min de paradas.",
      current.oee >= 85 ? "El periodo seleccionado esta en zona objetivo." : "El periodo seleccionado queda por debajo del objetivo del 85%."
    ];
    elements.insightList.innerHTML = insights.map(function (item) {
      return "<li>" + item + "</li>";
    }).join("");
  }

  function inferLine(metric) {
    return metric.line || "Linea";
  }

  function buildTitleSuffix() {
    if (state.period === "shift") {
      return "Turno " + state.shift;
    }
    return PERIOD_LABELS[state.period];
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

  function getWeekKey(date) {
    const temp = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    temp.setUTCDate(temp.getUTCDate() + 4 - (temp.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(temp.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((temp - yearStart) / 86400000) + 1) / 7);
    return temp.getUTCFullYear() + "-W" + pad(weekNo);
  }

  function formatDateKey(date) {
    return [
      date.getFullYear(),
      pad(date.getMonth() + 1),
      pad(date.getDate())
    ].join("-");
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
