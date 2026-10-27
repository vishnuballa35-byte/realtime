// =====================================================
// ReelTime — love-hearts.js
// Load LAST in index.html (after clear-chat.js):
//   <script src="love-hearts.js"></script>
// Hearts burst:
//   - where you tap / click inside the chat
//   - when you send a message
//   - when a new message arrives
// Uses the .love-pop styles from love-glow.css.
// =====================================================

(function loveHearts() {
  const COLORS = ["#ff4d8d", "#ff7aa8", "#ff9ac0", "#e0206f", "#ffb3cc", "#ff2d78"];
  const SYMBOLS = ["♥", "♥", "♥", "♡", "❤", "💗"];
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (list) => list[Math.floor(Math.random() * list.length)];

  let lastBurst = 0;

  function burst(chat, x, y, count) {
    if (!chat || reduce) return;

    for (let i = 0; i < count; i++) {
      const heart = document.createElement("i");
      heart.className = "love-pop";
      heart.textContent = pick(SYMBOLS);
      heart.style.left = x + "px";
      heart.style.top = y + "px";
      heart.style.setProperty("--s", rand(26, 56) + "px");
      heart.style.setProperty("--c", pick(COLORS));
      heart.style.setProperty("--dx", rand(-100, 100) + "px");
      heart.style.setProperty("--dy", rand(-220, -80) + "px");
      heart.style.setProperty("--rot", rand(-40, 40) + "deg");
      heart.addEventListener("animationend", () => heart.remove());
      chat.appendChild(heart);
    }
  }

  function burstAt(clientX, clientY, count) {
    const chat = document.getElementById("dm-chat");
    if (!chat) return;

    const now = Date.now();
    if (now - lastBurst < 120) return;
    lastBurst = now;

    const box = chat.getBoundingClientRect();
    burst(chat, clientX - box.left, clientY - box.top, count);
  }

  // Tap / click inside the chat
  document.addEventListener("pointerdown", (event) => {
    const chat = event.target.closest?.("#dm-chat");

    if (!chat) return;
    if (event.target.closest("button, input, textarea, a, video")) return;

    burstAt(event.clientX, event.clientY, 7);
  });

  // Sending a message
  document.addEventListener(
    "submit",
    (event) => {
      if (event.target.id !== "dm-form") return;

      const input = document.getElementById("dm-input");
      if (!input || !input.value.trim()) return;

      const send = event.target.querySelector(".dm-send") || event.target;
      const box = send.getBoundingClientRect();

      burstAt(box.left + box.width / 2, box.top, 12);
    },
    true
  );

  // A new message arrives
  let watched = null;
  let observer = null;
  let previousCount = 0;

  function countRows(list) {
    return list.querySelectorAll(":scope > .dm-row:not(.dm-call-log)");
  }

  function watch() {
    const list = document.getElementById("dm-messages");

    if (list === watched) return;

    observer?.disconnect();
    watched = list;

    if (!list) return;

    previousCount = countRows(list).length;

    observer = new MutationObserver(() => {
      const rows = countRows(list);
      const last = rows[rows.length - 1];

      if (
        previousCount > 0 &&
        rows.length === previousCount + 1 &&
        last &&
        !last.classList.contains("mine")
      ) {
        const bubble = (last.querySelector(".dm-bubble") || last).getBoundingClientRect();
        burstAt(bubble.left + 24, bubble.top, 8);
      }

      previousCount = rows.length;
    });

    observer.observe(list, { childList: true });
  }

  setInterval(watch, 1000);
  watch();
})();