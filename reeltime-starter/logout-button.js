// =====================================================
// ReelTime — logout-button.js
// Load LAST in index.html (after chat-media.js):
//   <script src="logout-button.js"></script>
// Adds a "Log out" button on your Profile page, next to "Edit profile".
// (The sidebar Log out button is hidden on phones, so this one is needed.)
// =====================================================

(function logoutButton() {
  const client = getClient();

  if (!client) return;

  const bio = document.querySelector("#profile-page .profile-bio");

  if (!bio || $("profile-logout-btn")) return;

  const button = document.createElement("button");

  button.id = "profile-logout-btn";
  button.type = "button";
  button.className = "primary-btn secondary";
  button.textContent = "Log out";
  button.style.marginLeft = "8px";

  button.addEventListener("click", async () => {
    button.disabled = true;

    try {
      await client.auth.signOut();
    } catch (error) {
      console.error("Log out failed:", error);
    }

    // Reload so calls, chats and saved data from this account are cleared.
    window.location.reload();
  });

  bio.appendChild(button);
})();
