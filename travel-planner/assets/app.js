(() => {
  "use strict";

  // ============================================================
  // Brand mark — injected into the auth screen from a shared
  // <template>, so the markup lives in one place.
  // ============================================================
  const brandTemplate = document.getElementById("brandMarkTemplate");
  document.querySelectorAll("#authBrand").forEach((slot) => {
    slot.appendChild(brandTemplate.content.cloneNode(true));
  });

  // ============================================================
  // Auth flow: email -> password -> success -> workspace
  // ============================================================
  const authPage = document.getElementById("authPage");
  const appWorkspace = document.getElementById("appWorkspace");

  const stepEmail = document.getElementById("stepEmail");
  const stepPassword = document.getElementById("stepPassword");
  const stepSuccess = document.getElementById("stepSuccess");

  const emailForm = document.getElementById("emailForm");
  const emailInput = document.getElementById("authEmail");
  const emailError = document.getElementById("emailError");

  const passwordForm = document.getElementById("passwordForm");
  const passwordInput = document.getElementById("authPassword");
  const passwordError = document.getElementById("passwordError");
  const passwordEmailLabel = document.getElementById("passwordEmail");
  const backToEmailBtn = document.getElementById("backToEmailBtn");
  const toggleVisibilityBtn = document.getElementById("togglePasswordBtn");

  const successEmail = document.getElementById("successEmail");
  const logoutBtn = document.getElementById("logoutBtn");
  const enterAppBtn = document.getElementById("enterAppBtn");

  let currentEmail = "";

  function isValidEmail(value) {
    // Simple, permissive check — the real check happens server-side later.
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  function showStep(step) {
    stepEmail.hidden = step !== "email";
    stepPassword.hidden = step !== "password";
    stepSuccess.hidden = step !== "success";
  }

  function showWorkspace() {
    authPage.hidden = true;
    appWorkspace.hidden = false;
    updateProfile();
    initWorkspace();
  }

  function showAuth() {
    closeAllMenus();
    appWorkspace.hidden = true;
    authPage.hidden = false;
    currentEmail = "";
    emailInput.value = "";
    passwordInput.value = "";
    showStep("email");
    emailInput.focus();
  }

  // Step 1 -> 2: validate email, move to password
  emailForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const value = emailInput.value.trim();

    if (!isValidEmail(value)) {
      emailError.hidden = false;
      emailInput.closest(".field-row").style.borderColor = "var(--danger)";
      emailInput.focus();
      return;
    }

    emailError.hidden = true;
    emailInput.closest(".field-row").style.borderColor = "";
    currentEmail = value;
    passwordEmailLabel.textContent = currentEmail;
    passwordInput.value = "";
    passwordError.hidden = true;
    showStep("password");
    passwordInput.focus();
  });

  emailInput.addEventListener("input", () => {
    emailError.hidden = true;
    emailInput.closest(".field-row").style.borderColor = "";
  });

  // Step 2 -> 1: change email
  backToEmailBtn.addEventListener("click", () => {
    showStep("email");
    emailInput.focus();
  });

  // Show/hide password text
  toggleVisibilityBtn.addEventListener("click", () => {
    const isPassword = passwordInput.type === "password";
    passwordInput.type = isPassword ? "text" : "password";
    toggleVisibilityBtn.classList.toggle("is-visible", isPassword);
    toggleVisibilityBtn.setAttribute("aria-label", isPassword ? "Скрыть пароль" : "Показать пароль");
  });

  // Step 2 -> 3: validate password, "log in"
  passwordForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const value = passwordInput.value;

    if (value.length < 6) {
      passwordError.hidden = false;
      passwordInput.closest(".field-row").style.borderColor = "var(--danger)";
      passwordInput.focus();
      return;
    }

    passwordError.hidden = true;
    passwordInput.closest(".field-row").style.borderColor = "";
    successEmail.textContent = currentEmail;
    showStep("success");
  });

  passwordInput.addEventListener("input", () => {
    passwordError.hidden = true;
    passwordInput.closest(".field-row").style.borderColor = "";
  });

  // Step 3 -> workspace / back to step 1
  enterAppBtn.addEventListener("click", showWorkspace);
  logoutBtn.addEventListener("click", showAuth);

  // ============================================================
  // Floating profile / settings menus
  // ============================================================
  const profileBtn = document.getElementById("profileBtn");
  const profileMenu = document.getElementById("profileMenu");
  const profileAvatar = document.getElementById("profileAvatar");
  const profileEmailLabel = document.getElementById("profileEmailLabel");
  const profileLogoutBtn = document.getElementById("profileLogoutBtn");

  const settingsBtn = document.getElementById("settingsBtn");
  const settingsMenu = document.getElementById("settingsMenu");

  function updateProfile() {
    const initial = currentEmail.trim().charAt(0).toUpperCase() || "У";
    profileAvatar.textContent = initial;
    profileEmailLabel.textContent = currentEmail;
  }

  function setMenuOpen(btn, menu, open) {
    menu.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
  }

  function closeAllMenus() {
    setMenuOpen(profileBtn, profileMenu, false);
    setMenuOpen(settingsBtn, settingsMenu, false);
  }

  function toggleMenu(btn, menu, otherBtn, otherMenu) {
    const willOpen = menu.hidden;
    setMenuOpen(otherBtn, otherMenu, false);
    setMenuOpen(btn, menu, willOpen);
  }

  profileBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleMenu(profileBtn, profileMenu, settingsBtn, settingsMenu);
  });
  settingsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleMenu(settingsBtn, settingsMenu, profileBtn, profileMenu);
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".fab-wrap")) closeAllMenus();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAllMenus();
  });

  profileLogoutBtn.addEventListener("click", showAuth);

  // ============================================================
  // Workspace / desktop — each app is a floating, draggable, resizable
  // window with its own titlebar (minimize/close), like a small desktop
  // OS. The taskbar lists every app; its icon opens/restores/minimizes
  // the matching window. Positions persist in localStorage per app.
  // ============================================================
  // Every window's rect is stored as FRACTIONS of the desktop's current
  // size (xf/yf/wf/hf, each 0..1), not absolute pixels. applyRect() always
  // re-multiplies by the desktop's live size, so growing or shrinking the
  // browser window rescales every app window right along with it — that
  // used to only happen once, at first load.
  // ============================================================
  const WINDOW_STATE_KEY = "uyutTrip.windows.v3";
  const APPS = ["map", "chat", "route", "flights"];
  const MIN_W = 280;
  const MIN_H = 200;
  const PINNED_Z_BASE = 100000; // pinned windows live far above the normal stack

  const desktopEl = document.getElementById("desktop");
  const resetLayoutBtn = document.getElementById("resetLayoutBtn");

  let mapInstance = null;
  let workspaceInitialized = false;
  let windowState = {};
  let zCounter = 10;
  let pinnedZCounter = PINNED_Z_BASE;
  let focusedApp = null;
  const windowEls = {};

  function loadWindowState() {
    try {
      const raw = JSON.parse(localStorage.getItem(WINDOW_STATE_KEY));
      return raw && typeof raw === "object" ? raw : {};
    } catch {
      return {};
    }
  }
  function saveWindowState() {
    localStorage.setItem(WINDOW_STATE_KEY, JSON.stringify(windowState));
  }

  function deskSize() {
    return { w: desktopEl.clientWidth || 1200, h: desktopEl.clientHeight || 700 };
  }

  // Defaults are computed from the desktop's own size (not fixed pixels)
  // so the first-ever layout looks reasonable at any resolution — a
  // rough echo of the old map-big-left, chat-and-route-stacked-right
  // arrangement, with the ticket window centered like a dialog (and
  // noticeably wider, since it's mostly ticket rows).
  function defaultRect(app) {
    const { w, h } = deskSize();
    const pad = 16;
    let x, y, rw, rh;
    if (app === "map") { x = pad; y = pad; rw = w * 0.6; rh = h - pad * 2; }
    else if (app === "chat") { x = w * 0.6 + pad * 2; y = pad; rw = w * 0.4 - pad * 3; rh = h * 0.58; }
    else if (app === "route") { x = w * 0.6 + pad * 2; y = h * 0.58 + pad; rw = w * 0.4 - pad * 3; rh = h * 0.42 - pad * 2; }
    else if (app === "flights") { rw = Math.min(980, w * 0.82); x = Math.max(pad, w / 2 - rw / 2); y = h * 0.04; rh = h * 0.92; }
    else { x = pad; y = pad; rw = 400; rh = 300; }
    return { xf: x / w, yf: y / h, wf: rw / w, hf: rh / h };
  }

  // Turns a window's stored fractions into actual pixels against the
  // desktop's CURRENT size — the one and only place px are computed, so
  // resizing the browser just means calling this again with a new w/h.
  function pxRect(app) {
    const st = windowState[app];
    const { w, h } = deskSize();
    let rw = Math.min(Math.max(MIN_W, st.wf * w), w);
    let rh = Math.min(Math.max(MIN_H, st.hf * h), h);
    let x = st.xf * w;
    let y = st.yf * h;
    x = Math.max(-rw + 120, Math.min(x, w - 80));
    y = Math.max(0, Math.min(y, h - 36));
    return { x, y, w: rw, h: rh };
  }

  function applyRect(app) {
    const r = pxRect(app);
    const el = windowEls[app];
    el.style.left = r.x + "px";
    el.style.top = r.y + "px";
    el.style.width = r.w + "px";
    el.style.height = r.h + "px";
  }

  function stateFor(app) {
    if (!windowState[app]) windowState[app] = { ...defaultRect(app), open: false, minimized: false, pinned: false };
    return windowState[app];
  }

  function updateTaskbar() {
    document.querySelectorAll(".taskbar-app").forEach((btn) => {
      const app = btn.dataset.app;
      const st = windowState[app];
      const isOpen = Boolean(st && st.open && !st.minimized);
      btn.classList.toggle("is-open", Boolean(st && st.open));
      btn.classList.toggle("is-focused", isOpen && app === focusedApp);
    });
  }

  function focusWindow(app) {
    const st = windowState[app];
    if (st && st.pinned) { pinnedZCounter += 1; windowEls[app].style.zIndex = String(pinnedZCounter); }
    else { zCounter += 1; windowEls[app].style.zIndex = String(zCounter); }
    focusedApp = app;
    Object.keys(windowEls).forEach((a) => windowEls[a].classList.toggle("is-front", a === app));
    updateTaskbar();
  }

  function togglePin(app) {
    const st = windowState[app];
    if (!st) return;
    st.pinned = !st.pinned;
    windowEls[app].querySelector(".window-btn-pin").classList.toggle("is-active", st.pinned);
    windowEls[app].querySelector(".window-btn-pin").setAttribute("aria-pressed", String(st.pinned));
    focusWindow(app); // re-applies the right z-index immediately either way
    saveWindowState();
  }

  function openWindow(app) {
    const st = stateFor(app);
    st.open = true;
    st.minimized = false;
    applyRect(app);
    windowEls[app].classList.remove("is-minimized");
    focusWindow(app);
    saveWindowState();
    if (app === "map" && mapInstance) requestAnimationFrame(() => mapInstance.invalidateSize());
  }

  function minimizeWindow(app) {
    const st = windowState[app];
    if (!st) return;
    st.minimized = true;
    windowEls[app].classList.add("is-minimized");
    if (focusedApp === app) focusedApp = null;
    saveWindowState();
    updateTaskbar();
  }

  function closeWindow(app) {
    const st = windowState[app];
    if (!st) return;
    st.open = false;
    st.minimized = false;
    windowEls[app].classList.add("is-minimized");
    if (focusedApp === app) focusedApp = null;
    saveWindowState();
    updateTaskbar();
  }

  function toggleFromTaskbar(app) {
    const st = windowState[app];
    if (!st || !st.open || st.minimized) { openWindow(app); return; }
    if (focusedApp === app) minimizeWindow(app);
    else focusWindow(app);
  }

  function makeWindowDraggable(app) {
    const el = windowEls[app];
    const titlebar = el.querySelector(".window-titlebar");
    titlebar.addEventListener("mousedown", (e) => {
      if (e.target.closest(".window-btn")) return;
      e.preventDefault();
      focusWindow(app);
      const st = windowState[app];
      const { w: deskW, h: deskH } = deskSize();
      const start = pxRect(app);
      const startX = e.clientX, startY = e.clientY;
      function onMove(ev) {
        st.xf = (start.x + (ev.clientX - startX)) / deskW;
        st.yf = (start.y + (ev.clientY - startY)) / deskH;
        applyRect(app);
      }
      function onUp() {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        applyRect(app);
        saveWindowState();
      }
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
    el.addEventListener("mousedown", () => focusWindow(app));
  }

  function makeWindowResizable(app) {
    const el = windowEls[app];
    const handle = el.querySelector(".window-resize");
    handle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      focusWindow(app);
      const st = windowState[app];
      const { w: deskW, h: deskH } = deskSize();
      const start = pxRect(app);
      const startX = e.clientX, startY = e.clientY;
      function onMove(ev) {
        st.wf = Math.max(MIN_W, start.w + (ev.clientX - startX)) / deskW;
        st.hf = Math.max(MIN_H, start.h + (ev.clientY - startY)) / deskH;
        applyRect(app);
        if (app === "map" && mapInstance) mapInstance.invalidateSize();
      }
      function onUp() {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        applyRect(app);
        saveWindowState();
        if (app === "map" && mapInstance) mapInstance.invalidateSize();
      }
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }

  function resetWindows() {
    localStorage.removeItem(WINDOW_STATE_KEY);
    windowState = {};
    APPS.forEach((app, i) => {
      const st = stateFor(app);
      st.open = i < 3; // flights starts closed, like the others used to
      st.minimized = false;
      st.pinned = false;
      applyRect(app);
      windowEls[app].classList.toggle("is-minimized", !st.open);
      const pinBtn = windowEls[app].querySelector(".window-btn-pin");
      pinBtn.classList.remove("is-active");
      pinBtn.setAttribute("aria-pressed", "false");
    });
    focusedApp = "map";
    focusWindow("map");
    saveWindowState();
    if (mapInstance) requestAnimationFrame(() => mapInstance.invalidateSize());
  }

  // The desktop area can change size for reasons that never fire a window
  // "resize" event too (a sidebar toggling, devtools docking) — a
  // ResizeObserver on the desktop itself catches all of those, and since
  // applyRect() re-derives pixels from the stored fractions every time,
  // every open window rescales with it automatically.
  function rescaleAllWindows() {
    APPS.forEach((app) => { if (windowState[app]) applyRect(app); });
    if (mapInstance) mapInstance.invalidateSize();
  }
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(rescaleAllWindows).observe(desktopEl);
  } else {
    window.addEventListener("resize", rescaleAllWindows);
  }

  function initWorkspace() {
    if (workspaceInitialized) return;
    workspaceInitialized = true;

    APPS.forEach((app) => { windowEls[app] = document.getElementById("win-" + app); });
    windowState = loadWindowState();

    const hasSavedState = Object.keys(windowState).length > 0;
    APPS.forEach((app, i) => {
      const st = stateFor(app);
      if (!hasSavedState) { st.open = i < 3; } // map, chat, route open by default; flights via taskbar
      applyRect(app);
      if (!st.open || st.minimized) windowEls[app].classList.add("is-minimized");
      makeWindowDraggable(app);
      makeWindowResizable(app);
      windowEls[app].querySelector(".window-btn-min").addEventListener("click", () => minimizeWindow(app));
      windowEls[app].querySelector(".window-btn-close").addEventListener("click", () => closeWindow(app));
      windowEls[app].querySelector(".window-btn-pin").addEventListener("click", () => togglePin(app));
      if (st.pinned) windowEls[app].querySelector(".window-btn-pin").classList.add("is-active");
      focusWindow(app); // establishes correct initial z-order, respecting pins
    });
    if (!hasSavedState) saveWindowState();

    document.querySelectorAll(".taskbar-app").forEach((btn) => {
      btn.addEventListener("click", () => toggleFromTaskbar(btn.dataset.app));
    });
    updateTaskbar();
    if (windowState.map && windowState.map.open && !windowState.map.minimized) focusWindow("map");

    resetLayoutBtn.addEventListener("click", resetWindows);

    initMap();
    initFlightSearch();
  }

  // Custom minimalist map: region borders as vector shapes on a plain
  // black background (no raster tiles, no fetch()) — the accent color
  // only appears on hover/selection/labels, everything else stays
  // neutral white. Starting with China and Japan; more regions can be
  // added the same way later as our own map data grows.
  const SAKURA = "#f3b6c9"; // keep in sync with --accent in styles.css

  // Small transport badges that can ride inside a city's pill. Only
  // "airport" is wired up to real data right now (window.CHINA_AIRPORTS_GEOJSON,
  // sourced from OurAirports); the rail set is drawn and ready, but not
  // attached to any city yet — there's no reliable open dataset splitting
  // Chinese stations into regular/high-speed/ultra-high-speed per city, so
  // it stays unused rather than guessing.
  const TRANSPORT_ICONS = {
    rail:
      '<svg class="transport-icon" viewBox="0 0 48 48" fill="none" aria-hidden="true">' +
      '<path d="M10 40 V22 Q10 8 24 8 Q38 8 38 22 V40" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>' +
      '<line x1="10" y1="24" x2="10" y2="40" stroke="currentColor" stroke-width="2.6"/>' +
      '<line x1="38" y1="24" x2="38" y2="40" stroke="currentColor" stroke-width="2.6"/>' +
      '<rect x="15" y="24" width="18" height="14" rx="3" fill="currentColor"/>' +
      '<rect x="18.5" y="27.5" width="4.5" height="4.5" rx="1" fill="#000"/>' +
      '<rect x="25" y="27.5" width="4.5" height="4.5" rx="1" fill="#000"/>' +
      '<circle cx="24" cy="35" r="1.4" fill="#000"/>' +
      '<line x1="6" y1="42" x2="42" y2="42" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>' +
      "</svg>",
    airport:
      '<svg class="transport-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
      '<path d="M21,15.5V13.5L13,8.5V3.5C13,2.67 12.33,2 11.5,2C10.67,2 10,2.67 10,3.5V8.5L2,13.5V15.5L10,13V18.5L7.5,20V21.5L11.5,20.5L15.5,21.5V20L13,18.5V13L21,15.5Z"/>' +
      "</svg>",
    highspeed:
      '<svg class="transport-icon" viewBox="0 0 48 48" fill="none" aria-hidden="true">' +
      '<path d="M6 34 Q6 30 12 28 L20 26 Q26 18 34 18 Q42 18 42 27 L42 34 Z" fill="currentColor"/>' +
      '<rect x="12" y="24.5" width="7" height="5" rx="1.2" fill="#000"/>' +
      '<rect x="24" y="21" width="7" height="6" rx="1.2" fill="#000"/>' +
      '<circle cx="14" cy="36" r="3.2" fill="#000" stroke="currentColor" stroke-width="1.6"/>' +
      '<circle cx="34" cy="36" r="3.2" fill="#000" stroke="currentColor" stroke-width="1.6"/>' +
      '<line x1="4" y1="39" x2="44" y2="39" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>' +
      "</svg>",
    ultraHighspeed:
      '<svg class="transport-icon" viewBox="0 0 48 48" fill="none" aria-hidden="true">' +
      '<path d="M2 33 Q2 29 8 28 L11 27.6 Q22 14 36 14 Q45 14 45 25 L45 33 Z" fill="currentColor"/>' +
      '<rect x="29" y="18" width="13" height="5.5" rx="1.2" fill="#000"/>' +
      '<circle cx="12" cy="35.5" r="3.2" fill="#000" stroke="currentColor" stroke-width="1.6"/>' +
      '<circle cx="36" cy="35.5" r="3.2" fill="#000" stroke="currentColor" stroke-width="1.6"/>' +
      '<line x1="0" y1="38.5" x2="47" y2="38.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>' +
      "</svg>",
  };

  // City labels reveal progressively as you zoom in, biggest cities first.
  function cityMinZoom(population) {
    if (population >= 15000000) return 2;
    if (population >= 7000000) return 4;
    if (population >= 3000000) return 5;
    if (population >= 1000000) return 6;
    return 7;
  }

  function initMap() {
    mapInstance = L.map("mapContainer", {
      zoomControl: true,
      attributionControl: true,
      worldCopyJump: false,
      minZoom: 2,
      maxZoom: 16, // deep enough to tell individual metro stations apart
    }).setView([33, 122], 3);

    mapInstance.attributionControl.setPrefix(false);

    // No hover highlight — it read as an annoying flash while just
    // moving the cursor around (especially once hovering a city also lit
    // up its whole region). A region only changes appearance on click,
    // and even then it's just a thin outline, not a color wash. The name
    // is still available on hover via the tooltip below.
    //
    // Selection has two levels: a province/prefecture, or (once zoomed in
    // past CITY_BOUNDARY_MIN_ZOOM) one city inside it — clicking a city
    // hands the highlight down to just that city and drops it off the
    // province; zooming back out past that threshold hands it back up to
    // the city's own province, so the region reads as "still selected"
    // rather than losing the selection entirely.
    let selectedLayer = null;
    let selectedCityLayer = null;
    let selectedCityProvinceId = null;
    const provinceLayerById = {};
    const cityProvinceId = {};
    (window.CHINA_CITIES_GEOJSON || { features: [] }).features.forEach((f) => {
      cityProvinceId[f.properties.name] = f.properties.province;
    });

    const baseStyle = { color: "rgba(244,246,242,.5)", weight: 1, fillColor: "#000", fillOpacity: 1 };
    // Fully opaque, not a translucent pink wash — a low fillOpacity here
    // let the sea layer underneath show through wherever our region
    // polygon and the (separately-sourced) sea mask don't align exactly,
    // which made selected coastal regions look like they'd gone half
    // underwater. Pre-blended color, still fully opaque, fixes it for good.
    const selectedStyle = { color: SAKURA, weight: 2.2, fillColor: "#5c454c", fillOpacity: 1 };

    function addRegions(geoData, trackIds) {
      if (!geoData) return null;
      return L.geoJSON(geoData, {
        style: () => baseStyle,
        // Leaflet gives interactive paths a focus outline (tabindex) by
        // default — Chromium draws it as a plain rectangle around the
        // path's bounding box, which looked like a stray square on click.
        keyboard: false,
        onEachFeature: (feature, layer) => {
          const props = feature.properties || {};
          const name = props.name || "";
          if (name) layer.bindTooltip(name, { sticky: true, className: "map-tooltip" });
          if (trackIds && props.id) provinceLayerById[props.id] = layer;

          layer.on("click", () => {
            if (selectedCityLayer) { selectedCityLayer.setStyle(cityBaseStyle); selectedCityLayer = null; selectedCityProvinceId = null; }
            if (selectedLayer && selectedLayer !== layer) selectedLayer.setStyle(baseStyle);
            selectedLayer = layer === selectedLayer ? null : layer;
            layer.setStyle(selectedLayer ? selectedStyle : baseStyle);
          });
        },
      }).addTo(mapInstance);
    }

    const bounds = L.latLngBounds([]);
    const chinaLayer = addRegions(window.CHINA_PROVINCES_GEOJSON, true);
    if (chinaLayer) bounds.extend(chinaLayer.getBounds());
    const japanLayer = addRegions(window.JAPAN_PREFECTURES_GEOJSON, false);
    if (japanLayer) bounds.extend(japanLayer.getBounds());

    // Region name labels — the native-language name (Chinese for a
    // province, Japanese for a prefecture) centered on the region, quiet
    // and permanent; the Russian-name tooltip on hover still works, since
    // this is a separate non-interactive layer sitting on top.
    function ringArea(ring) {
      let a = 0;
      for (let i = 0; i < ring.length - 1; i++) {
        const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
        a += x1 * y2 - x2 * y1;
      }
      return a / 2;
    }
    function ringCentroid(ring) {
      let a = 0, cx = 0, cy = 0;
      for (let i = 0; i < ring.length - 1; i++) {
        const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
        const cross = x1 * y2 - x2 * y1;
        a += cross;
        cx += (x1 + x2) * cross;
        cy += (y1 + y2) * cross;
      }
      a *= 0.5;
      if (Math.abs(a) < 1e-9) return ring[0];
      return [cx / (6 * a), cy / (6 * a)];
    }
    // Largest ring by area, so a region split across islands (Hong Kong,
    // Zhoushan, Okinawa's chain) gets its label on the mainland piece
    // instead of averaging out somewhere in the sea between them.
    function polygonCentroid(geometry) {
      const polys = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
      let best = null, bestArea = -Infinity;
      polys.forEach((rings) => {
        const area = Math.abs(ringArea(rings[0]));
        if (area > bestArea) { bestArea = area; best = rings[0]; }
      });
      if (!best) return null;
      const [lng, lat] = ringCentroid(best);
      return [lat, lng];
    }
    function addRegionLabels(geoData) {
      if (!geoData) return [];
      return geoData.features
        .map((feature) => {
          const label = feature.properties && (feature.properties.nameNative || feature.properties.name);
          const center = label && polygonCentroid(feature.geometry);
          if (!center) return null;
          return L.marker(center, {
            icon: L.divIcon({ className: "", html: `<span class="region-name">${label}</span>`, iconSize: null }),
            interactive: false,
            keyboard: false,
          });
        })
        .filter(Boolean);
    }
    // Dozens of small regions (Japan's 47 prefectures especially) would
    // just be visual noise at the country-wide view, so — like the city
    // boundaries — these only appear once you've zoomed in past them.
    const REGION_LABEL_MIN_ZOOM = 5;
    const regionLabelMarkers = [...addRegionLabels(window.CHINA_PROVINCES_GEOJSON), ...addRegionLabels(window.JAPAN_PREFECTURES_GEOJSON)];
    const updateRegionLabelVisibility = () => {
      const visible = mapInstance.getZoom() >= REGION_LABEL_MIN_ZOOM;
      regionLabelMarkers.forEach((m) => {
        const has = mapInstance.hasLayer(m);
        if (visible && !has) m.addTo(mapInstance);
        else if (!visible && has) mapInstance.removeLayer(m);
      });
    };
    mapInstance.on("zoomend", updateRegionLabelVisibility);
    mapInstance.whenReady(updateRegionLabelVisibility);

    // Sea/ocean names — hand-placed (these bodies of water aren't features
    // in any of our region data, just well-known labels), in a soft blue
    // so they read as part of the sea rather than competing with land.
    const SEA_NAMES = [
      { name: "Жёлтое море", lat: 37.5, lng: 122.5 },
      { name: "Восточно-Китайское море", lat: 27, lng: 127.5 },
      { name: "Южно-Китайское море", lat: 16.5, lng: 112.5 },
      { name: "Японское море", lat: 41.5, lng: 133 },
      { name: "Тихий океан", lat: 29, lng: 149 },
    ];
    SEA_NAMES.forEach((s) => {
      L.marker([s.lat, s.lng], {
        icon: L.divIcon({ className: "", html: `<span class="sea-name">${s.name}</span>`, iconSize: null }),
        interactive: false,
        keyboard: false,
      }).addTo(mapInstance);
    });

    // City boundaries — a fine dashed outline per city, sitting inside its
    // province/prefecture, only shown once zoomed in enough that ~120
    // overlapping outlines wouldn't just be noise at the country-wide view.
    // Interactive: clicking inside one selects that city instead of its
    // province (see the province click handler above and the zoom-out
    // hand-back below).
    const cityBoundaryData = window.CHINA_CITY_BOUNDARIES_GEOJSON;
    const CITY_BOUNDARY_MIN_ZOOM = 6;
    const cityBaseStyle = { color: "rgba(243,182,201,.55)", weight: 1, dashArray: "3,3", fillOpacity: 0 };
    // Same fix as the province style above: opaque blended fill instead of
    // a translucent one, so a city selection can't show the sea (or
    // anything else) bleeding through underneath it either.
    const citySelectedStyle = { color: SAKURA, weight: 2, dashArray: null, fillColor: "#7a5b65", fillOpacity: 1 };
    if (cityBoundaryData) {
      const cityBoundaryLayer = L.geoJSON(cityBoundaryData, {
        interactive: true,
        keyboard: false,
        style: () => cityBaseStyle,
        onEachFeature: (feature, layer) => {
          const name = (feature.properties && feature.properties.name) || "";
          if (name) layer.bindTooltip(name, { sticky: true, className: "map-tooltip" });
          layer.on("click", () => {
            if (mapInstance.getZoom() < CITY_BOUNDARY_MIN_ZOOM) return; // invisible at this zoom, shouldn't be clickable either
            if (selectedLayer) { selectedLayer.setStyle(baseStyle); selectedLayer = null; }
            if (selectedCityLayer && selectedCityLayer !== layer) selectedCityLayer.setStyle(cityBaseStyle);
            selectedCityLayer = layer === selectedCityLayer ? null : layer;
            layer.setStyle(selectedCityLayer ? citySelectedStyle : cityBaseStyle);
            selectedCityProvinceId = selectedCityLayer ? cityProvinceId[name] : null;
          });
        },
      }).addTo(mapInstance);
      const updateCityBoundaryVisibility = () => {
        const visible = mapInstance.getZoom() >= CITY_BOUNDARY_MIN_ZOOM;
        if (!visible && selectedCityLayer) {
          // Zoomed out past the point cities are selectable — hand the
          // highlight back up to the city's own province instead of just
          // dropping the selection.
          selectedCityLayer.setStyle(cityBaseStyle);
          const provLayer = selectedCityProvinceId && provinceLayerById[selectedCityProvinceId];
          selectedCityLayer = null;
          selectedCityProvinceId = null;
          if (provLayer) {
            if (selectedLayer && selectedLayer !== provLayer) selectedLayer.setStyle(baseStyle);
            selectedLayer = provLayer;
            provLayer.setStyle(selectedStyle);
          }
        }
        cityBoundaryLayer.eachLayer((l) => l.setStyle({ opacity: visible ? 1 : 0 }));
      };
      mapInstance.on("zoomend", updateCityBoundaryVisibility);
      mapInstance.whenReady(updateCityBoundaryVisibility);
    }

    // Sea — and with it the true coastline. Painted ABOVE the province /
    // prefecture / city fills (its own pane, z 401, over the overlay pane):
    // those polygons are coarse along most coasts and run out over the
    // water, so water is laid over them and the shoreline you see is the
    // sea mask's own. Land is simply the black background showing through,
    // which also covers reclaimed shore no region outline reaches. Streets,
    // metro, rail and flights sit in a pane above it (z 402), so they stay
    // on top of the water. Both panes ignore the mouse — clicks and
    // tooltips still reach the regions underneath.
    //
    // Shorelines are GSHHG full resolution (~15 m) along China, Taiwan and
    // Japan, coarse elsewhere, plus reclaimed shore the dataset predates.
    // Shipped as four levels of detail, each simplified (and cleaned of
    // spikes) in advance for its zoom range and drawn as-is
    // (smoothFactor 0): left to Leaflet's own pixel-space simplification,
    // narrow inlets folded into stray dark wedges out at sea. Each level is
    // cut into tiles so off-screen ones cost nothing, and decoded only the
    // first time its zoom range is reached.
    mapInstance.createPane("seaPane").style.zIndex = 401;
    mapInstance.createPane("transitPane").style.zIndex = 402;
    mapInstance.getPane("seaPane").style.pointerEvents = "none";
    mapInstance.getPane("transitPane").style.pointerEvents = "none";
    const seaData = window.SEA_LOD;
    if (seaData) {
      const SEA_COLOR = "#0f2d40";
      const decodeRing = (s) => {
        const pts = [];
        let i = 0, lat = 0, lng = 0;
        while (i < s.length) {
          for (let k = 0; k < 2; k++) {
            let result = 0, shift = 0, b;
            do { b = s.charCodeAt(i++) - 63; result |= (b & 31) << shift; shift += 5; } while (b >= 32);
            const delta = result & 1 ? ~(result >> 1) : result >> 1;
            if (k === 0) lat += delta; else lng += delta;
          }
          pts.push([lat / 1e5, lng / 1e5]);
        }
        return pts;
      };
      const buildLevel = (level) => {
        const layers = [];
        level.tiles.forEach((tile) => {
          const [w, s, e, n] = tile.b;
          const rings = tile.r.map(decodeRing);
          // even-odd, so a tile's land cut-outs (and lakes inside them) need no ring ordering
          layers.push(L.polygon(rings, {
            pane: "seaPane", interactive: false, stroke: false,
            fillColor: SEA_COLOR, fillOpacity: 1, fillRule: "evenodd", smoothFactor: 0,
          }));
          // Coastline = the same rings minus the stretches that only run
          // along the tile's own edge (those are cuts, not shore).
          const onEdge = (p) => p[1] === w || p[1] === e || p[0] === s || p[0] === n;
          const sameEdge = (p, q) => (p[1] === q[1] && (p[1] === w || p[1] === e)) || (p[0] === q[0] && (p[0] === s || p[0] === n));
          const runs = [];
          rings.forEach((ring) => {
            let run = [];
            for (let i = 0; i < ring.length; i++) {
              const p = ring[i], q = ring[i - 1];
              if (q && onEdge(p) && onEdge(q) && sameEdge(p, q)) {
                if (run.length > 1) runs.push(run);
                run = [p];
              } else run.push(p);
            }
            if (run.length > 1) runs.push(run);
          });
          if (runs.length) layers.push(L.polyline(runs, {
            pane: "seaPane", interactive: false, color: "rgba(244,246,242,.5)", weight: 1, smoothFactor: 0,
          }));
        });
        return L.featureGroup(layers);
      };
      const groups = [];
      let shown = null;
      const updateSeaLevel = () => {
        const z = mapInstance.getZoom();
        const i = seaData.findIndex((lv) => z <= lv.maxZoom);
        const idx = i < 0 ? seaData.length - 1 : i;
        if (shown === idx) return;
        if (!groups[idx]) groups[idx] = buildLevel(seaData[idx]);
        groups[idx].addTo(mapInstance);
        if (shown !== null) mapInstance.removeLayer(groups[shown]);
        shown = idx;
      };
      mapInstance.on("zoomend", updateSeaLevel);
      updateSeaLevel();
      // Decode the remaining levels while the browser is idle, one per
      // idle slot, so the first zoom into a city doesn't stall on it.
      const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 200));
      const prebuild = (i) => {
        if (i >= seaData.length) return;
        if (!groups[i]) groups[i] = buildLevel(seaData[i]);
        idle(() => prebuild(i + 1));
      };
      idle(() => prebuild(0));
    }

    // City street networks — Shenzhen, Dongguan, Foshan and Huizhou so
    // far, one file each registering itself in window.CITY_ROADS: every
    // road from OpenStreetMap (via city-roads), georeferenced against the
    // city's own metro lines (or, with no metro, against the neighbours'
    // roads its own cross the border onto) and cut exactly at its city
    // boundary, so neighbouring
    // cities meet at the shared border instead of overlapping. Drawn in
    // the transit pane, above the sea and the region fills, and added
    // before metro so every transit line lands on top of it. A handful of
    // multi-polylines (one SVG path per grid bucket, see below) rather
    // than 26k separate layers: Leaflet clips and
    // simplifies each to the visible area on redraw and skips off-screen
    // buckets entirely, so it stays cheap even zoomed all the way in.
    // Faint at the city-wide view and firmer as you zoom in, so the
    // street grid reads as texture first and as actual streets up close.
    const roadsData = window.CITY_ROADS;
    const ROADS_MIN_ZOOM = 9;
    if (roadsData) {
      // Google encoded polyline (precision 5) -> [[lat, lng], ...]
      const decodePolyline = (s) => {
        const pts = [];
        let i = 0, lat = 0, lng = 0;
        while (i < s.length) {
          for (let k = 0; k < 2; k++) {
            let result = 0, shift = 0, b;
            do { b = s.charCodeAt(i++) - 63; result |= (b & 31) << shift; shift += 5; } while (b >= 32);
            const delta = result & 1 ? ~(result >> 1) : result >> 1;
            if (k === 0) lat += delta; else lng += delta;
          }
          pts.push([lat / 1e5, lng / 1e5]);
        }
        return pts;
      };
      // Bucketed into a coarse grid (~5 km cells, by each line's first
      // point): Leaflet skips a whole polyline whose bounds are off screen,
      // so zoomed into one district it only clips the few buckets in view
      // instead of every point of every city on each pan.
      const ROAD_CELL_DEG = 0.05;
      const buckets = new Map();
      Object.values(roadsData).forEach((city) => city.lines.forEach((s) => {
        const pts = decodePolyline(s);
        const key = Math.floor(pts[0][0] / ROAD_CELL_DEG) + ":" + Math.floor(pts[0][1] / ROAD_CELL_DEG);
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(pts);
      }));
      const roadsLayer = L.featureGroup(
        [...buckets.values()].map((lines) => L.polyline(lines, {
          pane: "transitPane",
          interactive: false,
          color: "#f4f6f2",
          weight: 0.6,
          opacity: 0,
          lineCap: "round",
          lineJoin: "round",
        }))
      ).addTo(mapInstance);
      const updateRoadsVisibility = () => {
        const z = mapInstance.getZoom();
        if (z < ROADS_MIN_ZOOM) { roadsLayer.setStyle({ opacity: 0 }); return; }
        roadsLayer.setStyle({
          opacity: z <= 9 ? 0.2 : z === 10 ? 0.28 : z === 11 ? 0.36 : z === 12 ? 0.45 : 0.55,
          weight: z <= 10 ? 0.6 : z <= 12 ? 0.8 : z <= 14 ? 1 : 1.3,
        });
      };
      mapInstance.on("zoomend", updateRoadsVisibility);
      mapInstance.whenReady(updateRoadsVisibility);
    }

    // Metro/subway lines — drawn in each system's real line colors, inside
    // the city boundary. Only the cities that actually run one carry any
    // data here; shown a touch closer in than the city outline itself,
    // since a metro network reads as noise until you're zoomed into the
    // city proper.
    const metroData = window.CHINA_METRO_GEOJSON;
    const METRO_MIN_ZOOM = 8;
    if (metroData) {
      const metroLayer = L.geoJSON(metroData, {
        pane: "transitPane",
        interactive: false,
        // smoothFactor: 0 — Leaflet's default (1) simplifies the rendered
        // path for performance; with station dots now snapped exactly onto
        // a line's raw vertices, disabling that keeps the drawn path an
        // exact match for the data instead of a lightly simplified stand-in.
        // schematic: true (currently just Dongguan Line 1) marks a path with
        // no real track curvature behind it — a straight connect-the-dots
        // line through its real, correctly-ordered stations, not a survey
        // of the actual alignment (unlike every other line here). Dashed,
        // so that difference is visible on the map itself and not just in
        // the README — a real curve should never be mistaken for one of
        // these placeholders.
        style: (feature) => ({
          color: feature.properties.color || SAKURA,
          weight: 2,
          opacity: 1,
          fillOpacity: 0,
          smoothFactor: 0,
          dashArray: feature.properties.schematic ? "6,6" : null,
        }),
      }).addTo(mapInstance);
      const updateMetroVisibility = () => {
        const visible = mapInstance.getZoom() >= METRO_MIN_ZOOM;
        metroLayer.eachLayer((l) => l.setStyle({ opacity: visible ? 0.9 : 0 }));
      };
      mapInstance.on("zoomend", updateMetroVisibility);
      mapInstance.whenReady(updateMetroVisibility);
    }

    // High-speed rail — the inter-city trunk lines that connect whole
    // provinces, not one city's own metro network, so they reveal a step
    // earlier than metro (worth seeing at a wider, regional view) and stay
    // outside any city boundary. Drawn as two coincident strokes per line
    // (a wide teal band, plus a thin, much darker line straight down its
    // middle) rather than metro's single flat color — a real line already
    // reads as "metro" with a plain stroke, so this second stroke is what
    // makes a high-speed line read as its own kind of thing on sight,
    // matching how these are drawn on real HSR network maps.
    const hsrData = window.HIGHSPEED_RAIL_GEOJSON;
    const HSR_MIN_ZOOM = 6;
    const HSR_COLOR = "#1d6b5a";
    const HSR_CENTERLINE_COLOR = "#05221c";
    const HSR_OPACITY = 0.6; // duller than metro's 0.9 — a lot of these run close together
    if (hsrData) {
      const hsrOuter = L.geoJSON(hsrData, {
        pane: "transitPane",
        interactive: false,
        style: () => ({ color: HSR_COLOR, weight: 3, opacity: HSR_OPACITY, fillOpacity: 0, smoothFactor: 0 }),
      }).addTo(mapInstance);
      const hsrInner = L.geoJSON(hsrData, {
        pane: "transitPane",
        interactive: false,
        style: () => ({ color: HSR_CENTERLINE_COLOR, weight: 1, opacity: HSR_OPACITY, fillOpacity: 0, smoothFactor: 0 }),
      }).addTo(mapInstance);
      const updateHsrVisibility = () => {
        const visible = mapInstance.getZoom() >= HSR_MIN_ZOOM;
        const opacity = visible ? HSR_OPACITY : 0;
        hsrOuter.eachLayer((l) => l.setStyle({ opacity }));
        hsrInner.eachLayer((l) => l.setStyle({ opacity }));
      };
      mapInstance.on("zoomend", updateHsrVisibility);
      mapInstance.whenReady(updateHsrVisibility);
    }

    // Airports — one marker per city that has one, sitting at the
    // airport's real coordinates: the plane icon plus its IATA/ICAO code
    // (e.g. Гуанчжоу CAN). Same "zoomed into the city" reveal as metro,
    // rather than cluttering the country-wide view.
    const airportsData = window.CHINA_AIRPORTS_GEOJSON;
    const AIRPORT_MIN_ZOOM = 8;
    if (airportsData) {
      const airportMarkers = airportsData.features.map((feature) => {
        const [lng, lat] = feature.geometry.coordinates;
        const code = (feature.properties && feature.properties.code) || "";
        const marker = L.marker([lat, lng], {
          icon: L.divIcon({
            className: "",
            html:
              `<span class="airport-marker">${TRANSPORT_ICONS.airport}` +
              (code ? `<span class="airport-code">${code}</span>` : "") +
              `</span>`,
            iconSize: null,
          }),
          interactive: false,
          keyboard: false,
        });
        return marker;
      });
      const updateAirportVisibility = () => {
        const visible = mapInstance.getZoom() >= AIRPORT_MIN_ZOOM;
        airportMarkers.forEach((m) => {
          const has = mapInstance.hasLayer(m);
          if (visible && !has) m.addTo(mapInstance);
          else if (!visible && has) mapInstance.removeLayer(m);
        });
      };
      mapInstance.on("zoomend", updateAirportVisibility);
      mapInstance.whenReady(updateAirportVisibility);
    }

    // Rail termini — the regular/high-speed/ultra-high-speed icons above
    // were drawn but never wired up (no reliable dataset covering all 123
    // cities); real ones we do know about go here as they come in one at a
    // time, city by city. Right now: West Kowloon, Hong Kong's terminus
    // for the cross-border high-speed rail link. Revealed a bit later than
    // airports (a rail icon sitting right next to its city's own airport
    // icon, or right on top of a metro station's own dot, reads as clutter
    // at the zoom level airports are happy to show at).
    const RAIL_MIN_ZOOM = 10;
    const railData = window.RAIL_STATIONS_GEOJSON;
    if (railData) {
      // A rail terminus that's really the same building as a metro station
      // (Hung Hom, or Shenzhen's Luohu/Shenzhen North/Futian) names that
      // station via linkedStation instead of carrying its own copy of the
      // coordinate — so if that station's position is ever refined (as
      // happened this round, moving Shenzhen North by several km), the
      // rail icon follows automatically instead of quietly drifting away
      // from the dot it's supposed to sit next to. geometry.coordinates is
      // still required (a station with no metro counterpart, like West
      // Kowloon, has nothing else to go on) and doubles as a fallback if
      // the named station isn't found.
      const metroByKey = {};
      (window.METRO_STATIONS_GEOJSON || { features: [] }).features.forEach((f) => {
        metroByKey[f.properties.city + "|" + f.properties.name] = f;
      });
      const railMarkers = railData.features.map((feature) => {
        const p = feature.properties || {};
        let lat, lng;
        const linked = p.linkedStation && metroByKey[p.city + "|" + p.linkedStation];
        if (linked) {
          [lng, lat] = linked.geometry.coordinates;
        } else {
          [lng, lat] = feature.geometry.coordinates;
        }
        const icon = TRANSPORT_ICONS[p.tier] || TRANSPORT_ICONS.rail;
        return L.marker([lat, lng], {
          icon: L.divIcon({
            className: "",
            html: `<span class="airport-marker">${icon}<span class="airport-code">${p.name || ""}</span></span>`,
            iconSize: null,
          }),
          interactive: false,
          keyboard: false,
        });
      });
      const updateRailVisibility = () => {
        const visible = mapInstance.getZoom() >= RAIL_MIN_ZOOM;
        railMarkers.forEach((m) => {
          const has = mapInstance.hasLayer(m);
          if (visible && !has) m.addTo(mapInstance);
          else if (!visible && has) mapInstance.removeLayer(m);
        });
      };
      mapInstance.on("zoomend", updateRailVisibility);
      mapInstance.whenReady(updateRailVisibility);
    }

    // Distance (meters, equirectangular) between two {lat,lng} points —
    // used below both to build an interchange's connector layout and to
    // decide, per connector, whether it reads as "same complex" or "a walk
    // between platforms".
    function metersBetween(a, b) {
      const R = 6371000;
      const lat1 = a.lat * Math.PI / 180, lat2 = b.lat * Math.PI / 180;
      const dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180;
      const x = dLng * Math.cos((lat1 + lat2) / 2), y = dLat;
      return Math.sqrt(x * x + y * y) * R;
    }

    // The minimum-spanning tree over an interchange's per-line points —
    // just enough connectors (line count minus one) to visually tie every
    // line's own dot into one cluster, without a dense pairwise mesh once
    // a station has 3+ lines (Admiralty has 4). Trivial sizes (<=4 points
    // per station here), so a plain O(n^2) Prim's is more than fast enough.
    function minimumSpanningTree(points) {
      const edges = [];
      if (points.length < 2) return edges;
      const inTree = [0];
      const remaining = points.map((_, i) => i).slice(1);
      while (remaining.length) {
        let best = null;
        inTree.forEach((i) => remaining.forEach((j) => {
          const d = metersBetween(points[i], points[j]);
          if (!best || d < best.d) best = { i, j, d };
        }));
        edges.push(best);
        inTree.push(best.j);
        remaining.splice(remaining.indexOf(best.j), 1);
      }
      return edges;
    }

    // Metro stations — real, named stops (only Hong Kong has this level of
    // detail right now; the lines above cover more cities but as paths
    // only, no individual stations). Shown a step deeper than the lines
    // themselves: at the city-wide view the dots alone would be a wall of
    // clutter, so only the lines show there, and the dots reveal once
    // you're actually zoomed into the network. Drawn as SVG circleMarkers
    // — the same renderer and reprojection the metro lines themselves use
    // — instead of a div icon, so a dot is guaranteed to land exactly on
    // its line rather than through a second, separately-rounded DOM
    // layer. Every station's dot is the same size, colored in its own
    // line's real color; an interchange isn't one bigger mark but one
    // same-size dot per real line that meets there (Admiralty: four),
    // wired together by a connector — solid black where two platforms
    // sit close enough to be the same complex, dotted gray where the
    // real distance between them (still real per-line track data, not a
    // guess) means an actual walk between platforms, the same distinction
    // a real transit map draws between an in-station and an above-ground
    // transfer. The name shows on hover only (like a region's name); at
    // 97 stations close together, a permanent label next to every dot
    // was more clutter than help.
    const metroStationsData = window.METRO_STATIONS_GEOJSON;
    const STATION_MIN_ZOOM = 12;
    const INTERCHANGE_LINK_SAME_COMPLEX_M = 100; // below this: solid "same complex" connector
    const INTERCHANGE_LINK_MAX_M = 800; // beyond this, don't draw a connector at all — the
    // interchange is still real (both dots are shown, correctly placed on their own lines),
    // but a line drawn between two points this far apart would read as a mapping error
    // rather than a transfer; this happens where the source position data for one of the
    // two lines is only an interpolated estimate, not the interchange itself being fake.
    if (metroStationsData) {
      // Its own pane, above the marker pane (which line-end badges and
      // airport icons use) — otherwise a badge sitting right at an
      // interchange's own point (Central, Admiralty…) paints over the
      // dots and connector beneath it, since SVG layers render below the
      // marker pane by default regardless of add order.
      if (!mapInstance.getPane("stationsPane")) {
        mapInstance.createPane("stationsPane").style.zIndex = 650;
      }
      const stationLayers = [];
      const stationLabelLayers = [];
      const LABEL_MIN_ZOOM = 14; // one step past the dots/badges — a permanent
      // name next to every one of 859 stations is real clutter at a wider
      // view, so it only shows once zoomed in close enough that nearby dots
      // have spread apart. One label per station (its own dot for a plain
      // stop, the interchange's shared point for a transfer — not one per
      // line, that would just repeat the same name next to itself).
      metroStationsData.features.forEach((feature) => {
        const p = feature.properties || {};
        const name = p.name || "";
        if (name) {
          const [labelLng, labelLat] = feature.geometry.coordinates;
          stationLabelLayers.push(L.marker([labelLat, labelLng], {
            pane: "stationsPane",
            icon: L.divIcon({
              className: "",
              html: `<span class="station-name-label">${name}</span>`,
              iconSize: null,
            }),
            interactive: false,
            keyboard: false,
          }));
        }
        if (p.interchange && p.linePoints && p.linePoints.length) {
          // Connectors first, so the dots painted after them sit visually
          // on top at each end, like a real transfer diagram.
          minimumSpanningTree(p.linePoints).forEach((edge) => {
            if (edge.d > INTERCHANGE_LINK_MAX_M) return; // still an interchange, just no line drawn
            const a = p.linePoints[edge.i], b = p.linePoints[edge.j];
            const sameComplex = edge.d < INTERCHANGE_LINK_SAME_COMPLEX_M;
            // Gray, not black — a black connector all but disappears
            // against the map's own black background.
            stationLayers.push(L.polyline([[a.lat, a.lng], [b.lat, b.lng]], {
              pane: "stationsPane",
              color: sameComplex ? "#ccc" : "#888",
              weight: sameComplex ? 4 : 2.5,
              opacity: sameComplex ? 0.9 : 0.85,
              lineCap: "round",
              dashArray: sameComplex ? null : "1,7",
              interactive: false,
            }));
          });
          p.linePoints.forEach((lp) => {
            const marker = L.circleMarker([lp.lat, lp.lng], {
              pane: "stationsPane",
              radius: 3,
              color: "rgba(0,0,0,.85)",
              weight: 1,
              fillColor: lp.color,
              fillOpacity: 1,
              interactive: true,
              keyboard: false,
            });
            marker.bindTooltip(`${name} · ${lp.line}`, { sticky: true, className: "map-tooltip" });
            stationLayers.push(marker);
          });
        } else {
          const [lng, lat] = feature.geometry.coordinates;
          const marker = L.circleMarker([lat, lng], {
            pane: "stationsPane",
            radius: 3,
            color: "rgba(0,0,0,.85)",
            weight: 1,
            fillColor: p.color || "#fff",
            fillOpacity: 1,
            interactive: true,
            keyboard: false,
          });
          if (name) {
            const label = name + (p.line ? ` · ${p.line}` : "") + (p.checkpoint ? " · пограничный переход" : "");
            marker.bindTooltip(label, { sticky: true, className: "map-tooltip" });
          }
          stationLayers.push(marker);
        }
      });
      const updateStationVisibility = () => {
        const zoom = mapInstance.getZoom();
        const visible = zoom >= STATION_MIN_ZOOM;
        stationLayers.forEach((m) => {
          const has = mapInstance.hasLayer(m);
          if (visible && !has) m.addTo(mapInstance);
          else if (!visible && has) mapInstance.removeLayer(m);
        });
        const labelsVisible = zoom >= LABEL_MIN_ZOOM;
        stationLabelLayers.forEach((m) => {
          const has = mapInstance.hasLayer(m);
          if (labelsVisible && !has) m.addTo(mapInstance);
          else if (!labelsVisible && has) mapInstance.removeLayer(m);
        });
      };
      mapInstance.on("zoomend", updateStationVisibility);
      mapInstance.whenReady(updateStationVisibility);
    }

    // Line-end name badges — a small colored tag at each line's own true
    // terminus (a station where that line's trains actually start/end,
    // not a junction another branch continues through — Sheung Shui and
    // Tiu Keng Leng are real interchanges but not termini, so they're
    // deliberately left out). Same reveal as the lines themselves.
    // Real terminus stations per line, city by city — only added where the
    // station data is precise enough to be sure which station is genuinely
    // a line's own end (not just a junction another branch continues
    // through, like Sheung Shui or Tiu Keng Leng). Shenzhen's termini come
    // from its own station list's explicit line + running order, not from
    // guessing at coordinates, so they're trustworthy the same way.
    const LINE_TERMINI = [
      { city: "Гонконг", line: "Island Line", color: "#0074C1", stations: ["Kennedy Town", "Chai Wan"] },
      { city: "Гонконг", line: "Tsuen Wan Line", color: "#E50011", stations: ["Central", "Tsuen Wan"] },
      { city: "Гонконг", line: "Kwun Tong Line", color: "#009F40", stations: ["Whampoa", "Tiu Keng Leng"] },
      { city: "Гонконг", line: "Tseung Kwan O Line", color: "#7D3C92", stations: ["North Point", "Po Lam", "LOHAS Park"] },
      { city: "Гонконг", line: "East Rail Line", color: "#5DB6E7", stations: ["Admiralty", "Lo Wu", "Lok Ma Chau"] },
      { city: "Гонконг", line: "Tuen Ma Line", color: "#9B2E00", stations: ["Wu Kai Sha", "Tuen Mun"] },
      { city: "Гонконг", line: "Airport Express", color: "#00878E", stations: ["Hong Kong", "AsiaWorld-Expo"] },
      { city: "Гонконг", line: "Tung Chung Line", color: "#F3982C", stations: ["Hong Kong", "Tung Chung"] },
      { city: "Гонконг", line: "Disneyland Resort Line", color: "#EB6DA5", stations: ["Sunny Bay", "Disneyland Resort"] },
      { city: "Гонконг", line: "South Island Line", color: "#CBD300", stations: ["Admiralty", "South Horizons"] },
      { city: "Макао", line: "Taipa Line", color: "#84C44A", stations: ["Barra", "Taipa Ferry Terminal"] },
      { city: "Макао", line: "Seac Pai Van Line", color: "#8A66C3", stations: ["Union Hospital", "Seac Pai Van"] },
      { city: "Макао", line: "Hengqin Line", color: "#BD283B", stations: ["Lotus", "Hengqin"] },
      { city: "Шэньчжэнь", line: "Line 1", color: "#00ab39", stations: ["Luohu", "Airport East"] },
      { city: "Шэньчжэнь", line: "Line 2", color: "#db6d1c", stations: ["Chiwan", "Liantang"] },
      { city: "Шэньчжэнь", line: "Line 3", color: "#00a2e1", stations: ["Futian Bonded Area", "Pingdi Liulian"] },
      { city: "Шэньчжэнь", line: "Line 4", color: "#dc241f", stations: ["Futian Checkpoint", "Niuhu"] },
      { city: "Шэньчжэнь", line: "Line 5", color: "#9950b2", stations: ["Chiwan", "Grand Theater"] },
      { city: "Шэньчжэнь", line: "Line 6", color: "#3abca8", stations: ["Science Museum", "Songgang"] },
      { city: "Шэньчжэнь", line: "Line 6 Branch", color: "#428d89", stations: ["SUAT", "Guangmingcheng"] },
      { city: "Шэньчжэнь", line: "Line 7", color: "#0035ad", stations: ["SZU Lihu Campus", "Wenti Park"] },
      { city: "Шэньчжэнь", line: "Line 8", color: "#db6d1c", stations: ["Liantang", "Xichong"] },
      { city: "Шэньчжэнь", line: "Line 9", color: "#846e74", stations: ["Qianwan", "Wenjin"] },
      { city: "Шэньчжэнь", line: "Line 10", color: "#f8779e", stations: ["Shuangyong Street", "Futian Checkpoint"] },
      { city: "Шэньчжэнь", line: "Line 11", color: "#6a1d44", stations: ["Bitou", "Hongling South"] },
      { city: "Шэньчжэнь", line: "Line 12", color: "#a192b2", stations: ["Zuopaotai East", "Songgang"] },
      { city: "Шэньчжэнь", line: "Line 13", color: "#de7c00", stations: ["Shenzhen Bay Checkpoint", "Lisonglang"] },
      { city: "Шэньчжэнь", line: "Line 14", color: "#f2c75c", stations: ["Gangxia North", "Shatian"] },
      { city: "Шэньчжэнь", line: "Line 16", color: "#1e22aa", stations: ["Yuanshan Xikeng", "Tianxin"] },
      { city: "Шэньчжэнь", line: "Line 20", color: "#88dbdf", stations: ["Convention & Exhibition City", "Airport North"] },
      // Dongguan: both lines now have a real OSM-derived path and a
      // confirmed official colour (Line 1's own route relation carries
      // colour #3190cb directly — no longer the earlier approximation).
      { city: "Дунгуань", line: "Line 1", color: "#3190cb", stations: ["Dongguanxi Railway Station", "Meitang"] },
      { city: "Дунгуань", line: "Line 2", color: "#FC0601", stations: ["Dongguan Railway Station", "Humen Railway Station"] },
      // Guangzhou + Foshan: termini found the same data-driven way as
      // Dongguan's stations round — take each line's own real merged path,
      // find the station nearest each of its two far ends. Line 11 is a
      // real loop (both "ends" resolve to the same station) and Lines 18/22
      // have real stations but no track geometry in the source at all —
      // neither gets a badge, same reasoning as everywhere else on this map.
      { city: "Гуанчжоу", line: "Line 1", color: "#F3D03E", stations: ["Guangzhou East Railway Station", "Xilang"] },
      { city: "Гуанчжоу", line: "Line 2", color: "#00629B", stations: ["Jiahewanggang", "Guangzhou South Railway Station"] },
      { city: "Гуанчжоу", line: "Line 3", color: "#ECA154", stations: ["Tianhe Coach Terminal", "Haibang"] },
      { city: "Гуанчжоу", line: "Line 3 North Extension", color: "#ECA154", stations: ["Tiyu Xilu", "Gaozeng"] },
      { city: "Гуанчжоу", line: "Line 4", color: "#00843D", stations: ["Nansha Passenger Port", "Huangcun"] },
      { city: "Гуанчжоу", line: "Line 5", color: "#C5003E", stations: ["Jiaokou", "Huangpu New Port"] },
      { city: "Гуанчжоу", line: "Line 6", color: "#80225F", stations: ["Xiangxue", "Xunfenggang"] },
      // Line 7's own western terminus (Meidi Dadao) sits far enough into
      // Foshan that it came in through that city's station file, not
      // Guangzhou's — split into two single-station entries so each looks
      // up its terminus under the right city.
      { city: "Гуанчжоу", line: "Line 7", color: "#97D700", stations: ["Yanshan"] },
      { city: "Фошань", line: "Line 7", color: "#97D700", stations: ["Meidi Dadao"] },
      { city: "Гуанчжоу", line: "Line 8", color: "#008C95", stations: ["Jiaoxin", "Wanshengwei"] },
      { city: "Гуанчжоу", line: "Line 9", color: "#71CC98", stations: ["Fei'eling", "Gaozeng"] },
      { city: "Гуанчжоу", line: "Line 10", color: "#7D9CC0", stations: ["Xilang", "Yangji East"] },
      { city: "Гуанчжоу", line: "Line 12", color: "#59621D", stations: ["Ersha Island", "Higher Education Mega Center South"] },
      { city: "Гуанчжоу", line: "Line 13", color: "#8E8C13", stations: ["Xinsha", "Tianhe Park"] },
      { city: "Гуанчжоу", line: "Line 14", color: "#81312F", stations: ["Lejia Road", "Dongfeng"] },
      { city: "Гуанчжоу", line: "Line 14 Branch (Knowledge City)", color: "#81312F", stations: ["Xinhe", "Zhenlong"] },
      { city: "Гуанчжоу", line: "Line 21", color: "#211747", stations: ["Zengcheng Square", "Tianhe Park"] },
      // Lines 18 and 22 were blocked for rounds — no track geometry at
      // all, then only a handful of stations. A dedicated OSM export
      // finally had both: real route relations for each (with an
      // official colour on the relation itself) and the full real
      // station roster, so both are now drawn like every other line.
      { city: "Гуанчжоу", line: "Line 18", color: "#0047BA", stations: ["Xiancun", "Wanqingsha"] },
      { city: "Гуанчжоу", line: "Line 22", color: "#CD5228", stations: ["Fangcun", "Panyu Square"] },
      // Same cross-city split for the Guangfo Line: Kuiqi Lu is in Foshan's
      // own station file even though the line itself is nominally Guangzhou's.
      { city: "Гуанчжоу", line: "Guangfo Line", color: "#C4D600", stations: ["Xilang"] },
      { city: "Фошань", line: "Guangfo Line", color: "#C4D600", stations: ["Kuiqi Lu"] },
      { city: "Фошань", line: "Foshan Line 2", color: "#f6112e", stations: ["Nanzhuang", "Guangzhou South Railway Station"] },
      { city: "Фошань", line: "Foshan Line 3", color: "#002da0", stations: ["Foshan University", "Shunde College Railway Station"] },
    ];
    const BADGE_MIN_ZOOM = 13; // only once meaningfully zoomed in — at the network overview these covered everything
    if (metroStationsData) {
      // Keyed by city+name, not name alone — a handful of station names
      // (e.g. "Airport") are real in more than one of these cities.
      const featureByKey = {};
      metroStationsData.features.forEach((f) => { featureByKey[f.properties.city + "|" + f.properties.name] = f; });
      // A terminus badge has to sit on the actual dot of the line it's
      // labelling — at an interchange, that's one of several dots (one per
      // line, per the same MST-connector grouping above), not the
      // interchange's own averaged/fallback point, which usually isn't the
      // real position of any single line and left badges floating next to
      // nothing. So the lookup takes the specific line name and, at an
      // interchange, resolves to that line's own linePoint.
      function terminusLatLng(city, name, lineName) {
        const f = featureByKey[city + "|" + name];
        if (!f) return null;
        if (f.properties.interchange) {
          const lp = f.properties.linePoints.find((p) => p.line === lineName);
          if (lp) return [lp.lat, lp.lng];
        }
        return [f.geometry.coordinates[1], f.geometry.coordinates[0]];
      }
      const linesByStation = {};
      LINE_TERMINI.forEach((line) => {
        line.stations.forEach((st) => {
          const key = line.city + "|" + st;
          (linesByStation[key] = linesByStation[key] || []).push({ name: line.line, color: line.color, city: line.city, station: st });
        });
      });
      const badgeMarkers = [];
      Object.keys(linesByStation).forEach((key) => {
        linesByStation[key].forEach((line, i) => {
          const latlng = terminusLatLng(line.city, line.station, line.name);
          if (!latlng) return;
          // Offset downward, not up-and-right like the station-name-label
          // right above the same dot (translate(6px,-8px) in styles.css) —
          // same direction on both would stack one right over the other,
          // exactly the badge-eats-label overlap this was fixed for.
          badgeMarkers.push(L.marker(latlng, {
            icon: L.divIcon({
              className: "",
              html: `<span class="line-end-badge" style="background:${line.color};transform:translate(10px,${8 + i * 15}px)">${line.name}</span>`,
              iconSize: null,
            }),
            interactive: false,
            keyboard: false,
          }));
        });
      });
      const updateBadgeVisibility = () => {
        const visible = mapInstance.getZoom() >= BADGE_MIN_ZOOM;
        badgeMarkers.forEach((m) => {
          const has = mapInstance.hasLayer(m);
          if (visible && !has) m.addTo(mapInstance);
          else if (!visible && has) mapInstance.removeLayer(m);
        });
      };
      mapInstance.on("zoomend", updateBadgeVisibility);
      mapInstance.whenReady(updateBadgeVisibility);
    }

    // Cities — a small dot (capitals get a ring around theirs) with the
    // name in white beside it. Each city only becomes eligible once
    // you've zoomed in enough for its size (bigger cities first), and
    // among the eligible ones a simple greedy layout skips whichever
    // would overlap an already-placed label, so labels never collide.
    const citiesData = window.CHINA_CITIES_GEOJSON;
    if (citiesData) {
      const AVG_CHAR_PX = { 1: 8.2, 2: 7.3, 3: 6.7, 4: 6.1 }; // approx text width per font-size tier
      const DOT_GAP = 11; // dot diameter + gap before the text

      const cities = citiesData.features.map((feature) => {
        const p = feature.properties || {};
        const [lng, lat] = feature.geometry.coordinates;
        const minZoom = cityMinZoom(p.population || 0);
        const tier = minZoom <= 2 ? 1 : minZoom <= 4 ? 2 : minZoom <= 5 ? 3 : 4;
        const name = p.name || "";
        const textWidth = name.length * AVG_CHAR_PX[tier];
        const height = tier === 1 ? 17 : tier === 2 ? 15 : 14;
        const capitalClass = p.capital ? " city-marker-capital" : "";

        const marker = L.marker([lat, lng], {
          icon: L.divIcon({
            className: "",
            html:
              `<span class="city-marker city-marker-t${tier}${capitalClass}">` +
              `<span class="city-dot${p.capital ? " city-dot-capital" : ""}"></span>` +
              `<span class="city-name city-name-t${tier}${p.capital ? " city-name-capital" : ""}">${name}</span>` +
              `</span>`,
            iconSize: null,
          }),
          interactive: true,
          keyboard: false,
        });
        marker.on("click", () => mapInstance.setView([lat, lng], Math.max(mapInstance.getZoom(), 7), { animate: true }));

        return { marker, minZoom, population: p.population || 0, latlng: [lat, lng], boxW: DOT_GAP + textWidth, boxH: height };
      });
      // Bigger cities get priority when two labels compete for the same space.
      cities.sort((a, b) => b.population - a.population);

      let pending = false;
      function layoutCities() {
        pending = false;
        const zoom = mapInstance.getZoom();
        const placed = [];
        cities.forEach((c) => {
          if (zoom < c.minZoom) {
            if (mapInstance.hasLayer(c.marker)) mapInstance.removeLayer(c.marker);
            return;
          }
          const pt = mapInstance.latLngToContainerPoint(c.latlng);
          const box = { left: pt.x - 5, top: pt.y - c.boxH / 2, right: pt.x + c.boxW, bottom: pt.y + c.boxH / 2 };
          const overlaps = placed.some(
            (b) => box.left < b.right + 3 && box.right > b.left - 3 && box.top < b.bottom + 2 && box.bottom > b.top - 2
          );
          if (overlaps) {
            if (mapInstance.hasLayer(c.marker)) mapInstance.removeLayer(c.marker);
            return;
          }
          placed.push(box);
          if (!mapInstance.hasLayer(c.marker)) c.marker.addTo(mapInstance);
        });
      }
      function scheduleLayout() {
        if (pending) return;
        pending = true;
        requestAnimationFrame(layoutCities);
      }
      mapInstance.on("zoomend moveend", scheduleLayout);
      mapInstance.whenReady(scheduleLayout);
    }

    if (bounds.isValid()) mapInstance.fitBounds(bounds, { padding: [12, 12] });
  }

  // ============================================================
  // A small custom calendar dropdown — replaces the native
  // <input type="date"> everywhere it showed up (its own popup can't be
  // styled and looks out of place next to the rest of the app).
  // ============================================================
  const RU_MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  const RU_MONTHS_NOM = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
  const RU_WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

  function isoDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  // Only one calendar popover should ever be open at a time.
  const openCalendars = [];
  function closeAllCalendars() {
    while (openCalendars.length) openCalendars.pop()();
  }
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".flights-calendar") && !e.target.closest(".flights-date-btn")) closeAllCalendars();
  });

  function createDatePicker({ fieldEl, buttonEl, hiddenInput, minDate, initialDate }) {
    let selected = initialDate;
    let viewYear = selected.getFullYear();
    let viewMonth = selected.getMonth();

    const calendar = document.createElement("div");
    calendar.className = "flights-calendar";
    calendar.hidden = true;
    calendar.innerHTML =
      '<div class="flights-calendar-head">' +
      '<button type="button" class="flights-calendar-nav" data-dir="-1" aria-label="Предыдущий месяц">‹</button>' +
      '<span class="flights-calendar-month"></span>' +
      '<button type="button" class="flights-calendar-nav" data-dir="1" aria-label="Следующий месяц">›</button>' +
      "</div>" +
      '<div class="flights-calendar-weekdays">' + RU_WEEKDAYS.map((d) => `<span>${d}</span>`).join("") + "</div>" +
      '<div class="flights-calendar-days"></div>';
    fieldEl.appendChild(calendar);

    const monthEl = calendar.querySelector(".flights-calendar-month");
    const daysEl = calendar.querySelector(".flights-calendar-days");
    const prevBtn = calendar.querySelector('[data-dir="-1"]');
    const nextBtn = calendar.querySelector('[data-dir="1"]');

    function updateButtonLabel() {
      buttonEl.textContent = `${selected.getDate()} ${RU_MONTHS_GEN[selected.getMonth()]}`;
    }

    function render() {
      monthEl.textContent = `${RU_MONTHS_NOM[viewMonth]} ${viewYear}`;
      const firstOfMonth = new Date(viewYear, viewMonth, 1);
      const startOffset = (firstOfMonth.getDay() + 6) % 7; // grid starts Monday
      const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
      const gridStart = new Date(viewYear, viewMonth, 1 - startOffset);
      daysEl.innerHTML = "";
      const cellsNeeded = Math.ceil((startOffset + daysInMonth) / 7) * 7;
      for (let i = 0; i < cellsNeeded; i++) {
        const d = new Date(gridStart);
        d.setDate(gridStart.getDate() + i);
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "flights-calendar-day";
        btn.textContent = String(d.getDate());
        if (d.getMonth() !== viewMonth) btn.classList.add("is-outside");
        if (d.toDateString() === selected.toDateString()) btn.classList.add("is-selected");
        if (d.toDateString() === new Date().toDateString()) btn.classList.add("is-today");
        if (minDate && d < minDate) btn.disabled = true;
        btn.addEventListener("click", () => {
          selected = d;
          hiddenInput.value = isoDate(d);
          updateButtonLabel();
          close();
        });
        daysEl.appendChild(btn);
      }
      prevBtn.disabled = Boolean(minDate && viewYear === minDate.getFullYear() && viewMonth === minDate.getMonth());
    }

    function open() {
      closeAllCalendars();
      viewYear = selected.getFullYear();
      viewMonth = selected.getMonth();
      render();
      calendar.hidden = false;
      buttonEl.setAttribute("aria-expanded", "true");
      openCalendars.push(close);
    }
    function close() {
      calendar.hidden = true;
      buttonEl.setAttribute("aria-expanded", "false");
    }

    buttonEl.setAttribute("aria-haspopup", "true");
    buttonEl.setAttribute("aria-expanded", "false");
    buttonEl.addEventListener("click", (e) => {
      e.stopPropagation();
      calendar.hidden ? open() : close();
    });
    prevBtn.addEventListener("click", () => {
      viewMonth -= 1;
      if (viewMonth < 0) { viewMonth = 11; viewYear -= 1; }
      render();
    });
    nextBtn.addEventListener("click", () => {
      viewMonth += 1;
      if (viewMonth > 11) { viewMonth = 0; viewYear += 1; }
      render();
    });

    hiddenInput.value = isoDate(selected);
    updateButtonLabel();

    return {
      setDate(d) { selected = d; hiddenInput.value = isoDate(d); updateButtonLabel(); },
      getDate() { return selected; },
    };
  }

  // A typed city field's own suggestion panel — no native <datalist> arrow,
  // and it only appears once there's something worth narrowing down (2+
  // letters), matching anywhere in the city name, not just the start.
  function createCitySuggest({ inputEl, cityList }) {
    const fieldEl = inputEl.closest(".flights-field");
    const panel = document.createElement("div");
    panel.className = "flights-city-suggest";
    panel.hidden = true;
    fieldEl.appendChild(panel);

    let items = [];
    let activeIndex = -1;

    function pick(city) {
      inputEl.value = city.name;
      inputEl.dispatchEvent(new Event("input", { bubbles: true }));
      close();
    }
    function renderItems(matches) {
      items = matches;
      activeIndex = 0;
      panel.innerHTML = "";
      matches.forEach((c, i) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "flights-city-suggest-item" + (i === 0 ? " is-active" : "");
        item.innerHTML = `<span class="flights-city-suggest-name">${c.name}</span><span class="flights-city-suggest-code">${c.code}</span>`;
        item.addEventListener("mousedown", (e) => { e.preventDefault(); pick(c); });
        panel.appendChild(item);
      });
    }
    function setActive(i) {
      activeIndex = i;
      panel.querySelectorAll(".flights-city-suggest-item").forEach((el, idx) => el.classList.toggle("is-active", idx === activeIndex));
    }
    function open() { panel.hidden = false; }
    function close() { panel.hidden = true; }

    inputEl.addEventListener("input", () => {
      const q = inputEl.value.trim().toLowerCase();
      if (q.length < 2) { close(); return; }
      const matches = cityList.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 8);
      if (!matches.length) { close(); return; }
      renderItems(matches);
      open();
    });
    inputEl.addEventListener("keydown", (e) => {
      if (panel.hidden) return;
      if (e.key === "ArrowDown") { e.preventDefault(); setActive(Math.min(activeIndex + 1, items.length - 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setActive(Math.max(activeIndex - 1, 0)); }
      else if (e.key === "Enter") { if (activeIndex >= 0) { e.preventDefault(); pick(items[activeIndex]); } }
      else if (e.key === "Escape") { close(); }
    });
    document.addEventListener("click", (e) => {
      if (e.target !== inputEl && !e.target.closest(".flights-city-suggest")) close();
    });
  }

  // ============================================================
  // Flight search — one step of the eventual booking flow. Demo only
  // (no real fares/schedules anywhere to fetch): search generates a
  // handful of plausible flights between two of our airport cities for
  // the chosen date, deterministically from the route+date so the same
  // search always returns the same options. Picking one draws a line
  // between the two airports on the map, in the same style as the rest
  // of the map (sakura accent, a small plane on the route).
  // ============================================================
  function initFlightSearch() {
    const searchView = document.getElementById("ticketsSearchView");
    const resultsView = document.getElementById("ticketsResultsView");
    const backBtn = document.getElementById("ticketsBackBtn");
    const routeSummaryEl = document.getElementById("ticketsRouteSummary");
    const routeCardEl = document.getElementById("ticketsRouteCard");
    const outboundLabelEl = document.getElementById("ticketsOutboundLabel");
    const returnRouteSummaryEl = document.getElementById("ticketsReturnRouteSummary");
    const returnRouteCardEl = document.getElementById("ticketsReturnRouteCard");
    const returnLabelEl = document.getElementById("ticketsReturnLabel");
    const flightsForm = document.getElementById("flightsForm");
    const flightsFrom = document.getElementById("flightsFrom");
    const flightsTo = document.getElementById("flightsTo");
    const flightsDate = document.getElementById("flightsDate");
    const flightsDirect = document.getElementById("flightsDirect");
    const flightsResults = document.getElementById("flightsResults");
    const flightsReturnResults = document.getElementById("flightsReturnResults");
    const flightsSelected = document.getElementById("flightsSelected");
    const flightsSelectedList = document.getElementById("flightsSelectedList");

    const airportsData = window.CHINA_AIRPORTS_GEOJSON;
    if (!flightsForm || !airportsData) return;

    // One entry per city (a city can have more than one nearby airport in
    // the source data — first one wins, good enough for a demo).
    const citiesByName = {};
    airportsData.features.forEach((f) => {
      const p = f.properties;
      if (!citiesByName[p.city]) {
        citiesByName[p.city] = { name: p.city, code: p.code, latlng: [f.geometry.coordinates[1], f.geometry.coordinates[0]] };
      }
    });
    const cityList = Object.values(citiesByName).sort((a, b) => a.name.localeCompare(b.name, "ru"));
    const cityByLowerName = {};
    cityList.forEach((c) => { cityByLowerName[c.name.toLowerCase()] = c; });

    function resolveCity(input) {
      return cityByLowerName[input.value.trim().toLowerCase()];
    }
    function markCityError(input) { input.closest(".flights-field").classList.add("has-error"); }
    function clearCityError(input) { input.closest(".flights-field").classList.remove("has-error"); }
    [flightsFrom, flightsTo].forEach((el) => el.addEventListener("input", () => clearCityError(el)));

    // From/To are typed, not picked from a native dropdown — our own
    // suggestion panel, styled like the rest of the app, only appears
    // once 2+ letters are typed (a native <datalist> always shows its own
    // unstyleable arrow and full list, which is exactly what this replaces).
    [flightsFrom, flightsTo].forEach((input) => createCitySuggest({ inputEl: input, cityList }));

    flightsFrom.value = "Пекин";
    flightsTo.value = "Шанхай";

    const today = new Date(new Date().toDateString()); // today at local midnight
    const defaultDate = new Date(today);
    defaultDate.setDate(defaultDate.getDate() + 14);
    const returnDateDefault = new Date(defaultDate);
    returnDateDefault.setDate(returnDateDefault.getDate() + 7);

    const flightsReturnDate = document.getElementById("flightsReturnDate");
    const datePicker = createDatePicker({
      fieldEl: document.getElementById("flightsDateField"),
      buttonEl: document.getElementById("flightsDateBtn"),
      hiddenInput: flightsDate,
      minDate: today,
      initialDate: defaultDate,
    });
    const returnDatePicker = createDatePicker({
      fieldEl: document.getElementById("flightsReturnDateField"),
      buttonEl: document.getElementById("flightsReturnDateBtn"),
      hiddenInput: flightsReturnDate,
      minDate: today,
      initialDate: returnDateDefault,
    });

    // Trip type: only "one-way" actually searches today; "round-trip"
    // reveals a real return-date field and searches both legs;
    // "multi-city" is a stub (disables search) rather than faking a flow
    // that doesn't exist yet.
    const returnDateRow = document.getElementById("flightsReturnDateRow");
    const multicityNote = document.getElementById("flightsMulticityNote");
    const flightsSearchBtn = flightsForm.querySelector(".flights-search-btn");
    function currentTripType() {
      return flightsForm.querySelector('input[name="flightsTripType"]:checked').value;
    }
    function updateTripTypeUI() {
      const tripType = currentTripType();
      returnDateRow.hidden = tripType !== "roundtrip";
      flightsReturnDate.required = tripType === "roundtrip";
      multicityNote.hidden = tripType !== "multicity";
      flightsSearchBtn.disabled = tripType === "multicity";
    }
    flightsForm.querySelectorAll('input[name="flightsTripType"]').forEach((r) => r.addEventListener("change", updateTripTypeUI));
    updateTripTypeUI();

    // Passengers/class — a compact summary button opening a small popover,
    // same "opens upward" idea as the taskbar tray menus.
    const paxBtn = document.getElementById("flightsPaxBtn");
    const paxPanel = document.getElementById("flightsPaxPanel");
    const paxLabel = document.getElementById("flightsPaxLabel");
    const paxCountEl = document.getElementById("flightsPaxCount");
    const paxMinus = document.getElementById("flightsPaxMinus");
    const paxPlus = document.getElementById("flightsPaxPlus");
    const paxClassBtns = document.querySelectorAll(".flights-pax-class-btn");
    const paxState = { adults: 1, cls: "economy" };

    function pluralAdults(n) {
      const mod10 = n % 10, mod100 = n % 100;
      if (mod10 === 1 && mod100 !== 11) return "взрослый";
      if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return "взрослых";
      return "взрослых";
    }
    function updatePaxLabel() {
      paxLabel.textContent = `${paxState.adults} ${pluralAdults(paxState.adults)} · ${paxState.cls === "business" ? "Бизнес" : "Эконом"}`;
      paxMinus.disabled = paxState.adults <= 1;
      paxPlus.disabled = paxState.adults >= 9;
      paxCountEl.textContent = paxState.adults;
    }
    updatePaxLabel();

    function setPaxPanelOpen(open) {
      paxPanel.hidden = !open;
      paxBtn.setAttribute("aria-expanded", String(open));
    }
    paxBtn.addEventListener("click", () => setPaxPanelOpen(paxPanel.hidden));
    document.addEventListener("click", (e) => {
      if (!paxPanel.hidden && !e.target.closest(".flights-pax-wrap")) setPaxPanelOpen(false);
    });
    paxMinus.addEventListener("click", () => { if (paxState.adults > 1) { paxState.adults--; updatePaxLabel(); } });
    paxPlus.addEventListener("click", () => { if (paxState.adults < 9) { paxState.adults++; updatePaxLabel(); } });
    paxClassBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        paxState.cls = btn.dataset.cls;
        paxClassBtns.forEach((b) => b.classList.toggle("is-active", b === btn));
        updatePaxLabel();
      });
    });

    // Small seeded RNG so identical searches (same route + date) always
    // return the same "flights" instead of reshuffling every time.
    function seededRandom(seed) {
      let h = 0;
      for (let i = 0; i < seed.length; i++) h = (Math.imul(h, 31) + seed.charCodeAt(i)) | 0;
      return function next() {
        h = (Math.imul(h, 1103515245) + 12345) | 0;
        return ((h >>> 1) % 10000) / 10000;
      };
    }

    function haversineKm([lat1, lng1], [lat2, lng2]) {
      const R = 6371;
      const dLat = ((lat2 - lat1) * Math.PI) / 180;
      const dLng = ((lng2 - lng1) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    const AIRLINES = [
      { name: "China Southern", color: "#1b6ec2" },
      { name: "Air China", color: "#c0392b" },
      { name: "China Eastern", color: "#2d9c5a" },
      { name: "Hainan Airlines", color: "#d4a017" },
      { name: "Shenzhen Airlines", color: "#8e44ad" },
      { name: "Xiamen Airlines", color: "#16a085" },
    ];
    const AIRCRAFT_TYPES = ["A320", "A321", "A330", "A350", "B737", "B777", "B787", "ARJ21"];
    // Amenities follow from the aircraft actually assigned to the flight
    // (wide-bodies get the full set) rather than being sprinkled on at random.
    const AMENITIES_BY_AIRCRAFT = {
      A320: ["meal"],
      A321: ["meal", "wifi"],
      A330: ["wifi", "meal", "entertainment"],
      A350: ["wifi", "meal", "entertainment"],
      B737: ["meal", "wifi"],
      B777: ["wifi", "meal", "entertainment"],
      B787: ["wifi", "meal", "entertainment"],
      ARJ21: ["meal"],
    };
    const AMENITY_ICONS = {
      wifi:
        '<svg viewBox="0 0 24 24" fill="none" aria-label="Wi-Fi"><path d="M2 8.8a15 15 0 0 1 20 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M5.5 12.6a10 10 0 0 1 13 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M9 16.2a5 5 0 0 1 6 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="19.6" r="1.1" fill="currentColor"/></svg>',
      meal:
        '<svg viewBox="0 0 24 24" fill="none" aria-label="Питание"><path d="M6 2v7M8 2v7M6 9v12M8 9a2 2 0 0 1-2 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M17 2c-1.7 0-3 2-3 5s1.3 5 3 5v9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      entertainment:
        '<svg viewBox="0 0 24 24" fill="none" aria-label="Развлечения"><rect x="3" y="4" width="18" height="12" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M10 8l5 4-5 4Z" fill="currentColor"/><path d="M8 20h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    };
    function renderAmenities(aircraft) {
      return (AMENITIES_BY_AIRCRAFT[aircraft] || []).map((k) => AMENITY_ICONS[k]).join("");
    }

    function generateFlights(from, to, dateStr) {
      const distanceKm = haversineKm(from.latlng, to.latlng);
      const rand = seededRandom(`${from.name}-${to.name}-${dateStr}`);
      const count = 3 + Math.floor(rand() * 3); // 3–5 options
      const classMultiplier = paxState.cls === "business" ? 2.6 : 1;
      // Layovers route through one of our own airport cities — real places
      // in our own dataset, not invented foreign ones.
      const otherCities = cityList.filter((c) => c.name !== from.name && c.name !== to.name);
      const flights = [];
      for (let i = 0; i < count; i++) {
        const flyingMin = Math.round((distanceKm / 800) * 60 + 40 + rand() * 30);
        const stopRoll = rand();
        const stops = stopRoll > 0.92 ? 2 : stopRoll > 0.7 ? 1 : 0; // mostly direct
        const stopCities = [];
        let layoverMin = 0;
        for (let s = 0; s < stops && otherCities.length; s++) {
          let candidate;
          let guard = 0;
          do { candidate = otherCities[Math.floor(rand() * otherCities.length)]; guard++; } while (stopCities.includes(candidate) && guard < 20);
          stopCities.push(candidate);
        }
        if (stops) layoverMin = Math.round(45 + rand() * 150);
        const durationMin = stops ? flyingMin + layoverMin * stops + Math.round(rand() * 40 * stops) : flyingMin;
        const depHour = 6 + Math.floor(rand() * 16);
        const depMin = Math.floor(rand() * 12) * 5;
        const depDate = new Date(`${dateStr}T00:00:00`);
        depDate.setHours(depHour, depMin);
        const arrDate = new Date(depDate.getTime() + durationMin * 60000);
        const price = Math.round(((1800 + distanceKm * 4.2 + rand() * 3000 + stops * 900) * classMultiplier) / 50) * 50;
        const airline = AIRLINES[Math.floor(rand() * AIRLINES.length)];
        const aircraft = AIRCRAFT_TYPES[Math.floor(rand() * AIRCRAFT_TYPES.length)];
        flights.push({
          id: `${from.code}-${to.code}-${dateStr}-${i}`,
          airline: airline.name,
          airlineColor: airline.color,
          aircraft,
          dep: depDate,
          arr: arrDate,
          durationMin,
          price,
          stops,
          stopCities,
          layoverMin,
          from,
          to,
        });
      }
      flights.sort((a, b) => a.dep - b.dep);
      return flights;
    }

    // Calendar-day gap between departure and arrival — a long haul or a
    // layover can genuinely land the next day (or later).
    function dayOffset(dep, arr) {
      const depMidnight = new Date(dep.getFullYear(), dep.getMonth(), dep.getDate());
      const arrMidnight = new Date(arr.getFullYear(), arr.getMonth(), arr.getDate());
      return Math.round((arrMidnight - depMidnight) / 86400000);
    }

    // "0 stops" / "1 stop, with its layover time and city" / "2 stops,
    // just the cities" — mirrors how a real fare listing scales the detail
    // down once there's more than one connection to describe.
    function stopsLabel(f) {
      if (!f.stops) return "Прямой";
      if (f.stops === 1) return `${fmtDuration(f.layoverMin)} · ${f.stopCities[0].name}`;
      return `${f.stops} пересадки · ${f.stopCities.map((c) => c.name).join(", ")}`;
    }
    // A plain line for a direct flight; a dot per stop breaking it into
    // segments otherwise, so the number of connections reads at a glance.
    function renderPathLine(stops) {
      if (!stops) return `<span class="ticket-path-line"></span>`;
      let html = "";
      for (let i = 0; i <= stops; i++) {
        html += `<span class="ticket-path-line"></span>`;
        if (i < stops) html += `<span class="ticket-path-dot"></span>`;
      }
      return `<div class="ticket-path-line-wrap">${html}</div>`;
    }

    function fmtTime(d) {
      return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    }
    function fmtDuration(min) {
      const h = Math.floor(min / 60);
      const m = min % 60;
      return `${h} ч ${m ? m + " мин" : ""}`.trim();
    }
    function fmtDate(dateStr) {
      return new Date(`${dateStr}T00:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
    }
    const DASH = '<span class="route-dash"></span>';
    const PLANE_SVG =
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M21,15.5V13.5L13,8.5V3.5C13,2.67 12.33,2 11.5,2C10.67,2 10,2.67 10,3.5V8.5L2,13.5V15.5L10,13V18.5L7.5,20V21.5L11.5,20.5L15.5,21.5V20L13,18.5V13L21,15.5Z" style="transform-origin:center;transform:rotate(90deg)"/></svg>';

    // Flights currently drawn on the map: id -> { line, plane, chip }
    const activeFlights = {};

    function addFlightToMap(flight) {
      if (activeFlights[flight.id] || !mapInstance) return;
      const line = L.polyline([flight.from.latlng, flight.to.latlng], {
        pane: "transitPane",
        color: SAKURA,
        weight: 2.4,
        opacity: 0.9,
        dashArray: flight.stops ? "1,6" : null,
        lineCap: "round",
      }).addTo(mapInstance);

      const mid = [(flight.from.latlng[0] + flight.to.latlng[0]) / 2, (flight.from.latlng[1] + flight.to.latlng[1]) / 2];
      const angle = (Math.atan2(flight.to.latlng[1] - flight.from.latlng[1], flight.to.latlng[0] - flight.from.latlng[0]) * 180) / Math.PI;
      const plane = L.marker(mid, {
        icon: L.divIcon({
          className: "",
          html: `<span class="flight-map-plane" style="display:inline-flex;transform:rotate(${angle - 90}deg)">${TRANSPORT_ICONS.airport}</span>`,
          iconSize: null,
        }),
        interactive: false,
        keyboard: false,
      }).addTo(mapInstance);

      const chip = document.createElement("div");
      chip.className = "flights-selected-chip";
      chip.innerHTML =
        `<span>${flight.from.name} → ${flight.to.name}<br><span style="color:var(--text-faint)">${fmtTime(flight.dep)}, ${flight.airline}</span></span>` +
        `<button type="button" class="flights-selected-remove" aria-label="Убрать с карты">` +
        `<svg viewBox="0 0 24 24" width="13" height="13" fill="none"><path d="M6 6L18 18M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>` +
        `</button>`;
      chip.querySelector(".flights-selected-remove").addEventListener("click", () => removeFlightFromMap(flight.id));
      flightsSelectedList.appendChild(chip);

      activeFlights[flight.id] = { line, plane, chip };
      flightsSelected.hidden = false;

      const btn = findResultButton(flight.id);
      if (btn) { btn.innerHTML = "Добавлено"; btn.classList.add("is-added"); }
    }

    function findResultButton(id) {
      return flightsResults.querySelector(`[data-flight-id="${id}"]`) || flightsReturnResults.querySelector(`[data-flight-id="${id}"]`);
    }

    function removeFlightFromMap(id) {
      const entry = activeFlights[id];
      if (!entry) return;
      mapInstance.removeLayer(entry.line);
      mapInstance.removeLayer(entry.plane);
      entry.chip.remove();
      delete activeFlights[id];
      flightsSelected.hidden = flightsSelectedList.children.length === 0;

      const btn = findResultButton(id);
      if (btn) { btn.innerHTML = ADD_BTN_LABEL; btn.classList.remove("is-added"); }
    }

    const ADD_BTN_LABEL =
      'Добавить<svg viewBox="0 0 24 24" width="12" height="12" fill="none"><path d="M9 5l7 7-7 7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    // Renders one leg (outbound or return) into its own route-card header
    // and its own list of ticket cards, so a round trip shows two
    // independently-scored (own cheapest/fastest) result sets.
    function renderLeg(flights, from, to, dateStr, { cardsEl, summaryEl, cardEl }) {
      summaryEl.innerHTML =
        `<div class="tickets-route-endpoint"><span class="tickets-route-code">${from.code}</span><span class="tickets-route-city">${from.name}</span></div>` +
        `<div class="tickets-route-path">${DASH}${PLANE_SVG}${DASH}</div>` +
        `<div class="tickets-route-endpoint right"><span class="tickets-route-code">${to.code}</span><span class="tickets-route-city">${to.name}</span></div>`;
      let dateEl = cardEl.querySelector(".tickets-route-date");
      if (!dateEl) {
        dateEl = document.createElement("p");
        dateEl.className = "tickets-route-date";
        cardEl.appendChild(dateEl);
      }
      dateEl.textContent = fmtDate(dateStr);

      cardsEl.innerHTML = "";
      if (!flights.length) {
        cardsEl.innerHTML = `<p class="flights-empty">Рейсы не найдены — попробуйте другую дату${flightsDirect.checked ? " или снимите фильтр «Прямые рейсы»" : ""}.</p>`;
        return;
      }
      // Badges are earned, not decorative: the actual cheapest and actual
      // fastest option in this result set, not a fixed "recommended" pick.
      const cheapestId = flights.reduce((a, b) => (b.price < a.price ? b : a)).id;
      const fastestId = flights.reduce((a, b) => (b.durationMin < a.durationMin ? b : a)).id;

      flights.forEach((f) => {
        const card = document.createElement("div");
        const isCheapest = f.id === cheapestId;
        const isFastest = f.id === fastestId;
        card.className = "ticket-card" + (isCheapest ? " is-best" : "");
        const isAdded = Boolean(activeFlights[f.id]);
        const initial = f.airline.charAt(0);
        const badges =
          (isCheapest ? '<span class="ticket-badge">Лучшая цена</span>' : "") +
          (isFastest ? '<span class="ticket-badge ticket-badge-outline">Быстрее всего</span>' : "");
        card.innerHTML =
          (badges ? `<div class="ticket-badges">${badges}</div>` : "") +
          `<div class="ticket-top">` +
          `<div class="ticket-airline-col">` +
          `<span class="ticket-airline-logo" style="background:${f.airlineColor}">${initial}</span>` +
          `<div class="ticket-airline-info">` +
          `<div class="ticket-airline-name">${f.airline}</div>` +
          `<div class="ticket-airline-sub">${f.aircraft}</div>` +
          `</div></div>` +
          `<div class="ticket-price">${f.price.toLocaleString("ru-RU")} ₽<span>/pax</span></div>` +
          `</div>` +
          `<div class="ticket-route">` +
          `<div class="ticket-time-block"><span class="ticket-time">${fmtTime(f.dep)}</span><span class="ticket-code">${f.from.code}</span></div>` +
          `<div class="ticket-path-block">` +
          `<span class="ticket-duration">${fmtDuration(f.durationMin)}</span>` +
          renderPathLine(f.stops) +
          `<span class="ticket-stops">${stopsLabel(f)}</span>` +
          `</div>` +
          `<div class="ticket-time-block right"><span class="ticket-time">${fmtTime(f.arr)}${dayOffset(f.dep, f.arr) > 0 ? `<sup class="ticket-day-offset">+${dayOffset(f.dep, f.arr)}</sup>` : ""}</span><span class="ticket-code">${f.to.code}</span></div>` +
          `</div>` +
          `<div class="ticket-bottom">` +
          `<div class="ticket-amenities">${renderAmenities(f.aircraft)}</div>` +
          `<button type="button" class="ticket-add-btn${isAdded ? " is-added" : ""}" data-flight-id="${f.id}">${isAdded ? "Добавлено" : ADD_BTN_LABEL}</button>` +
          `</div>`;
        card.querySelector(".ticket-add-btn").addEventListener("click", () => addFlightToMap(f));
        cardsEl.appendChild(card);
      });
    }

    const swapBtn = document.getElementById("flightsSwapBtn");
    swapBtn.addEventListener("click", () => {
      const a = flightsFrom.value;
      flightsFrom.value = flightsTo.value;
      flightsTo.value = a;
    });

    flightsForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const tripType = currentTripType();
      if (tripType === "multicity") return;

      const from = resolveCity(flightsFrom);
      const to = resolveCity(flightsTo);
      clearCityError(flightsFrom);
      clearCityError(flightsTo);
      let hasError = false;
      if (!from) { markCityError(flightsFrom); hasError = true; }
      if (!to) { markCityError(flightsTo); hasError = true; }
      if (!hasError && from.name === to.name) { markCityError(flightsTo); hasError = true; }
      if (hasError || !flightsDate.value) return;

      const directOnly = flightsDirect.checked;
      const filterDirect = (flights) => (directOnly ? flights.filter((f) => !f.stops) : flights);

      renderLeg(filterDirect(generateFlights(from, to, flightsDate.value)), from, to, flightsDate.value, {
        cardsEl: flightsResults,
        summaryEl: routeSummaryEl,
        cardEl: routeCardEl,
      });

      const isRoundTrip = tripType === "roundtrip" && Boolean(flightsReturnDate.value);
      outboundLabelEl.hidden = !isRoundTrip;
      returnLabelEl.hidden = !isRoundTrip;
      returnRouteCardEl.hidden = !isRoundTrip;
      flightsReturnResults.hidden = !isRoundTrip;
      if (isRoundTrip) {
        renderLeg(filterDirect(generateFlights(to, from, flightsReturnDate.value)), to, from, flightsReturnDate.value, {
          cardsEl: flightsReturnResults,
          summaryEl: returnRouteSummaryEl,
          cardEl: returnRouteCardEl,
        });
      }

      searchView.hidden = true;
      resultsView.hidden = false;
    });

    backBtn.addEventListener("click", () => {
      resultsView.hidden = true;
      searchView.hidden = false;
    });
  }

  // Demo AI chat: the input panel feeds the chat panel above it.
  const aiInputForm = document.getElementById("aiInputForm");
  const aiInputField = document.getElementById("aiInputField");
  const chatMessages = document.getElementById("chatMessages");

  function appendMessage(text, from) {
    const bubble = document.createElement("div");
    bubble.className = "chat-msg " + (from === "user" ? "chat-msg-user" : "chat-msg-bot");
    bubble.textContent = text;
    chatMessages.appendChild(bubble);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  const DEMO_REPLIES = [
    "Пока это демо-ответ — настоящая нейросеть подключится позже.",
    "Записал! Когда появится маршрут, буду учитывать это в ответах.",
    "Хорошая мысль. Добавьте это в «Текущий маршрут», когда он появится.",
  ];

  aiInputForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = aiInputField.value.trim();
    if (!text) return;
    appendMessage(text, "user");
    aiInputField.value = "";
    const reply = DEMO_REPLIES[Math.floor(Math.random() * DEMO_REPLIES.length)];
    setTimeout(() => appendMessage(reply, "bot"), 400);
  });
})();
