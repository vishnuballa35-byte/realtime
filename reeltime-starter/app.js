// =====================================================
// ReelTime — app.js
// =====================================================



// --------------------------------------------------
// STATE (all declared up front)
// --------------------------------------------------

let reels = [];
let currentCommentReel = null;
let selectedVideoUrl = null;
let myFollowingIds = new Set();
let selectedAvatarFile = null;
let avatarPreviewUrl = null;
let reelTimeChatUser = null;
let reelTimeChatUserId = null;
let reelTimeChatChannel = null;
let reelTimeRealtimeChannel = null;

const PAGE_IDS = [
  "profile-page",
  "other-profile-page",
  "messages-page",
  "notifications-page"
];
const HOME_TITLE_HTML = 'Reels for you <span class="spark">✦</span>';

const $ = (id) => document.getElementById(id);
const feed = $("feed");
const toastEl = $("toast");

// --------------------------------------------------
// UTILITIES
// --------------------------------------------------

function toast(message) {
  if (!toastEl) {
    console.log(message);
    return;
  }

  toastEl.textContent = message;
  toastEl.classList.add("show");

  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => {
    toastEl.classList.remove("show");
  }, 2600);
}

function esc(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function formatNum(number) {
  return number >= 1000
    ? (number / 1000).toFixed(number >= 10000 ? 0 : 1).replace(".0", "") + "k"
    : String(number);
}

function getClient() {
  return window.supabaseClient || null;
}

// Reads the signed-in user from the local session (no network round trip).
async function getCurrentUser() {
  const client = getClient();
  if (!client) return null;

  const { data } = await client.auth.getSession();
  return data?.session?.user || null;
}

function promptLogin(message) {
  if (message) toast(message);
  window.openReelTimeAuth?.("login");
}

function setTitle(text) {
  const title = $("page-title");
  if (title) title.textContent = text;
}

function setHomeTitle() {
  const title = $("page-title");
  if (title) title.innerHTML = HOME_TITLE_HTML;
}

function setListMessage(container, text) {
  container.replaceChildren();
  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  container.appendChild(paragraph);
}

function setAvatar(letterEl, imageEl, url, name) {
  if (url) {
    imageEl.src = url;
    imageEl.style.display = "block";
    letterEl.style.display = "none";
  } else {
    imageEl.removeAttribute("src");
    imageEl.style.display = "none";
    letterEl.style.display = "";
    letterEl.textContent = (name || "U").charAt(0).toUpperCase();
  }
}

function updateLikeDisplay(button, card, reel) {
  button.classList.toggle("liked", Boolean(reel.liked));
  button.firstChild.textContent = reel.liked ? "♥ " : "♡ ";

  card.querySelector(".like-count").textContent = formatNum(reel.likes || 0);
  card.querySelector(".reel-description strong").textContent =
    formatNum(reel.likes || 0) + " likes";
}

// --------------------------------------------------
// PAGE NAVIGATION HELPERS
// --------------------------------------------------

function setActiveNav(view) {
  document.querySelectorAll("[data-view]").forEach((item) => {
    item.classList.toggle("active", item.dataset.view === view);
  });
}

function hidePages() {
  PAGE_IDS.forEach((id) => $(id)?.classList.add("hidden"));
  if (reelTimeChatChannel) closeChatChannel();
}

function showPage(id, title) {
  hidePages();
  feed.classList.add("hidden");
  $("empty-state")?.classList.add("hidden");
  $(id)?.classList.remove("hidden");
  setTitle(title);
}


async function showFeed(reelId = null) {
  hidePages();
  feed.classList.remove("hidden");
  setActiveNav("feed");

  const searchInput = $("search-input");
  if (searchInput) searchInput.value = "";

  setHomeTitle();
  renderFeed(reels);

  if (reelId === null) return;

  const card = Array.from(feed.querySelectorAll(".reel-card")).find(
    (item) => String(item.dataset.id) === String(reelId)
  );

  if (!card) {
    toast("Could not find this Reel in the feed. Please refresh.");
    return;
  }

  card.scrollIntoView({ behavior: "smooth", block: "center" });

  const video = card.querySelector("video.reel-video");

  if (video) {
    video.playsInline = true;
    video.muted = false;
    video.volume = 1;

    try {
      await video.play();
    } catch (error) {
      console.warn("Autoplay with sound was blocked:", error);

      // Browser restriction: retry with sound muted.
      video.muted = true;

      try {
        await video.play();
      } catch (playError) {
        console.warn("Video playback failed:", playError);
        toast("Tap the video to play it.");
      }
    }
  }
}


// --------------------------------------------------
// AUTOMATIC VIDEO PLAYBACK
// --------------------------------------------------


const reelVideoObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      const video = entry.target;

      if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
        // Keep the sound preference selected by the user.
        if (typeof window.reelTimeSoundOn !== "boolean") {
          window.reelTimeSoundOn = false;
        }

        video.muted = !window.reelTimeSoundOn;

        video.play().catch((error) => {
          console.warn("Video autoplay could not start:", error);
        });
      } else {
        video.pause();
      }
    });
  },
  { threshold: [0, 0.5, 1] }
);


function observeReelVideos() {
  document.querySelectorAll("#feed video.reel-video").forEach((video) => {
    reelVideoObserver.observe(video);
  });
}

// --------------------------------------------------
// FOLLOWING (shared by the feed, profiles and lists)
// --------------------------------------------------

async function loadMyFollowing() {
  const client = getClient();
  const user = await getCurrentUser();

  myFollowingIds = new Set();

  if (!client || !user) return;

  const { data, error } = await client
    .from("follows")
    .select("following_id")
    .eq("follower_id", user.id);

  if (error) {
    console.warn("Could not load who you follow:", error);
    return;
  }

  myFollowingIds = new Set((data || []).map((row) => row.following_id));
}

async function createNotification(client, { actorId, recipientId, type, reelId = null, detail = "" }) {
  if (!actorId || !recipientId || actorId === recipientId) return;

  // Only one "like" notification per person per Reel.
  if (type === "like" && reelId) {
    const { data: existing } = await client
      .from("notifications")
      .select("id")
      .eq("recipient_id", recipientId)
      .eq("actor_id", actorId)
      .eq("type", "like")
      .eq("reel_id", reelId)
      .limit(1);

    if (existing && existing.length > 0) return;
  }

  const { data: actor } = await client
    .from("profiles")
    .select("username, full_name")
    .eq("id", actorId)
    .maybeSingle();

  const actorName = actor?.username
    ? `@${actor.username}`
    : actor?.full_name || "Someone";

  const messages = {
    follow: `${actorName} started following you.`,
    like: `${actorName} liked your Reel.`,
    comment: `${actorName} commented: "${detail}"`
  };

  const row = {
    recipient_id: recipientId,
    actor_id: actorId,
    type,
    message: messages[type]
  };

  if (reelId) row.reel_id = reelId;

  const { error } = await client.from("notifications").insert(row);

  if (error) console.error(`${type} notification failed:`, error);
}

function syncFollowButtons(userId) {
  const following = myFollowingIds.has(userId);

  document
    .querySelectorAll(`.reel-follow-btn[data-user-id="${CSS.escape(userId)}"]`)
    .forEach((button) => {
      button.classList.toggle("following", following);
      button.textContent = following ? "Following" : "Follow";
    });

  const otherButton = $("other-profile-follow-btn");
  if (otherButton && otherButton.dataset.userId === userId) {
    otherButton.textContent = following ? "Following" : "Follow";
  }
}

// Returns true when the follow state really changed.
async function setFollow(creatorId, shouldFollow) {
  const client = getClient();

  if (!client) throw new Error("Supabase is not connected.");

  const user = await getCurrentUser();

  if (!user) {
    promptLogin("Please log in to follow creators.");
    return false;
  }

  if (creatorId === user.id) {
    toast("You cannot follow yourself.");
    return false;
  }

  if (shouldFollow) {
    const { error } = await client
      .from("follows")
      .insert({ follower_id: user.id, following_id: creatorId });

    if (error && error.code !== "23505") throw error;

    myFollowingIds.add(creatorId);
    createNotification(client, { actorId: user.id, recipientId: creatorId, type: "follow" });
  } else {
    const { error } = await client
      .from("follows")
      .delete()
      .eq("follower_id", user.id)
      .eq("following_id", creatorId);

    if (error) throw error;

    myFollowingIds.delete(creatorId);
  }

  syncFollowButtons(creatorId);
  return true;
}

// --------------------------------------------------
// LOAD SAVED REELS FROM SUPABASE
// --------------------------------------------------

async function loadSavedReels() {
  const client = getClient();

  if (!client) {
    console.error("Supabase client not found.");
    return;
  }

  try {
    const { data, error } = await client
      .from("reels")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;

    const rows = data || [];
    const reelIds = rows.map((item) => item.id);
    const userIds = [
      ...new Set(rows.map((item) => item.user_id).filter(Boolean))
    ];

    const me = await getCurrentUser();
    window.currentReelTimeUserId = me?.id || null;

    // Likes, comments, creator profiles and follows load in parallel.
    const [likesRes, commentsRes, profilesRes] = await Promise.all([
      reelIds.length
        ? client.from("reel_likes").select("reel_id, user_id").in("reel_id", reelIds)
        : { data: [] },
      reelIds.length
        ? client.from("reel_comments").select("reel_id").in("reel_id", reelIds)
        : { data: [] },
      userIds.length
        ? client
            .from("profiles")
            .select("id, username, full_name, avatar_url")
            .in("id", userIds)
        : { data: [] },
      loadMyFollowing()
    ]);

    if (likesRes.error) console.warn("Could not load Reel likes:", likesRes.error);
    if (commentsRes.error) console.warn("Could not load comment counts:", commentsRes.error);
    if (profilesRes.error) console.warn("Could not load creator profiles:", profilesRes.error);

    const likeCounts = {};
    const likedReelIds = new Set();

    for (const like of likesRes.data || []) {
      likeCounts[like.reel_id] = (likeCounts[like.reel_id] || 0) + 1;
      if (me && like.user_id === me.id) likedReelIds.add(like.reel_id);
    }

    const commentCounts = {};

    for (const comment of commentsRes.data || []) {
      commentCounts[comment.reel_id] = (commentCounts[comment.reel_id] || 0) + 1;
    }

    const profilesById = Object.fromEntries(
      (profilesRes.data || []).map((profile) => [profile.id, profile])
    );

    const savedReels = rows.map((item) => {
      const { data: urlData } = client.storage
        .from("reels")
        .getPublicUrl(item.video_path);

      const profile = profilesById[item.user_id];
      const creatorName =
        profile?.full_name || profile?.username || "ReelTime creator";

      return {
        id: item.id,
        userId: item.user_id,
        videoPath: item.video_path,
        user: profile?.username || creatorName,
        username: profile?.username || creatorName,
        avatar_url: profile?.avatar_url || null,
        name: creatorName,
        initials: creatorName.charAt(0).toUpperCase(),
        avatar: "avatar-you",
        location: "Uploaded Reel",
        caption: item.caption || "",
        likes: likeCounts[item.id] || 0,
        liked: likedReelIds.has(item.id),
        comments: commentCounts[item.id] || 0,
        localUrl: urlData.publicUrl,
        sound: "Original audio",
        tags: "#reeltime"
      };
    });

    reels = savedReels;
    renderFeed();
    renderStories();
  } catch (error) {
    console.error("Could not load saved Reels:", error);
    toast("Could not load saved Reels. Check the browser console.");
  }
}

// --------------------------------------------------
// REEL LINKS, "MORE" MENU AND ACTION SHEET
// --------------------------------------------------

function reelLink(reel) {
  return location.href.split("#")[0] + "#reel=" + encodeURIComponent(reel.id);
}

// Opens a shared link like  index.html#reel=<id>
function openReelFromHash() {
  const match = location.hash.match(/^#reel=(.+)$/);

  if (!match) return;

  history.replaceState(null, "", location.href.split("#")[0]);
  showFeed(decodeURIComponent(match[1]));
}

function openActionSheet(items) {
  let sheet = $("action-sheet");

  if (!sheet) {
    sheet = document.createElement("div");
    sheet.id = "action-sheet";
    sheet.className = "modal-backdrop hidden";
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.innerHTML = '<div class="modal action-sheet"></div>';
    sheet.addEventListener("click", (event) => {
      if (event.target === sheet) closeModal("action-sheet");
    });
    document.body.appendChild(sheet);
  }

  const box = sheet.querySelector(".action-sheet");
  box.replaceChildren();

  [...items, { label: "Cancel" }].forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = item.label;

    if (item.danger) button.classList.add("danger");

    button.addEventListener("click", () => {
      closeModal("action-sheet");
      item.onClick?.();
    });

    box.appendChild(button);
  });

  openModal("action-sheet");
}

async function copyReelLink(reel) {
  const link = reelLink(reel);

  try {
    await navigator.clipboard.writeText(link);
    toast("Link copied!");
  } catch (error) {
    toast(link);
  }
}

async function reportReel(reel, reason) {
  const client = getClient();
  const user = await getCurrentUser();

  if (!client || !user) {
    promptLogin("Please log in to report a Reel.");
    return;
  }

  const { error } = await client.from("reel_reports").insert({
    reel_id: reel.id,
    reporter_id: user.id,
    reason
  });

  if (error) {
    console.error("Report failed:", error);
    toast("Could not send your report. Please try again.");
    return;
  }

  toast("Thanks, we'll review this Reel.");
}

function openReelMenu(reel, card) {
  const isReal = !reel.isDemo && Boolean(reel.userId);
  const isOwn = isReal && reel.userId === window.currentReelTimeUserId;
  const items = [];

  if (isOwn) {
    items.push({
      label: "Delete",
      danger: true,
      onClick: () => card.querySelector(".delete-reel-btn")?.click()
    });
  } else if (isReal) {
    items.push({
      label: "Report",
      danger: true,
      onClick: () =>
        openActionSheet(
          ["Spam", "Inappropriate content", "Something else"].map((reason) => ({
            label: reason,
            onClick: () => reportReel(reel, reason)
          }))
        )
    });

    if (myFollowingIds.has(reel.userId)) {
      items.push({
        label: "Unfollow",
        danger: true,
        onClick: () => card.querySelector(".reel-follow-btn")?.click()
      });
    }
  }

  items.push({ label: "Copy link", onClick: () => copyReelLink(reel) });

  if (reel.userId) {
    items.push({
      label: "Go to profile",
      onClick: () => openOtherUserProfile(reel.userId)
    });
  }

  openActionSheet(items);
}

// --------------------------------------------------
// STORIES (a story = a creator's latest Reels)
// --------------------------------------------------

const STORY_SEEN_KEY = "reeltime_seen_stories";
const storyState = { items: [], index: 0, userId: null };

function readSeenStories() {
  try {
    return JSON.parse(localStorage.getItem(STORY_SEEN_KEY)) || {};
  } catch (error) {
    return {};
  }
}

function markStorySeen(key, reelId) {
  try {
    const seen = readSeenStories();
    seen[key] = String(reelId);
    localStorage.setItem(STORY_SEEN_KEY, JSON.stringify(seen));
  } catch (error) {
    /* storage unavailable: the ring simply stays colored */
  }
}


function renderStories() {
  const row = $("stories");

  if (!row) return;

  // Remove Story circles generated from Reels.
  // Keep the existing "Your story" button.
  row.querySelectorAll(".story:not(.add-story)").forEach((el) => {
    el.remove();
  });

  // Reels and Stories are separate.
  // Story circles will be added when a real Stories system exists.
}


function getStoryViewer() {
  let viewer = $("story-viewer");

  if (viewer) return viewer;

  viewer = document.createElement("div");
  viewer.id = "story-viewer";
  viewer.className = "hidden";
  viewer.setAttribute("role", "dialog");
  viewer.setAttribute("aria-modal", "true");
  viewer.innerHTML = `
    <div class="story-frame">
      <div class="story-bars"></div>
      <div class="story-head">
        <button class="story-head-user" type="button">
          <span class="avatar story-head-avatar"></span>
          <strong class="story-head-name"></strong>
        </button>
        <button class="story-close" type="button" aria-label="Close">×</button>
      </div>
      <video class="story-video" playsinline></video>
      <p class="story-caption"></p>
      <button class="story-nav story-prev" type="button" aria-label="Previous"></button>
      <button class="story-nav story-next" type="button" aria-label="Next"></button>
    </div>
  `;

  document.body.appendChild(viewer);

  const video = viewer.querySelector(".story-video");

  viewer.querySelector(".story-next").addEventListener("click", nextStory);
  viewer.querySelector(".story-prev").addEventListener("click", prevStory);
  viewer.querySelector(".story-close").addEventListener("click", closeStoryViewer);

  viewer.addEventListener("click", (event) => {
    if (event.target === viewer) closeStoryViewer();
  });

  viewer.querySelector(".story-head-user").addEventListener("click", () => {
    const userId = storyState.userId;

    if (!userId) return;

    closeStoryViewer();
    openOtherUserProfile(userId);
  });

  video.addEventListener("ended", nextStory);

  video.addEventListener("timeupdate", () => {
    const fill = viewer.querySelectorAll(".story-bars i")[storyState.index];

    if (fill && video.duration) {
      fill.style.width = (video.currentTime / video.duration) * 100 + "%";
    }
  });

  document.addEventListener("keydown", (event) => {
    if (viewer.classList.contains("hidden")) return;

    if (event.key === "Escape") closeStoryViewer();
    if (event.key === "ArrowRight") nextStory();
    if (event.key === "ArrowLeft") prevStory();
  });

  return viewer;
}


function showStory() {
  const viewer = getStoryViewer();
  const reel = storyState.items[storyState.index];
  const video = viewer.querySelector(".story-video");

  if (!reel || !video) return;

  viewer.querySelector(".story-bars").innerHTML = storyState.items
    .map(
      (_, i) =>
        `<span><i style="width:${i < storyState.index ? 100 : 0}%"></i></span>`
    )
    .join("");

  const avatar = viewer.querySelector(".story-head-avatar");

  if (reel.avatar_url) {
    avatar.textContent = "";
    avatar.style.backgroundImage = `url("${reel.avatar_url}")`;
  } else {
    avatar.style.backgroundImage = "";
    avatar.textContent = reel.initials || "V";
  }

  viewer.querySelector(".story-head-name").textContent = reel.user;
  viewer.querySelector(".story-caption").textContent = reel.caption || "";

  // Remember the sound preference while moving between stories.
  if (typeof window.reelTimeSoundOn !== "boolean") {
    window.reelTimeSoundOn = false;
  }

  video.pause();
  video.src = reel.localUrl || reel.video || "";
  video.playsInline = true;
  video.muted = !window.reelTimeSoundOn;
  video.volume = 1;

  // Create one sound button for the viewer.
  let soundButton = viewer.querySelector(".story-sound-toggle");

  if (!soundButton) {
    soundButton = document.createElement("button");
    soundButton.type = "button";
    soundButton.className = "story-sound-toggle";
    soundButton.style.cssText =
      "position:absolute;right:16px;bottom:90px;z-index:20;" +
      "padding:12px;border:0;border-radius:50%;" +
      "background:rgba(0,0,0,.65);color:white;font-size:20px;cursor:pointer;";

    const videoContainer = video.parentElement;
    videoContainer.appendChild(soundButton);

    soundButton.addEventListener("click", async (event) => {
      event.stopPropagation();

      window.reelTimeSoundOn = !window.reelTimeSoundOn;
      video.muted = !window.reelTimeSoundOn;
      soundButton.textContent = video.muted ? "🔇" : "🔊";
      soundButton.setAttribute(
        "aria-label",
        video.muted ? "Turn sound on" : "Turn sound off"
      );

      if (!video.muted) {
        try {
          await video.play();
        } catch (error) {
          console.warn("Could not enable sound:", error);
        }
      }
    });
  }

  soundButton.textContent = video.muted ? "🔇" : "🔊";
  soundButton.setAttribute(
    "aria-label",
    video.muted ? "Turn sound on" : "Turn sound off"
  );

  video.play().catch((error) => {
    console.warn("Story autoplay failed:", error);
  });
}


function nextStory() {
  if (storyState.index < storyState.items.length - 1) {
    storyState.index += 1;
    showStory();
  } else {
    closeStoryViewer();
  }
}

function prevStory() {
  if (storyState.index > 0) {
    storyState.index -= 1;
    showStory();
  } else {
    const video = $("story-viewer")?.querySelector(".story-video");
    if (video) video.currentTime = 0;
  }
}

function openStoryViewer(group) {
  storyState.items = group.items.slice(0, 6);
  storyState.index = 0;
  storyState.userId = group.userId || null;

  getStoryViewer().classList.remove("hidden");
  document.body.style.overflow = "hidden";

  showStory();
}

function closeStoryViewer() {
  const viewer = $("story-viewer");

  if (!viewer) return;

  const video = viewer.querySelector(".story-video");

  video.pause();
  video.removeAttribute("src");
  video.load();

  viewer.classList.add("hidden");
  document.body.style.overflow = "";
}

// --------------------------------------------------
// RENDER THE FEED
// --------------------------------------------------

function renderFeed(list = reels) {
  reelVideoObserver.disconnect();
  feed.replaceChildren();

  $("empty-state")?.classList.toggle("hidden", list.length !== 0);

  const fragment = document.createDocumentFragment();
  list.forEach((reel) => fragment.appendChild(buildReelCard(reel)));
  feed.appendChild(fragment);

  // Observe videos only after adding them to the page.
  observeReelVideos();
}

function buildReelCard(reel) {
  const card = document.createElement("article");
  card.className = "reel-card";
  card.dataset.id = reel.id;

  const videoUrl = reel.localUrl || reel.video || "";
  const isOwnReel =
    !reel.isDemo &&
    Boolean(reel.userId) &&
    reel.userId === window.currentReelTimeUserId;
  const following = myFollowingIds.has(reel.userId);

  card.innerHTML = `
    <div class="reel-top">
      ${
        reel.avatar_url
          ? `<img class="avatar" src="${esc(reel.avatar_url)}" alt="${esc(reel.username || "Creator")}" style="object-fit: cover;">`
          : `<div class="avatar ${esc(reel.avatar || "")}">${esc(reel.initials || "V")}</div>`
      }

      <div class="creator">
        <strong>
          ${esc(reel.user || "you")}
          <span class="verified">✦</span>
        </strong>
        <small>
          ${esc(reel.location || "Just now")} ·
          <span>Original Reel</span>
        </small>
      </div>

      ${
        !isOwnReel && reel.userId
          ? `<button class="action-btn reel-follow-btn ${following ? "following" : ""}" data-user-id="${esc(reel.userId)}" type="button">${following ? "Following" : "Follow"}</button>`
          : ""
      }

      ${
        isOwnReel
          ? `<button class="action-btn delete-reel-btn" type="button">Delete</button>`
          : ""
      }

      <button class="more-btn" aria-label="More options">···</button>
    </div>

    <div class="reel-media">
      <video src="${esc(videoUrl)}" class="reel-video" playsinline muted preload="metadata" loop></video>
      <button
    class="reel-sound-btn"
    type="button"
    aria-label="Turn sound on"
    title="Turn sound on"
  ></button>
      <div class="media-gradient"></div>
      <div class="media-overlay">
        <div class="caption-main">
          <strong>@${esc(reel.user || "you")}</strong>
          <p>${esc(reel.caption || "A new moment on ReelTime")}</p>
          <span class="sound-pill">♫ ${esc(reel.sound || "Original audio")}</span>
        </div>
      </div>
      <div class="play-hint">▶</div>
    </div>

    <div class="reel-actions">
      <button class="action-btn like-btn ${reel.liked ? "liked" : ""}" aria-label="Like">
        ${reel.liked ? "♥" : "♡"}
        <span class="like-count">${formatNum(reel.likes || 0)}</span>
      </button>

      <button class="action-btn comment-btn" aria-label="Comments">
        ◯ <span>${reel.comments || 0}</span>
      </button>

      <button class="action-btn share-btn" aria-label="Share">
        ↗ <span>Share</span>
      </button>

      <span class="action-spacer"></span>

      <button class="action-btn save-btn ${reel.saved ? "saved" : ""}" aria-label="Save">
        ${reel.saved ? "▣" : "♧"}
      </button>
    </div>

    <div class="reel-description">
      <strong>${formatNum(reel.likes || 0)} likes</strong>
      · ${esc(reel.tags || "#reeltime")}
      · <span>${reel.comments || 0} comments</span>
    </div>
  `;


  // Reel video playback and sound controls.
  const video = card.querySelector(".reel-video");
  const soundButton = card.querySelector(".reel-sound-btn");

  // Sound is off by default and remembers the user's choice.
  if (typeof window.reelTimeSoundOn !== "boolean") {
    window.reelTimeSoundOn = false;
  }

  video.muted = !window.reelTimeSoundOn;

  function updateSoundButton() {
    soundButton.textContent = video.muted ? "🔇" : "🔊";

    soundButton.setAttribute(
      "aria-label",
      video.muted ? "Turn sound on" : "Turn sound off"
    );

    soundButton.title = video.muted ? "Turn sound on" : "Turn sound off";
  }

  updateSoundButton();

  // Click the speaker button to mute or unmute.
  soundButton.addEventListener("click", async (event) => {
    event.stopPropagation();

    video.muted = !video.muted;
    window.reelTimeSoundOn = !video.muted;
    video.volume = 1;

    updateSoundButton();

    try {
      await video.play();
    } catch (error) {
      console.warn("Could not play this video:", error);
    }
  });

  // Click the video itself to play or pause.
  video.addEventListener("click", () => {
    if (video.paused) {
      video.play().catch((error) => {
        console.warn("Could not play this video:", error);
        toast("This video could not play. Try another video.");
      });
    } else {
      video.pause();
    }
  });


  // Like button: demo Reels stay local, real Reels are saved in Supabase.
  const likeButton = card.querySelector(".like-btn");

  likeButton.addEventListener("click", async () => {
    if (reel.isDemo) {
      reel.liked = !reel.liked;
      reel.likes = Math.max(0, (reel.likes || 0) + (reel.liked ? 1 : -1));
      updateLikeDisplay(likeButton, card, reel);
      return;
    }

    const client = getClient();

    if (!client) {
      toast("Supabase is not connected.");
      return;
    }

    likeButton.disabled = true;

    try {
      const user = await getCurrentUser();

      if (!user) {
        promptLogin("Please log in to like this Reel.");
        return;
      }

      if (reel.liked) {
        const { error } = await client
          .from("reel_likes")
          .delete()
          .eq("reel_id", reel.id)
          .eq("user_id", user.id);

        if (error) throw error;

        reel.liked = false;
        reel.likes = Math.max(0, (reel.likes || 0) - 1);
      } else {
        const { error } = await client
          .from("reel_likes")
          .insert({ reel_id: reel.id, user_id: user.id });

        if (error) throw error;

        reel.liked = true;
        reel.likes = (reel.likes || 0) + 1;

        createNotification(client, {
          actorId: user.id,
          recipientId: reel.userId,
          type: "like",
          reelId: reel.id
        });
      }

      updateLikeDisplay(likeButton, card, reel);
    } catch (error) {
      console.error("Could not update Reel like:", error);
      toast("Could not save your like. Please try again.");
    } finally {
      likeButton.disabled = false;
    }
  });

  // Delete a Reel owned by the current user.
  const deleteButton = card.querySelector(".delete-reel-btn");

  if (deleteButton) {
    deleteButton.addEventListener("click", async () => {
      if (!confirm("Are you sure you want to permanently delete this Reel?")) {
        return;
      }

      const client = getClient();
      const user = await getCurrentUser();

      if (!client || !user || user.id !== reel.userId || !reel.videoPath) {
        toast("Could not verify this Reel. Refresh and try again.");
        return;
      }

      deleteButton.disabled = true;
      deleteButton.textContent = "Deleting...";

      try {
        // Delete the database record first, so a failure never leaves a
        // Reel in the feed that points to a missing video.
        const { data: deletedRows, error: deleteError } = await client
          .from("reels")
          .delete()
          .eq("id", reel.id)
          .eq("user_id", user.id)
          .select("id");

        if (deleteError) throw deleteError;

        if (!deletedRows || deletedRows.length === 0) {
          toast("The Reel was not deleted. Check your Supabase policies.");
          return;
        }

        const { error: storageError } = await client.storage
          .from("reels")
          .remove([reel.videoPath]);

        if (storageError) {
          console.error("Reel deleted, but its video file remains:", storageError);
        }

        reels = reels.filter((item) => item.id !== reel.id);
        renderFeed();
        toast("Reel deleted successfully!");
      } catch (error) {
        console.error("Could not delete Reel:", error);
        toast(error.message || "Could not delete this Reel.");
      } finally {
        if (deleteButton.isConnected) {
          deleteButton.disabled = false;
          deleteButton.textContent = "Delete";
        }
      }
    });
  }

  // Comments.
  card.querySelector(".comment-btn").addEventListener("click", () => {
    openComments(reel);
  });

  // Share.
  card.querySelector(".share-btn").addEventListener("click", async () => {
    const shareText = `Check out this Reel by @${reel.user} on ReelTime!`;

    try {
      if (navigator.share) {
        await navigator.share({
          title: "ReelTime",
          text: shareText,
          url: reelLink(reel)
        });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(shareText + " " + reelLink(reel));
        toast("Share text copied!");
      } else {
        toast(shareText);
      }
    } catch (error) {
      if (error.name !== "AbortError") {
        toast("You can share this Reel with your friends.");
      }
    }
  });

  // Save.
  card.querySelector(".save-btn").addEventListener("click", (event) => {
    reel.saved = !reel.saved;

    event.currentTarget.classList.toggle("saved", reel.saved);
    event.currentTarget.textContent = reel.saved ? "▣" : "♧";

    toast(reel.saved ? "Saved to your collection" : "Removed from saved");
  });

  card.querySelector(".more-btn").addEventListener("click", () => {
    openReelMenu(reel, card);
  });

  // Follow / unfollow the creator.
  const followButton = card.querySelector(".reel-follow-btn");

  if (followButton) {
    const creatorId = followButton.dataset.userId;

    followButton.addEventListener("click", async () => {
      followButton.disabled = true;

      try {
        const wasFollowing = myFollowingIds.has(creatorId);
        const changed = await setFollow(creatorId, !wasFollowing);

        if (changed) {
          toast(wasFollowing ? "Unfollowed creator." : "Following creator!");
        }
      } catch (error) {
        console.error("Follow action failed:", error);
        toast("Could not update follow. Please try again.");
      } finally {
        followButton.disabled = false;
      }
    });
  }

  // Open a creator's profile when their name or avatar is clicked.
  if (reel.userId) {
    const openCreatorProfile = (event) => {
      event.stopPropagation();
      openOtherUserProfile(reel.userId);
    };

    [".creator strong", ".reel-top .avatar"].forEach((selector) => {
      const element = card.querySelector(selector);

      if (element) {
        element.style.cursor = "pointer";
        element.addEventListener("click", openCreatorProfile);
      }
    });
  }

  return card;
}

// --------------------------------------------------
// MODALS
// --------------------------------------------------

function openModal(id) {
  const modal = $(id);
  if (!modal) return;

  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeModal(id) {
  const modal = $(id);
  if (!modal) return;

  modal.classList.add("hidden");
  document.body.style.overflow = "";
}

document.querySelectorAll("[data-close]").forEach((button) => {
  button.addEventListener("click", () => closeModal(button.dataset.close));
});

document.querySelectorAll(".modal-backdrop").forEach((modal) => {
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeModal(modal.id);
  });
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;

  document
    .querySelectorAll(".modal-backdrop:not(.hidden)")
    .forEach((modal) => closeModal(modal.id));

  $("edit-profile-modal")?.classList.add("hidden");
});

// --------------------------------------------------
// CREATE REEL AND VIDEO PREVIEW
// --------------------------------------------------

function openCreate() {
  openModal("create-modal");
}

[
  "open-create",
  "top-create",
  "mobile-create",
  "welcome-create",
  "story-create"
].forEach((id) => {
  $(id)?.addEventListener("click", openCreate);
});

const videoInput = $("video-file");
const preview = $("video-preview");
const caption = $("caption");

const createForm = $("create-form");
const uploadButton = createForm.querySelector('button[type="submit"]');

// Add a Discard button beside the existing upload button.
if (uploadButton && !$("discard-reel-btn")) {
  const discardButton = document.createElement("button");

  discardButton.id = "discard-reel-btn";
  discardButton.type = "button";
  discardButton.textContent = "Discard";
  discardButton.className = "discard-reel-btn";

  uploadButton.insertAdjacentElement("beforebegin", discardButton);

  discardButton.addEventListener("click", () => {
    // Remove the selected video preview.
    videoInput.value = "";

    preview.pause();
    preview.removeAttribute("src");
    preview.load();
    preview.classList.add("hidden");

    // Release the temporary preview URL.
    if (selectedVideoUrl) {
      URL.revokeObjectURL(selectedVideoUrl);
      selectedVideoUrl = null;
    }

    // Clear the caption.
    caption.value = "";
    $("caption-count").textContent = "0/300";

    // Close the Create Reel popup.
    closeModal("create-modal");

    toast("Reel discarded.");
  });
}

videoInput.addEventListener("change", () => {
  if (selectedVideoUrl) {
    URL.revokeObjectURL(selectedVideoUrl);
    selectedVideoUrl = null;
  }

  const file = videoInput.files[0];

  if (!file) return;

  if (!file.type.startsWith("video/")) {
    toast("Please choose a video file.");
    videoInput.value = "";
    return;
  }

  if (file.size > 50 * 1024 * 1024) {
    toast("Choose a video under 50 MB.");
    videoInput.value = "";
    return;
  }

  selectedVideoUrl = URL.createObjectURL(file);
  preview.src = selectedVideoUrl;
  preview.classList.remove("hidden");

  toast("Video ready to preview.");
});

caption.addEventListener("input", () => {
  $("caption-count").textContent = caption.value.length + "/300";
});

$("create-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  const client = getClient();
  const file = videoInput.files[0];
  const captionText = caption.value.trim() || "My first Reel on ReelTime ✨";
  const submitButton = event.currentTarget.querySelector('button[type="submit"]');

  if (!file) {
    toast("Choose a video first.");
    videoInput.focus();
    return;
  }

  if (!file.type.startsWith("video/")) {
    toast("Please choose a valid video file.");
    return;
  }

  if (file.size > 50 * 1024 * 1024) {
    toast("Choose a video under 50 MB.");
    return;
  }

  if (!client) {
    toast("Supabase is not connected. Refresh and try again.");
    return;
  }

  if (!submitButton) {
    toast("Upload button not found. Check your HTML.");
    return;
  }


const originalButtonText = submitButton.textContent;

submitButton.disabled = true;
submitButton.textContent = "Uploading video…  Please wait";
submitButton.setAttribute("aria-busy", "true");

  let uploadedPath = null;
  let databaseSaved = false;

  try {
    const user = await getCurrentUser();

    if (!user) {
      throw new Error("Please log in before uploading a Reel.");
    }

    const extension =
      file.name.split(".").pop().toLowerCase().replace(/[^a-z0-9]/g, "") || "mp4";

    const filePath = `${user.id}/${crypto.randomUUID()}.${extension}`;

    const { error: uploadError } = await client.storage
      .from("reels")
      .upload(filePath, file, {
        contentType: file.type || "video/mp4",
        upsert: false
      });

    if (uploadError) throw uploadError;

    uploadedPath = filePath;

    const { error: dbError } = await client.from("reels").insert({
      user_id: user.id,
      video_path: filePath,
      caption: captionText
    });

    if (dbError) throw dbError;

    databaseSaved = true;

    // Reset the form and preview.
    closeModal("create-modal");

    caption.value = "";
    $("caption-count").textContent = "0/300";
    videoInput.value = "";

    preview.pause();
    preview.removeAttribute("src");
    preview.load();
    preview.classList.add("hidden");

    if (selectedVideoUrl) {
      URL.revokeObjectURL(selectedVideoUrl);
      selectedVideoUrl = null;
    }

    // Reload so the new Reel appears (with creator photo) and go home.
    await loadSavedReels();
    await showFeed();
    setActiveNav("feed");
    window.scrollTo({ top: 0, behavior: "smooth" });

    toast("Your Reel was uploaded successfully!");
  } catch (error) {
    console.error("Reel upload failed:", error);

    // Clean up Storage only if the database insert did not succeed.
    if (uploadedPath && !databaseSaved) {
      const { error: cleanupError } = await client.storage
        .from("reels")
        .remove([uploadedPath]);

      if (cleanupError) console.error("Storage cleanup failed:", cleanupError);
    }

    
let message = error.message || "Please try again.";

if (/row-level security|permission denied/i.test(message)) {
  message = "Upload blocked by Supabase permissions. Check your Storage and reels table policies.";
} else if (/network|fetch/i.test(message)) {
  message = "Network error. Check your internet connection and try again.";
} else if (/duplicate|already exists/i.test(message)) {
  message = "This video file path already exists. Please try uploading again.";
}

toast("Reel upload failed: " + message);

  } 
finally {
  submitButton.disabled = false;
  submitButton.textContent = originalButtonText;
  submitButton.removeAttribute("aria-busy");
}

});

// --------------------------------------------------
// COMMENTS
// --------------------------------------------------

function createCommentElement(initial, avatarClass, name, text) {
  const element = document.createElement("div");
  element.className = "comment";

  const avatar = document.createElement("div");
  avatar.className = "avatar " + avatarClass;
  avatar.textContent = initial;

  const body = document.createElement("div");
  body.className = "comment-body";

  const username = document.createElement("strong");
  username.textContent = "@" + name;

  const paragraph = document.createElement("p");
  paragraph.textContent = text;

  body.append(username, paragraph);
  element.append(avatar, body);

  return element;
}

async function openComments(reel) {
  currentCommentReel = reel;

  const list = $("comments-list");
  const title = $("comments-title");

  title.textContent = "Comments · " + (reel.comments || 0);
  list.innerHTML = '<p class="muted">Loading comments...</p>';

  openModal("comments-modal");

  // Demo Reels keep their sample comments.
  if (reel.isDemo) {
    list.innerHTML = "";

    [
      ["A", "a-pink", "ananya.jpg", "This is such a vibe ✨"],
      ["R", "a-orange", "rahul.travels", "Love this! Keep posting 🙌"]
    ].forEach(([initial, avatarClass, name, text]) => {
      list.appendChild(createCommentElement(initial, avatarClass, name, text));
    });

    return;
  }

  const client = getClient();

  if (!client) {
    list.innerHTML = '<p class="muted">Supabase is not connected.</p>';
    return;
  }

  try {
    const { data, error } = await client
      .from("reel_comments")
      .select("id, user_id, comment_text, created_at")
      .eq("reel_id", reel.id)
      .order("created_at", { ascending: true });

    if (error) throw error;

    // Ignore results if the user opened a different Reel meanwhile.
    if (currentCommentReel?.id !== reel.id) return;

    const comments = data || [];
    const userIds = [...new Set(comments.map((item) => item.user_id))];
    let profilesById = {};

    if (userIds.length > 0) {
      const { data: profiles, error: profileError } = await client
        .from("profiles")
        .select("id, username, full_name")
        .in("id", userIds);

      if (profileError) {
        console.warn("Could not load comment profiles:", profileError);
      } else {
        profilesById = Object.fromEntries(
          (profiles || []).map((profile) => [profile.id, profile])
        );
      }
    }

    if (currentCommentReel?.id !== reel.id) return;

    list.innerHTML = "";

    comments.forEach((comment) => {
      const profile = profilesById[comment.user_id];
      const name = profile?.username || profile?.full_name || "ReelTime user";

      list.appendChild(
        createCommentElement(
          name.charAt(0).toUpperCase(),
          "avatar-you",
          name,
          comment.comment_text
        )
      );
    });

    reel.comments = comments.length;
    title.textContent = "Comments · " + comments.length;

    if (comments.length === 0) {
      list.innerHTML =
        '<p class="muted">Be the first to start the conversation.</p>';
    }
  } catch (error) {
    console.error("Could not load comments:", error);
    list.innerHTML =
      '<p class="muted">Could not load comments. Please try again.</p>';
  }
}

function updateCommentCount(reel) {
  const card = feed.querySelector(`[data-id="${reel.id}"]`);

  if (card) {
    const buttonCount = card.querySelector(".comment-btn span");
    if (buttonCount) buttonCount.textContent = reel.comments;

    const descriptionCount = card.querySelector(".reel-description span");
    if (descriptionCount) {
      descriptionCount.textContent = reel.comments + " comments";
    }
  }

  $("comments-title").textContent = "Comments · " + reel.comments;
}

$("comment-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  const input = $("comment-input");
  const commentText = input.value.trim();
  const reel = currentCommentReel;

  if (!commentText || !reel) return;

  // Demo Reel comments stay local.
  if (reel.isDemo) {
    $("comments-list").appendChild(
      createCommentElement("V", "avatar-you", "you", commentText)
    );

    reel.comments = (reel.comments || 0) + 1;
    input.value = "";
    updateCommentCount(reel);
    return;
  }

  const client = getClient();

  if (!client) {
    toast("Supabase is not connected.");
    return;
  }

  const submitButton = event.currentTarget.querySelector('button[type="submit"]');
  if (submitButton) submitButton.disabled = true;

  try {
    const user = await getCurrentUser();

    if (!user) {
      promptLogin("Please log in to comment.");
      return;
    }

    const { error } = await client.from("reel_comments").insert({
      reel_id: reel.id,
      user_id: user.id,
      comment_text: commentText
    });

    if (error) throw error;

    createNotification(client, {
      actorId: user.id,
      recipientId: reel.userId,
      type: "comment",
      reelId: reel.id,
      detail: commentText.length > 60 ? commentText.slice(0, 60) + "…" : commentText
    });

    input.value = "";
    await openComments(reel);
    updateCommentCount(reel);
    toast("Comment posted!");
  } catch (error) {
    console.error("Could not save comment:", error);
    toast("Could not save comment. Please try again.");
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
});

// --------------------------------------------------
// SEARCH
// --------------------------------------------------

$("search-input").addEventListener("input", (event) => {
  const query = event.target.value.toLowerCase().trim();

  // Searching always happens on the feed.
  if (feed.classList.contains("hidden")) {
    hidePages();
    feed.classList.remove("hidden");
    setActiveNav("feed");
  }

  const filtered = reels.filter((reel) =>
    (
      reel.user + " " + reel.name + " " + reel.caption + " " + (reel.tags || "")
    )
      .toLowerCase()
      .includes(query)
  );

  renderFeed(filtered);

  if (query) {
    $("page-title").innerHTML = 'Search results <span class="spark">✦</span>';
  } else {
    setHomeTitle();
  }
});

// --------------------------------------------------
// MY PROFILE
// --------------------------------------------------

function renderProfileTiles(container, emptyElement, rows) {
  const client = getClient();

  container.replaceChildren();
  emptyElement?.classList.toggle("hidden", rows.length > 0);

  if (!client) return;

  rows.forEach((row) => {
    const { data } = client.storage.from("reels").getPublicUrl(row.video_path);

    const tile = document.createElement("div");
    tile.className = "profile-reel-tile";
    tile.style.cursor = "pointer";

    const video = document.createElement("video");
    // "#t=0.1" makes browsers show a still frame as the thumbnail.
    video.src = data.publicUrl + "#t=0.1";
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;

    const label = document.createElement("p");
    label.textContent = row.caption || "Reel";

    tile.append(video, label);

    // Clicking a tile opens that exact Reel in the feed.
    tile.addEventListener("click", () => showFeed(row.id));

    container.appendChild(tile);
  });
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

    const [profileRes, reelsRes, followersRes, followingRes] = await Promise.all([
      client
        .from("profiles")
        .select("id, username, full_name, avatar_url")
        .eq("id", user.id)
        .maybeSingle(),
      client
        .from("reels")
        .select("id, caption, video_path, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }),
      client
        .from("follows")
        .select("*", { count: "exact", head: true })
        .eq("following_id", user.id),
      client
        .from("follows")
        .select("*", { count: "exact", head: true })
        .eq("follower_id", user.id)
    ]);

    for (const result of [profileRes, reelsRes, followersRes, followingRes]) {
      if (result.error) throw result.error;
    }

    const profile = profileRes.data;
    const myReels = reelsRes.data || [];

    // Total likes received on this user's Reels.
    let totalLikes = 0;

    if (myReels.length > 0) {
      const { count, error: likesError } = await client
        .from("reel_likes")
        .select("*", { count: "exact", head: true })
        .in("reel_id", myReels.map((item) => item.id));

      if (likesError) {
        console.warn("Could not count likes:", likesError);
      } else {
        totalLikes = count || 0;
      }
    }

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

    $("profile-reel-count").textContent = myReels.length;
    $("profile-like-count").textContent = totalLikes;
    $("profile-follower-count").textContent = followersRes.count || 0;
    $("profile-following-count").textContent = followingRes.count || 0;

    showPage("profile-page", "Your profile");
    setActiveNav("profile");

    renderProfileTiles($("profile-reels"), $("profile-empty"), myReels);
  } catch (error) {
    console.error("Could not load your profile:", error);
    toast("Could not load your profile. Check the browser console.");
  }
}

$("profile-create-btn")?.addEventListener("click", openCreate);

// --------------------------------------------------
// EDIT PROFILE
// --------------------------------------------------

const editProfileModal = $("edit-profile-modal");
const editProfileForm = $("edit-profile-form");
const editAvatarInput = $("edit-avatar");
const editAvatarPreview = $("edit-avatar-preview");
const editProfileMessage = $("edit-profile-message");

editAvatarInput?.addEventListener("change", () => {
  const file = editAvatarInput.files?.[0];

  if (!file) return;

  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    toast("Choose a JPG, PNG, or WebP image.");
    editAvatarInput.value = "";
    return;
  }

  if (file.size > 2 * 1024 * 1024) {
    toast("Profile photos must be 2 MB or smaller.");
    editAvatarInput.value = "";
    return;
  }

  selectedAvatarFile = file;

  if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);

  avatarPreviewUrl = URL.createObjectURL(file);
  editAvatarPreview.src = avatarPreviewUrl;
  editAvatarPreview.style.display = "block";
});

$("profile-edit-btn")?.addEventListener("click", async () => {
  const client = getClient();

  if (!client) {
    toast("Supabase is not connected.");
    return;
  }

  const user = await getCurrentUser();

  if (!user) {
    promptLogin("Please log in first.");
    return;
  }

  const { data: profile, error } = await client
    .from("profiles")
    .select("username, full_name, avatar_url")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    toast("Could not load your profile.");
    console.error(error);
    return;
  }

  $("edit-full-name").value =
    profile?.full_name || user.user_metadata?.full_name || "";
  $("edit-username").value = profile?.username || "";

  // Reset any photo chosen earlier and show the current one.
  selectedAvatarFile = null;
  editAvatarInput.value = "";

  if (avatarPreviewUrl) {
    URL.revokeObjectURL(avatarPreviewUrl);
    avatarPreviewUrl = null;
  }

  if (profile?.avatar_url) {
    editAvatarPreview.src = profile.avatar_url;
    editAvatarPreview.style.display = "block";
  } else {
    editAvatarPreview.removeAttribute("src");
    editAvatarPreview.style.display = "none";
  }

  editProfileMessage.textContent = "";
  editProfileModal.classList.remove("hidden");
});

$("edit-profile-close")?.addEventListener("click", () => {
  editProfileModal.classList.add("hidden");
});

editProfileModal?.addEventListener("click", (event) => {
  if (event.target === editProfileModal) {
    editProfileModal.classList.add("hidden");
  }
});

editProfileForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const client = getClient();

  if (!client) {
    editProfileMessage.textContent = "Supabase is not connected.";
    return;
  }

  const user = await getCurrentUser();

  if (!user) {
    editProfileMessage.textContent = "Please log in again.";
    return;
  }

  const fullName = $("edit-full-name").value.trim();
  const username = $("edit-username").value.trim();

  if (!fullName || !/^[A-Za-z0-9_]{1,30}$/.test(username)) {
    editProfileMessage.textContent =
      "Enter a display name and a username using only letters, numbers, or underscores.";
    return;
  }

  const saveButton = editProfileForm.querySelector('button[type="submit"]');
  saveButton.disabled = true;
  saveButton.textContent = "Saving...";

  try {
    // Keep the existing profile photo if no new photo is selected.
    const { data: currentProfile, error: profileError } = await client
      .from("profiles")
      .select("avatar_url")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) throw profileError;

    let avatarUrl = currentProfile?.avatar_url || null;

    if (selectedAvatarFile) {
      const file = selectedAvatarFile;
      const extension =
        file.type === "image/png" ? "png" :
        file.type === "image/webp" ? "webp" : "jpg";

      const filePath = `${user.id}/profile.${extension}`;

      const { error: uploadError } = await client.storage
        .from("avatars")
        .upload(filePath, file, { upsert: true, contentType: file.type });

      if (uploadError) throw uploadError;

      const { data: publicUrlData } = client.storage
        .from("avatars")
        .getPublicUrl(filePath);

      // The file path never changes, so add a version to bypass the cache.
      avatarUrl = `${publicUrlData.publicUrl}?v=${Date.now()}`;
    }

    const { error: saveError } = await client
      .from("profiles")
      .upsert(
        {
          id: user.id,
          full_name: fullName,
          username: username,
          avatar_url: avatarUrl
        },
        { onConflict: "id" }
      );

    if (saveError) throw saveError;

    $("profile-display-name").textContent = fullName;
    $("profile-username").textContent = "@" + username;

    setAvatar(
      $("profile-avatar"),
      $("profile-avatar-image"),
      avatarUrl,
      fullName
    );

    selectedAvatarFile = null;
    editAvatarInput.value = "";

    editProfileMessage.textContent = "Profile updated successfully!";
    toast("Profile updated successfully!");

    // Refresh the feed and the sidebar so the new name and photo show up.
    loadSavedReels();
    window.refreshReelTimeAccount?.();

    setTimeout(() => editProfileModal.classList.add("hidden"), 800);
  } catch (error) {
    console.error("Profile update failed:", error);
    editProfileMessage.textContent =
      error.code === "23505"
        ? "That username is already taken."
        : "Could not save. Check your Supabase profile policies.";
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = "Save changes";
  }
});

// --------------------------------------------------
// FOLLOWERS / FOLLOWING LISTS
// --------------------------------------------------

async function loadFollowList(listType) {
  const client = getClient();
  const listBox = $("follow-list");
  const listTitle = $("follow-list-title");
  const listContent = $("follow-list-content");

  if (!client || !listBox || !listTitle || !listContent) {
    toast("Could not open the follow list.");
    return;
  }

  listBox.hidden = false;
  listTitle.textContent = listType === "followers" ? "Followers" : "Following";
  listContent.replaceChildren();

  const loading = document.createElement("p");
  loading.className = "follow-list-message";
  loading.textContent = "Loading accounts...";
  listContent.appendChild(loading);

  try {
    const user = await getCurrentUser();

    if (!user) throw new Error("Please log in first.");

    const column = listType === "followers" ? "following_id" : "follower_id";
    const targetColumn = listType === "followers" ? "follower_id" : "following_id";

    const { data: followRows, error: followError } = await client
      .from("follows")
      .select(targetColumn)
      .eq(column, user.id);

    if (followError) throw followError;

    const accountIds = [
      ...new Set((followRows || []).map((row) => row[targetColumn]))
    ];

    listContent.replaceChildren();

    if (accountIds.length === 0) {
      const empty = document.createElement("p");
      empty.className = "follow-list-message";
      empty.textContent =
        listType === "followers"
          ? "You don't have any followers yet."
          : "You aren't following anyone yet.";
      listContent.appendChild(empty);
      return;
    }

    const { data: profiles, error: profilesError } = await client
      .from("profiles")
      .select("id, username, full_name, avatar_url")
      .in("id", accountIds);

    if (profilesError) throw profilesError;

    const profileMap = new Map(
      (profiles || []).map((profile) => [profile.id, profile])
    );

    accountIds.forEach((accountId) => {
      const profile = profileMap.get(accountId);
      const displayName =
        profile?.full_name || profile?.username || "ReelTime user";

      const item = document.createElement("div");
      item.className = "follow-list-item";
      item.style.cursor = "pointer";

      let avatar;

      if (profile?.avatar_url) {
        avatar = document.createElement("img");
        avatar.alt = "Profile photo";
        avatar.src = profile.avatar_url;
      } else {
        avatar = document.createElement("div");
        avatar.className = "avatar avatar-you";
        avatar.textContent = displayName.charAt(0).toUpperCase();
      }

      const details = document.createElement("div");

      const name = document.createElement("div");
      name.className = "follow-list-name";
      name.textContent = displayName;

      const username = document.createElement("div");
      username.textContent = profile?.username ? "@" + profile.username : "";

      details.append(name, username);
      item.append(avatar, details);

      item.addEventListener("click", () => openOtherUserProfile(accountId));

      listContent.appendChild(item);
    });
  } catch (error) {
    console.error("Could not load follow list:", error);
    listContent.replaceChildren();

    const message = document.createElement("p");
    message.className = "follow-list-message";
    message.textContent =
      error.message || "Could not load accounts. Please try again.";
    listContent.appendChild(message);
  }
}

$("show-followers-btn")?.addEventListener("click", () => loadFollowList("followers"));
$("show-following-btn")?.addEventListener("click", () => loadFollowList("following"));
$("close-follow-list")?.addEventListener("click", () => {
  $("follow-list").hidden = true;
});

// --------------------------------------------------
// OTHER CREATORS' PROFILES
// --------------------------------------------------

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

  try {
    const [profileRes, reelsRes, followersRes, followingRes] = await Promise.all([
      client
        .from("profiles")
        .select("id, username, full_name, avatar_url")
        .eq("id", userId)
        .maybeSingle(),
      client
        .from("reels")
        .select("id, caption, video_path, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false }),
      client
        .from("follows")
        .select("*", { count: "exact", head: true })
        .eq("following_id", userId),
      client
        .from("follows")
        .select("*", { count: "exact", head: true })
        .eq("follower_id", userId)
    ]);

    for (const result of [profileRes, reelsRes, followersRes, followingRes]) {
      if (result.error) throw result.error;
    }

    const profile = profileRes.data;

    if (!profile) {
      toast("Creator profile not found.");
      showFeed();
      return;
    }

    const displayName = profile.full_name || profile.username || "Creator";
    const creatorReels = reelsRes.data || [];

    $("other-profile-display-name").textContent = displayName;
    $("other-profile-username").textContent = "@" + (profile.username || "creator");

    setAvatar(letterEl, imageEl, profile.avatar_url, displayName);

    $("other-profile-reel-count").textContent = creatorReels.length;
    $("other-profile-follower-count").textContent = followersRes.count || 0;
    $("other-profile-following-count").textContent = followingRes.count || 0;

    renderProfileTiles(
      $("other-profile-reels"),
      $("other-profile-empty"),
      creatorReels
    );
  } catch (error) {
    console.error("Could not load creator profile:", error);
    toast("Could not load this profile. Check the browser console.");
  }
}

$("other-profile-back").addEventListener("click", () => showFeed());

$("other-profile-follow-btn").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const userId = button.dataset.userId;

  if (!userId) return;

  button.disabled = true;

  try {
    const wasFollowing = myFollowingIds.has(userId);
    const changed = await setFollow(userId, !wasFollowing);

    if (changed) {
      const countElement = $("other-profile-follower-count");

      countElement.textContent = Math.max(
        0,
        Number(countElement.textContent) + (wasFollowing ? -1 : 1)
      );

      toast(
        wasFollowing
          ? "You unfollowed this creator."
          : "You are now following this creator."
      );
    }
  } catch (error) {
    console.error("Follow action failed:", error);
    toast("Could not update follow status.");
  } finally {
    button.disabled = false;
  }
});

// --------------------------------------------------
// MESSAGES
// --------------------------------------------------

function setMessagesDot(show) {
  document
    .querySelectorAll(".nav-dot")
    .forEach((dot) => dot.classList.toggle("hidden", !show));
}

async function refreshMessagesDot() {
  const client = getClient();
  const user = await getCurrentUser();

  if (!client || !user) {
    setMessagesDot(false);
    return;
  }

  const { count, error } = await client
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("receiver_id", user.id)
    .is("read_at", null);

  if (error) {
    console.warn("Could not check unread messages:", error);
    return;
  }

  setMessagesDot((count || 0) > 0);
}

async function closeChatChannel() {
  const client = getClient();
  const channel = reelTimeChatChannel;

  reelTimeChatChannel = null;

  if (client && channel) await client.removeChannel(channel);
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

  showPage("messages-page", "Messages");

  $("chat-title").textContent = "Choose a creator to start chatting";
  $("chat-messages").replaceChildren();
  $("message-search-results").replaceChildren();
  $("message-status").textContent = "Search for a creator to start chatting.";

  await loadRecentChats();
}

async function searchMessageUsers() {
  const client = getClient();
  const input = $("message-user-search");
  const results = $("message-search-results");
  const status = $("message-status");

  if (!client || !input || !results || !status) {
    toast("Messages HTML is missing.");
    return;
  }

  const term = input.value.trim().replace(/^@/, "");

  results.replaceChildren();
  status.textContent = "Searching...";

  if (!term) {
    status.textContent = "Enter a username to search.";
    return;
  }

  const user = await getCurrentUser();

  if (!user) {
    status.textContent = "Please log in again.";
    return;
  }

  reelTimeChatUserId = user.id;

  const { data, error } = await client
    .from("profiles")
    .select("id, username, full_name, avatar_url")
    .ilike("username", `%${term}%`)
    .limit(20);

  if (error) {
    console.error("Profile search error:", error);
    status.textContent = "Search failed: " + error.message;
    return;
  }

  const otherUsers = (data || []).filter((profile) => profile.id !== user.id);

  if (otherUsers.length === 0) {
    status.textContent =
      "No matching profiles found. If you expected results, check the profiles SELECT policy.";
    return;
  }

  otherUsers.forEach((profile) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "message-user-result";
    button.textContent =
      `${profile.full_name || profile.username} (@${profile.username})`;

    button.addEventListener("click", () => openChatWithUser(profile));
    results.appendChild(button);
  });

  status.textContent = "Select a creator to open the chat.";
}

function addChatMessage(message, myId) {
  const container = $("chat-messages");

  if (
    !container ||
    container.querySelector(`[data-message-id="${message.id}"]`)
  ) {
    return;
  }

  const item = document.createElement("div");
  item.className = "chat-message" + (message.sender_id === myId ? " mine" : "");
  item.dataset.messageId = message.id;
  item.dataset.createdAt = String(new Date(message.created_at).getTime());

  const text = document.createElement("div");
  text.textContent = message.message_text;

  const time = document.createElement("small");
  time.textContent = new Date(message.created_at).toLocaleString();

  item.append(text, time);

  if (message.sender_id === myId) {
    const receipt = document.createElement("small");
    receipt.className = "chat-read-status";
    receipt.dataset.readReceipt = message.id;
    receipt.textContent = message.read_at ? "Read ✓✓" : "Sent ✓";
    item.appendChild(receipt);
  }

  // Insert each message according to its timestamp.
  const messageTime = Number(item.dataset.createdAt);

  const nextItem = Array.from(
    container.querySelectorAll("[data-message-id]")
  ).find((existing) => Number(existing.dataset.createdAt) > messageTime);

  if (nextItem) {
    container.insertBefore(item, nextItem);
  } else {
    container.appendChild(item);
    container.scrollTop = container.scrollHeight;
  }
}

async function openChatWithUser(profile) {
  const client = getClient();

  await closeChatChannel();

  reelTimeChatUser = profile;

  $("chat-title").textContent = `Chat with ${profile.full_name || profile.username}`;
  $("chat-messages").replaceChildren();
  $("message-status").textContent = "Loading messages...";

  const myId = reelTimeChatUserId;
  const otherId = profile.id;

  const { data, error } = await client
    .from("messages")
    .select("id, sender_id, receiver_id, message_text, created_at, read_at")
    .or(
      `and(sender_id.eq.${myId},receiver_id.eq.${otherId}),and(sender_id.eq.${otherId},receiver_id.eq.${myId})`
    )
    .order("created_at", { ascending: true })
    .limit(500);

  if (error) {
    console.error("Loading chat failed:", error);
    $("message-status").textContent =
      "Could not load messages. Check the messages table permissions.";
    return;
  }

  (data || []).forEach((message) => addChatMessage(message, myId));

  const chatContainer = $("chat-messages");
  requestAnimationFrame(() => {
    chatContainer.scrollTop = chatContainer.scrollHeight;
  });

  // Mark unread incoming messages as read.
  const unreadIds = (data || [])
    .filter((message) => message.receiver_id === myId && !message.read_at)
    .map((message) => message.id);

  if (unreadIds.length > 0) {
    const { error: readError } = await client
      .from("messages")
      .update({ read_at: new Date().toISOString() })
      .in("id", unreadIds)
      .eq("receiver_id", myId);

    if (readError) {
      console.error("Marking messages as read failed:", readError);
      $("message-status").textContent =
        "Chat opened, but read receipts could not be saved.";
    } else {
      refreshMessagesDot();
    }
  }

  // Subscribe to new messages and read-receipt updates.
  // The timestamp keeps the channel name unique if the same chat is reopened.
  reelTimeChatChannel = client
    .channel(`chat-${myId}-${otherId}-${Date.now()}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "messages" },
      (payload) => {
        const message = payload.new;

        if (!message || !message.sender_id) return;

        const relevant =
          (message.sender_id === myId && message.receiver_id === otherId) ||
          (message.sender_id === otherId && message.receiver_id === myId);

        if (!relevant) return;

        if (payload.eventType === "INSERT") {
          addChatMessage(message, myId);

          // Mark a message as read when it arrives in the open chat.
          if (message.receiver_id === myId && !message.read_at) {
            client
              .from("messages")
              .update({ read_at: new Date().toISOString() })
              .eq("id", message.id)
              .eq("receiver_id", myId)
              .is("read_at", null)
              .then(({ error: updateError }) => {
                if (updateError) {
                  console.error("Read receipt update failed:", updateError);
                } else {
                  refreshMessagesDot();
                }
              });
          }
        }

        if (payload.eventType === "UPDATE" && message.read_at) {
          const receipt = document.querySelector(
            `[data-read-receipt="${message.id}"]`
          );

          if (receipt) receipt.textContent = "Read ✓✓";
        }
      }
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        $("message-status").textContent = "Live chat connected.";
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        $("message-status").textContent =
          "Live connection failed. Check Supabase Realtime and permissions.";
      }
    });
}

$("message-search-btn")?.addEventListener("click", searchMessageUsers);

$("message-user-search")?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    searchMessageUsers();
  }
});

$("message-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const client = getClient();
  const input = $("message-input");
  const messageText = input.value.trim();

  if (!reelTimeChatUser) {
    $("message-status").textContent = "Search for and select a creator first.";
    return;
  }

  if (!messageText) return;

  const button = event.currentTarget.querySelector('button[type="submit"]');
  if (button) button.disabled = true;

  try {
    const { data, error } = await client
      .from("messages")
      .insert({
        sender_id: reelTimeChatUserId,
        receiver_id: reelTimeChatUser.id,
        message_text: messageText
      })
      .select("id, sender_id, receiver_id, message_text, created_at")
      .single();

    if (error) throw error;

    addChatMessage(data, reelTimeChatUserId);
    input.value = "";
    $("message-status").textContent = "Message sent.";
  } catch (error) {
    console.error("Sending message failed:", error);
    $("message-status").textContent =
      "Message failed to send. Check the console and table permissions.";
  } finally {
    if (button) button.disabled = false;
    input.focus();
  }
});

$("messages-back-btn")?.addEventListener("click", () => showFeed());

async function loadRecentChats() {
  const client = getClient();
  const container = $("recent-chats");

  if (!client || !container) return;

  const user = await getCurrentUser();

  if (!user) {
    container.textContent = "Please log in to view chats.";
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
    container.textContent = "Could not load recent chats.";
    return;
  }

  const latestByUser = new Map();
  const unreadCounts = new Map();

  (messages || []).forEach((message) => {
    const otherId =
      message.sender_id === user.id ? message.receiver_id : message.sender_id;

    // Messages arrive newest first, so the first one is the latest.
    if (!latestByUser.has(otherId)) latestByUser.set(otherId, message);

    // Count only incoming messages that haven't been read.
    if (message.receiver_id === user.id && message.read_at === null) {
      unreadCounts.set(otherId, (unreadCounts.get(otherId) || 0) + 1);
    }
  });

  const otherIds = [...latestByUser.keys()];
  container.replaceChildren();

  if (otherIds.length === 0) {
    container.textContent = "No conversations yet.";
    return;
  }

  const { data: profiles, error: profileError } = await client
    .from("profiles")
    .select("id, username, full_name, avatar_url")
    .in("id", otherIds);

  if (profileError) {
    console.error("Recent chat profiles error:", profileError);
    container.textContent = "Could not load chat usernames.";
    return;
  }

  const profileMap = new Map(
    (profiles || []).map((profile) => [profile.id, profile])
  );

  otherIds.forEach((otherId) => {
    const profile = profileMap.get(otherId);
    if (!profile) return;

    const latest = latestByUser.get(otherId);
    const unread = unreadCounts.get(otherId) || 0;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "message-user-result";

    const previewText = String(latest.message_text || "");
    const shortPreview =
      previewText.length > 45 ? previewText.slice(0, 45) + "…" : previewText;

    button.textContent =
      `@${profile.username} — ${shortPreview}` +
      (unread > 0 ? ` · ${unread} unread` : "");

    if (unread > 0) {
      button.classList.add("has-unread");
      button.setAttribute(
        "aria-label",
        `${profile.username}, ${unread} unread messages`
      );
    }

    button.addEventListener("click", async () => {
      await openChatWithUser(profile);
      await loadRecentChats();
    });

    container.appendChild(button);
  });

  if (!container.childElementCount) {
    container.textContent = "No visible chat profiles found.";
  }
}

// --------------------------------------------------
// NOTIFICATIONS
// --------------------------------------------------

function setNotificationBadge(count) {
  const badge = $("notification-count");
  if (!badge) return;

  badge.textContent = String(count);
  badge.classList.toggle("hidden", count === 0);
}

async function refreshNotificationBadge() {
  const client = getClient();
  const user = await getCurrentUser();

  if (!client || !user) {
    setNotificationBadge(0);
    return;
  }

  const { count, error } = await client
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("recipient_id", user.id)
    .eq("is_read", false);

  if (error) {
    console.warn("Could not count notifications:", error);
    return;
  }

  setNotificationBadge(count || 0);
}

async function loadNotifications() {
  const client = getClient();
  const list = $("notifications-list");

  if (!client || !list) return;

  const user = await getCurrentUser();

  if (!user) {
    setListMessage(list, "Please log in to view notifications.");
    setNotificationBadge(0);
    return;
  }

  const { data, error } = await client
    .from("notifications")
    .select("id, actor_id, type, reel_id, message, is_read, created_at")
    .eq("recipient_id", user.id)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error("Loading notifications failed:", error);
    setListMessage(list, "Could not load notifications.");
    return;
  }

  const notifications = data || [];

  setNotificationBadge(notifications.filter((n) => !n.is_read).length);

  if (notifications.length === 0) {
    setListMessage(list, "You're all caught up! No notifications yet.");
    return;
  }

  list.replaceChildren();

  notifications.forEach((notification) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "notification-item";

    if (!notification.is_read) item.classList.add("notification-unread");

    const message = document.createElement("span");
    message.textContent = notification.message;

    const time = document.createElement("small");
    time.textContent = new Date(notification.created_at).toLocaleString();

    item.append(message, time);

    item.addEventListener("click", async () => {
      if (!notification.is_read) {
        const { error: updateError } = await client
          .from("notifications")
          .update({ is_read: true })
          .eq("id", notification.id)
          .eq("recipient_id", user.id);

        if (updateError) {
          console.error("Marking notification as read failed:", updateError);
          toast("Could not mark notification as read.");
          return;
        }

        notification.is_read = true;
        item.classList.remove("notification-unread");
        refreshNotificationBadge();
      }

      // Follows open the follower's profile; likes and comments open the Reel.
      if (notification.type === "follow" && notification.actor_id) {
        openOtherUserProfile(notification.actor_id);
      } else if (notification.reel_id) {
        await showFeed(notification.reel_id);

        if (notification.type === "comment") {
          const target = reels.find(
            (item) => String(item.id) === String(notification.reel_id)
          );

          if (target) openComments(target);
        }
      }
    });

    list.appendChild(item);
  });
}

async function openNotificationsPage() {
  const client = getClient();

  if (!client) {
    toast("Supabase is not connected.");
    return;
  }

  const user = await getCurrentUser();

  if (!user) {
    promptLogin("Please log in to view notifications.");
    return;
  }

  showPage("notifications-page", "Notifications");
  await loadNotifications();
}

$("notifications-btn")?.addEventListener("click", openNotificationsPage);
$("notifications-back-btn")?.addEventListener("click", () => showFeed());

// --------------------------------------------------
// LIVE UPDATES (unread messages dot + notification badge)
// --------------------------------------------------

function stopRealtime() {
  const client = getClient();

  if (client && reelTimeRealtimeChannel) {
    client.removeChannel(reelTimeRealtimeChannel);
  }

  reelTimeRealtimeChannel = null;
}

function startRealtime(user) {
  const client = getClient();

  if (!client) return;

  stopRealtime();

  reelTimeRealtimeChannel = client
    .channel(`reeltime-inbox-${user.id}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "messages" },
      (payload) => {
        const message = payload.new || {};

        if (message.sender_id !== user.id && message.receiver_id !== user.id) {
          return;
        }

        refreshMessagesDot();

        if (!$("messages-page").classList.contains("hidden")) {
          loadRecentChats();
        }
      }
    )
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "notifications",
        filter: `recipient_id=eq.${user.id}`
      },
      () => {
        refreshNotificationBadge();

        if (!$("notifications-page").classList.contains("hidden")) {
          loadNotifications();
        }
      }
    )
    .subscribe();
}

// Runs once at start-up and whenever someone logs in or out.
async function onUserChanged(user, initial = false) {
  window.currentReelTimeUserId = user?.id || null;

  stopRealtime();
  await loadSavedReels();

  if (initial) openReelFromHash();

  if (user) {
    startRealtime(user);
    refreshNotificationBadge();
    refreshMessagesDot();
  } else {
    setNotificationBadge(0);
    setMessagesDot(false);
    if (!initial) showFeed();
  }
}

// --------------------------------------------------
// SIDEBAR / BOTTOM NAVIGATION AND OTHER BUTTONS
// --------------------------------------------------

document.querySelectorAll(".follow-btn").forEach((button) => {
  button.addEventListener("click", async () => {
    const creatorId = button.dataset.userId;

    // Demo creators have no real profile, so they toggle locally.
    if (!creatorId) {
      const nowFollowing = !button.classList.contains("following");
      button.classList.toggle("following", nowFollowing);
      button.textContent = nowFollowing ? "Following" : "Follow";
      toast(nowFollowing ? "Following creator!" : "Unfollowed creator.");
      return;
    }

    button.disabled = true;

    try {
      const wasFollowing = myFollowingIds.has(creatorId);
      const changed = await setFollow(creatorId, !wasFollowing);

      if (changed) {
        button.classList.toggle("following", !wasFollowing);
        button.textContent = wasFollowing ? "Follow" : "Following";
        toast(wasFollowing ? "Unfollowed creator." : "Following creator!");
      }
    } catch (error) {
      console.error("Follow error:", error);
      toast("Could not update follow. Please try again.");
    } finally {
      button.disabled = false;
    }
  });
});

$("refresh-suggestions")?.addEventListener("click", () => {
  toast("You're all caught up on suggestions!");
});

$("settings-btn")?.addEventListener("click", () => {
  window.openReelTimeAuth?.("login");
});

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", async () => {
    const view = button.dataset.view;

    if ((view === "messages" || view === "profile") && !(await getCurrentUser())) {
      promptLogin(
        view === "messages"
          ? "Please log in to use Messages."
          : "Please log in to view your profile."
      );
      return;
    }

    setActiveNav(view);

    if (view === "messages") {
      openMessagesPage();
    } else if (view === "profile") {
      loadMyProfile();
    } else if (view === "discover") {
      await showFeed();
      setTitle("Discover creators");
      $("search-input")?.focus();
      toast("Search creators using the search bar.");
    } else {
      showFeed();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  });
});

// --------------------------------------------------
// SUPABASE EMAIL/PASSWORD AUTHENTICATION
// --------------------------------------------------

(function setupReelTimeAuth() {
  const client = getClient();

  const avatarButton = $("auth-profile-btn");
  const form = $("auth-form");
  const loginTab = $("auth-login-tab");
  const signupTab = $("auth-signup-tab");
  const nameWrap = $("auth-name-wrap");
  const nameInput = $("auth-name");
  const emailInput = $("auth-email");
  const passwordInput = $("auth-password");
  const title = $("auth-title");
  const intro = $("auth-intro");
  const submitButton = $("auth-submit");
  const message = $("auth-message");
  const logoutButton = $("auth-logout-btn");
  const sidebarLogoutButton = $("sidebar-logout-btn");
  const accountName = $("account-name");
  const accountStatus = $("account-status");

  let authMode = "login";
  let currentUser = null;
  let sessionReady = false;

  function setMessage(text, isError = false) {
    message.textContent = text || "";
    message.classList.toggle("error", Boolean(isError));
  }

  function setMode(mode) {
    authMode = mode;

    const signup = mode === "signup";

    loginTab.classList.toggle("active", !signup);
    signupTab.classList.toggle("active", signup);

    nameWrap.classList.toggle("hidden", !signup);
    nameInput.classList.toggle("hidden", !signup);
    nameInput.required = signup;

    passwordInput.autocomplete = signup ? "new-password" : "current-password";

    title.textContent = signup ? "Create your account" : "Log in to ReelTime";

    intro.textContent = signup
      ? "Join ReelTime and start building your creator profile."
      : "Log in to connect with creators and manage your profile.";

    submitButton.textContent = signup ? "Create account" : "Log in";

    logoutButton.classList.add("hidden");
    form.classList.remove("hidden");

    setMessage("");
  }

  function openAuth(mode = "login") {
    setMode(mode);

    if (currentUser) {
      title.textContent = "Your ReelTime account";
      intro.textContent = currentUser.email || "You are logged in.";

      form.classList.add("hidden");
      logoutButton.classList.remove("hidden");

      setMessage("You are logged in.");
    }

    openModal("auth-modal");
  }

  // Upgrade the sidebar label with the saved profile (name, @username, photo).
  async function refreshAccountProfile() {
    const user = currentUser;

    if (!client || !user) return;

    const { data } = await client
      .from("profiles")
      .select("username, full_name, avatar_url")
      .eq("id", user.id)
      .maybeSingle();

    if (!data || currentUser?.id !== user.id) return;

    if (data.full_name) accountName.textContent = data.full_name;
    if (data.username) accountStatus.textContent = "@" + data.username;

    if (data.avatar_url) {
      avatarButton.textContent = "";
      avatarButton.style.backgroundImage = `url("${data.avatar_url}")`;
      avatarButton.style.backgroundSize = "cover";
      avatarButton.style.backgroundPosition = "center";
    }
  }

  function updateAccount(user) {
    currentUser = user || null;
    window.currentReelTimeUserId = currentUser?.id || null;

    avatarButton.style.backgroundImage = "";

    if (currentUser) {
      const display =
        currentUser.user_metadata?.full_name ||
        currentUser.email?.split("@")[0] ||
        "Your profile";

      accountName.textContent = display;
      accountStatus.textContent = currentUser.email || "Logged in";
      avatarButton.textContent = (display.trim()[0] || "R").toUpperCase();

      setTimeout(refreshAccountProfile, 0);
    } else {
      accountName.textContent = "Your profile";
      accountStatus.textContent = "Welcome to ReelTime";
      avatarButton.textContent = "V";
    }
  }

  async function ensureProfile(user) {
    if (!client || !user) return;

    const fullName =
      user.user_metadata?.full_name ||
      user.email?.split("@")[0] ||
      "ReelTime user";

    const { error } = await client
      .from("profiles")
      .upsert(
        { id: user.id, full_name: fullName },
        { onConflict: "id", ignoreDuplicates: true }
      );

    if (error) {
      console.warn("Profile setup will retry later:", error.message);
    }
  }

  // Other parts of the app use these.
  window.openReelTimeAuth = openAuth;
  window.refreshReelTimeAccount = refreshAccountProfile;

  // The sidebar avatar opens your profile when logged in, or the login form.
  avatarButton?.addEventListener("click", () => {
    if (currentUser) {
      document.querySelector('.nav-item[data-view="profile"]')?.click();
    } else {
      openAuth("login");
    }
  });

  loginTab?.addEventListener("click", () => setMode("login"));
  signupTab?.addEventListener("click", () => setMode("signup"));

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!client) {
      setMessage(
        "Supabase did not load. Check your internet connection and refresh.",
        true
      );
      return;
    }

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    submitButton.disabled = true;
    submitButton.textContent =
      authMode === "signup" ? "Creating account…" : "Logging in…";

    setMessage("");

    try {
      if (authMode === "signup") {
        const fullName = nameInput.value.trim();

        const { data, error } = await client.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName } }
        });

        if (error) throw error;

        if (data.user && data.session) {
          await ensureProfile(data.user);

          setMessage("Account created successfully. You are now logged in.");
          toast("Welcome to ReelTime!");

          closeModal("auth-modal");
        } else {
          setMessage(
            "Account created. Check your email for a verification link, then log in."
          );
        }
      } else {
        const { data, error } = await client.auth.signInWithPassword({
          email,
          password
        });

        if (error) throw error;

        await ensureProfile(data.user);

        setMessage("Login successful!");
        toast("Welcome back to ReelTime!");

        closeModal("auth-modal");
      }

      passwordInput.value = "";
    } catch (error) {
      setMessage(error.message || "Something went wrong. Please try again.", true);
    } finally {
      submitButton.disabled = false;
      submitButton.textContent =
        authMode === "signup" ? "Create account" : "Log in";
    }
  });

  logoutButton?.addEventListener("click", async () => {
    if (!client) return;

    logoutButton.disabled = true;

    const { error } = await client.auth.signOut();

    logoutButton.disabled = false;

    if (error) {
      setMessage(error.message, true);
      return;
    }

    updateAccount(null);
    closeModal("auth-modal");

    toast("You have logged out.");
  });
  sidebarLogoutButton?.addEventListener("click", () => {
  logoutButton?.click();
});

  if (!client) {
    console.error(
      "Supabase client is missing. Check supabase.js and script order in index.html."
    );
    return;
  }

  client.auth
    .getSession()
    .then(async ({ data, error }) => {
      if (error) console.warn("Could not restore session:", error.message);

      const user = data?.session?.user || null;

      updateAccount(user);

      if (user) await ensureProfile(user);

      sessionReady = true;
      await onUserChanged(user, true);
    })
    .catch((error) => {
      console.error("Could not start the session:", error);
      sessionReady = true;
      loadSavedReels();
    });

  client.auth.onAuthStateChange((_event, session) => {
    const user = session?.user || null;
    const changed = (user?.id || null) !== (currentUser?.id || null);

    updateAccount(user);

    // Defer Supabase calls: they must not run inside this callback.
    if (user) setTimeout(() => ensureProfile(user), 0);
    if (changed && sessionReady) setTimeout(() => onUserChanged(user), 0);
  });
})();

// --------------------------------------------------
// START
// --------------------------------------------------

setMessagesDot(false); // shown only when there are unread messages
renderFeed();          // demo Reels appear instantly; saved Reels load after
renderStories();

/* ReelTime PWA installation */
(() => {
  let installPrompt = null;

  const installButton = document.getElementById("install-app-btn");

  if (!installButton) {
    console.warn("ReelTime install button was not found.");
    return;
  }

  // Register the service worker.
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("./sw.js")
        .catch((error) => {
          console.error("ReelTime service worker registration failed:", error);
        });
    });
  }

  // Chrome fires this when the website is eligible for installation.
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    installButton.hidden = false;
  });

  installButton.addEventListener("click", async () => {
    if (!installPrompt) {
      alert(
        'If installation is available, open Chrome menu (⋮) and choose "Install app" or "Add to Home screen".'
      );
      return;
    }

    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    installButton.hidden = true;
  });

  // Hide the button after successful installation.
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    installButton.hidden = true;
    console.log("ReelTime was installed.");
  });
})();
