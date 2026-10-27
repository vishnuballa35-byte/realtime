// =====================================================
// ReelTime — e2ee.js
// End-to-end encryption for chat messages.
// Load AFTER app.js and BEFORE instagram-extras.js.
//
// How it works (simple version):
//  1. Every device makes an ECDH P-256 key pair. The PRIVATE key is
//     stored in IndexedDB as a NON-EXTRACTABLE key (JavaScript can use
//     it but can never read it out). The PUBLIC key goes to
//     profiles.public_key.
//  2. For a chat, your private key + their public key give a shared
//     secret (ECDH). That becomes an AES-256-GCM key.
//  3. Messages are encrypted in the browser. Supabase only stores
//     "e2ee1.<iv>.<ciphertext>" and can never read the text.
//  4. The first public key you see for a person is pinned. If it ever
//     changes, you are warned (possible man-in-the-middle).
// =====================================================

const E2EE = (() => {
  const DB_NAME = "reeltime-e2ee";
  const PREFIX = "e2ee1.";
  const ECDH = { name: "ECDH", namedCurve: "P-256" };
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  const sharedKeys = new Map(); // peerId -> AES key
  const peerInfo = new Map();   // peerId -> { jwk, changed }
  let myKeys = null;
  let myId = null;

  // ---------- base64 helpers ----------
  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  // ---------- tiny IndexedDB key/value store ----------
  function db() {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open(DB_NAME, 1);
      open.onupgradeneeded = () => open.result.createObjectStore("kv");
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
  }
  async function idbGet(key) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const r = d.transaction("kv").objectStore("kv").get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  async function idbSet(key, value) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction("kv", "readwrite");
      t.objectStore("kv").put(value, key);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  }
  async function idbClear() {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction("kv", "readwrite");
      t.objectStore("kv").clear();
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  }

  // ---------- my key pair ----------
  // Keys are stored per user id, so two accounts on one browser never mix.
  async function init() {
    const client = getClient();
    const user = await getCurrentUser();
    if (!client || !user) return false;
    if (myKeys && myId === user.id) return true;

    myId = user.id;
    sharedKeys.clear();

    let pair = await idbGet("pair:" + user.id);
    let created = false;

    if (!pair) {
      // extractable:false -> the private key can never be exported.
      pair = await crypto.subtle.generateKey(ECDH, false, ["deriveKey"]);
      await idbSet("pair:" + user.id, pair);
      created = true;
    }

    myKeys = pair;

    const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
    const publicText = JSON.stringify({ crv: publicJwk.crv, kty: publicJwk.kty, x: publicJwk.x, y: publicJwk.y });

    const { data } = await client.from("profiles").select("public_key").eq("id", user.id).maybeSingle();

    if (created || data?.public_key !== publicText) {
      const { error } = await client.from("profiles").update({ public_key: publicText }).eq("id", user.id);
      if (error) console.warn("Could not publish your public key:", error.message);
      if (created && data?.public_key) {
        toast("New device key created. Older messages cannot be read on this device.");
      }
    }
    return true;
  }

  // ---------- peer public key (with pinning) ----------
  async function getPeer(peerId) {
    if (peerInfo.has(peerId)) return peerInfo.get(peerId);

    const client = getClient();
    const { data, error } = await client.from("profiles").select("public_key").eq("id", peerId).maybeSingle();
    if (error || !data?.public_key) throw new Error("This person has not set up encryption yet.");

    const pinKey = `pin:${myId}:${peerId}`;
    const pinned = await idbGet(pinKey);
    const changed = Boolean(pinned && pinned !== data.public_key);

    if (!pinned) await idbSet(pinKey, data.public_key); // trust on first use

    const info = { jwk: JSON.parse(data.public_key), text: data.public_key, changed };
    peerInfo.set(peerId, info);
    return info;
  }

  // Call after the person confirms a changed key is genuine.
  async function acceptNewKey(peerId) {
    const info = await getPeer(peerId);
    await idbSet(`pin:${myId}:${peerId}`, info.text);
    info.changed = false;
    sharedKeys.delete(peerId);
  }

  async function keyFor(peerId) {
    if (!(await init())) throw new Error("Please log in first.");
    if (sharedKeys.has(peerId)) return sharedKeys.get(peerId);

    const peer = await getPeer(peerId);
    if (peer.changed) throw new Error("KEY_CHANGED");

    const theirPublic = await crypto.subtle.importKey("jwk", peer.jwk, ECDH, false, []);
    const aes = await crypto.subtle.deriveKey(
      { name: "ECDH", public: theirPublic },
      myKeys.privateKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );

    sharedKeys.set(peerId, aes);
    return aes;
  }

  // The sender and receiver ids are bound into the ciphertext, so a
  // message cannot be replayed into a different conversation.
  const aad = (senderId, receiverId) => enc.encode(`${senderId}>${receiverId}`);

  // ---------- public API ----------
  async function encryptFor(peerId, text) {
    const key = await keyFor(peerId);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: aad(myId, peerId) },
      key,
      enc.encode(text)
    );
    return `${PREFIX}${b64(iv)}.${b64(ct)}`;
  }

  // Returns readable text for a message row. Never throws.
  async function decryptMessage(message) {
    const raw = message.message_text || "";
    if (!raw.startsWith(PREFIX)) return raw; // old plaintext / missed-call line

    try {
      const peerId = message.sender_id === myId ? message.receiver_id : message.sender_id;
      const key = await keyFor(peerId);
      const [iv, ct] = raw.slice(PREFIX.length).split(".");
      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: unb64(iv), additionalData: aad(message.sender_id, message.receiver_id) },
        key,
        unb64(ct)
      );
      return dec.decode(plain);
    } catch (error) {
      return error.message === "KEY_CHANGED" ? "⚠️ Security key changed" : "🔒 Message can't be decrypted on this device";
    }
  }

  // Adds message._text (readable) to a row.
  async function hydrate(message) {
    message._text = await decryptMessage(message);
    return message;
  }

  // 60-digit safety number. Both people see the SAME number; compare it
  // in person or on a call to be sure nobody is intercepting.
  async function safetyNumber(peerId) {
    await init();
    const mine = await crypto.subtle.exportKey("jwk", myKeys.publicKey);
    const mineText = JSON.stringify({ crv: mine.crv, kty: mine.kty, x: mine.x, y: mine.y });
    const peer = await getPeer(peerId);
    const ordered = [mineText, peer.text].sort().join("|");
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(ordered)));
    let digits = "";
    for (const byte of hash) digits += String(byte).padStart(3, "0");
    return digits.slice(0, 60).match(/.{5}/g).join(" ");
  }

  // ---------- clear chat / delete chat ----------
  // Clear chat  = hides every message for ME only (the other person keeps theirs).
  // Delete chat = permanently deletes the messages for BOTH people.
  async function clearChat(peerId) {
    const { error } = await getClient().rpc("clear_chat", { other_id: peerId });
    if (error) throw error;
  }

  async function deleteChat(peerId) {
    const user = await getCurrentUser();
    const { error } = await getClient()
      .from("messages")
      .delete()
      .or(`and(sender_id.eq.${user.id},receiver_id.eq.${peerId}),and(sender_id.eq.${peerId},receiver_id.eq.${user.id})`);
    if (error) throw error;
  }

  // On logout: forget everything held in memory. Keys stay on the device
  // (so you can read your history after logging in again) unless wipe=true.
  async function onLogout(wipe = false) {
    myKeys = null;
    myId = null;
    sharedKeys.clear();
    peerInfo.clear();
    if (wipe) await idbClear();
  }

  return { init, getPeer, encryptFor, decryptMessage, hydrate, safetyNumber, acceptNewKey, clearChat, deleteChat, onLogout, PREFIX };
})();

window.E2EE = E2EE;

// ---------- auto start ----------
// Publishes your public key as soon as you are logged in (so people can
// message you right away) and forgets keys held in memory on logout.
(function e2eeAutoStart() {
  const client = getClient();
  if (!client) return;

  getCurrentUser().then((user) => {
    if (user) E2EE.init().catch((error) => console.warn("E2EE start failed:", error));
  });

  client.auth.onAuthStateChange((_event, session) => {
    // Supabase calls must not run inside this callback.
    setTimeout(() => {
      if (session?.user) E2EE.init().catch((error) => console.warn("E2EE start failed:", error));
      else E2EE.onLogout();
    }, 0);
  });
})();
