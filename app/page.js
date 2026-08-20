"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

function initials(name) {
  if (!name) return "?";
  return name.trim().charAt(0).toUpperCase();
}

function timeAgo(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString("sw-TZ", { hour: "2-digit", minute: "2-digit" });
}

function AuthForm({ onClose }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message === "Invalid login credentials" ? "Barua pepe au password si sahihi." : error.message);
      else onClose();
    } else {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) setError(error.message);
      else onClose();
    }
    setBusy(false);
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="auth-card" onClick={(e) => e.stopPropagation()}>
        <div className="auth-tabs">
          <button className={mode === "login" ? "auth-tab active" : "auth-tab"} onClick={() => setMode("login")}>Ingia</button>
          <button className={mode === "signup" ? "auth-tab active" : "auth-tab"} onClick={() => setMode("signup")}>Jisajili</button>
        </div>
        <form onSubmit={submit} className="auth-form">
          <label>Barua pepe<input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="wewe@mfano.com" /></label>
          <label>Password<input type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)} placeholder="......" /></label>
          {error && <div className="auth-error">{error}</div>}
          <button className="primary-btn" type="submit" disabled={busy}>{busy ? "Inashughulikia..." : mode === "login" ? "Ingia" : "Jisajili"}</button>
        </form>
      </div>
    </div>
  );
}

export default function Home() {
  const [user, setUser] = useState(null);
  const [showAuth, setShowAuth] = useState(false);
  const [profile, setProfile] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [tab, setTab] = useState("mazungumzo");
  const [activeChat, setActiveChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user || null);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    ensureProfile();
    loadContacts();
    loadConversations();
  }, [user]);

  async function ensureProfile() {
    const { data } = await supabase.from("chat_profiles").select("*").eq("id", user.id).single();
    if (data) {
      setProfile(data);
    } else {
      const name = user.email.split("@")[0];
      await supabase.from("chat_profiles").insert([{ id: user.id, email: user.email, full_name: name }]);
      setProfile({ id: user.id, email: user.email, full_name: name });
    }
  }

  async function loadContacts() {
    const { data } = await supabase.from("chat_profiles").select("*").neq("id", user.id).order("full_name");
    if (data) setContacts(data);
  }

  async function loadConversations() {
    const { data } = await supabase
      .from("messages")
      .select("*")
      .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
      .order("created_at", { ascending: false });
    if (!data) return;
    const map = new Map();
    for (const m of data) {
      const partnerId = m.sender_id === user.id ? m.receiver_id : m.sender_id;
      if (!map.has(partnerId)) {
        map.set(partnerId, { partnerId, lastMessage: m.content, lastTime: m.created_at });
      }
    }
    const partnerIds = Array.from(map.keys());
    if (!partnerIds.length) {
      setConversations([]);
      return;
    }
    const { data: profiles } = await supabase.from("chat_profiles").select("*").in("id", partnerIds);
    const list = partnerIds.map((pid) => {
      const p = profiles?.find((pr) => pr.id === pid);
      const info = map.get(pid);
      return { ...info, profile: p };
    }).filter((c) => c.profile);
    setConversations(list);
  }

  async function openChat(contact) {
    setActiveChat(contact);
    const { data } = await supabase
      .from("messages")
      .select("*")
      .or(`and(sender_id.eq.${user.id},receiver_id.eq.${contact.id}),and(sender_id.eq.${contact.id},receiver_id.eq.${user.id})`)
      .order("created_at", { ascending: true });
    if (data) setMessages(data);
  }

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("messages-realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
        const m = payload.new;
        const involvesMe = m.sender_id === user.id || m.receiver_id === user.id;
        if (!involvesMe) return;
        if (activeChat && (m.sender_id === activeChat.id || m.receiver_id === activeChat.id)) {
          setMessages((prev) => [...prev, m]);
        }
        loadConversations();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, activeChat]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage(e) {
    e.preventDefault();
    if (!newMessage.trim() || !activeChat) return;
    setSending(true);
    const content = newMessage.trim();
    setNewMessage("");
    const { error } = await supabase.from("messages").insert([{
      sender_id: user.id,
      receiver_id: activeChat.id,
      content,
    }]);
    if (error) {
      setNewMessage(content);
    }
    setSending(false);
  }

  async function logout() {
    await supabase.auth.signOut();
    setActiveChat(null);
  }

  async function startVideoCall() {
    if (!activeChat) return;
    const ids = [user.id, activeChat.id].sort().join("-").replace(/[^a-zA-Z0-9-]/g, "");
    const roomUrl = `https://meet.jit.si/FrahChat-${ids}`;
    await supabase.from("messages").insert([{
      sender_id: user.id,
      receiver_id: activeChat.id,
      content: `📹 Video Call imeanzishwa: ${roomUrl}`,
    }]);
    window.open(roomUrl, "_blank");
  }

  async function startVoiceCall() {
    if (!activeChat) return;
    const ids = [user.id, activeChat.id].sort().join("-").replace(/[^a-zA-Z0-9-]/g, "");
    const roomUrl = `https://meet.jit.si/FrahChat-${ids}#config.startAudioOnly=true`;
    await supabase.from("messages").insert([{
      sender_id: user.id,
      receiver_id: activeChat.id,
      content: `📞 Voice Call imeanzishwa: ${roomUrl}`,
    }]);
    window.open(roomUrl, "_blank");
  }

  const filteredContacts = useMemo(() => contacts, [contacts]);

  if (!user) {
    return (
      <main className="splash">
        <div className="splash-card">
          <h1>Frah Chat</h1>
          <p>Ungana na watu popote walipo, kwa uwazi na urahisi.</p>
          <button className="primary-btn" onClick={() => setShowAuth(true)}>Anza Sasa</button>
        </div>
        {showAuth && <AuthForm onClose={() => setShowAuth(false)} />}
      </main>
    );
  }

  if (activeChat) {
    return (
      <main className="chat-screen">
        <header className="chat-header">
          <button className="icon-btn" onClick={() => setActiveChat(null)}>←</button>
          <div className="chat-avatar">
            {activeChat.photo_url ? <img src={activeChat.photo_url} alt="" /> : <span>{initials(activeChat.full_name || activeChat.email)}</span>}
          </div>
          <div className="chat-header-info">
            <strong>{activeChat.full_name || activeChat.email}</strong>
            <span>{activeChat.status || "Mtandaoni"}</span>
          </div>
          <button className="icon-btn video-btn" onClick={startVoiceCall}>📞</button>
          <button className="icon-btn video-btn" onClick={startVideoCall}>📹</button>
        </header>
        <div className="messages-list">
          {messages.map((m) => (
            <div key={m.id} className={m.sender_id === user.id ? "bubble bubble-me" : "bubble bubble-them"}>
              {m.content.includes("meet.jit.si") ? (
                <span>
                  {m.content.includes("Voice Call") ? "📞 Voice Call" : "📹 Video Call"}{" "}
                  <a
                    href={m.content.split(": ")[1]}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="call-link"
                  >
                    Jiunge sasa →
                  </a>
                </span>
              ) : (
                <span>{m.content}</span>
              )}
              <small>{timeAgo(m.created_at)}</small>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
        <form className="chat-input-bar" onSubmit={sendMessage}>
          <input
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Andika ujumbe..."
          />
          <button type="submit" disabled={sending} className="send-btn">➤</button>
        </form>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="chat-avatar">
          {profile?.photo_url ? <img src={profile.photo_url} alt="" /> : <span>{initials(profile?.full_name || user.email)}</span>}
        </div>
        <strong>Frah Chat</strong>
        <button className="icon-btn" onClick={logout}>Toka</button>
      </header>

      <div className="tabs-row">
        <button className={tab === "mazungumzo" ? "tab-btn active" : "tab-btn"} onClick={() => setTab("mazungumzo")}>Mazungumzo</button>
        <button className={tab === "watu" ? "tab-btn active" : "tab-btn"} onClick={() => setTab("watu")}>Watu Wote</button>
      </div>

      {tab === "mazungumzo" ? (
        <div className="list">
          {!conversations.length ? (
            <div className="empty-state">Bado huna mazungumzo. Nenda "Watu Wote" kuanza mazungumzo mapya.</div>
          ) : (
            conversations.map((c) => (
              <button className="list-row" key={c.partnerId} onClick={() => openChat(c.profile)}>
                <div className="chat-avatar">
                  {c.profile.photo_url ? <img src={c.profile.photo_url} alt="" /> : <span>{initials(c.profile.full_name || c.profile.email)}</span>}
                </div>
                <div className="list-row-info">
                  <strong>{c.profile.full_name || c.profile.email}</strong>
                  <span>{c.lastMessage}</span>
                </div>
                <span className="list-row-time">{timeAgo(c.lastTime)}</span>
              </button>
            ))
          )}
        </div>
      ) : (
        <div className="list">
          {!filteredContacts.length ? (
            <div className="empty-state">Hakuna watu wengine bado.</div>
          ) : (
            filteredContacts.map((c) => (
              <button className="list-row" key={c.id} onClick={() => openChat(c)}>
                <div className="chat-avatar">
                  {c.photo_url ? <img src={c.photo_url} alt="" /> : <span>{initials(c.full_name || c.email)}</span>}
                </div>
                <div className="list-row-info">
                  <strong>{c.full_name || c.email}</strong>
                  <span>{c.status || "Mtandaoni"}</span>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </main>
  );
}
