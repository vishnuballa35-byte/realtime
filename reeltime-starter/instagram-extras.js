// =====================================================
// ReelTime — instagram-extras.js
// Load this file AFTER app.js. It adds:
//   1. An Instagram-style Messages inbox (list + chat)
//   2. A profile that shows likes / views / comments
//   3. A separate Reels page opened from the profile grid
//   4. A Reels tab (TikTok-style scrolling) with a + button
//   5. Audio calls AND video calls
// It reuses the helpers from app.js ($, getClient, toast, ...).
// =====================================================

// The Reels pages behave like the other pages (hidden by showFeed, etc.).
PAGE_IDS.push("reels-viewer-page");
PAGE_IDS.push("reels-tab-page");

// --------------------------------------------------
// VIEW COUNTS
// A "view" = a logged-in person (not the owner) who watched a Reel
// for 2+ seconds. Stored once per person in the reel_views table.
// --------------------------------------------------

window.reelTimeReelsLoaded = false;

async function attachViewCounts() {
  const client = getClient();
  const ids = reels.filter((reel) => !reel.isDemo).map((reel) => reel.id);

  reels.forEach((reel) => {
    reel.views = 0;
  });

  if (!client || ids.length === 0) return;

  const { data, error } = await client
    .from("reel_views")
    .select("reel_id")
    .in("reel_id", ids);

  if (error) {
    console.warn("Could not load view counts (is the reel_views table created?):", error.message);
    return;
  }

  const counts = {};

  (data || []).forEach((row) => {
    counts[row.reel_id] = (counts[row.reel_id] || 0) + 1;
  });

  reels.forEach((reel) => {
    reel.views = counts[reel.id] || 0;
  });
}

// Wrap loadSavedReels so every load also fetches view counts.
const loadSavedReelsOriginal = loadSavedReels;

loadSavedReels = async function () {
  await loadSavedReelsOriginal();
  await attachViewCounts();
  window.reelTimeReelsLoaded = true;
};

async function ensureReelsLoaded() {
  if (!window.reelTimeReelsLoaded) await loadSavedReels();
}

const recordedViews = new Set();

async function recordView(reelId) {
  const reel = reels.find((item) => String(item.id) === String(reelId));
  const client = getClient();
  const user = await getCurrentUser();

  if (!reel || reel.isDemo || !client || !user || reel.userId === user.id) return;

  recordedViews.add(String(reelId));

  const { error } = await client
    .from("reel_views")
    .upsert(
      { reel_id: reel.id, viewer_id: user.id },
      { onConflict: "reel_id,viewer_id", ignoreDuplicates: true }
    );

  if (error) console.warn("Could not record view:", error.message);
}

// "playing" does not bubble, so listen in the capture phase.
document.addEventListener(
  "playing",
  (event) => {
    const video = event.target;

    if (!(video instanceof HTMLVideoElement)) return;
    if (!video.classList.contains("reel-video")) return;

    const reelId = video.closest(".reel-card")?.dataset.id;

    if (!reelId || recordedViews.has(String(reelId))) return;

    setTimeout(() => {
      if (!video.paused && !recordedViews.has(String(reelId))) {
        recordView(reelId);
      }
    }, 2000);
  },
  true
);

// --------------------------------------------------
// PROFILE: grid of this person's Reels only, with
// views / likes / comments on every tile
// --------------------------------------------------

function renderProfileReels(container, emptyElement, userId) {
  const items = reels.filter((reel) => reel.userId === userId);

  container.replaceChildren();
  emptyElement?.classList.toggle("hidden", items.length > 0);

  items.forEach((reel) => {
    const tile = document.createElement("div");
    tile.className = "profile-reel-tile";
    tile.style.cursor = "pointer";

    const video = document.createElement("video");
    // "#t=0.1" makes browsers show a still frame as the thumbnail.
    video.src = (reel.localUrl || "") + "#t=0.1";
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;

    const stats = document.createElement("div");
    stats.className = "tile-stats";
    stats.innerHTML =
      `<span title="Views">▶ ${formatNum(reel.views || 0)}</span>` +
      `<span title="Likes">♥ ${formatNum(reel.likes || 0)}</span>` +
      `<span title="Comments">◯ ${formatNum(reel.comments || 0)}</span>`;

    tile.append(video, stats);

    // Opens the separate Reels page, starting at this Reel.
    tile.addEventListener("click", () => openReelsViewer(userId, reel.id));

    container.appendChild(tile);
  });

  return items;
}

async function loadMyProfile() {
  const client = getClient();

  if (!client) {
    toast("Supabase is not connected.");
    return;
  }

  try {
    const user = await getCurrentUser();

    if (!user) {
      promptLogin("Please log in to view your profile.");
      return;
    }

    window.currentReelTimeUserId = user.id;

    await ensureReelsLoaded();

    const [profileRes, followersRes, followingRes] = await Promise.all([
      client
        .from("profiles")
        .select("id, username, full_name, avatar_url")
        .eq("id", user.id)
        .maybeSingle(),
      client
        .from("follows")
        .select("*", { count: "exact", head: true })
        .eq("following_id", user.id),
      client
        .from("follows")
        .select("*", { count: "exact", head: true })
        .eq("follower_id", user.id)
    ]);

    for (const result of [profileRes, followersRes, followingRes]) {
      if (result.error) throw result.error;
    }

    const profile = profileRes.data;
    const mine = reels.filter((reel) => reel.userId === user.id);

    const sum = (key) => mine.reduce((total, reel) => total + (reel[key] || 0), 0);

    const displayName =
      profile?.full_name ||
      user.user_metadata?.full_name ||
      user.email?.split("@")[0] ||
      "ReelTime user";

    $("profile-display-name").textContent = displayName;
    $("profile-username").textContent = "@" + (profile?.username || "user");

    setAvatar(
      $("profile-avatar"),
      $("profile-avatar-image"),
      profile?.avatar_url,
      displayName
    );

    // Separate counters: reels, followers, following.
    $("profile-reel-count").textContent = mine.length;
    $("profile-follower-count").textContent = followersRes.count || 0;
    $("profile-following-count").textContent = followingRes.count || 0;

    // Totals for this person's own Reels.
    $("profile-like-count").textContent = formatNum(sum("likes"));
    $("profile-view-count").textContent = formatNum(sum("views"));
    $("profile-comment-count").textContent = formatNum(sum("comments"));

    showPage("profile-page", "Your profile");
    setActiveNav("profile");

    renderProfileReels($("profile-reels"), $("profile-empty"), user.id);
  } catch (error) {
    console.error("Could not load your profile:", error);
    toast("Could not load your profile. Check the browser console.");
  }
}

async function openOtherUserProfile(userId) {
  if (!userId) return;

  const client = getClient();

  if (!client) {
    toast("Supabase is not connected.");
    return;
  }

  const me = await getCurrentUser();

  if (!me) {
    promptLogin("Please log in to view creator profiles.");
    return;
  }

  if (userId === me.id) {
    await loadMyProfile();
    return;
  }

  showPage("other-profile-page", "Creator Profile");

  $("other-profile-display-name").textContent = "Loading...";
  $("other-profile-username").textContent = "";
  $("other-profile-reel-count").textContent = "0";
  $("other-profile-follower-count").textContent = "0";
  $("other-profile-following-count").textContent = "0";
  $("other-profile-reels").replaceChildren();
  $("other-profile-empty").classList.add("hidden");

  const letterEl = $("other-profile-avatar");
  const imageEl = $("other-profile-avatar-image");
  setAvatar(letterEl, imageEl, null, "U");

  const followButton = $("other-profile-follow-btn");
  followButton.dataset.userId = userId;
  followButton.textContent = myFollowingIds.has(userId) ? "Following" : "Follow";

  const messageButton = $("other-profile-message-btn");
  if (messageButton) messageButton.dataset.userId = userId;

  try {
    await ensureReelsLoaded();

    const [profileRes, followersRes, followingRes] = await Promise.all([
      client
        .from("profiles")
        .select("id, username, full_name, avatar_url")
        .eq("id", userId)
        .maybeSingle(),
      client
        .from("follows")
        .select("*", { count: "exact", head: true })
        .eq("following_id", userId),
      client
        .from("follows")
        .select("*", { count: "exact", head: true })
        .eq("follower_id", userId)
    ]);

    for (const result of [profileRes, followersRes, followingRes]) {
      if (result.error) throw result.error;
    }

    const profile = profileRes.data;

    if (!profile) {
      toast("Creator profile not found.");
      showFeed();
      return;
    }

    const displayName = profile.full_name || profile.username || "Creator";

    $("other-profile-display-name").textContent = displayName;
    $("other-profile-username").textContent = "@" + (profile.username || "creator");

    setAvatar(letterEl, imageEl, profile.avatar_url, displayName);

    const items = renderProfileReels(
      $("other-profile-reels"),
      $("other-profile-empty"),
      userId
    );

    $("other-profile-reel-count").textContent = items.length;
    $("other-profile-follower-count").textContent = followersRes.count || 0;
    $("other-profile-following-count").textContent = followingRes.count || 0;
  } catch (error) {
    console.error("Could not load creator profile:", error);
    toast("Could not load this profile. Check the browser console.");
  }
}

// "Message" button on another creator's profile.
$("other-profile-message-btn")?.addEventListener("click", async (event) => {
  const userId = event.currentTarget.dataset.userId;
  const client = getClient();

  if (!userId || !client) return;

  const { data: profile } = await client
    .from("profiles")
    .select("id, username, full_name, avatar_url")
    .eq("id", userId)
    .maybeSingle();

  if (!profile) {
    toast("Could not open this chat.");
    return;
  }

  setActiveNav("messages");
  await openMessagesPage();
  await openChatWithUser(profile);
});

// --------------------------------------------------
// REELS PAGE (separate page, like Instagram)
// Scroll up/down through one creator's Reels.
// --------------------------------------------------

let reelsViewerUserId = null;

function buildReelsViewerList(startId) {
  const host = $("rv-list");
  const items = reels.filter((reel) => reel.userId === reelsViewerUserId);

  host.replaceChildren();

  items.forEach((reel) => {
    const item = document.createElement("div");
    item.className = "rv-item";
    item.appendChild(buildReelCard(reel));
    host.appendChild(item);
  });

  host
    .querySelectorAll("video.reel-video")
    .forEach((video) => reelVideoObserver.observe(video));

  requestAnimationFrame(() => {
    if (startId === null || startId === undefined) return;

    const target = host.querySelector(
      `.reel-card[data-id="${CSS.escape(String(startId))}"]`
    );

    if (target) host.scrollTop = target.parentElement.offsetTop;
  });
}

async function openReelsViewer(userId, startId) {
  await ensureReelsLoaded();

  const items = reels.filter((reel) => reel.userId === userId);

  if (items.length === 0) {
    toast("There are no Reels to show.");
    return;
  }

  reelsViewerUserId = userId;

  showPage("reels-viewer-page", "Reels");
  setActiveNav("profile");

  $("rv-title").textContent =
    userId === window.currentReelTimeUserId
      ? "Your Reels"
      : "@" + (items[0].user || "creator") + " · Reels";

  buildReelsViewerList(startId);
}

// Rebuild the Reels page if the feed data changes while it is open
// (for example after deleting a Reel).
function refreshReelsViewerIfOpen() {
  const page = $("reels-viewer-page");

  if (!page || page.classList.contains("hidden")) return;

  const host = $("rv-list");
  const current = Array.from(host.children).find(
    (child) => child.offsetTop + child.offsetHeight > host.scrollTop + 10
  );

  buildReelsViewerList(current?.querySelector(".reel-card")?.dataset.id ?? null);
}

const renderFeedOriginal = renderFeed;

renderFeed = function (...args) {
  renderFeedOriginal(...args);
  refreshReelsViewerIfOpen();
  refreshReelsTabIfOpen();
};

$("rv-back")?.addEventListener("click", () => {
  if (reelsViewerUserId === window.currentReelTimeUserId) {
    loadMyProfile();
  } else {
    openOtherUserProfile(reelsViewerUserId);
  }
});

// --------------------------------------------------
// MESSAGES — Instagram-style inbox
// --------------------------------------------------

let dmMessages = [];
let dmOpenToken = 0;
let dmSearchTimer = null;
let dmStatusTimer = null;

function dmAvatar(profile) {
  const name = profile?.full_name || profile?.username || "U";

  if (profile?.avatar_url) {
    const image = document.createElement("img");
    image.className = "avatar";
    image.src = profile.avatar_url;
    image.alt = "";
    return image;
  }

  const letter = document.createElement("div");
  letter.className = "avatar avatar-you";
  letter.textContent = name.charAt(0).toUpperCase();
  return letter;
}

function shortTime(iso) {
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000;

  if (seconds < 60) return "now";
  if (seconds < 3600) return Math.floor(seconds / 60) + "m";
  if (seconds < 86400) return Math.floor(seconds / 3600) + "h";
  if (seconds < 604800) return Math.floor(seconds / 86400) + "d";

  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short"
  });
}

function dayLabel(date) {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";

  return date.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short"
  });
}

function setDmStatus(text) {
  const element = $("dm-status");

  if (!element) return;

  element.textContent = text || "";
  clearTimeout(dmStatusTimer);

  if (text) {
    dmStatusTimer = setTimeout(() => {
      element.textContent = "";
    }, 5000);
  }
}

function setDmListMessage(text) {
  const list = $("dm-list");
  const message = document.createElement("p");

  message.className = "dm-list-message";
  message.textContent = text;
  list.replaceChildren(message);
}

function showDmChat(show) {
  $("dm-chat").classList.toggle("hidden", !show);
  $("dm-empty").classList.toggle("hidden", show);
  $("messages-page").classList.toggle("chat-open", show);
}

function renderDmHeader(profile) {
  $("dm-head-avatar").replaceChildren(dmAvatar(profile));
  $("dm-head-name").textContent =
    profile.full_name || profile.username || "ReelTime user";
  $("dm-head-handle").textContent = profile.username ? "@" + profile.username : "";
}

// A missed call is saved as a normal chat message with this exact text.
// renderThread() shows it as a call line instead of a bubble.
const MISSED_CALL_TEXT = "📹 Missed video call";
const MISSED_AUDIO_CALL_TEXT = "📞 Missed audio call";

function renderThread() {
  const box = $("dm-messages");

  const myId = reelTimeChatUserId;

  const sorted = dmMessages
    .slice()
    .sort(
      (a, b) =>
        new Date(a.created_at) - new Date(b.created_at) ||
        String(a.id).localeCompare(String(b.id))
    );

  box.replaceChildren();

  let lastDay = "";
  let lastMine = null;

  sorted.forEach((message) => {
    const date = new Date(message.created_at);
    const dayKey = date.toDateString();

    if (dayKey !== lastDay) {
      const separator = document.createElement("div");
      separator.className = "dm-day";
      separator.textContent = dayLabel(date);
      box.appendChild(separator);
      lastDay = dayKey;
    }

    const mine = message.sender_id === myId;

    // Missed call line (the caller sees "No answer", the other person sees "Missed ... call").
    if (
      message.message_text === MISSED_CALL_TEXT ||
      message.message_text === MISSED_AUDIO_CALL_TEXT
    ) {
      const isAudio = message.message_text === MISSED_AUDIO_CALL_TEXT;

      const logRow = document.createElement("div");
      logRow.className = "dm-row dm-call-log";

      const pill = document.createElement("div");
      pill.className = "dm-call-pill" + (mine ? "" : " missed");
      pill.textContent = mine
        ? (isAudio ? "📞 No answer" : "📹 No answer")
        : message.message_text;
      pill.title = date.toLocaleString();

      logRow.appendChild(pill);
      box.appendChild(logRow);
      return;
    }

    const row = document.createElement("div");
    row.className = "dm-row" + (mine ? " mine" : "");

    const bubble = document.createElement("div");
    bubble.className = "dm-bubble";
    bubble.textContent = message.message_text;
    bubble.title = date.toLocaleString();

    row.appendChild(bubble);
    box.appendChild(row);

    if (mine) lastMine = { row, message };
  });

  // Like Instagram: only the newest message you sent shows Sent / Seen.
  if (lastMine) {
    const status = document.createElement("small");
    status.className = "dm-seen";
    status.textContent = lastMine.message.read_at ? "Seen" : "Sent";
    lastMine.row.appendChild(status);
  }

  box.scrollTop = box.scrollHeight;
}

function pushMessage(message) {
  const index = dmMessages.findIndex((item) => item.id === message.id);

  if (index >= 0) {
    dmMessages[index] = { ...dmMessages[index], ...message };
  } else {
    dmMessages.push(message);
  }

  renderThread();
}

async function markIncomingRead(ids) {
  const client = getClient();

  if (!client || ids.length === 0) return;

  const { error } = await client
    .from("messages")
    .update({ read_at: new Date().toISOString() })
    .in("id", ids)
    .eq("receiver_id", reelTimeChatUserId);

  if (error) {
    console.error("Marking messages as read failed:", error);
    return;
  }

  refreshMessagesDot();
  loadRecentChats();
}

async function openMessagesPage() {
  const client = getClient();

  if (!client) {
    toast("Supabase is not connected.");
    return;
  }

  const user = await getCurrentUser();

  if (!user) {
    promptLogin("Please log in to use Messages.");
    return;
  }

  reelTimeChatUserId = user.id;
  reelTimeChatUser = null;
  dmMessages = [];

  showPage("messages-page", "Messages");
  showDmChat(false);

  $("dm-search").value = "";
  $("dm-list-title").textContent = "Messages";

  await loadRecentChats();
}

async function loadRecentChats() {
  const client = getClient();
  const list = $("dm-list");

  if (!client || !list) return;

  // While the person is searching, the list shows search results instead.
  if ($("dm-search").value.trim()) return;

  const user = await getCurrentUser();

  if (!user) {
    setDmListMessage("Log in to see your messages.");
    return;
  }

  const { data: messages, error } = await client
    .from("messages")
    .select("id, sender_id, receiver_id, message_text, created_at, read_at")
    .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    console.error("Recent chats error:", error);
    setDmListMessage("Could not load your chats.");
    return;
  }

  const latestByUser = new Map();
  const unreadCounts = new Map();

  (messages || []).forEach((message) => {
    const otherId =
      message.sender_id === user.id ? message.receiver_id : message.sender_id;

    // Newest first, so the first message we see is the latest one.
    if (!latestByUser.has(otherId)) latestByUser.set(otherId, message);

    if (message.receiver_id === user.id && message.read_at === null) {
      unreadCounts.set(otherId, (unreadCounts.get(otherId) || 0) + 1);
    }
  });

  const otherIds = [...latestByUser.keys()];

  if (otherIds.length === 0) {
    setDmListMessage("No messages yet. Tap ✎ to start a chat.");
    return;
  }

  const { data: profiles, error: profileError } = await client
    .from("profiles")
    .select("id, username, full_name, avatar_url")
    .in("id", otherIds);

  if (profileError) {
    console.error("Recent chat profiles error:", profileError);
    setDmListMessage("Could not load your chats.");
    return;
  }

  // The person may have started searching while we were loading.
  if ($("dm-search").value.trim()) return;

  const profileMap = new Map((profiles || []).map((profile) => [profile.id, profile]));

  list.replaceChildren();

  otherIds.forEach((otherId) => {
    const profile = profileMap.get(otherId);

    if (!profile) return;

    const latest = latestByUser.get(otherId);
    const unread = unreadCounts.get(otherId) || 0;
    const name = profile.full_name || profile.username || "ReelTime user";

    const item = document.createElement("button");
    item.type = "button";
    item.className = "dm-item";

    if (unread > 0) item.classList.add("unread");
    if (reelTimeChatUser?.id === otherId) item.classList.add("active");

    const text = document.createElement("div");
    text.className = "dm-item-text";

    const title = document.createElement("strong");
    title.textContent = name;

    const line = document.createElement("div");
    line.className = "dm-preview-line";

    const preview = document.createElement("span");
    preview.className = "dm-preview";
    preview.textContent =
      (latest.sender_id === user.id ? "You: " : "") + (latest.message_text || "");

    const time = document.createElement("span");
    time.className = "dm-time";
    time.textContent = "· " + shortTime(latest.created_at);

    line.append(preview, time);
    text.append(title, line);
    item.append(dmAvatar(profile), text);

    if (unread > 0) {
      const dot = document.createElement("i");
      dot.className = "dm-unread-dot";
      dot.setAttribute("aria-label", `${unread} unread`);
      item.appendChild(dot);
    }

    item.addEventListener("click", () => openChatWithUser(profile));

    list.appendChild(item);
  });

  if (!list.childElementCount) setDmListMessage("No messages yet.");
}

async function openChatWithUser(profile) {
  const client = getClient();
  const token = ++dmOpenToken;

  await closeChatChannel();

  reelTimeChatUser = profile;
  dmMessages = [];

  showDmChat(true);
  renderDmHeader(profile);
  setDmStatus("");

  const box = $("dm-messages");
  const loading = document.createElement("p");
  loading.className = "dm-list-message";
  loading.textContent = "Loading…";
  box.replaceChildren(loading);

  const myId = reelTimeChatUserId;
  const otherId = profile.id;

  // Get this user's Clear Chat timestamp.
  const { data: clearRecord, error: clearError } = await client
    .from("chat_clears")
    .select("cleared_at")
    .eq("user_id", myId)
    .eq("other_id", otherId)
    .maybeSingle();

  if (token !== dmOpenToken) return;

  if (clearError) {
    console.error("Checking chat clear time failed:", clearError);
    setDmStatus("Could not load chat settings.");
    return;
  }

  const clearedAt = clearRecord?.cleared_at || null;

  let messageQuery = client
    .from("messages")
    .select("id, sender_id, receiver_id, message_text, created_at, read_at")
    .or(
      `and(sender_id.eq.${myId},receiver_id.eq.${otherId}),and(sender_id.eq.${otherId},receiver_id.eq.${myId})`
    );

  if (clearedAt) {
    messageQuery = messageQuery.gt("created_at", clearedAt);
  }

  const { data, error } = await messageQuery
    .order("created_at", { ascending: true })
    .limit(500);

  // The person opened another chat while this one was loading.
  if (token !== dmOpenToken) return;

  if (error) {
    console.error("Loading chat failed:", error);
    box.replaceChildren();
    setDmStatus("Could not load messages. Check your messages permissions.");
    return;
  }

  dmMessages = data || [];
  renderThread();

  $("dm-input").focus();

  markIncomingRead(
    dmMessages
      .filter((message) => message.receiver_id === myId && !message.read_at)
      .map((message) => message.id)
  );

  // Live updates for this chat. The timestamp keeps the channel name unique.
  reelTimeChatChannel = client
    .channel(`chat-${myId}-${otherId}-${Date.now()}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "messages" },
      (payload) => {
        const message = payload.new;

        if (!message || !message.sender_id) return;
        if (
          clearedAt &&
          Date.parse(message.created_at) <= Date.parse(clearedAt)
        ) {
          return;
        }

        const relevant =
          (message.sender_id === myId && message.receiver_id === otherId) ||
          (message.sender_id === otherId && message.receiver_id === myId);

        if (!relevant || reelTimeChatUser?.id !== otherId) return;

        pushMessage(message);

        if (
          payload.eventType === "INSERT" &&
          message.receiver_id === myId &&
          !message.read_at
        ) {
          markIncomingRead([message.id]);
        }
      }
    )
    .subscribe((status) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        setDmStatus("Live updates are off. Check Supabase Realtime.");
      }
    });

  loadRecentChats();
}

// ----- sending -----

function updateSendButton() {
  $("dm-send").classList.toggle("ready", $("dm-input").value.trim().length > 0);
}

$("dm-input")?.addEventListener("input", updateSendButton);

$("dm-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const client = getClient();
  const input = $("dm-input");
  const text = input.value.trim();

  if (!client || !reelTimeChatUser || !text) return;

  const button = $("dm-send");
  button.disabled = true;

  try {
    const { data, error } = await client
      .from("messages")
      .insert({
        sender_id: reelTimeChatUserId,
        receiver_id: reelTimeChatUser.id,
        message_text: text
      })
      .select("id, sender_id, receiver_id, message_text, created_at, read_at")
      .single();

    if (error) throw error;

    pushMessage(data);
    input.value = "";
    updateSendButton();
    loadRecentChats();
  } catch (error) {
    console.error("Sending message failed:", error);
    setDmStatus("Message failed to send. Check your messages permissions.");
  } finally {
    button.disabled = false;
    input.focus();
  }
});

// ----- search for people to message -----

async function runDmSearch() {
  const client = getClient();
  const raw = $("dm-search").value.trim().replace(/^@/, "");

  if (!raw) {
    $("dm-list-title").textContent = "Messages";
    loadRecentChats();
    return;
  }

  $("dm-list-title").textContent = "People";

  // Characters with a special meaning in the filter are removed.
  const term = raw.replace(/[,()%*]/g, "");
  const user = await getCurrentUser();

  if (!client || !user) return;

  if (!term) {
    setDmListMessage("No people found.");
    return;
  }

  const { data, error } = await client
    .from("profiles")
    .select("id, username, full_name, avatar_url")
    .or(`username.ilike.%${term}%,full_name.ilike.%${term}%`)
    .limit(20);

  // The search box changed while we were waiting.
  if ($("dm-search").value.trim().replace(/^@/, "") !== raw) return;

  if (error) {
    console.error("Profile search error:", error);
    setDmListMessage("Search failed. Check the profiles SELECT policy.");
    return;
  }

  const people = (data || []).filter((profile) => profile.id !== user.id);

  if (people.length === 0) {
    setDmListMessage("No people found.");
    return;
  }

  const list = $("dm-list");
  list.replaceChildren();

  people.forEach((profile) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "dm-item";

    const text = document.createElement("div");
    text.className = "dm-item-text";

    const name = document.createElement("strong");
    name.textContent = profile.full_name || profile.username || "ReelTime user";

    const handle = document.createElement("span");
    handle.className = "dm-preview";
    handle.textContent = profile.username ? "@" + profile.username : "";

    text.append(name, handle);
    item.append(dmAvatar(profile), text);

    item.addEventListener("click", () => {
      $("dm-search").value = "";
      $("dm-list-title").textContent = "Messages";
      openChatWithUser(profile);
    });

    list.appendChild(item);
  });
}

$("dm-search")?.addEventListener("input", () => {
  clearTimeout(dmSearchTimer);
  dmSearchTimer = setTimeout(runDmSearch, 250);
});

function focusDmSearch() {
  reelTimeChatUser = null;
  showDmChat(false);
  $("dm-search").focus();
}

$("dm-new-btn")?.addEventListener("click", focusDmSearch);
$("dm-empty-btn")?.addEventListener("click", focusDmSearch);

// Back arrow in the chat header (visible on phones).
$("dm-back")?.addEventListener("click", () => {
  closeChatChannel();
  reelTimeChatUser = null;
  showDmChat(false);
  loadRecentChats();
});

// Tap the name in the chat header to open that person's profile.
$("dm-head-user")?.addEventListener("click", () => {
  if (reelTimeChatUser) openOtherUserProfile(reelTimeChatUser.id);
});

// --------------------------------------------------
// REELS TAB (TikTok-style: scroll through all Reels)
// --------------------------------------------------

function buildReelsTabList(startId = null) {
  const host = $("rt-list");
  const items = reels.filter((reel) => !reel.isDemo);

  host.replaceChildren();

  if (items.length === 0) {
    setListMessage(host, "No Reels yet. Tap ＋ to create one.");
    updateReelsTabArrows();
    return;
  }

  items.forEach((reel) => {
    const item = document.createElement("div");
    item.className = "rv-item";
    item.appendChild(buildReelCard(reel));
    host.appendChild(item);
  });

  host
    .querySelectorAll("video.reel-video")
    .forEach((video) => reelVideoObserver.observe(video));

  requestAnimationFrame(() => {
    const target =
      startId !== null &&
      host.querySelector(`.reel-card[data-id="${CSS.escape(String(startId))}"]`);

    host.scrollTop = target ? target.parentElement.offsetTop : 0;
    updateReelsTabArrows();
  });
}

async function openReelsTab() {
  await ensureReelsLoaded();
  showPage("reels-tab-page", "Reels");
  setActiveNav("reels");
  buildReelsTabList();
}

// Keeps your place if the data reloads while the tab is open.
function refreshReelsTabIfOpen() {
  const page = $("reels-tab-page");

  if (!page || page.classList.contains("hidden")) return;

  const host = $("rt-list");
  const current = Array.from(host.children).find(
    (child) => child.offsetTop + child.offsetHeight > host.scrollTop + 10
  );

  buildReelsTabList(current?.querySelector(".reel-card")?.dataset.id ?? null);
}

// The + button opens the Create Reel popup.
$("rt-create")?.addEventListener("click", openCreate);

// Up / down buttons (like Instagram on a computer), keyboard arrows,
// and the button state for the Reels tab.
(function addReelsTabArrows() {
  const page = $("reels-tab-page");

  if (!page || $("rt-prev")) return;

  const wrap = document.createElement("div");
  wrap.className = "rt-arrows";
  wrap.innerHTML =
    '<button class="rt-arrow" id="rt-prev" type="button" aria-label="Previous Reel">↑</button>' +
    '<button class="rt-arrow" id="rt-next" type="button" aria-label="Next Reel">↓</button>';

  page.appendChild(wrap);
})();

function reelsTabItems() {
  return Array.from($("rt-list").querySelectorAll(".rv-item"));
}

// Which Reel fills most of the screen right now (0 = the first one).
function currentReelsTabIndex() {
  const host = $("rt-list");
  let current = 0;

  reelsTabItems().forEach((item, index) => {
    if (item.offsetTop - host.scrollTop <= host.clientHeight / 2) current = index;
  });

  return current;
}

function updateReelsTabArrows() {
  const previous = $("rt-prev");
  const next = $("rt-next");

  if (!previous || !next) return;

  const total = reelsTabItems().length;
  const index = currentReelsTabIndex();

  previous.disabled = total === 0 || index <= 0;
  next.disabled = total === 0 || index >= total - 1;
}

function stepReelsTab(direction) {
  const items = reelsTabItems();

  if (items.length === 0) return;

  const target = Math.min(items.length - 1, Math.max(0, currentReelsTabIndex() + direction));

  $("rt-list").scrollTo({ top: items[target].offsetTop, behavior: "smooth" });
}

$("rt-prev")?.addEventListener("click", () => stepReelsTab(-1));
$("rt-next")?.addEventListener("click", () => stepReelsTab(1));

let reelsTabScrollFrame = 0;

$("rt-list")?.addEventListener(
  "scroll",
  () => {
    cancelAnimationFrame(reelsTabScrollFrame);
    reelsTabScrollFrame = requestAnimationFrame(updateReelsTabArrows);
  },
  { passive: true }
);

// Up / Down arrow keys move between Reels while the Reels tab is open.
document.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;

  const page = $("reels-tab-page");

  if (!page || page.classList.contains("hidden")) return;
  if (document.querySelector(".modal-backdrop:not(.hidden)")) return;
  if ($("call-overlay") && !$("call-overlay").classList.contains("hidden")) return;

  const target = event.target;

  if (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable) return;

  event.preventDefault();
  stepReelsTab(event.key === "ArrowDown" ? 1 : -1);
});

// Reels nav buttons (sidebar + mobile bar).
// Handled here so app.js does not need to change. Capturing on the
// document stops app.js's own handler from also running for these buttons.
document.addEventListener(
  "click",
  (event) => {
    const button = event.target.closest?.('[data-view="reels"]');

    if (!button) return;

    event.stopPropagation();
    openReelsTab();
  },
  true
);

// --------------------------------------------------
// CREATOR SEARCH (top search bar)
// Type a name or @username and matching creators show
// in a dropdown under the search bar. Tap one to open
// their profile. The feed filter still works as before.
// --------------------------------------------------

(function setupCreatorSearch() {
  const input = $("search-input");
  const label = input?.closest(".search");

  if (!input || !label) return;

  const box = document.createElement("div");
  box.id = "creator-results";
  box.className = "creator-results hidden";
  label.appendChild(box);

  let timer = null;
  let requestId = 0;

  function hideBox() {
    requestId += 1;
    box.classList.add("hidden");
    box.replaceChildren();
  }

  function showMessage(text) {
    const message = document.createElement("p");
    message.className = "creator-results-message";
    message.textContent = text;
    box.replaceChildren(message);
    box.classList.remove("hidden");
  }

  async function runCreatorSearch() {
    const client = getClient();
    const raw = input.value.trim().replace(/^@/, "");
    // Characters with a special meaning in the filter are removed.
    const term = raw.replace(/[,()%*]/g, "");

    if (!client || !term) {
      hideBox();
      return;
    }

    const currentRequest = ++requestId;

    const { data, error } = await client
      .from("profiles")
      .select("id, username, full_name, avatar_url")
      .or(`username.ilike.%${term}%,full_name.ilike.%${term}%`)
      .limit(8);

    // The search text changed while we were waiting.
    if (currentRequest !== requestId) return;

    if (error) {
      console.warn("Creator search failed:", error.message);
      showMessage("Could not search creators.");
      return;
    }

    if (!data || data.length === 0) {
      showMessage("No creators found.");
      return;
    }

    box.replaceChildren();

    data.forEach((profile) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "creator-result";

      const text = document.createElement("div");
      text.className = "creator-result-text";

      const name = document.createElement("strong");
      name.textContent = profile.full_name || profile.username || "ReelTime user";

      const handle = document.createElement("small");
      handle.textContent = profile.username ? "@" + profile.username : "";

      text.append(name, handle);
      item.append(dmAvatar(profile), text);

      item.addEventListener("click", () => {
        input.value = "";
        hideBox();
        openOtherUserProfile(profile.id);
      });

      box.appendChild(item);
    });

    box.classList.remove("hidden");
  }

  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(runCreatorSearch, 250);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideBox();
  });

  // Close the dropdown when tapping anywhere else.
  document.addEventListener("click", (event) => {
    if (!label.contains(event.target)) hideBox();
  });
})();

// --------------------------------------------------
// AUDIO + VIDEO CALLS (secure version)
// Needs snap-calls.sql (audio + video version) to be run once in Supabase.
//
//  * start_call()  : database function that decides who may call whom
//                    (both people have chatted, not blocked, max 5 calls
//                    a minute) and creates a row in the "calls" table,
//                    including call_type = 'audio' or 'video'.
//  * Incoming call : the other person is told through a protected
//                    database change, so the caller's identity and the
//                    call type come from the server and cannot be faked.
//  * call:<callId> : a PRIVATE Realtime channel. Only the two people
//                    in that call can join it or send to it.
//  * The audio/video goes directly between the two browsers (WebRTC).
// --------------------------------------------------

(function setupVideoCalls() {
  const client = getClient();

  if (!client) return;

  const RTC_CONFIG = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
  const RING_TIMEOUT_MS = 30000;
  const INVITE_TIMEOUT_MS = 35000;

  let incomingChannel = null;
  let incomingUserId = null;
  let call = null;           // the call in progress (or being set up)
  let starting = false;      // true while a call is being created
  let pendingInvite = null;  // an incoming call that is still ringing
  let inviteTimer = null;
  const endedCallIds = new Set();

  function typeWord(callType) {
    return callType === "audio" ? "audio" : "video";
  }

  // ----- call notifications: ringtone, tab title, system pop-up -----

  let audioContext = null;
  let ringTimer = null;
  let savedTitle = null;
  let systemNotification = null;
  let permissionArmed = false;

  function beep() {
    try {
      audioContext =
        audioContext || new (window.AudioContext || window.webkitAudioContext)();

      if (audioContext.state === "suspended") audioContext.resume();

      [0, 0.25].forEach((offset) => {
        const start = audioContext.currentTime + offset;
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();

        oscillator.type = "sine";
        oscillator.frequency.value = 880;

        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.2);

        oscillator.connect(gain).connect(audioContext.destination);
        oscillator.start(start);
        oscillator.stop(start + 0.22);
      });
    } catch (error) {
      console.warn("Could not play the ringtone:", error);
    }
  }

  function startRingtone(callType = "video") {
    stopRingtone();

    beep();
    ringTimer = setInterval(beep, 2000);

    savedTitle = document.title;
    document.title =
      callType === "audio" ? "📞 Incoming audio call" : "📹 Incoming video call";
  }

  function stopRingtone() {
    clearInterval(ringTimer);
    ringTimer = null;

    if (savedTitle !== null) {
      document.title = savedTitle;
      savedTitle = null;
    }
  }

  // A pop-up outside the browser, shown only when the ReelTime tab is in the background.
  function showSystemNotification(name, callType = "video") {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    if (!document.hidden) return;

    try {
      systemNotification = new Notification(`Incoming ${typeWord(callType)} call`, {
        body: `${name} is calling you on ReelTime`,
        tag: "reeltime-call",
        requireInteraction: true
      });

      systemNotification.onclick = () => {
        window.focus();
        closeSystemNotification();
      };
    } catch (error) {
      console.warn("Could not show the pop-up notification:", error);
    }
  }

  function closeSystemNotification() {
    try {
      systemNotification?.close();
    } catch (error) {
      /* already closed */
    }

    systemNotification = null;
  }

  // Asks once (on the first click after logging in) to allow pop-up notifications.
  function armNotificationPermission() {
    if (permissionArmed || !("Notification" in window)) return;
    if (Notification.permission !== "default") return;

    permissionArmed = true;

    document.addEventListener(
      "click",
      () => {
        Notification.requestPermission().catch(() => {});
      },
      { once: true }
    );
  }

  // Adds "tried to call you" to the other person's Notifications page.
  async function recordMissedCall(activeCall) {
    const me = await getCurrentUser();

    if (!me) return;

    const isAudio = activeCall.callType === "audio";

    const { data: mine } = await client
      .from("profiles")
      .select("username, full_name")
      .eq("id", me.id)
      .maybeSingle();

    const name = mine?.username ? `@${mine.username}` : mine?.full_name || "Someone";

    const { error } = await client.from("notifications").insert({
      recipient_id: activeCall.peerId,
      actor_id: me.id,
      type: "call",
      message: `${name} tried to ${isAudio ? "audio" : "video"} call you.`
    });

    if (error) console.warn("Could not save the missed call notification:", error.message);

    // Also leave a line in their chat with you, like Instagram.
    const { error: messageError } = await client.from("messages").insert({
      sender_id: me.id,
      receiver_id: activeCall.peerId,
      message_text: isAudio ? MISSED_AUDIO_CALL_TEXT : MISSED_CALL_TEXT
    });

    if (messageError) console.warn("Could not save the missed call in the chat:", messageError.message);
  }

  // ----- small helpers -----

  function send(channel, event, payload = {}) {
    return channel.send({ type: "broadcast", event, payload }).catch((error) => {
      console.warn("Call message failed:", error);
    });
  }

  function mediaErrorMessage(error, callType = "video") {
    if (error?.name === "NotAllowedError" || error?.name === "SecurityError") {
      return callType === "audio"
        ? "Allow microphone access to use audio calls."
        : "Allow camera and microphone access to use video calls.";
    }

    if (error?.name === "NotFoundError") {
      return callType === "audio"
        ? "No microphone was found."
        : "No camera or microphone was found.";
    }

    return error?.message || "Could not access your microphone or camera.";
  }

  function callErrorMessage(error) {
    const text = `${error?.message || ""} ${error?.code || ""}`;

    if (/not_allowed/i.test(text)) {
      return "You can call someone after you have both sent messages in your chat, and if neither of you has blocked the other.";
    }

    if (/too_many_calls/i.test(text)) {
      return "Too many call attempts. Please wait a minute and try again.";
    }

    if (/not_logged_in/i.test(text)) {
      return "Please log in to start a call.";
    }

    if (/PGRST202|Could not find the function|start_call/i.test(text)) {
      return "Calls are not set up yet. Run snap-calls.sql in Supabase.";
    }

    return "Could not start the call. Please try again.";
  }

  async function getMedia(callType = "video") {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Calls need HTTPS or localhost.");
    }

    return navigator.mediaDevices.getUserMedia({
      video: callType === "video",
      audio: true
    });
  }

  // Joins the private room for one call. The database policies only let
  // the caller and the callee in.
  async function joinRoom(callId) {
    try {
      await client.realtime.setAuth();
    } catch (error) {
      console.warn("Could not refresh the realtime login:", error);
    }

    const room = client.channel(`call:${callId}`, {
      config: { private: true, broadcast: { self: false } }
    });

    const forThisCall = (handler) => (message) => {
      if (call && call.id === callId) handler(message.payload || {});
    };

    room
      .on("broadcast", { event: "ready" }, forThisCall(onReady))
      .on("broadcast", { event: "offer" }, forThisCall(onOffer))
      .on("broadcast", { event: "answer" }, forThisCall(onAnswer))
      .on("broadcast", { event: "ice" }, forThisCall(onIce))
      .on("broadcast", { event: "hangup" }, forThisCall(() => endCall(false, "Call ended.")))
      .on(
        "broadcast",
        { event: "decline" },
        forThisCall(() => {
          if (call) call.declined = true;
          endCall(false, "Call declined.");
        })
      );

    return new Promise((resolve, reject) => {
      room.subscribe((status, error) => {
        if (status === "SUBSCRIBED") resolve(room);

        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.error("Call channel error:", status, error);
          client.removeChannel(room);
          reject(
            new Error(
              "Could not connect to the call. Make sure snap-calls.sql was run in Supabase."
            )
          );
        }
      });
    });
  }

  // ----- call screen -----

  function getOverlay() {
    let overlay = $("call-overlay");

    if (overlay) return overlay;

    overlay = document.createElement("div");
    overlay.id = "call-overlay";
    overlay.className = "call-overlay hidden";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.innerHTML = `
      <div class="call-stage">
        <video class="call-remote" playsinline autoplay></video>
        <video class="call-local" playsinline autoplay muted></video>
        <div class="call-info">
          <div class="call-avatar"></div>
          <strong class="call-name"></strong>
          <span class="call-status"></span>
        </div>
        <div class="call-controls">
          <button type="button" class="call-btn" data-act="mic" aria-label="Mute microphone">🎤</button>
          <button type="button" class="call-btn" data-act="cam" aria-label="Turn camera off">📷</button>
          <button type="button" class="call-btn call-accept" data-act="accept" aria-label="Accept call">📞</button>
          <button type="button" class="call-btn call-end" data-act="end" aria-label="End call">✕</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector(".call-controls").addEventListener("click", (event) => {
      const button = event.target.closest("[data-act]");

      if (!button) return;

      const action = button.dataset.act;

      if (action === "accept") acceptInvite();
      else if (action === "end") pendingInvite ? declineInvite() : endCall(true);
      else if (action === "mic") toggleTrack("audio", button);
      else if (action === "cam") toggleTrack("video", button);
    });

    return overlay;
  }

  function setStatus(text) {
    getOverlay().querySelector(".call-status").textContent = text || "";
  }

  function showOverlay({ name, profile, status, incoming, callType = "video" }) {
    const overlay = getOverlay();

    overlay.classList.remove("hidden", "connected");
    overlay.classList.toggle("incoming", Boolean(incoming));
    overlay.classList.toggle("audio-only", callType === "audio");

    overlay.querySelector(".call-name").textContent = name;
    overlay.querySelector(".call-avatar").replaceChildren(dmAvatar(profile));

    const mic = overlay.querySelector('[data-act="mic"]');
    const cam = overlay.querySelector('[data-act="cam"]');

    mic.classList.remove("off");
    mic.textContent = "🎤";
    cam.classList.remove("off");
    cam.textContent = "📷";

    setStatus(status);
    document.body.style.overflow = "hidden";
  }

  function hideOverlay() {
    const overlay = getOverlay();

    overlay.classList.add("hidden");
    overlay.classList.remove("connected", "incoming", "audio-only");

    overlay.querySelectorAll("video").forEach((video) => {
      video.srcObject = null;
    });

    document.body.style.overflow = "";
  }

  function toggleTrack(kind, button) {
    const stream = call?.localStream;

    if (!stream) return;

    const tracks = kind === "audio" ? stream.getAudioTracks() : stream.getVideoTracks();

    if (tracks.length === 0) return;

    const enable = !tracks[0].enabled;

    tracks.forEach((track) => {
      track.enabled = enable;
    });

    button.classList.toggle("off", !enable);
    button.textContent =
      kind === "audio" ? (enable ? "🎤" : "🔇") : (enable ? "📷" : "🚫");
  }

  function markConnected(activeCall) {
    if (call !== activeCall || activeCall.connected) return;

    activeCall.connected = true;
    clearTimeout(activeCall.timer);

    getOverlay().classList.add("connected");

    const startedAt = Date.now();

    const tick = () => {
      const seconds = Math.floor((Date.now() - startedAt) / 1000);
      const minutes = String(Math.floor(seconds / 60)).padStart(2, "0");
      setStatus(`${minutes}:${String(seconds % 60).padStart(2, "0")}`);
    };

    tick();
    activeCall.tick = setInterval(tick, 1000);
  }

  // ----- WebRTC connection -----

  function makePeer() {
    const activeCall = call;
    const pc = new RTCPeerConnection(RTC_CONFIG);

    activeCall.localStream
      .getTracks()
      .forEach((track) => pc.addTrack(track, activeCall.localStream));

    pc.ontrack = (event) => {
      const remote = getOverlay().querySelector(".call-remote");

      remote.srcObject = event.streams[0];
      remote.play().catch(() => {});
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && call === activeCall) {
        send(activeCall.room, "ice", { candidate: event.candidate.toJSON() });
      }
    };

    pc.onconnectionstatechange = () => {
      if (call !== activeCall) return;

      if (pc.connectionState === "connected") {
        markConnected(activeCall);
      } else if (pc.connectionState === "disconnected") {
        setStatus("Reconnecting…");
      } else if (pc.connectionState === "failed") {
        endCall(true, "The connection failed. Try again.");
      }
    };

    activeCall.pc = pc;
    return pc;
  }

  async function flushPendingIce(activeCall) {
    const queued = activeCall.pendingIce.splice(0);

    for (const candidate of queued) {
      try {
        await activeCall.pc.addIceCandidate(candidate);
      } catch (error) {
        console.warn("Could not add ICE candidate:", error);
      }
    }
  }

  // The other person accepted: the caller creates the offer.
  async function onReady() {
    const activeCall = call;

    if (!activeCall || activeCall.role !== "caller" || activeCall.pc) return;

    clearTimeout(activeCall.timer);
    setStatus("Connecting…");

    try {
      const pc = makePeer();
      const offer = await pc.createOffer();

      await pc.setLocalDescription(offer);
      send(activeCall.room, "offer", { sdp: pc.localDescription });
    } catch (error) {
      console.error("Could not create the call offer:", error);
      endCall(true, "Could not start the call.");
    }
  }

  async function onOffer(payload) {
    const activeCall = call;

    if (!activeCall || activeCall.role !== "callee" || activeCall.pc || !payload.sdp) return;

    clearInterval(activeCall.readyTimer);

    try {
      const pc = makePeer();

      await pc.setRemoteDescription(payload.sdp);
      await flushPendingIce(activeCall);

      const answer = await pc.createAnswer();

      await pc.setLocalDescription(answer);
      send(activeCall.room, "answer", { sdp: pc.localDescription });
    } catch (error) {
      console.error("Could not answer the call:", error);
      endCall(true, "Could not join the call.");
    }
  }

  async function onAnswer(payload) {
    const activeCall = call;

    if (!activeCall?.pc || !payload.sdp) return;

    try {
      await activeCall.pc.setRemoteDescription(payload.sdp);
      await flushPendingIce(activeCall);
    } catch (error) {
      console.error("Could not finish the call setup:", error);
      endCall(true, "Could not connect the call.");
    }
  }

  async function onIce(payload) {
    const activeCall = call;

    if (!activeCall || !payload.candidate) return;

    if (activeCall.pc?.remoteDescription) {
      try {
        await activeCall.pc.addIceCandidate(payload.candidate);
      } catch (error) {
        console.warn("Could not add ICE candidate:", error);
      }
    } else {
      activeCall.pendingIce.push(payload.candidate);
    }
  }

  // ----- ending a call -----

  function endCall(notifyPeer = true, message = "") {
    const activeCall = call;

    if (!activeCall) return;

    call = null;

    clearTimeout(activeCall.timer);
    clearInterval(activeCall.tick);
    clearInterval(activeCall.readyTimer);

    if (notifyPeer && activeCall.room) send(activeCall.room, "hangup");

    // Nobody picked up: leave a notification for the other person.
    if (
      activeCall.role === "caller" &&
      activeCall.rang &&
      !activeCall.connected &&
      !activeCall.declined
    ) {
      recordMissedCall(activeCall);
    }

    activeCall.pc?.close();
    activeCall.localStream?.getTracks().forEach((track) => track.stop());

    // Give the last message a moment to leave, then close the room and
    // mark the call as finished in the database (this also tells the
    // other person if they were still being rung).
    setTimeout(() => {
      if (activeCall.room) client.removeChannel(activeCall.room);

      client.rpc("end_call", { call_id: activeCall.id }).then(({ error }) => {
        if (error) console.warn("Could not mark the call as ended:", error.message);
      });
    }, 400);

    hideOverlay();

    if (message) toast(message);
  }

  // ----- calling someone -----

  async function startCall(userId, callType = "video") {
    if (callType !== "audio") callType = "video";

    if (call || pendingInvite || starting) {
      toast("You are already in a call.");
      return;
    }

    const me = await getCurrentUser();

    if (!me) {
      promptLogin("Please log in to start a call.");
      return;
    }

    if (!userId || userId === me.id) return;

    starting = true;

    try {
      let stream;

      try {
        stream = await getMedia(callType);
      } catch (error) {
        toast(mediaErrorMessage(error, callType));
        return;
      }

      // The database checks the rules and creates the call.
      const [callRes, peerRes] = await Promise.all([
        client.rpc("start_call", { target_id: userId, p_call_type: callType }),
        client
          .from("profiles")
          .select("id, username, full_name, avatar_url")
          .eq("id", userId)
          .maybeSingle()
      ]);

      if (callRes.error || !callRes.data) {
        console.warn("start_call failed:", callRes.error);
        stream.getTracks().forEach((track) => track.stop());
        toast(callErrorMessage(callRes.error));
        return;
      }

      const peer = peerRes.data || { id: userId };
      const peerName = peer.full_name || peer.username || "ReelTime user";

      const activeCall = {
        id: callRes.data,
        role: "caller",
        callType,
        peerId: userId,
        localStream: stream,
        pendingIce: [],
        connected: false,
        room: null
      };

      call = activeCall;

      showOverlay({
        name: peerName,
        profile: peer,
        status: "Calling…",
        incoming: false,
        callType
      });
      getOverlay().querySelector(".call-local").srcObject = stream;

      try {
        const room = await joinRoom(activeCall.id);

        activeCall.room = room;

        // The call was ended while we were connecting.
        if (call !== activeCall) {
          client.removeChannel(room);
          return;
        }

        setStatus("Ringing…");
        activeCall.rang = true;
        activeCall.timer = setTimeout(
          () => endCall(true, "No answer."),
          RING_TIMEOUT_MS
        );
      } catch (error) {
        console.error("Could not start the call:", error);
        endCall(false, error.message || "Could not start the call.");
      }
    } finally {
      starting = false;
    }
  }

  // ----- receiving a call -----

  function clearInvite() {
    clearTimeout(inviteTimer);
    pendingInvite = null;
    stopRingtone();
    closeSystemNotification();
  }

  function onInvite(payload) {
    if (!payload?.callId || !payload.from) return;
    if (endedCallIds.has(payload.callId)) return;

    // Already busy: ignore the new invite.
    if (call || pendingInvite || starting) return;

    const callType = payload.callType === "audio" ? "audio" : "video";

    pendingInvite = { ...payload, callType };

    const name =
      payload.from.full_name || payload.from.username || "ReelTime user";

    showOverlay({
      name,
      profile: payload.from,
      status: callType === "audio" ? "Incoming audio call…" : "Incoming video call…",
      incoming: true,
      callType
    });

    startRingtone(callType);
    showSystemNotification(name, callType);

    clearTimeout(inviteTimer);
    inviteTimer = setTimeout(() => {
      if (pendingInvite?.callId !== payload.callId) return;

      clearInvite();
      hideOverlay();
      toast(`Missed ${typeWord(callType)} call from ${name}.`);
    }, INVITE_TIMEOUT_MS);
  }

  // A new row in "calls" addressed to me. The caller's id and the call type
  // come from the database, so the name, photo and type shown here are real.
  async function onInviteRow(row) {
    if (!row?.id || !incomingUserId || row.callee_id !== incomingUserId) return;
    if (row.ended_at || call || pendingInvite || starting) return;

    const { data } = await client
      .from("profiles")
      .select("id, username, full_name, avatar_url")
      .eq("id", row.caller_id)
      .maybeSingle();

    onInvite({
      callId: row.id,
      from: data || { id: row.caller_id },
      callType: row.call_type || "video"
    });
  }

  // The caller hung up while it was still ringing.
  function onCallUpdated(row) {
    if (!row?.id || !row.ended_at) return;

    endedCallIds.add(row.id);

    if (pendingInvite?.callId !== row.id) return;

    const name =
      pendingInvite.from.full_name || pendingInvite.from.username || "someone";
    const callType = pendingInvite.callType;

    clearInvite();
    hideOverlay();
    toast(`Missed ${typeWord(callType)} call from ${name}.`);
  }

  async function acceptInvite() {
    const invite = pendingInvite;

    if (!invite) return;

    clearInvite();

    let stream;

    try {
      stream = await getMedia(invite.callType);
    } catch (error) {
      toast(mediaErrorMessage(error, invite.callType));
      pendingInvite = invite;
      declineInvite();
      return;
    }

    const activeCall = {
      id: invite.callId,
      role: "callee",
      callType: invite.callType,
      peerId: invite.from.id,
      localStream: stream,
      pendingIce: [],
      connected: false,
      room: null
    };

    call = activeCall;

    showOverlay({
      name: invite.from.full_name || invite.from.username || "ReelTime user",
      profile: invite.from,
      status: "Connecting…",
      incoming: false,
      callType: invite.callType
    });
    getOverlay().querySelector(".call-local").srcObject = stream;

    try {
      const room = await joinRoom(invite.callId);

      activeCall.room = room;

      if (call !== activeCall) {
        client.removeChannel(room);
        return;
      }

      // The caller may still be joining the room, so repeat "ready"
      // every 2 seconds until the offer arrives.
      send(room, "ready");

      let attempts = 0;

      activeCall.readyTimer = setInterval(() => {
        attempts += 1;

        if (call !== activeCall || activeCall.pc || attempts > 10) {
          clearInterval(activeCall.readyTimer);
          return;
        }

        send(room, "ready");
      }, 2000);
    } catch (error) {
      console.error("Could not join the call:", error);
      endCall(false, error.message || "Could not join the call.");
    }
  }

  async function declineInvite() {
    const invite = pendingInvite;

    clearInvite();
    hideOverlay();

    if (!invite) return;

    try {
      const room = await joinRoom(invite.callId);

      await send(room, "decline");
      setTimeout(() => client.removeChannel(room), 500);
    } catch (error) {
      console.warn("Could not send the decline message:", error);
    }

    client.rpc("end_call", { call_id: invite.callId }).then(({ error }) => {
      if (error) console.warn("Could not mark the call as ended:", error.message);
    });
  }

  // ----- listen for incoming calls while logged in -----

  function stopIncomingListener() {
    if (incomingChannel) client.removeChannel(incomingChannel);

    incomingChannel = null;
    incomingUserId = null;
  }

  function startIncomingListener(user) {
    if (incomingChannel && incomingUserId === user.id) return;

    stopIncomingListener();
    incomingUserId = user.id;

    const filter = `callee_id=eq.${user.id}`;

    incomingChannel = client
      .channel(`incoming-calls-${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "calls", filter },
        ({ new: row }) => onInviteRow(row)
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "calls", filter },
        ({ new: row }) => onCallUpdated(row)
      )
      .subscribe();
  }

  getCurrentUser().then((user) => {
    if (user) {
      startIncomingListener(user);
      armNotificationPermission();
    }
  });

  client.auth.onAuthStateChange((_event, session) => {
    const user = session?.user || null;

    // Supabase calls must not run inside this callback.
    setTimeout(() => {
      if (user) {
        startIncomingListener(user);
        armNotificationPermission();
      } else {
        stopIncomingListener();
        clearInvite();
        endCall(true);
        hideOverlay();
      }
    }, 0);
  });

  // ----- call buttons -----
  // Other code can start a call with: window.startReelTimeCall(userId, "audio" | "video")
  window.startReelTimeCall = startCall;

  // 📞 and 📹 buttons in the chat header.
  $("dm-audio-call")?.addEventListener("click", () => {
    if (reelTimeChatUser) startCall(reelTimeChatUser.id, "audio");
  });

  $("dm-video-call")?.addEventListener("click", () => {
    if (reelTimeChatUser) startCall(reelTimeChatUser.id, "video");
  });

  // ----- "Audio call", "Video call" and "Block" buttons on a creator's profile -----
  const actions = document.querySelector("#other-profile-page .profile-actions");
  let blockButton = $("other-profile-block-btn");

  if (actions && !$("other-profile-audio-btn")) {
    const audioButton = document.createElement("button");

    audioButton.id = "other-profile-audio-btn";
    audioButton.type = "button";
    audioButton.className = "primary-btn secondary";
    audioButton.textContent = "📞 Audio call";

    audioButton.addEventListener("click", () => {
      const userId = $("other-profile-follow-btn")?.dataset.userId;

      if (userId) startCall(userId, "audio");
    });

    actions.appendChild(audioButton);
  }

  if (actions && !$("other-profile-call-btn")) {
    const callButton = document.createElement("button");

    callButton.id = "other-profile-call-btn";
    callButton.type = "button";
    callButton.className = "primary-btn secondary";
    callButton.textContent = "📹 Video call";

    callButton.addEventListener("click", () => {
      const userId = $("other-profile-follow-btn")?.dataset.userId;

      if (userId) startCall(userId, "video");
    });

    actions.appendChild(callButton);
  }

  if (actions && !blockButton) {
    blockButton = document.createElement("button");

    blockButton.id = "other-profile-block-btn";
    blockButton.type = "button";
    blockButton.className = "primary-btn secondary";
    blockButton.textContent = "Block";

    blockButton.addEventListener("click", async () => {
      const userId = $("other-profile-follow-btn")?.dataset.userId;
      const me = await getCurrentUser();

      if (!userId || !me) return;

      const blocked = blockButton.dataset.blocked === "1";

      if (
        !blocked &&
        !confirm("Block this person? Neither of you will be able to call the other.")
      ) {
        return;
      }

      blockButton.disabled = true;

      try {
        const { error } = blocked
          ? await client
              .from("blocks")
              .delete()
              .eq("blocker_id", me.id)
              .eq("blocked_id", userId)
          : await client
              .from("blocks")
              .upsert({ blocker_id: me.id, blocked_id: userId });

        if (error) throw error;

        blockButton.dataset.blocked = blocked ? "" : "1";
        blockButton.textContent = blocked ? "Block" : "Unblock";
        toast(blocked ? "Person unblocked." : "Person blocked.");
      } catch (error) {
        console.error("Could not update block:", error);
        toast("Could not update the block. Did you run the calls SQL?");
      } finally {
        blockButton.disabled = false;
      }
    });

    actions.appendChild(blockButton);
  }

  async function refreshBlockButton(userId) {
    if (!blockButton) return;

    blockButton.dataset.blocked = "";
    blockButton.textContent = "Block";

    const me = await getCurrentUser();

    if (!me) return;

    const { data } = await client
      .from("blocks")
      .select("blocked_id")
      .eq("blocker_id", me.id)
      .eq("blocked_id", userId)
      .maybeSingle();

    // The person may have opened a different profile while we were loading.
    if ($("other-profile-follow-btn")?.dataset.userId !== userId) return;

    blockButton.dataset.blocked = data ? "1" : "";
    blockButton.textContent = data ? "Unblock" : "Block";
  }

  // Whenever another creator's profile opens, show the right Block / Unblock label.
  const openOtherUserProfileBeforeCalls = openOtherUserProfile;

  openOtherUserProfile = async function (userId) {
    await openOtherUserProfileBeforeCalls(userId);

    if (userId && !$("other-profile-page").classList.contains("hidden")) {
      refreshBlockButton(userId);
    }
  };
})();