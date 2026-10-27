// =====================================================
// ReelTime — call-minimize.js
// Load LAST in index.html (after love-hearts.js):
//   <script src="call-minimize.js"></script>
// - Adds a "Minimize" button to the call screen.
// - Minimizing shrinks the call into a small floating window
//   (like Snapchat). The call keeps running and you can use the chat.
// - Drag the small window anywhere; it snaps to the left/right edge.
// - Tap the small window to open the full call again.
// - The phone's Back button minimizes the call instead of leaving it.
// - The call only stops when you press the red End button.
// It only changes CSS classes, so your call code is not touched.
// =====================================================

(function callMinimize() {
  const MINIMIZE_ON_BACK_BUTTON = true;
  const EDGE = 12;

  let pushed = false;

  const getOverlay = () => document.querySelector(".call-overlay");
  const isOpen = (overlay) => overlay && !overlay.classList.contains("hidden");

  function minimize(overlay) {
    if (!isOpen(overlay) || overlay.classList.contains("incoming")) return;
    overlay.classList.add("mini");
  }

  function restore(overlay) {
    overlay.classList.remove("mini");
    overlay.style.inset = "";
    overlay.style.transition = "";
  }

  function addButton(overlay) {
    const stage = overlay.querySelector(".call-stage");

    if (!stage || stage.querySelector(".call-min-btn")) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "call-min-btn";
    button.dataset.act = "mini";
    button.setAttribute("aria-label", "Minimize call");
    button.innerHTML = '<span aria-hidden="true">⌄</span> Minimize';
    stage.appendChild(button);
  }

  // ----- Minimize button (runs before the call code's own click handlers) -----

  document.addEventListener(
    "click",
    (event) => {
      const button = event.target.closest?.(".call-min-btn");

      if (!button) return;

      event.stopImmediatePropagation();
      event.preventDefault();

      const overlay = button.closest(".call-overlay");
      if (overlay) minimize(overlay);
    },
    true
  );

  // ----- Drag the small window, tap to open it again -----

  function enableDrag(overlay) {
    if (overlay.dataset.miniDrag) return;
    overlay.dataset.miniDrag = "1";

    const stage = overlay.querySelector(".call-stage");

    if (!stage) return;

    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    let dragging = false;
    let down = false;

    stage.addEventListener("pointerdown", (event) => {
      if (!overlay.classList.contains("mini")) return;
      if (event.target.closest(".call-end, .call-btn")) return; // End button works normally

      const box = stage.getBoundingClientRect();

      down = true;
      dragging = false;
      startX = event.clientX;
      startY = event.clientY;
      startLeft = box.left;
      startTop = box.top;
      overlay.style.transition = "";
      stage.setPointerCapture?.(event.pointerId);
    });

    stage.addEventListener("pointermove", (event) => {
      if (!down || !overlay.classList.contains("mini")) return;

      const dx = event.clientX - startX;
      const dy = event.clientY - startY;

      if (!dragging && Math.hypot(dx, dy) < 6) return;

      dragging = true;

      const width = stage.offsetWidth;
      const height = stage.offsetHeight;
      const left = Math.min(Math.max(startLeft + dx, 4), window.innerWidth - width - 4);
      const top = Math.min(Math.max(startTop + dy, 4), window.innerHeight - height - 4);

      overlay.style.inset = `${top}px auto auto ${left}px`;
    });

    function finish(event) {
      if (!down) return;

      down = false;
      stage.releasePointerCapture?.(event.pointerId);

      if (!overlay.classList.contains("mini")) return;

      if (!dragging) {
        restore(overlay); // a tap opens the full call
        return;
      }

      // Snap to the nearest side, like Snapchat.
      const box = stage.getBoundingClientRect();
      const toLeft = box.left + box.width / 2 < window.innerWidth / 2;
      const left = toLeft ? EDGE : window.innerWidth - box.width - EDGE;
      const top = Math.min(Math.max(box.top, EDGE), window.innerHeight - box.height - EDGE);

      overlay.style.transition = "left .25s ease, top .25s ease";
      overlay.style.inset = `${top}px auto auto ${left}px`;
    }

    stage.addEventListener("pointerup", finish);
    stage.addEventListener("pointercancel", finish);
  }

  // ----- Phone Back button minimizes instead of leaving -----

  window.addEventListener("popstate", () => {
    const overlay = getOverlay();

    if (!MINIMIZE_ON_BACK_BUTTON || !pushed || !isOpen(overlay)) return;

    pushed = false;

    if (!overlay.classList.contains("mini")) minimize(overlay);
  });

  // ----- Keep everything in step with the call screen -----

  setInterval(() => {
    const overlay = getOverlay();

    if (!overlay) return;

    if (!isOpen(overlay)) {
      // Call ended: next call starts full screen.
      if (overlay.classList.contains("mini")) restore(overlay);
      pushed = false;
      return;
    }

    addButton(overlay);
    enableDrag(overlay);

    // A new incoming call always opens full screen.
    if (overlay.classList.contains("incoming") && overlay.classList.contains("mini")) {
      restore(overlay);
    }

    if (MINIMIZE_ON_BACK_BUTTON && !pushed && !overlay.classList.contains("mini")) {
      history.pushState({ reeltimeCall: true }, "");
      pushed = true;
    }
  }, 400);
})();
