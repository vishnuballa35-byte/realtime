// =====================================================
// ReelTime — chat-security.js
// Load LAST (after app.js, e2ee.js and instagram-extras.js).
// Connects encryption, Clear chat, Delete chat and the safety number
// to your existing Messages screen. You do NOT need to edit
// instagram-extras.js: this file wraps its functions.
// =====================================================

(function chatSecurity() {
  const client = getClient();
  if (!client || !window.E2EE) return;

  // ---------- 1. Show readable text instead of ciphertext ----------
  const renderThreadOriginal = renderThread;
  let hydrating = false;

  const isCipher = (m) => String(m.message_text || "").startsWith(E2EE.PREFIX);
  const readable = (m) => m._text ?? (isCipher(m) ? "🔒 Decrypting…" : m.message_text);

  renderThread = function () {
    const real = dmMessages;
    const pending = real.filter((m) => m._text === undefined && isCipher(m));

    if (pending.length && !hydrating) {
      hydrating = true;
      Promise.all(pending.map(E2EE.hydrate)).finally(() => {
        hydrating = false;
        renderThread();
      });
    }

    // Draw the chat from a readable copy, then put the real list back.
    dmMessages = real.map((m) => ({ ...m, message_text: readable(m) }));
    try {
      renderThreadOriginal();
    } finally {
      dmMessages = real;
    }
  };

  // ---------- 2. Send encrypted messages ----------
  // Runs before the old send handler and replaces it.
  document.addEventListener(
    "submit",
    async (event) => {
      if (event.target.id !== "dm-form") return;

      event.preventDefault();
      event.stopImmediatePropagation();

      const input = $("dm-input");
      const text = input.value.trim();

      if (!reelTimeChatUser || !text) return;

      const button = $("dm-send");
      button.disabled = true;

      try {
        const cipher = await E2EE.encryptFor(reelTimeChatUser.id, text);

        const { data, error } = await client
          .from("messages")
          .insert({
            sender_id: reelTimeChatUserId,
            receiver_id: reelTimeChatUser.id,
            message_text: cipher
          })
          .select("id, sender_id, receiver_id, message_text, created_at, read_at")
          .single();

        if (error) throw error;

        data._text = text;
        pushMessage(data);
        input.value = "";
        updateSendButton();
        loadRecentChats();
      } catch (error) {
        console.error("Sending message failed:", error);
        setDmStatus(
          error.message === "KEY_CHANGED"
            ? "This person's security key changed. Tap 🔐 to check it."
            : /encryption/.test(error.message || "")
              ? error.message
              : "Message failed to send. Check your messages permissions."
        );
      } finally {
        button.disabled = false;
        input.focus();
      }
    },
    true
  );

  // ---------- 3. Readable previews in the chat list ----------
  const dmAvatarOriginal = dmAvatar;

  dmAvatar = function (profile) {
    const element = dmAvatarOriginal(profile);
    if (profile?.id) element.dataset.peerId = profile.id;
    return element;
  };

  async function fixPreviews() {
    const myId = window.currentReelTimeUserId;

    for (const item of document.querySelectorAll("#dm-list .dm-item")) {
      const preview = item.querySelector(".dm-preview");
      const peerId = item.querySelector("[data-peer-id]")?.dataset.peerId;

      if (!preview || !peerId) continue;

      const mine = preview.textContent.startsWith("You: ");
      const raw = preview.textContent.replace(/^You: /, "");

      if (!raw.startsWith(E2EE.PREFIX)) continue;

      const text = await E2EE.decryptMessage({
        message_text: raw,
        sender_id: mine ? myId : peerId,
        receiver_id: mine ? peerId : myId
      });

      preview.textContent = (mine ? "You: " : "") + text;
    }
  }

  const loadRecentChatsOriginal = loadRecentChats;

  loadRecentChats = async function () {
    await loadRecentChatsOriginal();
    await fixPreviews();
  };

  // ---------- 4. Clear chat, Delete chat, Safety number buttons ----------
  const style = document.createElement("style");
  style.textContent =
    "#messages-page .dm-head-actions{display:flex;gap:6px;margin-left:auto}" +
    "#messages-page .dm-head-actions button{padding:6px 10px;font-size:13px}" +
    "#messages-page .dm-head-actions .danger{color:var(--red)}";
  document.head.appendChild(style);

  const head = document.querySelector("#dm-chat .dm-chat-head");

  if (head && !$("dm-clear")) {
    const box = document.createElement("div");
    box.className = "dm-head-actions";
    box.innerHTML =
      '<button type="button" id="dm-safety" title="Check security">🔐</button>' +
      '<button type="button" id="dm-clear">Clear</button>' +
      '<button type="button" id="dm-delete" class="danger">Delete</button>';
    head.appendChild(box);
  }

  $("dm-clear")?.addEventListener("click", async () => {
    if (!reelTimeChatUser) return;
    if (!confirm("Clear this chat for you? The other person will still see their messages.")) return;

    try {
      await E2EE.clearChat(reelTimeChatUser.id);
      dmMessages = [];
      renderThread();
      loadRecentChats();
      setDmStatus("Chat cleared.");
    } catch (error) {
      console.error("Clear chat failed:", error);
      setDmStatus("Could not clear the chat. Did you run e2ee-security.sql?");
    }
  });

  $("dm-delete")?.addEventListener("click", async () => {
    if (!reelTimeChatUser) return;
    if (!confirm("Delete this chat for BOTH of you? This cannot be undone.")) return;

    try {
      await E2EE.deleteChat(reelTimeChatUser.id);
      await closeChatChannel();
      dmMessages = [];
      reelTimeChatUser = null;
      showDmChat(false);
      loadRecentChats();
    } catch (error) {
      console.error("Delete chat failed:", error);
      setDmStatus("Could not delete the chat.");
    }
  });

  $("dm-safety")?.addEventListener("click", async () => {
    if (!reelTimeChatUser) return;

    try {
      const id = reelTimeChatUser.id;
      const peer = await E2EE.getPeer(id);
      const number = await E2EE.safetyNumber(id);

      if (peer.changed) {
        const trust = confirm(
          "WARNING: this person's security key CHANGED.\n" +
          "This happens if they changed device or cleared their browser, " +
          "but it could also be an attacker.\n\n" +
          "Safety number:\n" + number + "\n\n" +
          "Ask them to read their number to you. Trust the new key?"
        );

        if (trust) {
          await E2EE.acceptNewKey(id);
          dmMessages.forEach((m) => delete m._text);
          renderThread();
        }
      } else {
        alert(
          "Safety number:\n" + number + "\n\n" +
          "Ask the other person to open this screen. If their number is the same, " +
          "nobody is intercepting your chat."
        );
      }
    } catch (error) {
      alert(error.message || "Could not check security.");
    }
  });

  // ---------- 5. Live updates when the other person deletes the chat ----------
  let deleteChannel = null;
  let deleteTimer = null;
  const deletedIds = new Set();

  function startDeleteListener(user) {
    if (deleteChannel) client.removeChannel(deleteChannel);

    deleteChannel = client
      .channel(`chat-deletes-${user.id}`)
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "messages" },
        (payload) => {
          const id = payload.old?.id;
          if (!id) return;

          deletedIds.add(id);
          clearTimeout(deleteTimer);

          deleteTimer = setTimeout(() => {
            if (dmMessages.some((m) => deletedIds.has(m.id))) {
              dmMessages = dmMessages.filter((m) => !deletedIds.has(m.id));
              renderThread();
            }

            deletedIds.clear();
            loadRecentChats();
          }, 300);
        }
      )
      .subscribe();
  }

  function stopDeleteListener() {
    if (deleteChannel) client.removeChannel(deleteChannel);
    deleteChannel = null;
  }

  getCurrentUser().then((user) => {
    if (user) startDeleteListener(user);
  });

  client.auth.onAuthStateChange((_event, session) => {
    setTimeout(() => {
      if (session?.user) startDeleteListener(session.user);
      else stopDeleteListener();
    }, 0);
  });
})();
