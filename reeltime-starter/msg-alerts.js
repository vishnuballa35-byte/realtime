// =====================================================
// VN — msg-alerts.js
// Load LAST in index.html (after call-minimize.js):
//   <script src="msg-alerts.js"></script>
// When someone sends you a message you get:
//   - a pink banner at the top (tap it to open the chat)
//   - a soft "ping" sound and a short vibration on phones
//   - an unread count in the browser tab title, e.g. "(2) VN"
//   - a system notification when VN is in the background
//     (asks permission once, the first time you tap the screen)
// No alert is shown if you are already looking at that chat.
// =====================================================

(function messageAlerts() {
  const SOUND_ON = true;
  const VIBRATE_ON = true;
  const BANNER_MS = 5000;

  const client = typeof getClient === "function" ? getClient() : null;

  if (!client) return;

  const baseTitle = document.title;
  const seen = new Set();
  const profiles = new Map();

  let me = null;
  let channel = null;
  let hiddenCount = 0;
  let audioCtx = null;
  let bannerTimer = null;

  // ----- styles -----

  const style = document.createElement("style");
  style.textContent = `
    .vn-alert {
      position: fixed;
      top: calc(12px + env(safe-area-inset-top, 0px));
      left: 50%;
      z-index: 300;
      display: flex;
      align-items: center;
      gap: 12px;
      width: min(420px, calc(100vw - 24px));
      padding: 12px 14px;
      border: 1px solid #ffd0e0;
      border-radius: 20px;
      background: rgba(255, 255, 255, .96);
      -webkit-backdrop-filter: blur(12px);
      backdrop-filter: blur(12px);
      box-shadow: 0 14px 40px rgba(255, 77, 141, .38), 0 0 0 1px rgba(255, 255, 255, .8) inset;
      color: #3b1f2c;
      font-family: inherit;
      cursor: pointer;
      transform: translate(-50%, -150%);
      transition: transform .38s cubic-bezier(.2, 1.2, .4, 1);
    }
    .vn-alert.show { transform: translate(-50%, 0); }
    .vn-alert-avatar {
      display: grid;
      place-items: center;
      flex-shrink: 0;
      width: 46px;
      height: 46px;
      border-radius: 50%;
      background: linear-gradient(135deg, #ffc2d6, #ff4d8d);
      color: #fff;
      font-weight: 700;
      font-size: 18px;
      object-fit: cover;
      box-shadow: 0 0 0 2px #fff, 0 0 0 4px #ff9ac0;
    }
    .vn-alert-text { flex: 1; min-width: 0; }
    .vn-alert-name { display: block; overflow: hidden; color: #d81b60; font-size: 14px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
    .vn-alert-name::after { content: " ♥"; color: #ff4d8d; }
    .vn-alert-msg { display: block; overflow: hidden; font-size: 14px; text-overflow: ellipsis; white-space: nowrap; }
    .vn-alert-close { flex-shrink: 0; width: 28px; height: 28px; border: 0; border-radius: 50%; background: #ffeaf1; color: #d81b60; font-size: 18px; line-height: 1; cursor: pointer; }
    .vn-ask .vn-alert-actions { display: flex; gap: 8px; margin-top: 8px; }
    .vn-ask button.vn-btn { padding: 6px 14px; border: 0; border-radius: 999px; background: #ffeaf1; color: #d81b60; font-weight: 700; cursor: pointer; }
    .vn-ask button.vn-btn.primary { background: linear-gradient(135deg, #ff8fb4, #ff4d8d); color: #fff; }
    @media (prefers-reduced-motion: reduce) { .vn-alert { transition: none; } }
  `;
  document.head.appendChild(style);

  // ----- sound (made in code, no sound file needed) -----

  function unlockAudio() {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) audioCtx = new AudioContextClass();
    }

    audioCtx?.resume?.();
  }

  function ping() {
    if (!SOUND_ON || !audioCtx || audioCtx.state !== "running") return;

    const start = audioCtx.currentTime;

    [[880, 0], [1175, 0.13]].forEach(([frequency, delay]) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.type = "sine";
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start + delay);
      gain.gain.exponentialRampToValueAtTime(0.18, start + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + delay + 0.35);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(start + delay);
      osc.stop(start + delay + 0.4);
    });
  }

  document.addEventListener("pointerdown", unlockAudio, { once: true });
  document.addEventListener("keydown", unlockAudio, { once: true });

  // ----- helpers -----

  function viewingChatWith(senderId) {
    const page = document.getElementById("messages-page");
    const pageOpen = page && !page.classList.contains("hidden");
    const chatOpen =
      typeof reelTimeChatUser !== "undefined" &&
      reelTimeChatUser &&
      reelTimeChatUser.id === senderId;

    return Boolean(pageOpen && chatOpen && !document.hidden);
  }

  async function getProfile(id) {
    if (profiles.has(id)) return profiles.get(id);

    const { data } = await client
      .from("profiles")
      .select("id, username, full_name, avatar_url")
      .eq("id", id)
      .maybeSingle();

    const profile = data || { id, username: "someone", full_name: "", avatar_url: null };
    profiles.set(id, profile);
    return profile;
  }

  function previewOf(text) {
    const value = String(text || "");

    if (typeof MISSED_CALL_TEXT !== "undefined" && value === MISSED_CALL_TEXT) return "📞 Missed video call";
    if (typeof MISSED_AUDIO_CALL_TEXT !== "undefined" && value === MISSED_AUDIO_CALL_TEXT) return "📞 Missed voice call";

    // Scrambled (encrypted) text must never be shown as a preview.
    if (!value || /^[A-Za-z0-9+/=_-]{40,}$/.test(value)) return "Sent you a message";

    return value.length > 60 ? value.slice(0, 60) + "…" : value;
  }

  function openMessagesView() {
    const buttons = document.querySelectorAll('[data-view="messages"]');

    for (const button of buttons) {
      if (button.offsetParent !== null) {
        button.click();
        return;
      }
    }

    buttons[0]?.click();
  }

  // ----- banner -----

  function hideBanner() {
    clearTimeout(bannerTimer);

    const old = document.querySelector(".vn-alert");

    if (!old) return;

    old.classList.remove("show");
    setTimeout(() => old.remove(), 400);
  }

  function showBanner(profile, preview) {
    document.querySelector(".vn-alert")?.remove();

    const name = profile.full_name || profile.username || "New message";

    const banner = document.createElement("div");
    banner.className = "vn-alert";
    banner.setAttribute("role", "status");

    let avatar;

    if (profile.avatar_url) {
      avatar = document.createElement("img");
      avatar.src = profile.avatar_url;
      avatar.alt = "";
    } else {
      avatar = document.createElement("div");
      avatar.textContent = name.charAt(0).toUpperCase();
    }

    avatar.className = "vn-alert-avatar";

    const text = document.createElement("div");
    text.className = "vn-alert-text";

    const nameEl = document.createElement("span");
    nameEl.className = "vn-alert-name";
    nameEl.textContent = name;

    const messageEl = document.createElement("span");
    messageEl.className = "vn-alert-msg";
    messageEl.textContent = preview;

    text.append(nameEl, messageEl);

    const close = document.createElement("button");
    close.type = "button";
    close.className = "vn-alert-close";
    close.setAttribute("aria-label", "Dismiss");
    close.textContent = "×";
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      hideBanner();
    });

    banner.append(avatar, text, close);

    banner.addEventListener("click", async () => {
      hideBanner();
      openMessagesView();

      if (typeof openChatWithUser === "function") {
        try {
          await openChatWithUser(profile);
        } catch (error) {
          console.warn("Could not open the chat:", error);
        }
      }
    });

    document.body.appendChild(banner);
    requestAnimationFrame(() => requestAnimationFrame(() => banner.classList.add("show")));

    bannerTimer = setTimeout(hideBanner, BANNER_MS);
  }

  // ----- system notification (when VN is in the background) -----

  async function systemNotify(profile, preview, message) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;

    const title = profile.full_name || profile.username || "New message";
    const options = {
      body: preview,
      icon: "./icons/icon-192.png",
      badge: "./icons/favicon-32.png",
      tag: "vn-" + message.sender_id,
      renotify: true,
      data: { from: message.sender_id }
    };

    try {
      const registration = await navigator.serviceWorker?.ready;

      if (registration?.showNotification) {
        await registration.showNotification(title, options);
        return;
      }
    } catch (error) {
      console.warn("Service worker notification failed:", error);
    }

    try {
      new Notification(title, options);
    } catch (error) {
      console.warn("Notification failed:", error);
    }
  }

  // ----- ask permission once -----

  function askPermissionOnce() {
    if (!("Notification" in window) || Notification.permission !== "default") return;

    try {
      if (localStorage.getItem("vn-notify-asked")) return;
    } catch {}

    const finish = () => {
      try {
        localStorage.setItem("vn-notify-asked", "1");
      } catch {}
      hideBanner();
    };

    const show = () => {
      document.querySelector(".vn-alert")?.remove();

      const card = document.createElement("div");
      card.className = "vn-alert vn-ask";

      const text = document.createElement("div");
      text.className = "vn-alert-text";
      text.style.whiteSpace = "normal";

      const title = document.createElement("span");
      title.className = "vn-alert-name";
      title.textContent = "Message alerts";

      const body = document.createElement("span");
      body.className = "vn-alert-msg";
      body.style.whiteSpace = "normal";
      body.textContent = "Get an alert when someone messages you, even when VN is in the background?";

      const actions = document.createElement("div");
      actions.className = "vn-alert-actions";

      const yes = document.createElement("button");
      yes.type = "button";
      yes.className = "vn-btn primary";
      yes.textContent = "Turn on";
      yes.addEventListener("click", async (event) => {
        event.stopPropagation();
        try {
          await Notification.requestPermission();
        } catch {}
        finish();
      });

      const no = document.createElement("button");
      no.type = "button";
      no.className = "vn-btn";
      no.textContent = "Not now";
      no.addEventListener("click", (event) => {
        event.stopPropagation();
        finish();
      });

      actions.append(yes, no);
      text.append(title, body, actions);
      card.appendChild(text);
      document.body.appendChild(card);
      requestAnimationFrame(() => requestAnimationFrame(() => card.classList.add("show")));
    };

    // Show it a moment after the first tap once you are logged in.
    document.addEventListener(
      "pointerdown",
      () => setTimeout(() => { if (me) show(); }, 2500),
      { once: true }
    );
  }

  // ----- a message arrived -----

  async function handleMessage(message) {
    if (!message || seen.has(message.id)) return;
    seen.add(message.id);

    // Keep the Messages list and the red dot up to date.
    if (typeof loadRecentChats === "function") loadRecentChats();
    if (typeof refreshMessagesDot === "function") refreshMessagesDot();

    // Already looking at this chat: no alert needed.
    if (viewingChatWith(message.sender_id)) return;

    const profile = await getProfile(message.sender_id);
    const preview = previewOf(message.message_text);

    if (document.hidden) {
      hiddenCount += 1;
      document.title = `(${hiddenCount}) ${baseTitle}`;
      systemNotify(profile, preview, message);
    } else {
      showBanner(profile, preview);
    }

    ping();

    if (VIBRATE_ON && navigator.vibrate) navigator.vibrate([80, 40, 80]);
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      hiddenCount = 0;
      document.title = baseTitle;
    }
  });

  // ----- listen for new messages sent to you -----

  async function start() {
    const user = await (typeof getCurrentUser === "function" ? getCurrentUser() : null);

    if (!user) {
      if (channel) client.removeChannel(channel);
      channel = null;
      me = null;
      return;
    }

    if (channel && me === user.id) return;

    if (channel) client.removeChannel(channel);

    me = user.id;

    channel = client
      .channel("msg-alerts-" + me)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `receiver_id=eq.${me}` },
        (payload) => handleMessage(payload.new)
      )
      .subscribe();
  }

  client.auth.onAuthStateChange(() => setTimeout(start, 300));
  start();
  askPermissionOnce();
})();
