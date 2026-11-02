"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { api, getToken } from "../api";
import AppShell from "../components/AppShell";
import { Avatar } from "../components/ui";
import { formatDateTime } from "../lib/format";
import { useAuth } from "../context/AuthContext";
import { useRealtime } from "../context/RealtimeContext";

export default function Chat() {
  const { workspaceId, channelId } = useParams();
  const { user } = useAuth();
  const { socket } = useRealtime();
  const [messages, setMessages] = useState([]);
  const [channels, setChannels] = useState([]);
  const [body, setBody] = useState("");
  const [files, setFiles] = useState([]);
  const [typing, setTyping] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const scroller = useRef(null);
  const fileInput = useRef(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [msgs, ch] = await Promise.all([
        api(`/api/channels/${channelId}/messages`),
        api(`/api/workspaces/${workspaceId}/channels`),
      ]);
      setMessages(msgs.messages);
      setChannels(ch.channels);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [channelId]);

  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (!socket) return undefined;
    socket.emit("channel:join", channelId);
    function onMessage({ message }) {
      if (String(message.channel) === channelId || String(message.channel?._id) === channelId) {
        setMessages((list) => (list.some((m) => m._id === message._id) ? list : [...list, message]));
      }
    }
    function onTyping(payload) {
      if (payload.channelId !== channelId || payload.userId === (user?._id || user?.id)) return;
      setTyping(payload.typing ? `${payload.name} is typing…` : "");
    }
    socket.on("chat:message", onMessage);
    socket.on("chat:typing", onTyping);
    return () => {
      socket.off("chat:message", onMessage);
      socket.off("chat:typing", onTyping);
    };
  }, [socket, channelId, user]);

  async function send(e) {
    e.preventDefault();
    if (!body.trim() && files.length === 0) return;
    const form = new FormData();
    form.append("body", body);
    [...files].forEach((f) => form.append("files", f));
    try {
      await fetch(`/api/channels/${channelId}/messages`, {
        method: "POST",
        body: form,
        credentials: "include",
        headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {},
      }).then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Send failed");
        return data;
      });
      setBody("");
      setFiles([]);
      if (fileInput.current) fileInput.current.value = "";
      socket?.emit("chat:typing", { channelId, typing: false });
    } catch (err) {
      setError(err.message);
    }
  }

  const channel = channels.find((c) => c._id === channelId);
  const myId = user?._id || user?.id;

  return (
    <AppShell>
      <div className="page-head">
        <div className="grow">
          <h1># {channel?.name || "chat"}</h1>
          <p className="muted">
            {typing || (channel?.members ? `${channel.members.length} member${channel.members.length === 1 ? "" : "s"} · messages are saved and reload after reconnect` : "Messages are saved and reload after reconnect")}
          </p>
        </div>
      </div>
      {error && <div className="error" role="alert">{error}</div>}
      <div className="chat">
        <div className="messages" ref={scroller}>
          {loading && <div className="skeleton" />}
          {!loading && messages.length === 0 && <div className="empty">No messages yet. Say hello 👋</div>}
          {messages.map((m, i) => {
            const mine = (m.sender?._id || m.sender?.id) === myId;
            const prev = messages[i - 1];
            const grouped = prev && (prev.sender?._id || prev.sender?.id) === (m.sender?._id || m.sender?.id) && new Date(m.createdAt) - new Date(prev.createdAt) < 5 * 60 * 1000;
            return (
              <div className={`msg ${mine ? "mine" : ""} ${grouped ? "grouped" : ""}`} key={m._id}>
                {!grouped ? <Avatar user={m.sender} size={32} /> : <span className="msg-gap" />}
                <div className="msg-main">
                  {!grouped && (
                    <div className="msg-head">
                      <strong>{m.sender?.name}</strong> <span className="muted">{formatDateTime(m.createdAt)}</span>
                    </div>
                  )}
                  {m.body && <div className="bubble">{m.body}</div>}
                  {m.attachments?.length > 0 && (
                    <div className="attachments">
                      {m.attachments.map((a) => (
                        <a className="attachment" key={a.url} href={a.url} target="_blank" rel="noreferrer">
                          📎 {a.originalName}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {files.length > 0 && (
          <div className="file-queue">
            {[...files].map((f) => (
              <span className="chip" key={f.name}>{f.name}</span>
            ))}
            <button type="button" className="link-btn" onClick={() => { setFiles([]); if (fileInput.current) fileInput.current.value = ""; }}>Clear</button>
          </div>
        )}
        <form className="composer" onSubmit={send}>
          <label className="btn secondary icon-btn attach" title="Attach files">
            📎
            <input ref={fileInput} type="file" multiple hidden onChange={(e) => setFiles([...e.target.files])} />
          </label>
          <input
            value={body}
            placeholder={`Message #${channel?.name || "channel"}`}
            maxLength={4000}
            aria-label="Message"
            onChange={(e) => {
              setBody(e.target.value);
              socket?.emit("chat:typing", { channelId, typing: e.target.value.length > 0 });
            }}
          />
          <button className="btn" disabled={!body.trim() && files.length === 0}>Send</button>
        </form>
      </div>
    </AppShell>
  );
}
