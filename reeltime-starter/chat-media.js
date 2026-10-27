// =====================================================
// ReelTime — chat-media.js
// Load LAST in index.html (after otp-login.js):
//   <script src="chat-media.js"></script>
// Adds to the chat box:
//   📎 button  -> send a photo or video
//   ⬇ Save     -> download a photo/video you got or sent
//   🗑          -> delete one of YOUR messages (text, photo or video)
// Needs chat-media.sql to be run once in Supabase.
// =====================================================

(function chatMedia() {
  const client = getClient();
  const form = $("dm-form");
  const input = $("dm-input");

  if (!client || !form || !input) return;

  const BUCKET = "chat-media";
  const MAX_MB = 50;

  const mediaInfo = new Map();     // message id -> { path, type, name }
  const checkedIds = new Set();    // message ids we already looked up
  const urlCache = new Map();      // path -> { url, exp }
  let loadingInfo = false;

  // ----- styles -----

  const style = document.createElement("style");
  style.textContent = `
    #dm-attach { border: 0; background: transparent; font-size: 20px; cursor: pointer; padding: 0 8px; }
    #dm-attach:disabled { opacity: .4; cursor: default; }
    .dm-bubble.dm-media-bubble { padding: 6px; }
    .dm-media { display: block; max-width: 240px; max-height: 320px; border-radius: 12px; object-fit: cover; cursor: pointer; }
    video.dm-media { max-width: 260px; cursor: default; }
    .dm-actions { display: flex; gap: 6px; margin-top: 4px; }
    .dm-save { border: 0; background: rgba(255,255,255,.85); color: #111; border-radius: 8px; padding: 4px 10px; font-size: 12px; cursor: pointer; }
    .dm-del { border: 0; background: transparent; cursor: pointer; opacity: .4; font-size: 14px; align-self: center; padding: 4px; }
    .dm-row:hover .dm-del { opacity: .9; }
  `;
  document.head.appendChild(style);

  // ----- 📎 attach button -----

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept =
    "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime";
  fileInput.hidden = true;

  const attach = document.createElement("button");
  attach.type = "button";
  attach.id = "dm-attach";
  attach.textContent = "📎";
  attach.title = "Send a photo or video";
  attach.setAttribute("aria-label", "Send a photo or video");

  form.insertBefore(attach, input);
  form.appendChild(fileInput);

  attach.addEventListener("click", () => {
    if (reelTimeChatUser) fileInput.click();
  });

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (file) sendMedia(file);
  });

  async function sendMedia(file) {
    const partner = reelTimeChatUser;
    const myId = reelTimeChatUserId;

    if (!partner || !myId) return;

    const kind = file.type.startsWith("video/")
      ? "video"
      : file.type.startsWith("image/")
        ? "image"
        : null;

    if (!kind) {
      setDmStatus("Choose a photo or a video.");
      fileInput.value = "";
      return;
    }

    if (file.size > MAX_MB * 1024 * 1024) {
      setDmStatus(`That file is too big (max ${MAX_MB} MB).`);
      fileInput.value = "";
      return;
    }

    attach.disabled = true;
    setDmStatus("Sending…");

    const ext =
      (file.name.split(".").pop() || "bin")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
        .slice(0, 5) || "bin";
    const random = crypto.randomUUID
      ? crypto.randomUUID()
      : String(Math.random()).slice(2);
    const path = `${myId}/${Date.now()}-${random}.${ext}`;

    try {
      const { error: uploadError } = await client.storage
        .from(BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });

      if (uploadError) throw uploadError;

      const { data, error } = await client
        .from("messages")
        .insert({
          sender_id: myId,
          receiver_id: partner.id,
          message_text: kind === "video" ? "🎥 Video" : "📷 Photo",
          media_path: path,
          media_type: kind,
          media_name: file.name.slice(0, 120)
        })
        .select(
          "id, sender_id, receiver_id, message_text, created_at, read_at, media_path, media_type, media_name"
        )
        .single();

      if (error) {
        await client.storage.from(BUCKET).remove([path]);
        throw error;
      }

      mediaInfo.set(data.id, { path, type: kind, name: data.media_name });
      checkedIds.add(data.id);

      if (reelTimeChatUser?.id === partner.id) pushMessage(data);

      loadRecentChats();
      setDmStatus("");
    } catch (error) {
      console.error("Sending media failed:", error);
      setDmStatus("Could not send it. Did you run chat-media.sql?");
    } finally {
      attach.disabled = false;
      fileInput.value = "";
    }
  }

  // ----- signed links (the bucket is private) -----

  async function getUrls(paths) {
    const now = Date.now();
    const need = [...new Set(paths)].filter((path) => {
      const entry = urlCache.get(path);
      return !(entry && entry.exp > now + 60000);
    });

    if (need.length === 0) return;

    const { data, error } = await client.storage
      .from(BUCKET)
      .createSignedUrls(need, 3600);

    if (error) {
      console.warn("Could not get media links:", error.message);
      return;
    }

    (data || []).forEach((item) => {
      if (item.signedUrl) {
        urlCache.set(item.path, { url: item.signedUrl, exp: now + 3600 * 1000 });
      }
    });
  }

  async function saveMedia(info) {
    const { data, error } = await client.storage
      .from(BUCKET)
      .createSignedUrl(info.path, 60, { download: info.name || true });

    if (error || !data?.signedUrl) {
      toast("Could not save this file.");
      return;
    }

    const link = document.createElement("a");
    link.href = data.signedUrl;
    link.download = info.name || "";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  // ----- show media inside the chat -----

  function scrollChatToEnd() {
    const box = $("dm-messages");
    if (box) box.scrollTop = box.scrollHeight;
  }

  function fillMedia(bubble, info, message) {
    const entry = urlCache.get(info.path);

    bubble.replaceChildren();

    if (!entry) {
      bubble.textContent = "This file is not available.";
      return;
    }

    let element;

    if (info.type === "video") {
      element = document.createElement("video");
      element.src = entry.url;
      element.controls = true;
      element.playsInline = true;
      element.preload = "metadata";
      element.addEventListener("loadedmetadata", scrollChatToEnd);
    } else {
      element = document.createElement("img");
      element.src = entry.url;
      element.alt = info.name || "Photo";
      element.addEventListener("load", scrollChatToEnd);
      element.addEventListener("click", () =>
        window.open(entry.url, "_blank", "noopener")
      );
    }

    element.className = "dm-media";

    const actions = document.createElement("div");
    actions.className = "dm-actions";

    const save = document.createElement("button");
    save.type = "button";
    save.className = "dm-save";
    save.textContent = "⬇ Save";
    save.addEventListener("click", () => saveMedia(info));
    actions.appendChild(save);

    // Delete sits beside Save, only on photos/videos you sent.
    if (message && message.sender_id === reelTimeChatUserId) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "dm-save";
      remove.textContent = "🗑 Delete";
      remove.addEventListener("click", () => deleteMessage(message, info));
      actions.appendChild(remove);
    }

    bubble.append(element, actions);
  }

  function sortedThreadMessages() {
    return dmMessages
      .slice()
      .sort(
        (a, b) =>
          new Date(a.created_at) - new Date(b.created_at) ||
          String(a.id).localeCompare(String(b.id))
      )
      .filter(
        (message) =>
          message.message_text !== MISSED_CALL_TEXT &&
          message.message_text !== MISSED_AUDIO_CALL_TEXT
      );
  }

  // Runs right after renderThread() has drawn the normal bubbles.
  function decorate() {
    const box = $("dm-messages");

    if (!box) return;

    const rows = Array.from(box.querySelectorAll(":scope > .dm-row:not(.dm-call-log)"));
    const messages = sortedThreadMessages();

    // Something does not line up: leave the thread as it is.
    if (rows.length !== messages.length) return;

    const pending = [];

    rows.forEach((row, index) => {
      const message = messages[index];
      const mine = message.sender_id === reelTimeChatUserId;
      const info = message.media_path
        ? { path: message.media_path, type: message.media_type, name: message.media_name }
        : mediaInfo.get(message.id);

      row.dataset.msgId = message.id;

      if (info) {
        const bubble = row.querySelector(".dm-bubble");

        if (bubble) {
          bubble.classList.add("dm-media-bubble");
          bubble.textContent = "Loading…";
          pending.push({ bubble, info, message });
        }
      }

      
    });

    if (pending.length > 0) {
      getUrls(pending.map((item) => item.info.path)).then(() => {
        pending.forEach((item) => {
          if (item.bubble.isConnected) fillMedia(item.bubble, item.info, item.message);
        });
      });
    }
  }

  // The normal chat loader does not fetch the media columns,
  // so look them up once for the messages on screen.
  async function ensureMediaInfo() {
    if (loadingInfo || !reelTimeChatUser || !reelTimeChatUserId) return;

    const unknown = dmMessages.filter(
      (message) => !message.media_path && !checkedIds.has(message.id)
    );

    if (unknown.length === 0) return;

    loadingInfo = true;

    const myId = reelTimeChatUserId;
    const otherId = reelTimeChatUser.id;
    let foundNew = false;

    try {
      const { data, error } = await client
        .from("messages")
        .select("id, media_path, media_type, media_name")
        .not("media_path", "is", null)
        .or(
          `and(sender_id.eq.${myId},receiver_id.eq.${otherId}),and(sender_id.eq.${otherId},receiver_id.eq.${myId})`
        )
        .limit(500);

      if (error) throw error;

      (data || []).forEach((row) => {
        if (!mediaInfo.has(row.id)) foundNew = true;
        mediaInfo.set(row.id, {
          path: row.media_path,
          type: row.media_type,
          name: row.media_name
        });
      });

      unknown.forEach((message) => checkedIds.add(message.id));
    } catch (error) {
      console.warn("Could not load media info (did you run chat-media.sql?):", error.message);
    } finally {
      loadingInfo = false;
    }

    if (foundNew) renderThread();
  }

  const renderThreadOriginal = renderThread;

  renderThread = function (...args) {
    renderThreadOriginal(...args);
    decorate();
    ensureMediaInfo();
  };

  // ----- delete one of your messages -----

  async function deleteMessage(message, info) {
    try {
      const { data, error } = await client
        .from("messages")
        .delete()
        .eq("id", message.id)
        .eq("sender_id", reelTimeChatUserId)
        .select("id");

      if (error) throw error;

      if (!data || data.length === 0) {
        toast("You can only delete your own messages.");
        return;
      }

      const path = message.media_path || info?.path;

      if (path) {
        const { error: removeError } = await client.storage.from(BUCKET).remove([path]);

        if (removeError) console.warn("Could not remove the file:", removeError.message);
      }

      dmMessages = dmMessages.filter((item) => item.id !== message.id);
      mediaInfo.delete(message.id);
      renderThread();
      loadRecentChats();
    } catch (error) {
      console.error("Deleting the message failed:", error);
      toast("Could not delete the message.");
    }
  }

  // When the other person deletes a message, remove it from your screen too.
  client
    .channel("chat-media-deletes")
    .on(
      "postgres_changes",
      { event: "DELETE", schema: "public", table: "messages" },
      (payload) => {
        const id = payload.old?.id;

        if (!id) return;

        const before = dmMessages.length;
        dmMessages = dmMessages.filter((item) => item.id !== id);
        mediaInfo.delete(id);

        if (dmMessages.length !== before) renderThread();
      }
    )
    .subscribe();
})();