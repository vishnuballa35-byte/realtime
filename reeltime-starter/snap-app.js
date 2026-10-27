// =====================================================
// ReelTime — snap-app.js  (load LAST, after instagram-extras.js)
//  1. Login gate: logged out -> login box, logged in -> Messages
//  2. 📹 Video call button inside the chat box
//  3. Minimize the call to a floating window (drag it, tap to open)
//  4. Keeps the call alive when you leave the app:
//       Picture-in-Picture + screen wake lock
//  5. Log out button on your profile (works on phones too)
// =====================================================

(function snapApp() {
  const client = getClient();
  if (!client) return;

  // ---------- 1. Login gate ----------
  let lastId;

  async function route(user) {
    document.body.classList.toggle("logged-out", !user);

    if (!user) {
      window.openReelTimeAuth?.("login");
      return;
    }

    closeModal("auth-modal");
    setActiveNav("messages");
    await openMessagesPage();
  }

  // Only react when the person really changes (Supabase also fires
  // SIGNED_IN when you just come back to the tab).
  function onUser(user) {
    const id = user?.id || null;
    if (id === lastId) return;
    lastId = id;
    route(user);
  }

  getCurrentUser().then(onUser);

  client.auth.onAuthStateChange((_event, session) => {
    setTimeout(() => onUser(session?.user || null), 0);
  });

  // The login box cannot be closed while logged out.
  const authModal = $("auth-modal");

  if (authModal) {
    new MutationObserver(() => {
      if (document.body.classList.contains("logged-out") && authModal.classList.contains("hidden")) {
        window.openReelTimeAuth?.("login");
      }
    }).observe(authModal, { attributes: true, attributeFilter: ["class"] });
  }

  // ---------- 2. Video call button in the chat box ----------
  const head = document.querySelector("#dm-chat .dm-chat-head");

  if (head && !$("dm-call-btn")) {
    let box = head.querySelector(".dm-head-actions");

    if (!box) {
      box = document.createElement("div");
      box.className = "dm-head-actions";
      head.appendChild(box);
    }

    const callButton = document.createElement("button");
    callButton.id = "dm-call-btn";
    callButton.type = "button";
    callButton.title = "Video call";
    callButton.textContent = "📹";

    callButton.addEventListener("click", () => {
      if (!reelTimeChatUser) return;

      if (!window.startReelTimeCall) {
        toast("Video calls are not ready yet. Refresh the page.");
        return;
      }

      window.startReelTimeCall(reelTimeChatUser.id);
    });

    box.prepend(callButton);
  }

  // ---------- 5. Log out on your profile ----------
  const bio = document.querySelector("#profile-page .profile-bio");

  if (bio && !$("profile-logout-btn")) {
    const logout = document.createElement("button");
    logout.id = "profile-logout-btn";
    logout.type = "button";
    logout.className = "primary-btn";
    logout.textContent = "Log out";

    logout.addEventListener("click", () => {
      if (confirm("Log out of ReelTime?")) $("auth-logout-btn")?.click();
    });

    bio.appendChild(logout);
  }

  // ---------- 3 + 4. Call window: minimize, drag, PiP, wake lock ----------
  let wakeLock = null;

  function callIsConnected() {
    const overlay = $("call-overlay");

    return Boolean(
      overlay &&
      !overlay.classList.contains("hidden") &&
      overlay.classList.contains("connected")
    );
  }

  async function updateWakeLock(on) {
    try {
      if (on && !wakeLock && navigator.wakeLock) {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", () => {
          wakeLock = null;
        });
      } else if (!on && wakeLock) {
        await wakeLock.release();
        wakeLock = null;
      }
    } catch (error) {
      /* not supported or refused: the call still works */
    }
  }

  function remoteVideo() {
    return document.querySelector("#call-overlay .call-remote");
  }

  async function enterPip() {
    const video = remoteVideo();

    if (!video || !document.pictureInPictureEnabled || document.pictureInPictureElement) return;

    try {
      await video.requestPictureInPicture();
    } catch (error) {
      toast("Picture-in-picture is not available in this browser.");
    }
  }

  // Chrome can open Picture-in-Picture by itself when you leave a call.
  try {
    navigator.mediaSession?.setActionHandler("enterpictureinpicture", () => {
      remoteVideo()?.requestPictureInPicture().catch(() => {});
    });
  } catch (error) {
    /* not supported */
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      // Works when the browser allows it (needs the call to be active).
      if (callIsConnected() && document.pictureInPictureEnabled && !document.pictureInPictureElement) {
        remoteVideo()?.requestPictureInPicture().catch(() => {});
      }
    } else {
      // The wake lock is released when the tab is hidden: take it again.
      updateWakeLock(callIsConnected());
    }
  });

  function enhanceOverlay(overlay) {
    if (overlay.dataset.snap) return;
    overlay.dataset.snap = "1";

    const controls = overlay.querySelector(".call-controls");
    const stage = overlay.querySelector(".call-stage");

    controls.insertAdjacentHTML(
      "afterbegin",
      '<button type="button" class="call-btn" data-act="mini" aria-label="Minimize">⤡</button>' +
      '<button type="button" class="call-btn" data-act="pip" aria-label="Picture in picture">⧉</button>'
    );

    function setMini(on) {
      if (on && overlay.classList.contains("incoming")) return;

      overlay.classList.toggle("mini", on);

      if (!on) {
        overlay.style.left = "";
        overlay.style.top = "";
        overlay.style.inset = "";
      }

      // The page behind a minimized call must stay scrollable.
      document.body.style.overflow = on ? "" : "hidden";
    }

    controls.addEventListener("click", (event) => {
      const action = event.target.closest("[data-act]")?.dataset.act;

      if (action === "mini") setMini(true);
      if (action === "pip") enterPip();
    });

    // Drag the small window; a simple tap opens it again.
    let drag = null;
    let moved = false;

    stage.addEventListener("pointerdown", (event) => {
      if (!overlay.classList.contains("mini") || event.target.closest("[data-act]")) return;

      const box = overlay.getBoundingClientRect();
      drag = { x: event.clientX, y: event.clientY, left: box.left, top: box.top };
      moved = false;
      stage.setPointerCapture(event.pointerId);
    });

    stage.addEventListener("pointermove", (event) => {
      if (!drag) return;

      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;

      if (Math.abs(dx) + Math.abs(dy) > 6) moved = true;
      if (!moved) return;

      const maxLeft = window.innerWidth - overlay.offsetWidth;
      const maxTop = window.innerHeight - overlay.offsetHeight;

      overlay.style.inset = "auto";
      overlay.style.left = Math.max(0, Math.min(maxLeft, drag.left + dx)) + "px";
      overlay.style.top = Math.max(0, Math.min(maxTop, drag.top + dy)) + "px";
    });

    stage.addEventListener("pointerup", () => {
      if (drag && !moved) setMini(false);
      drag = null;
    });

    // Reset when the call ends or a new call rings.
    new MutationObserver(() => {
      const hidden = overlay.classList.contains("hidden");
      const incoming = overlay.classList.contains("incoming");

      if (overlay.classList.contains("mini") && (hidden || incoming)) setMini(false);
      if (hidden && document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});

      updateWakeLock(callIsConnected());
    }).observe(overlay, { attributes: true, attributeFilter: ["class"] });
  }

  // The call screen is created the first time it is needed.
  const existing = $("call-overlay");
  if (existing) enhanceOverlay(existing);

  new MutationObserver(() => {
    const overlay = $("call-overlay");
    if (overlay) enhanceOverlay(overlay);
  }).observe(document.body, { childList: true });
})();
