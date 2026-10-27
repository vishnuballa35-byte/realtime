// =====================================================
// ReelTime — clear-chat.js
// Load this LAST in index.html (after chat-security.js):
//   <script src="clear-chat.js"></script>
// "Clear"  -> permanently deletes all messages but keeps the person
//             in the Messages list.
// "Delete" -> deletes all messages AND removes the person from the list.
// =====================================================

(function fullClearChat() {
  // ----- remember people whose chat was cleared -----

  const keptKey = () => `reeltime-kept-chats-${reelTimeChatUserId}`;

  function readKept() {
    try {
      return JSON.parse(localStorage.getItem(keptKey()) || "{}");
    } catch {
      return {};
    }
  }

  function writeKept(map) {
    try {
      localStorage.setItem(keptKey(), JSON.stringify(map));
    } catch {}
  }

  // Exposed so loadRecentChats() can use it.
  window.reelTimeKeptChats = () => readKept();

  // ----- Clear / Delete buttons -----

  document.addEventListener(
    "click",
    async (event) => {
      const button = event.target.closest?.("#dm-chat .dm-chat-head button");

      const label = button?.textContent.trim();

      if (!button || (label !== "Clear" && label !== "Delete")) return;

      // Stop the old Clear code from running.
      event.stopImmediatePropagation();
      event.preventDefault();

      const client = getClient();

      if (!client || !reelTimeChatUser) return;

      button.disabled = true;

      try {
        // 1) Delete the photo/video files of this chat first
        //    (the storage rules look at the messages, so this must come first).
        const myId = reelTimeChatUserId;
        const otherId = reelTimeChatUser.id;

        const { data: mediaRows, error: listError } = await client
          .from("messages")
          .select("media_path")
          .not("media_path", "is", null)
          .or(
            `and(sender_id.eq.${myId},receiver_id.eq.${otherId}),and(sender_id.eq.${otherId},receiver_id.eq.${myId})`
          )
          .limit(1000);

        if (listError) {
          console.warn("Could not list chat files:", listError.message);
        } else {
          const paths = (mediaRows || []).map((row) => row.media_path).filter(Boolean);

          for (let i = 0; i < paths.length; i += 100) {
            const { error: removeError } = await client.storage
              .from("chat-media")
              .remove(paths.slice(i, i + 100));

            if (removeError) {
              console.warn("Could not remove some chat files:", removeError.message);
            }
          }
        }

        // 2) Then delete all the messages.
        const { error } = await client.rpc("clear_chat", {
          other_id: reelTimeChatUser.id
        });

        if (error) throw error;

        // 3) Clear keeps the person in the list; Delete removes them.
        const kept = readKept();

        if (label === "Clear") {
          kept[reelTimeChatUser.id] = reelTimeChatUser;
        } else {
          delete kept[reelTimeChatUser.id];
        }

        writeKept(kept);

        dmMessages = [];
        renderThread();

        // "Delete" also closes the chat; "Clear" keeps it open and empty.
        if (label === "Delete") {
          closeChatChannel();
          reelTimeChatUser = null;
          showDmChat(false);
        }

        loadRecentChats();
        refreshMessagesDot?.();
        toast(label === "Delete" ? "Chat deleted." : "Chat cleared.");
      } catch (error) {
        console.error("Clearing chat failed:", error);
        toast("Could not clear the chat. Did you run clear-chat.sql?");
      } finally {
        button.disabled = false;
      }
    },
    true
  );
})();